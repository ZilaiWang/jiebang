import { describe, expect, test } from "bun:test"
import { contentHash } from "../src/role-c-content/contracts/common"
import { buildResourceBlueprint } from "../src/role-c-content/planning/resource-blueprint"
import {
  buildCodeLabObjectivePlan,
  projectAssessmentPublicAuthorPayload,
  validateAssessmentNovelty,
} from "../src/role-c-content/providers/staged-generation"
import type { PriorAssessmentItem } from "../src/role-c-content/agents/types"

/** 构造含 title 的 spec + evidence（模拟真实 RAG 检索结果）。 */
function makeSpec(
  targets: Array<{ source_id: string; title: string; fact: string }>,
  level = "intermediate",
  primarySourceId?: string,
) {
  const evidence: any = {
    schema_version: "1.0",
    retrieval_id: "RAG-TC",
    query: "test",
    learner_level: level,
    top_k: 2,
    match_status: "strong",
    kb_version: "kb",
    rag_version: "rag",
    results: targets.map((t) => ({
      source_id: t.source_id,
      title: t.title,
      facts: [{ source_id: t.source_id, fact_id: "F1", content: t.fact }],
    })),
  }
  const spec: any = {
    spec_id: "SPEC-TC",
    run_id: "RUN-TC",
    evidence_ref: evidence.retrieval_id,
    evidence_content_hash: contentHash(evidence),
    path_node: { target_source_ids: targets.map((t) => t.source_id), prerequisite_source_ids: [], goal: `学习 ${targets[0]!.title}` },
    targets: targets.map((t) => ({
      objective_id: `OBJ-${t.source_id}`,
      source_id: t.source_id,
      required_fact_ids: ["F1"],
      observable_behavior: "apply",
      importance: "core",
      // 显式 primary 标记：上游路径规划决定，不依赖数组顺序
      is_primary: primarySourceId ? t.source_id === primarySourceId : undefined,
    })),
    learner_adaptation: { level, preferred_contexts: [] },
    assessment_blueprint: { tier_1_count: 2, tier_2_count: 2, tier_3_count: 1, required_modalities: ["mcq", "code"] },
    policies: { seed: 7 },
  }
  return { spec, evidence }
}

const K018 = { source_id: "K018", title: "成绩统计器综合项目", fact: "成绩统计项目可综合练习列表、循环和函数。" }
const K013 = { source_id: "K013", title: "函数定义与调用", fact: "def 用于定义函数。" }
const K014 = { source_id: "K014", title: "函数参数与返回值", fact: "return 用于返回函数结果。" }
const K009 = { source_id: "K009", title: "列表", fact: "列表可用于保存多个有序元素。" }
const K002 = { source_id: "K002", title: "变量与赋值", fact: "Python 使用 = 进行变量赋值。" }

