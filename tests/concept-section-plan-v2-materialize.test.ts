import { describe, expect, test } from "bun:test"
import {
  buildConceptSectionPlansForSegment,
  anchorConceptFactsInVisibleText,
  materializeConceptSegmentV2,
  validateConceptVisibleFactCoverage,
  validateConceptSectionStructure,
  validateConceptSegmentV2AgainstPlans,
  validateConceptMicroCheckEvidenceDiscipline,
} from "../src/role-c-content/planning/concept-section-plan"
import { normalizeConceptSegment } from "../src/role-c-content/providers/staged-generation"
import { ModelBackedRoleCContentProvider } from "../src/role-c-content/providers/model-backed-provider"
import { validateConceptLesson } from "../src/role-c-content/validators/concept-validator"
import type { ConceptTutorRequest } from "../src/role-c-content/agents/types"
import type { ModelGateway, StructuredModelRequest } from "../src/role-c-content/contracts/model-gateway"
import { ROLE_C_PROMPT_MANIFEST_VERSION } from "../src/role-c-content/prompts"

function segmentRequest(targets: Array<{ objective_id: string; source_id: string; fact_ids: string[]; behavior: string }>, facts: Array<{ source_id: string; fact_id: string; content: string; capabilities?: string[] }>): ConceptTutorRequest {
  return {
    generation_spec: {
      schema_version: "1.0",
      spec_id: "SPEC-1",
      run_id: "RUN-1",
      targets: targets.map((t) => ({
        objective_id: t.objective_id,
        source_id: t.source_id,
        required_fact_ids: t.fact_ids,
        observable_behavior: t.behavior,
        importance: "core",
      })),
      evidence_content_hash: `sha256:${"1".repeat(64)}`,
      versions: {
        profile_version: "PROFILE-TEST",
        prompt_version: ROLE_C_PROMPT_MANIFEST_VERSION,
        model_config_hash: "MODEL-TEST",
        kb_version: "KB-TEST",
        rag_version: "RAG-TEST",
        schema_version: "1.0",
      },
      profile_ref: { profile_id: "PROFILE-1", profile_version: "PROFILE-TEST", profile_content_hash: `sha256:${"2".repeat(64)}` },
      path_node: { node_id: "NODE-1", goal: "x", target_source_ids: [...new Set(targets.map((t) => t.source_id))], prerequisite_source_ids: [] },
      learner_adaptation: {
        level: "basic",
        known_concepts: [],
        weak_concepts: [],
        preferred_contexts: [],
        scaffold_level: 2,
        reading_density: "medium",
        accommodations: [],
      },
      difficulty: { domain_complexity: 1, cognitive_demand: 1, reasoning_steps: 1, code_complexity: 0, prerequisite_load: 0, scaffold_strength: 2 },
      assessment_blueprint: { tier_1_count: 1, tier_2_count: 0, tier_3_count: 0, required_modalities: ["mcq"] },
      policies: {
        external_knowledge_allowed: false,
        citation_required: true,
        seed: 1,
        max_semantic_revision: 1,
        max_tool_retry: 1,
      },
      evidence_ref: "ev-1",
    },
    evidence_pack: {
      retrieval_id: "ev-1",
      results: [...new Set(targets.map((t) => t.source_id))].map((sourceId) => ({
        source_id: sourceId,
        title: "x",
        facts: facts.filter((f) => f.source_id === sourceId),
      })),
    },
  } as unknown as ConceptTutorRequest
}

const payloadV2 = {
  title: "Python 变量",
  objectives: [{
    objective_id: "O1",
    sections: [],
    micro_check: { prompt: "哪项正确？", options: ["整数", "小数"], answer: "整数", explanation: "int 表示整数" },
    hints: ["看事实", "找关键词", "代入判断"],
  }],
}

