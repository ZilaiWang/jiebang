import { describe, expect, test } from "bun:test"
import {
  buildConceptSectionPlansForSegment,
  anchorConceptFactsInVisibleText,
  materializeConceptSegmentV2,
  validateConceptVisibleFactCoverage,
  validateConceptSectionStructure,
} from "../src/role-c-content/planning/concept-section-plan"
import { normalizeConceptSegment } from "../src/role-c-content/providers/staged-generation"
import { ModelBackedRoleCContentProvider } from "../src/role-c-content/providers/model-backed-provider"
import { validateConceptLesson } from "../src/role-c-content/validators/concept-validator"
import type { ConceptTutorRequest } from "../src/role-c-content/agents/types"
import type { ModelGateway, StructuredModelRequest } from "../src/role-c-content/contracts/model-gateway"
import { ROLE_C_PROMPT_MANIFEST_VERSION } from "../src/role-c-content/prompts"

function segmentRequest(targets: Array<{ objective_id: string; source_id: string; fact_ids: string[]; behavior: string }>, facts: Array<{ source_id: string; fact_id: string; content: string }>): ConceptTutorRequest {
  return {
    generation_spec: {
      spec_id: "SPEC-1",
      run_id: "RUN-1",
      targets: targets.map((t) => ({
        objective_id: t.objective_id,
        source_id: t.source_id,
        required_fact_ids: t.fact_ids,
        observable_behavior: t.behavior,
        importance: "core",
      })),
      path_node: { goal: "x", target_source_ids: [...new Set(targets.map((t) => t.source_id))], prerequisite_source_ids: [] },
      learner_adaptation: { level: "basic" },
      difficulty: { domain_complexity: 1, cognitive_demand: 1, reasoning_steps: 1, code_complexity: 0, prerequisite_load: 0, scaffold_strength: 2 },
      policies: { seed: 1, max_semantic_revision: 1, max_tool_retry: 1 },
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
          staged_contract: { section_plan: Array<{ objective_id: string; slots: Array<{ slot_id: string; kind: string }> }> }
        }).staged_contract.section_plan
        return {
          title: "Python 基本类型",
          objectives: contract.map((objective) => ({
            objective_id: objective.objective_id,
            sections: objective.slots.map((slot) => ({
              slot_id: slot.slot_id,
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