describe("CodeLabTaskContract：planning 层决定执行接口（不再用证据关键词猜）", () => {
  test("显式资源合同保留主目标和配套目标的全部冻结事实", () => {
    const { spec, evidence } = makeSpec([K002, K009], "basic", "K002")
    spec.artifact_tasks = { code_lab: { behavior: "apply" } }
    for (const target of spec.targets) target.required_fact_ids = ["F1", "F2", "F3", "F4", "F5", "F6", "F7"]
    const plan = buildCodeLabObjectivePlan(spec, evidence, { primary_objective_id: "OBJ-K002", learner_action: "implement_function" })
    for (const entry of plan) expect(entry.citations.map(c => c.fact_id)).toEqual(spec.targets[0].required_fact_ids)
  })
  test("识别型代码实验只投影完成练习所需的一条事实，不重复整章内容", () => {
    const plan = buildCodeLabObjectivePlan({
      spec_id: "S-FOCUS",
      policies: { seed: 1 },
      targets: [{
        objective_id: "O1", source_id: "K001",
        required_fact_ids: Array.from({ length: 12 }, (_, index) => `F${String(index + 1).padStart(3, "0")}`),
        observable_behavior: "recognize", importance: "core",
      }],
    } as any)
    expect(plan[0]?.citations.map((citation) => citation.fact_id)).toEqual(["F001"])
  })

  test("有 evidence 时按目标行为选择最小可执行事实束，不再机械截取前四条", () => {
    const { spec, evidence } = makeSpec([K009])
    spec.targets[0]!.required_fact_ids = ["F1", "F2", "F3"]
    evidence.results[0]!.facts = [
      { source_id: "K009", fact_id: "F1", content: "列表保存有序元素。", capabilities: ["definition"] },
      { source_id: "K009", fact_id: "F2", content: "append(x) 可在末尾追加元素。", capabilities: ["rule", "example"] },
      { source_id: "K009", fact_id: "F3", content: "列表可按索引读取。", capabilities: ["rule"] },
    ]
    const plan = buildCodeLabObjectivePlan(spec, evidence)
    expect(plan[0]?.citations.map((citation) => citation.fact_id)).toEqual(["F2", "F1"])
  })

  test("综合项目（成绩统计器）→ stdin_stdout_program，即使 evidence 含 def/return", () => {
    const { spec, evidence } = makeSpec([K018])
    const bp = buildResourceBlueprint(spec, evidence)
    expect(bp.code_lab.task_contract.task_kind).toBe("stdin_stdout_program")
    expect(bp.code_lab.task_contract.execution_mode).toBe("stdin_stdout")
    expect(bp.code_lab.task_contract.learner_action).toBe("implement_program")
    expect(bp.code_lab.task_contract.primary_objective_id).toBe("OBJ-K018")
  })

  test("函数定义/调用证据生成无外部输入的程序任务，不强加返回值合同", () => {
    const { spec, evidence } = makeSpec([K013])
    const bp = buildResourceBlueprint(spec, evidence)
    expect(bp.code_lab.task_contract.task_kind).toBe("stdin_stdout_program")
    expect(bp.code_lab.task_contract.execution_mode).toBe("stdin_stdout")
    expect(bp.code_lab.task_contract.learner_action).toBe("implement_program")
    expect(bp.code_lab.task_contract.input_form).toBe("none")
    expect(bp.code_lab.task_contract.stdin_layout).toBe("none")
    expect(bp.code_lab.task_contract.learner_owned_region).toBe("program_logic")
    expect(bp.code_lab.task_contract.input_form).toBe("none")
    expect(bp.code_lab.task_contract.output_constraint).toContain("空 stdin")
  })

  test("参数与返回值专题 → callable_function", () => {
    const { spec, evidence } = makeSpec([K014])
    const bp = buildResourceBlueprint(spec, evidence)
    expect(bp.code_lab.task_contract.task_kind).toBe("callable_function")
    expect(bp.code_lab.task_contract.execution_mode).toBe("function")
    expect(bp.code_lab.task_contract.learner_action).toBe("implement_function")
  })

  test("综合项目主任务 + 函数支撑证据仍按 primary（K018）决定为 stdin_stdout", () => {
    const { spec, evidence } = makeSpec([K018, K013])
    const bp = buildResourceBlueprint(spec, evidence)
    expect(bp.code_lab.task_contract.primary_objective_id).toBe("OBJ-K018")
    expect(bp.code_lab.task_contract.execution_mode).toBe("stdin_stdout")
  })

  test("执行接口不随学习者水平变化（能力影响难度，不影响 ABI）", () => {
    const { spec: lowSpec, evidence: lowEvidence } = makeSpec([K018], "beginner")
    const { spec: highSpec, evidence: highEvidence } = makeSpec([K018], "integrated")
    const low = buildResourceBlueprint(lowSpec, lowEvidence)
    const high = buildResourceBlueprint(highSpec, highEvidence)
    expect(low.code_lab.task_contract.execution_mode).toBe("stdin_stdout")
    expect(high.code_lab.task_contract.execution_mode).toBe("stdin_stdout")
    expect(low.code_lab.task_contract).toEqual(high.code_lab.task_contract)
  })

  test("列表（中性知识点）→ stdin_stdout_program", () => {
    const { spec, evidence } = makeSpec([K009])
    const bp = buildResourceBlueprint(spec, evidence)
    expect(bp.code_lab.task_contract.task_kind).toBe("stdin_stdout_program")
  })

  test("识别型目标只要证据支持真实操作，就生成代码任务而非事实复述", () => {
    const { spec, evidence } = makeSpec([K002], "beginner")
    spec.targets[0]!.observable_behavior = "recognize"
    const bp = buildResourceBlueprint(spec, evidence)
    expect(bp.code_lab.task_contract.learner_action).toBe("implement_program")
    expect(bp.code_lab.task_contract.learner_owned_region).toBe("program_logic")
  })

  test("真实代码任务同时携带支撑状态变化的操作事实", () => {
    const { spec, evidence } = makeSpec([K002], "beginner")
    spec.targets[0]!.observable_behavior = "recognize"
    spec.targets[0]!.required_fact_ids = ["F001", "F002", "F003"]
    evidence.results[0]!.facts = [
      { source_id: "K002", fact_id: "F001", content: "Python 使用 = 进行变量赋值。" },
      { source_id: "K002", fact_id: "F002", content: "变量名用于引用程序中的数据。" },
      { source_id: "K002", fact_id: "F003", content: "变量可以被重新赋值，新值会覆盖旧绑定。" },
    ]
    spec.evidence_content_hash = contentHash(evidence)
    const bp = buildResourceBlueprint(spec, evidence)
    expect(bp.code_lab.objective_plan[0]!.citations.map((citation) => citation.fact_id))
      .toEqual(expect.arrayContaining(["F001", "F003"]))
  })

  test("真实代码任务携带目标内全部获准类别事实，避免实验使用 str 却只引用 int", () => {
    const { spec, evidence } = makeSpec([K002], "beginner")
    spec.targets[0]!.observable_behavior = "recognize"
    spec.targets[0]!.source_id = "K003"
    spec.targets[0]!.objective_id = "OBJ-K003"
    spec.targets[0]!.required_fact_ids = ["F001", "F002", "F003", "F004"]
    spec.path_node.target_source_ids = ["K003"]
    evidence.results[0] = {
      source_id: "K003",
      title: "基本数据类型",
      facts: [
        { source_id: "K003", fact_id: "F001", content: "int 表示整数，float 表示小数。", capabilities: ["definition"] },
        { source_id: "K003", fact_id: "F002", content: "str 表示字符串文本。", capabilities: ["definition"] },
        { source_id: "K003", fact_id: "F003", content: "bool 表示 True 或 False 两种逻辑值。", capabilities: ["definition"] },
        { source_id: "K003", fact_id: "F004", content: "type(x) 返回 x 的类型对象。", capabilities: ["procedure"] },
      ],
    }
    spec.evidence_content_hash = contentHash(evidence)
    const bp = buildResourceBlueprint(spec, evidence)
    expect(bp.code_lab.task_contract.learner_action).toBe("implement_program")
    expect(bp.code_lab.objective_plan[0]!.citations.map((citation) => citation.fact_id))
      .toEqual(["F004", "F001", "F002", "F003"])
  })

  test("相同目标组合换顺序不再改变契约：primary 由显式 is_primary 标记决定，不依赖数组位置", () => {
    // [K013, K018] 反向顺序，但显式标记 K018 为 primary → 仍是 stdin_stdout
    const { spec: reversedSpec, evidence: reversedEvidence } = makeSpec(
      [K013, K018],
      "intermediate",
      "K018",
    )
    const reversed = buildResourceBlueprint(reversedSpec, reversedEvidence)
    expect(reversed.code_lab.task_contract.primary_objective_id).toBe("OBJ-K018")
    expect(reversed.code_lab.task_contract.execution_mode).toBe("stdin_stdout")

    // [K018, K013] 正向顺序、同样标记 K018 → 契约与反向顺序完全一致
    const { spec: forwardSpec, evidence: forwardEvidence } = makeSpec(
      [K018, K013],
      "intermediate",
      "K018",
    )
    const forward = buildResourceBlueprint(forwardSpec, forwardEvidence)
    expect(forward.code_lab.task_contract).toEqual(reversed.code_lab.task_contract)

    // 标记 K013 为 primary，但它没有参数/返回值证据 → 不强加 function ABI
    const { spec: fnSpec, evidence: fnEvidence } = makeSpec(
      [K018, K013],
      "intermediate",
      "K013",
    )
    const fn = buildResourceBlueprint(fnSpec, fnEvidence)
    expect(fn.code_lab.task_contract.primary_objective_id).toBe("OBJ-K013")
    expect(fn.code_lab.task_contract.execution_mode).toBe("stdin_stdout")
  })

  test("任务契约完整字段：程序入口/输入形式/输出形式/判题调用方式/输出约束与 task_kind 一致", () => {
    const { spec: stdinSpec, evidence: stdinEvidence } = makeSpec([K018])
    const stdin = buildResourceBlueprint(stdinSpec, stdinEvidence)
    expect(stdin.code_lab.task_contract.program_entry).toContain("stdin")
    expect(stdin.code_lab.task_contract.input_form).toBe("stdin_lines")
    expect(stdin.code_lab.task_contract.stdin_layout).toBe("single_line_text")
    expect(stdin.code_lab.task_contract.output_form).toBe("stdout_lines")
    expect(stdin.code_lab.task_contract.grading_invocation).toBe("feed_stdin_compare_stdout")
    expect(stdin.code_lab.task_contract.output_constraint).toContain("比较 stdout")

    const { spec: fnSpec, evidence: fnEvidence } = makeSpec([K014])
    const fn = buildResourceBlueprint(fnSpec, fnEvidence)
    expect(fn.code_lab.task_contract.input_form).toBe("function_arguments")
    expect(fn.code_lab.task_contract.stdin_layout).toBe("none")
    expect(fn.code_lab.task_contract.output_form).toBe("return_value")
    expect(fn.code_lab.task_contract.grading_invocation).toBe("call_entry_function")
    expect(fn.code_lab.task_contract.output_constraint).toContain("返回值")
  })

  test("多个显式 primary 目标会被拒绝，不会悄然按数组顺序选择", () => {
    const { spec, evidence } = makeSpec([K018, K013], "intermediate", "K018")
    spec.targets[1]!.is_primary = true
    expect(() => buildResourceBlueprint(spec, evidence)).toThrow(
      "MULTIPLE_CODE_LAB_PRIMARY_OBJECTIVES",
    )
  })
})