describe("改进方案5 审查修复：Section Plan V2 真实链路", () => {
  test("即时检查与三级提示保留完整的应用事实闭包，不在物化前截成四条", () => {
    const contents = ["列表保存有序元素。", "元素通过索引访问。", "append 向末尾添加元素。", "方括号创建列表。", "索引从 0 开始。", "列表可变。", "越界引发 IndexError。"]
    for (const behavior of ["apply", "create"]) {
      const facts = contents.map((content, i) => ({ source_id: "K009", fact_id: `F00${i + 1}`, content }))
      const request = segmentRequest([{ objective_id: "O1", source_id: "K009", fact_ids: facts.map(f => f.fact_id), behavior }], facts)
      const plans = buildConceptSectionPlansForSegment(request)
      expect(new Set(plans[0]!.micro_check.fact_ids)).toEqual(new Set(facts.map(f => f.fact_id)))
      const payload = structuredClone(payloadV2) as any
      payload.objectives[0].sections = plans[0]!.slots.map(s => ({ slot_id: s.slot_id, used_fact_ids: s.fact_ids, heading: "列表操作", body: "比较列表变化。检查元素。", steps: [], code: null }))
      const lesson = materializeConceptSegmentV2(request, payload, plans)
      expect(new Set(lesson.micro_checks[0]!.citations.map(c => c.fact_id))).toEqual(new Set(facts.map(f => f.fact_id)))
      for (const hint of lesson.hint_ladders[0]!.hints) expect(new Set(hint.citations.map(c => c.fact_id))).toEqual(new Set(facts.map(f => f.fact_id)))
    }
  })
  test("代码不经过文案清理：保留嵌套缩进、字符串内空格和词语", () => {
    const request = segmentRequest(
      [{ objective_id: "O1", source_id: "K007", fact_ids: ["F001"], behavior: "trace" }],
      [{ source_id: "K007", fact_id: "F001", content: "for 可遍历序列。" }],
    )
    const plans = buildConceptSectionPlansForSegment(request)
    const code = 'for row in [["RAG  example"]]:\n    for value in row:\n        print(value)'
    const payload = structuredClone(payloadV2) as any
    payload.objectives[0].sections = plans[0]!.slots.map(slot => ({
      slot_id: slot.slot_id, used_fact_ids: slot.fact_ids, heading: "遍历",
      body: "for 可遍历序列。依次处理其中的元素。", steps: [], code,
    }))
    const normalized = anchorConceptFactsInVisibleText({ payload, request, plans })
    expect(normalized.objectives[0]!.sections[0]!.code).toBe(code)
    const run = Bun.spawnSync(["python3", "-c", normalized.objectives[0]!.sections[0]!.code!])
    expect(run.exitCode).toBe(0)
    expect(run.stdout.toString()).toBe("RAG  example\n")
  })
  test("误区按完整纠错事实规划，不能只绑定首条主题事实或半条误区证据", () => {
    const request = segmentRequest(
      [{ objective_id: "O1", source_id: "K007", fact_ids: ["F001", "F005"], behavior: "trace" }],
      [{ source_id: "K007", fact_id: "F001", content: "for 可遍历序列。" },
        { source_id: "K007", fact_id: "F005", content: "range 不包含结束值。" }],
    )
    request.evidence_pack.results[0]!.misconceptions = [{
      misconceptionId: "M1", incorrectBelief: "range 包含结束值。", diagnosticSignals: [],
      counterexample: "range(3) 为 0、1、2。", correctionStrategy: "检查结束边界。", distractorTemplates: [],
      factRefs: [{ sourceId: "K007", factId: "F005" }],
    }]
    const plans = buildConceptSectionPlansForSegment(request)
    const slot = plans[0]!.slots.find(s => s.kind === "misconception")!
    expect(slot.fact_ids).toEqual(["F005"])
    expect(slot.misconception_belief).toBe("range 包含结束值。")
    const payload = structuredClone(payloadV2) as any
    payload.objectives[0].sections = plans[0]!.slots.map(s => ({
      slot_id: s.slot_id, used_fact_ids: s.fact_ids, heading: "端点辨析",
      body: "上界不是实际取到的最后一个数。需要在遍历时检查结束位置。", steps: [], code: null,
    }))
    expect(materializeConceptSegmentV2(request, payload, plans).misconceptions[0]!.citations.map(c => c.fact_id)).toEqual(["F005"])
    request.evidence_pack.results[0]!.misconceptions[0]!.factRefs.push({ sourceId: "K007", factId: "F999" })
    expect(buildConceptSectionPlansForSegment(request)[0]!.slots.find(s => s.kind === "misconception")!.misconception_belief).toBeUndefined()
  })
  test("段落改写同目标其他事实时保留显式引用，拒绝越界引用", () => {
    const request = segmentRequest(
      [{ objective_id: "O1", source_id: "K007", fact_ids: ["F001", "F002"], behavior: "trace" }],
      [
        { source_id: "K007", fact_id: "F001", content: "for 可遍历序列中的元素。" },
        { source_id: "K007", fact_id: "F002", content: "range 的 stop 不包含在结果中。" },
      ],
    )
    const plans = buildConceptSectionPlansForSegment(request)
    const payload = structuredClone(payloadV2) as any
    payload.objectives[0].sections = plans[0]!.slots.map(slot => ({
      slot_id: slot.slot_id, used_fact_ids: ["F002"], heading: "观察端点",
      body: "上界设为五时，最后一次取得的是四。", steps: [], code: null,
    }))
    const materialized = materializeConceptSegmentV2(request, payload, plans)
    const overview = materialized.explanation_blocks.find(block => block.block_type === "paragraph") as any
    expect(overview.claims.flatMap((claim: any) => claim.citations).some((c: any) => c.fact_id === "F002")).toBe(true)
    payload.objectives[0].sections[0].used_fact_ids = ["F999"]
    expect(validateConceptSectionStructure({ plan: plans[0]!, authored: payload.objectives[0] }).join("\n")).toContain("目标之外")
    expect(() => materializeConceptSegmentV2(request, payload, plans)).toThrow("FACT_OUT_OF_SCOPE")
  })
  test("模型省略空 steps/code 时先规范化，不以 TypeError 中断候选修复", () => {
    const request = segmentRequest(
      [{ objective_id: "O1", source_id: "K001", fact_ids: ["F001"], behavior: "explain" }],
      [{ source_id: "K001", fact_id: "F001", content: "Python 是一种通用编程语言。" }],
    )
    const plans = buildConceptSectionPlansForSegment(request)
    const payload = {
      title: "Python",
      objectives: [{
        objective_id: "O1",
        sections: plans[0]!.slots.map((slot) => ({
          slot_id: slot.slot_id,
          heading: "说明",
          body: "Python 是一种通用编程语言。这里用通俗语言说明它的类别。",
        })),
        micro_check: {
          prompt: "哪项正确？",
          options: ["Python 是一种通用编程语言", "Python 不是一种通用编程语言"],
          answer: "Python 是一种通用编程语言",
          explanation: "与事实一致",
        },
        hints: ["看类别", "对照事实", "判断描述"],
      }],
    } as any
    const normalized = anchorConceptFactsInVisibleText({ payload, request, plans })
    expect(normalized.objectives[0]!.sections.every((section) =>
      Array.isArray(section.steps) && section.code === null)).toBe(true)
  })

  test("规范讲解保留模型题目：越界即时检查交还作者修复，不替换成事实背诵题", () => {
    const request = segmentRequest(
      [{ objective_id: "O1", source_id: "K002", fact_ids: ["F001", "F002"], behavior: "explain" }],
      [
        { source_id: "K002", fact_id: "F001", content: "Python 使用 = 进行变量赋值。" },
        { source_id: "K002", fact_id: "F002", content: "变量名用于引用程序中的数据。" },
      ],
    )
    const plans = buildConceptSectionPlansForSegment(request)
    const payload = {
      title: "变量与赋值",
      objectives: [{
        objective_id: "O1",
        sections: plans[0]!.slots.map((slot) => ({
          slot_id: slot.slot_id,
          heading: "理解变量",
          body: "变量名用于引用程序中的数据，赋值把名称和数据联系起来",
          steps: [],
          code: null,
        })),
        micro_check: {
          prompt: "变量保存在哪个硬件区域？",
          options: ["内存", "编译器", "网页"],
          answer: "内存",
          explanation: "根据常识判断。",
        },
        hints: ["看目标", "看关系", "再判断"],
      }],
    } as any

    const normalized = anchorConceptFactsInVisibleText({ payload, request, plans })
    expect(validateConceptSegmentV2AgainstPlans(normalized, plans).join("\n"))
      .not.toContain("至少需要")
    expect(normalized.objectives[0]!.micro_check).toEqual(payload.objectives[0].micro_check)
    plans[0]!.micro_check.mode = "recognition"
    expect(validateConceptMicroCheckEvidenceDiscipline(
      normalized,
      plans,
      new Map([["O1", ["Python 使用 = 进行变量赋值。", "变量名用于引用程序中的数据。"]]]),
    ).join("\n")).toContain("未直接得到当前事实支持")
  })

  test("应用型即时检查保留可复算的推理答案，不要求答案逐字存在于事实中", () => {
    const facts = [
      { source_id: "K002", fact_id: "F001", content: "Python 使用 = 进行变量赋值。" },
      { source_id: "K002", fact_id: "F002", content: "重新赋值时，新值会覆盖旧绑定。" },
    ]
    const request = segmentRequest([{ objective_id: "O1", source_id: "K002", fact_ids: ["F001", "F002"], behavior: "apply" }], facts)
    const plans = buildConceptSectionPlansForSegment(request)
    plans[0]!.micro_check = { mode: "guided_application", fact_ids: ["F001", "F002"], minimum_reasoning_steps: 2 }
    const check = { prompt: "执行 x = 3，再执行 x = 7 后，x 对应什么值？", options: ["3", "7"], answer: "7", explanation: "先将 x 绑定到 3，再以 7 覆盖旧绑定，因此最后为 7。" }
    const payload = { title: "赋值练习", objectives: [{ objective_id: "O1", sections: [], micro_check: check, hints: ["找先后顺序", "看最后绑定", "分两步跟踪"] }] }
    const normalized = anchorConceptFactsInVisibleText({ payload, request, plans })
    expect(normalized.objectives[0]!.micro_check).toEqual(check)
    expect(validateConceptMicroCheckEvidenceDiscipline(normalized, plans, new Map([["O1", facts.map(f => f.content)]])).filter(x => x.includes("micro_check"))).toEqual([])
  })

  test("同一讲义中的重复代码示例会在作者阶段被拒绝", () => {
    const plan = {
      objective_id: "O1",
      mode: "guided_explanation",
      slots: ["S1", "S2"].map((slot_id) => ({
        slot_id, kind: "guided_example", fact_ids: ["F1"],
        allowed_moves: ["direct_instance"], required: true,
        min_sentences: 1, max_sentences: 3, allowed_block_types: ["code"],
        requires_executable_code: true,
      })),
      micro_check: { mode: "recognition", fact_ids: ["F1"], minimum_reasoning_steps: 1 },
    } as any
    const payload = {
      title: "重复示例",
      objectives: [{
        objective_id: "O1",
        sections: ["S1", "S2"].map((slot_id) => ({
          slot_id, heading: slot_id, body: "观察这段程序。", steps: [], code: 'print("Python")',
        })),
        micro_check: { prompt: "哪项正确？", options: ["正确", "错误"], answer: "正确", explanation: "直接判断" },
        hints: ["先看事实", "再看关系", "最后判断"],
      }],
    } as any
    expect(validateConceptSegmentV2AgainstPlans(payload, [plan])).toContain(
      "section S2 与 S1 不得重复同一段代码示例",
    )
  })

  test("讲义即时检查不能用未引用的绝对用途制造干扰项", () => {
    const plan = {
      objective_id: "O1", mode: "definition_only", slots: [],
      micro_check: { mode: "recognition", fact_ids: ["F1"], minimum_reasoning_steps: 1 },
    } as any
    const payload = {
      title: "Python",
      objectives: [{
        objective_id: "O1", sections: [],
        micro_check: {
          prompt: "哪项正确？",
          options: ["Python 是一种通用编程语言", "Python 仅限用于网页设计"],
          answer: "Python 是一种通用编程语言",
          explanation: "与事实一致",
        },
        hints: ["先看事实", "再看关键词", "最后判断"],
      }],
    } as any
    const issues = validateConceptMicroCheckEvidenceDiscipline(
      payload,
      [plan],
      new Map([["O1", ["Python 是一种通用编程语言。"]]]),
    )
    expect(issues.join("\n")).toContain("未授权的绝对限定：仅限")
  })

  test("讲义即时检查不能用未引用的编译器机制制造干扰项", () => {
    const plan = {
      objective_id: "O1", mode: "definition_only", slots: [],
      micro_check: { mode: "recognition", fact_ids: ["F1"], minimum_reasoning_steps: 1 },
    } as any
    const payload = {
      title: "Python",
      objectives: [{
        objective_id: "O1", sections: [],
        micro_check: {
          prompt: "哪项正确？",
          options: ["Python 程序通常由解释器执行", "Python 程序通常由编译器执行"],
          answer: "Python 程序通常由解释器执行",
          explanation: "与事实一致",
        },
        hints: ["先看事实", "再看关键词", "最后判断"],
      }],
    } as any
    const issues = validateConceptMicroCheckEvidenceDiscipline(
      payload,
      [plan],
      new Map([["O1", ["Python 程序通常由解释器执行。"]]]),
    )
    expect(issues.join("\n")).toContain("不是事实复述或直接否定")
  })

  test("普通讲解不能把解释器事实扩写成未引用的否定性机制", () => {
    const plan = {
      objective_id: "O1", mode: "definition_only",
      slots: [{ slot_id: "S1", kind: "fact_explanation" }],
      micro_check: { mode: "recognition", fact_ids: ["F1"], minimum_reasoning_steps: 1 },
    } as any
    const payload = {
      title: "Python",
      objectives: [{
        objective_id: "O1",
        sections: [{ slot_id: "S1", heading: "运行方式", body: "解释器执行代码，而不是事先把整个程序转换后再运行。", steps: [], code: null }],
        micro_check: {
          prompt: "哪项正确？", options: ["Python 程序通常由解释器执行", "Python 程序不是由解释器执行"],
          answer: "Python 程序通常由解释器执行", explanation: "与事实一致",
        },
        hints: ["先看事实", "再看关键词", "最后判断"],
      }],
    } as any
    const issues = validateConceptMicroCheckEvidenceDiscipline(
      payload,
      [plan],
      new Map([["O1", ["Python 程序通常由解释器执行。"]]]),
    )
    expect(issues.join("\n")).toContain("否定性机制说明：而不是")
  })

  test("赋值事实允许用新变量名和值作直接实例，不误判为替代机制", () => {
    const plan = {
      objective_id: "O1", mode: "guided_explanation",
      slots: [{ slot_id: "S1", kind: "guided_example" }],
      micro_check: { mode: "recognition", fact_ids: ["F1", "F2"], minimum_reasoning_steps: 1 },
    } as any
    const payload = {
      title: "变量与赋值",
      objectives: [{
        objective_id: "O1",
        sections: [{
          slot_id: "S1",
          heading: "换一个名称观察",
          body: "例如写 city = '北京'。这里的 city 是变量名，它引用字符串数据；如果之后写 city = '上海'，新值会覆盖旧绑定。",
          steps: [],
          code: "city = '北京'\ncity = '上海'\nprint(city)",
        }],
        micro_check: {
          prompt: "哪项正确？",
          options: ["变量可以被重新赋值，新值会覆盖旧绑定", "变量不可以被重新赋值"],
          answer: "变量可以被重新赋值，新值会覆盖旧绑定",
          explanation: "与事实一致。",
        },
        hints: ["看赋值", "看新值", "判断绑定"],
      }],
    } as any
    const issues = validateConceptMicroCheckEvidenceDiscipline(
      payload,
      [plan],
      new Map([["O1", ["Python 使用 = 进行变量赋值。", "变量名用于引用程序中的数据。", "变量可以被重新赋值，新值会覆盖旧绑定。"]]]),
    )
    expect(issues.join("\n")).not.toContain("具体替代说法")
  })

  test("分步示例不能用未引用的编译器或大括号制造具体反例", () => {
    const plan = {
      objective_id: "O1", mode: "guided_explanation",
      slots: [{ slot_id: "S1", kind: "guided_example" }],
      micro_check: { mode: "recognition", fact_ids: ["F1", "F2"], minimum_reasoning_steps: 1 },
    } as any
    const payload = {
      title: "Python",
      objectives: [{
        objective_id: "O1",
        sections: [{
          slot_id: "S1",
          heading: "辨析",
          body: "有人声称“Python 程序由编译器直接转换为硬件指令”，另一个说法是“Python 用大括号表示代码块”。",
          steps: [],
          code: null,
        }],
        micro_check: {
          prompt: "哪项正确？",
          options: ["Python 程序通常由解释器执行", "Python 程序不是由解释器执行"],
          answer: "Python 程序通常由解释器执行",
          explanation: "与事实一致",
        },
        hints: ["先看事实", "再看关系", "最后判断"],
      }],
    } as any
    const issues = validateConceptMicroCheckEvidenceDiscipline(
      payload,
      [plan],
      new Map([["O1", ["Python 程序通常由解释器执行。", "Python 用缩进表示代码块。"]]]),
    )
    expect(issues.join("\n")).toContain("事实未提供的具体替代说法")
    expect(issues.join("\n")).toContain("编译器直接转换为硬件指令")
    expect(issues.join("\n")).toContain("大括号表示代码块")
  })

  test("误区不能用知识库未提供的具体领域缩小事实范围", () => {
    const plan = {
      objective_id: "O1", mode: "definition_only",
      slots: [{ slot_id: "S1", kind: "misconception" }],
      micro_check: { mode: "recognition", fact_ids: ["F1"], minimum_reasoning_steps: 1 },
    } as any
    const payload = {
      title: "Python",
      objectives: [{
        objective_id: "O1",
        sections: [{
          slot_id: "S1", heading: "误区",
          body: "有人认为 Python 仅用于网页设计。", steps: [], code: null,
        }],
        micro_check: {
          prompt: "哪项正确？",
          options: ["Python 是一种通用编程语言", "Python 不是一种通用编程语言"],
          answer: "Python 是一种通用编程语言",
          explanation: "与事实一致",
        },
        hints: ["先看事实", "再看关系", "最后判断"],
      }],
    } as any
    const issues = validateConceptMicroCheckEvidenceDiscipline(
      payload,
      [plan],
      new Map([["O1", ["Python 是一种通用编程语言。"]]]),
    )
    expect(issues.join("\n")).toContain("misconception S1 引入事实未授权的绝对限定：仅用于")
  })

  test("buildConceptSectionPlansForSegment 为每个 objective 生成 section plan", () => {
    const request = segmentRequest(
      [{ objective_id: "O1", source_id: "K001", fact_ids: ["F001", "F002"], behavior: "apply" }],
      [
        { source_id: "K001", fact_id: "F001", content: "int 表示整数" },
        { source_id: "K001", fact_id: "F002", content: "float 表示小数" },
      ],
    )
    const plans = buildConceptSectionPlansForSegment(request)
    expect(plans).toHaveLength(1)
    expect(plans[0]!.slots.length).toBeGreaterThanOrEqual(5)
    expect(plans[0]!.slots.filter((slot) => slot.kind === "fact_explanation").map((slot) => slot.fact_ids)).toEqual([
      ["F001", "F002"],
    ])
    expect(plans[0]!.slots.find((slot) => slot.kind === "overview")?.fact_ids).toEqual(["F001"])
    expect(plans[0]!.slots.find((slot) => slot.kind === "misconception")?.fact_ids).toEqual(["F001"])
    expect(plans[0]!.micro_check).toEqual({
      mode: "guided_application",
      fact_ids: ["F001", "F002"],
      minimum_reasoning_steps: 2,
    })
  })

  test("显式 Python 事实要求分步示例生成真实代码并拒绝注释占位", () => {
    const request = segmentRequest(
      [{ objective_id: "O1", source_id: "K007", fact_ids: ["F001", "F002"], behavior: "apply" }],
      [
        {
          source_id: "K007",
          fact_id: "F001",
          content: "for 循环常用于遍历序列中的元素。",
          capabilities: ["rule", "procedure", "example"],
        },
        {
          source_id: "K007",
          fact_id: "F002",
          content: "for 循环适合对列表、字符串等对象逐个处理。",
          capabilities: ["rule", "procedure", "state_transition"],
        },
      ],
    )
    const [plan] = buildConceptSectionPlansForSegment(request)
    const exampleSlot = plan!.slots.find((slot) =>
      slot.kind === "guided_example" || slot.kind === "procedure_steps")!
    expect(exampleSlot.allowed_block_types).toEqual(["code"])
    expect(exampleSlot.requires_executable_code).toBe(true)
    expect(exampleSlot.fact_ids).toEqual(["F001", "F002"])

    const authored = {
      sections: plan!.slots.map((slot, index) => ({
        slot_id: slot.slot_id,
        heading: `教学单元 ${index + 1}`,
        body: Array.from({ length: slot.min_sentences }, (_, sentenceIndex) =>
          `第 ${index + 1} 单元的说明 ${sentenceIndex + 1}`).join("。") + "。",
        steps: [],
        code: slot.slot_id === exampleSlot.slot_id ? "# 遍历列表\n# 逐个处理元素" : null,
      })),
    }
    expect(validateConceptSectionStructure({ plan: plan!, authored }).some((issue) =>
      issue.includes("必须提供含可执行语句的 Python 示例"))).toBe(true)

    authored.sections.find((section) => section.slot_id === exampleSlot.slot_id)!.code =
      "for item in [1, 2, 3]:\n    print(item)"
    expect(validateConceptSectionStructure({ plan: plan!, authored }).filter((issue) =>
      issue.includes("code") || issue.includes("Python 示例"))).toEqual([])
  })

  test("零基础保留识别检查，basic 使用多事实应用检查", () => {
    const request = segmentRequest(
      [{ objective_id: "O1", source_id: "K001", fact_ids: ["F001", "F002", "F003"], behavior: "explain" }],
      [
        { source_id: "K001", fact_id: "F001", content: "Python 是编程语言" },
        { source_id: "K001", fact_id: "F002", content: "Python 程序通常由解释器执行" },
        { source_id: "K001", fact_id: "F003", content: "Python 代码使用缩进表示代码块" },
      ],
    )
    expect(buildConceptSectionPlansForSegment(request)[0]!.micro_check.mode).toBe("guided_application")
    request.generation_spec.learner_adaptation.level = "beginner"
    expect(buildConceptSectionPlansForSegment(request)[0]!.micro_check).toMatchObject({
      mode: "recognition",
      minimum_reasoning_steps: 1,
    })
  })

  test("可见正文缺少 required fact 时不能被自动 claim 元数据伪装成已覆盖", () => {
    const request = segmentRequest(
      [{ objective_id: "O1", source_id: "K001", fact_ids: ["F001"], behavior: "recognize" }],
      [{ source_id: "K001", fact_id: "F001", content: "int 表示整数" }],
    )
    const plans = buildConceptSectionPlansForSegment(request)
    const authored = {
      title: "Python 变量",
      objectives: [{
        objective_id: "O1",
        sections: plans[0]!.slots.map((slot) => ({
          slot_id: slot.slot_id,
          heading: slot.kind,
          body: slot.kind === "fact_explanation"
            ? "这是一个重要知识点。请认真理解这个概念。"
            : "请结合当前事实理解本节内容。",
          steps: [],
          code: null,
        })),
        micro_check: { prompt: "哪项正确？", options: ["整数", "小数"], answer: "整数", explanation: "根据事实判断。" },
        hints: ["看事实", "找关键词", "代入判断"],
      }],
    }
    const issues = validateConceptVisibleFactCoverage(request, authored, plans)
    expect(issues).toContain("objective O1 的 required fact F001 未在可见 fact_explanation 正文中完整表达")
  })

  test("事实只被原样复述、没有通俗解释时仍判覆盖不足", () => {
    const request = segmentRequest(
      [{ objective_id: "O1", source_id: "K001", fact_ids: ["F001"], behavior: "recognize" }],
      [{ source_id: "K001", fact_id: "F001", content: "int 表示整数" }],
    )
    const plans = buildConceptSectionPlansForSegment(request)
    const factSlot = plans[0]!.slots.find((slot) => slot.kind === "fact_explanation")!
    const authored = {
      title: "Python 变量",
      objectives: [{
        objective_id: "O1",
        sections: [{
          slot_id: factSlot.slot_id,
          heading: "事实讲解",
          body: "int 表示整数。",
          steps: [],
          code: null,
        }],
        micro_check: { prompt: "哪项正确？", options: ["整数", "小数"], answer: "整数", explanation: "根据事实判断。" },
        hints: ["看事实", "找关键词", "代入判断"],
      }],
    }
    const issues = validateConceptVisibleFactCoverage(request, authored, plans)
    expect(issues).toContain("objective O1 只罗列或复述 required facts，缺少通俗解释或有意义的直接实例")
  })

  test("事实核心由程序锚定，模型仍保留教学解释", () => {
    const request = segmentRequest(
      [{ objective_id: "O1", source_id: "K001", fact_ids: ["F001", "F002"], behavior: "recognize" }],
      [
        { source_id: "K001", fact_id: "F001", content: "int 表示整数" },
        { source_id: "K001", fact_id: "F002", content: "float 表示小数" },
      ],
    )
    const plans = buildConceptSectionPlansForSegment(request)
    const authored = {
      title: "Python 数值类型",
      objectives: [{
        objective_id: "O1",
        sections: plans[0]!.slots.map((slot) => ({
          slot_id: slot.slot_id,
          heading: slot.kind,
          body: slot.kind === "fact_explanation"
            ? "根据证据事实 F001，这两种类型分别用于表达不同形式的数值。在选择时先观察数值是否带小数部分。"
            : "先建立整体认识。再联系下面的例子。",
          steps: [],
          code: null,
        })),
        micro_check: { prompt: "哪项正确？", options: ["整数", "小数"], answer: "整数", explanation: "根据讲解判断。" },
        hints: ["看类型", "看数值", "再判断"],
      }],
    }
    const anchored = anchorConceptFactsInVisibleText({ payload: authored, request, plans })
    const explanation = anchored.objectives[0]!.sections.find((section) =>
      plans[0]!.slots.find((slot) => slot.slot_id === section.slot_id)?.kind === "fact_explanation")!
    expect(explanation.body).toContain("int 表示整数")
    expect(explanation.body).toContain("float 表示小数")
    expect(explanation.body).toContain("选择时先观察")
    expect(explanation.body).not.toContain("证据事实")
    expect(explanation.body).not.toContain("F001")
    expect(validateConceptVisibleFactCoverage(request, anchored, plans)).toEqual([])
  })

  test("12 条 required facts 在多个讲解单元中全部可见且逐单元有解释", () => {
    const facts = Array.from({ length: 12 }, (_, index) => ({
      source_id: "K001",
      fact_id: `F${String(index + 1).padStart(3, "0")}`,
      content: `Python 特性 ${index + 1} 具有明确的知识含义`,
    }))
    const request = segmentRequest(
      [{ objective_id: "O1", source_id: "K001", fact_ids: facts.map((fact) => fact.fact_id), behavior: "recognize" }],
      facts,
    )
    const plans = buildConceptSectionPlansForSegment(request)
    const authored = {
      title: "Python 基础",
      objectives: [{
        objective_id: "O1",
        sections: plans[0]!.slots.map((slot, index) => ({
          slot_id: slot.slot_id,
          heading: `教学单元 ${index + 1}`,
          body: slot.kind === "fact_explanation"
            ? `${slot.fact_ids.map((factId) => facts.find((fact) => fact.fact_id === factId)!.content).join("。")}。这些内容放在同一个单元中，可以帮助学习者理解它们之间的联系和使用情境。`
            : "第一句说明当前内容。第二句帮助学习者建立整体认识。",
          steps: [],
          code: null,
        })),
        micro_check: { prompt: "哪项正确？", options: ["正确", "错误"], answer: "正确", explanation: "根据讲解判断。" },
        hints: ["看讲解", "找关键词", "联系情境"],
      }],
    }
    expect(plans[0]!.slots.filter((slot) => slot.kind === "fact_explanation")).toHaveLength(4)
    expect(validateConceptSectionStructure({ plan: plans[0]!, authored: authored.objectives[0]! })).toEqual([])
    expect(validateConceptVisibleFactCoverage(request, authored, plans)).toEqual([])
  })

  test("fact_explanation 未达到最少句数时不能发布", () => {
    const request = segmentRequest(
      [{ objective_id: "O1", source_id: "K001", fact_ids: ["F001"], behavior: "recognize" }],
      [{ source_id: "K001", fact_id: "F001", content: "int 表示整数" }],
    )
    const plan = buildConceptSectionPlansForSegment(request)[0]!
    const factSlot = plan.slots.find((slot) => slot.kind === "fact_explanation")!
    const issues = validateConceptSectionStructure({
      plan,
      authored: {
        sections: plan.slots.map((slot) => ({
          slot_id: slot.slot_id,
          heading: slot.kind,
          body: slot.slot_id === factSlot.slot_id
            ? "int 表示整数。"
            : "第一句用于说明当前内容；第二句用于补充理解。",
          steps: [],
          code: null,
        })),
      },
    })
    expect(issues).toContain(
      `section ${factSlot.slot_id} 至少需要 ${factSlot.min_sentences} 个有效句子，实际 1`,
    )
  })

  test("标题复制正文首句或暴露证据标签时拒绝机械化讲义", () => {
    const request = segmentRequest(
      [{ objective_id: "O1", source_id: "K001", fact_ids: ["F001"], behavior: "recognize" }],
      [{ source_id: "K001", fact_id: "F001", content: "Python 是一种通用编程语言" }],
    )
    const plan = buildConceptSectionPlansForSegment(request)[0]!
    const factSlot = plan.slots.find((slot) => slot.kind === "fact_explanation")!
    const baseSections = plan.slots.map((slot) => ({
      slot_id: slot.slot_id,
      heading: slot.kind,
      body: "第一句说明当前内容。第二句帮助学习者理解。",
      steps: [],
      code: null,
    }))
    const duplicated = baseSections.map((section) => section.slot_id === factSlot.slot_id
      ? { ...section, heading: "Python 是一种通用编程语言", body: "Python 是一种通用编程语言。它帮助我们建立对当前主题的整体认识。" }
      : section)
    expect(validateConceptSectionStructure({ plan, authored: { sections: duplicated } })).toContain(
      `section ${factSlot.slot_id} 标题不得与正文首句完全重复`,
    )

    const leaked = baseSections.map((section) => section.slot_id === factSlot.slot_id
      ? { ...section, heading: "理解 Python", body: "证据事实：Python 是一种通用编程语言。这里用通俗语言帮助理解。" }
      : section)
    expect(validateConceptSectionStructure({ plan, authored: { sections: leaked } })).toContain(
      `section ${factSlot.slot_id} 不得向学习者暴露事实编号或证据标签`,
    )
  })

  test("materializeConceptSegmentV2 物化出多个 RenderBlock（每个 section 独立）", () => {
    const request = segmentRequest(
      [{ objective_id: "O1", source_id: "K001", fact_ids: ["F001"], behavior: "recognize" }],
      [{ source_id: "K001", fact_id: "F001", content: "int 表示整数" }],
    )
    const plans = buildConceptSectionPlansForSegment(request)
    const authored = {
      title: "Python 变量",
      objectives: [{
        objective_id: "O1",
        sections: plans[0]!.slots.map((slot) => ({
          slot_id: slot.slot_id,
          heading: slot.kind,
          body: `${slot.kind} 的教学内容`,
          steps: [],
          code: null,
        })),
        micro_check: { prompt: "哪项正确？", options: ["整数", "小数"], answer: "整数", explanation: "int 表示整数" },
        hints: ["看事实", "找关键词", "代入判断"],
      }],
    }
    const lesson = materializeConceptSegmentV2(request, authored as never, plans)
    expect(lesson.explanation_blocks.length).toBeGreaterThanOrEqual(2)
    expect(lesson.explanation_blocks[0]).toEqual(expect.objectContaining({
      block_type: "heading",
      text: "x（O1）",
    }))
    expect(lesson.worked_examples.length).toBeGreaterThanOrEqual(1)
    expect(lesson.misconceptions.length).toBe(1)
    expect(lesson.micro_checks.length).toBe(1)
    expect(lesson.hint_ladders.length).toBe(1)
    expect(lesson.summary.length).toBeGreaterThanOrEqual(1)
    expect(lesson.objective_coverage).toHaveLength(1)

    const normalized = normalizeConceptSegment(request, lesson)
    const validation = validateConceptLesson({
      payload: normalized,
      spec: request.generation_spec,
      evidence: request.evidence_pack,
    })
    expect(validation.issues).toEqual([])
    expect(validation.ok).toBe(true)
  })

  test("required slot 缺失时抛错", () => {
    const request = segmentRequest(
      [{ objective_id: "O1", source_id: "K001", fact_ids: ["F001"], behavior: "recognize" }],
      [{ source_id: "K001", fact_id: "F001", content: "int 表示整数" }],
    )
    const plans = buildConceptSectionPlansForSegment(request)
    const authored = {
      title: "x",
      objectives: [{ objective_id: "O1", sections: [], micro_check: { prompt: "p", options: ["a", "b"], answer: "a", explanation: "e" }, hints: ["1", "2", "3"] }],
    }
    expect(() => materializeConceptSegmentV2(request, authored as never, plans)).toThrow("CONCEPT_REQUIRED_SLOT_MISSING")
  })

  test("validateConceptSectionStructure 拒绝计划外 section", () => {
    const request = segmentRequest(
      [{ objective_id: "O1", source_id: "K001", fact_ids: ["F001"], behavior: "recognize" }],
      [{ source_id: "K001", fact_id: "F001", content: "int 表示整数" }],
    )
    const plans = buildConceptSectionPlansForSegment(request)
    const issues = validateConceptSectionStructure({
      plan: plans[0]!,
      authored: { sections: [{ slot_id: "NOT-IN-PLAN", heading: "x", body: "y", steps: [], code: null }] },
    })
    expect(issues.some((issue) => issue.includes("计划外"))).toBe(true)
  })

  test("staged provider 在生产入口消费 V2 section contract 并生成可发布讲义", async () => {
    const request = segmentRequest(
      [{ objective_id: "O1", source_id: "K001", fact_ids: ["F001"], behavior: "recognize" }],
      [{ source_id: "K001", fact_id: "F001", content: "int 表示整数" }],
    )
    request.generation_spec.versions = {
      profile_version: "PROFILE-TEST",
      prompt_version: ROLE_C_PROMPT_MANIFEST_VERSION,
      model_config_hash: "MODEL-CONCEPT-V2-TEST",
      kb_version: "KB-TEST",
      rag_version: "RAG-TEST",
      schema_version: "1.0",
    }

    let captured: StructuredModelRequest | undefined
    const gateway: ModelGateway = {
      model_id: "concept-v2-test",
      model_config_hash: "MODEL-CONCEPT-V2-TEST",
      async generateStructured<T>(stage: StructuredModelRequest): Promise<T> {
        if (stage.task.endsWith(".candidate-critic")) {
          const candidates = (stage.input as { candidates: unknown[] }).candidates
          return {
            results: candidates.map((_, candidate_index) => ({
              candidate_index,
              groundedness: 0.95,
              correctness: 0.95,
              instructional_value: 0.9,
              critical_issues: [],
            })),
          } as T
        }
        captured = stage
        const contract = (stage.input as {
          staged_contract: { section_plan: Array<{ objective_id: string; slots: Array<{ slot_id: string; kind: string; fact_ids: string[] }> }> }
        }).staged_contract.section_plan
        return {
          title: "Python 基本类型",
          objectives: contract.map((objective) => ({
            objective_id: objective.objective_id,
            sections: objective.slots.map((slot) => ({
              slot_id: slot.slot_id,
              used_fact_ids: slot.fact_ids,
              heading: slot.kind,
              body: slot.kind === "misconception"
                ? "错误理解是 int 不表示整数；这与当前事实冲突。正确理解是 int 表示整数，可回看关键词自查。"
                : slot.kind === "fact_explanation"
                  ? "int 表示整数。看到 int 时，应把它和整数这一数据类别对应起来。"
                  : `${slot.kind}：int 表示整数。`,
              steps: [],
              code: null,
            })),
            micro_check: {
              prompt: "哪一项符合当前事实？",
              options: ["int 表示整数", "int 不表示整数"],
              answer: "int 表示整数",
              explanation: "当前事实明确说明 int 表示整数。",
            },
            hints: ["定位 int 对应的事实。", "关注‘表示’后面的对象。", "把 int 与整数对应起来。"],
          })),
        } as T
      },
    }

    const diagnostics: Array<{ issue_codes: string[]; issue_count: number }> = []
    const provider = new ModelBackedRoleCContentProvider(gateway, {
      generation_strategy: "staged",
      max_repair_attempts: 0,
      stage_failure_diagnostic_sink: (diagnostic) => {
        diagnostics.push(diagnostic)
      },
    })
    const result = await provider.generateConceptLesson(request).catch((error: unknown) => {
      throw new Error(`${error instanceof Error ? error.message : String(error)}:${JSON.stringify(diagnostics)}`)
    })
    expect(captured?.task).toBe("role-c.concept-tutor.segment-v2")
    expect((captured?.input as { staged_contract?: unknown }).staged_contract).toBeDefined()
    expect(result.payload.worked_examples.length).toBeGreaterThan(0)
    expect(result.payload.used_evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ source_id: "K001", fact_id: "F001" }),
    ]))
    const validation = validateConceptLesson({
      payload: result.payload,
      spec: request.generation_spec,
      evidence: request.evidence_pack,
    })
    expect(validation.issues).toEqual([])
    expect(validation.ok).toBe(true)
  })
})