describe("AssessmentNovelty：任务结构签名挡住'只换数字'的伪变式", () => {
  const history: PriorAssessmentItem[] = [{
    form_id: "FORM-A", item_id: "ITEM-1", objective_id: "OBJ-1", modality: "mcq",
    prompt: "在 Python 中，range(2, 5) 会生成哪些值？",
    options: [],
  }]

  test("只换数字（range(3,6)）→ 判任务结构重复", () => {
    const issues = validateAssessmentNovelty({
      items: [{ objective_id: "OBJ-1", modality: "mcq", prompt: "在 Python 中，range(3, 6) 会生成哪些值？", options: [] } as never],
    }, history)
    expect(issues.some((i) => i.includes("任务结构重复"))).toBe(true)
  })

  test("换操作（len 返回长度）→ 不判结构重复", () => {
    const issues = validateAssessmentNovelty({
      items: [{ objective_id: "OBJ-1", modality: "mcq", prompt: "在 Python 中，len([1, 2, 3]) 的返回值是什么？", options: [] } as never],
    }, history)
    expect(issues.some((i) => i.includes("任务结构重复"))).toBe(false)
  })

  test("换情境（range 换成 for 遍历）→ 不判结构重复", () => {
    const issues = validateAssessmentNovelty({
      items: [{ objective_id: "OBJ-1", modality: "mcq", prompt: "for 循环遍历字符串时，每次迭代拿到的是什么？", options: [] } as never],
    }, history)
    expect(issues.some((i) => i.includes("任务结构重复"))).toBe(false)
  })
})

describe("AssessmentNovelty：结构元数据（structure_meta）按任务结构判重", () => {
  const metaHistory: PriorAssessmentItem[] = [{
    form_id: "FORM-M", item_id: "ITEM-M-1", objective_id: "OBJ-1", modality: "mcq",
    prompt: "列表 [1, 2, 3] 的每个元素求和结果是多少？",
    options: [],
    structure_meta: {
      operation: "遍历求和",
      reasoning_pattern: "单步映射",
      representation: "列表",
      context_family: "成绩统计",
      answer_form: "输出数字",
    },
  }]

  test("同一 objective、结构元数据完全一致（换情境词/换数字）→ 判结构重复", () => {
    const issues = validateAssessmentNovelty({
      items: [{
        objective_id: "OBJ-1",
        modality: "mcq",
        prompt: "数组 [80, 90] 的全部成绩加在一起等于几？",
        options: [],
        structure_meta: {
          operation: "遍历求和",
          reasoning_pattern: "单步映射",
          representation: "列表",
          context_family: "成绩统计",
          answer_form: "输出数字",
        },
      } as never],
    }, metaHistory)
    expect(issues.some((i) => i.includes("任务结构重复"))).toBe(true)
  })

  test("结构元数据改变操作（求和→求最大值）→ 不判结构重复", () => {
    const issues = validateAssessmentNovelty({
      items: [{
        objective_id: "OBJ-1",
        modality: "mcq",
        prompt: "列表 [1, 2, 3] 中最大的元素是多少？",
        options: [],
        structure_meta: {
          operation: "求最大值",
          reasoning_pattern: "单步映射",
          representation: "列表",
          context_family: "成绩统计",
          answer_form: "输出数字",
        },
      } as never],
    }, metaHistory)
    expect(issues.some((i) => i.includes("任务结构重复"))).toBe(false)
  })

  test("保留同一操作但更换真实情境，允许作为近似变式", () => {
    const issues = validateAssessmentNovelty({
      items: [{
        objective_id: "OBJ-1",
        modality: "mcq",
        prompt: "购物金额 [10, 20, 30] 的合计是多少？",
        options: [],
        structure_meta: {
          operation: "遍历求和",
          reasoning_pattern: "单步映射",
          representation: "列表",
          context_family: "购物清单",
          answer_form: "输出数字",
        },
      } as never],
    }, metaHistory)
    expect(issues.some((i) => i.includes("任务结构重复"))).toBe(false)
  })

  test("命题输出投影保留 structure_meta，不在进入校验前丢失", () => {
    const projected = projectAssessmentPublicAuthorPayload({
      title: "变式题",
      items: [{
        prompt: "求列表中数字的和",
        options: null,
        starter_code: null,
        structure_meta: metaHistory[0]!.structure_meta!,
      }],
    })
    expect(projected.items[0]?.structure_meta).toEqual(metaHistory[0]!.structure_meta!)
  })

  test("不同 objective 的相同结构不判重（objective_id 纳入签名）", () => {
    const issues = validateAssessmentNovelty({
      items: [{
        objective_id: "OBJ-2",
        modality: "mcq",
        prompt: "字典的键求和结果是多少？",
        options: [],
        structure_meta: {
          operation: "遍历求和",
          reasoning_pattern: "单步映射",
          representation: "字典",
          context_family: "成绩统计",
          answer_form: "输出数字",
        },
      } as never],
    }, metaHistory)
    expect(issues.some((i) => i.includes("任务结构重复"))).toBe(false)
  })

  test("旧题（无 structure_meta）回退文本结构签名，不破坏兼容", () => {
    const legacyHistory: PriorAssessmentItem[] = [{
      form_id: "FORM-L", item_id: "ITEM-L-1", objective_id: "OBJ-1", modality: "mcq",
      prompt: "在 Python 中，range(2, 5) 会生成哪些值？",
      options: [],
    }]
    const issues = validateAssessmentNovelty({
      items: [{
        objective_id: "OBJ-1",
        modality: "mcq",
        prompt: "在 Python 中，range(3, 6) 会生成哪些值？",
        options: [],
      } as never],
    }, legacyHistory)
    expect(issues.some((i) => i.includes("任务结构重复"))).toBe(true)
  })
})
