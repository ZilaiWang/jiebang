import type { AssessmentItemPublic } from "../contracts/artifacts"
import { contentHash, stableId, type CitationRef } from "../contracts/common"
import type { RagEvidencePack } from "../contracts/evidence-pack"
import type { GenerationSpec } from "../contracts/generation-spec"
import {
  buildAssessmentItemPlan,
  buildCodeLabObjectivePlan,
  buildCodeLabSecurePlan,
  buildLabIdentity,
  type AssessmentItemPlan,
  type CodeLabObjectivePlan,
  type CodeLabSecurePlan,
} from "../providers/staged-generation"

export interface ResourceBlueprintObjective {
  objective_id: string
  source_id: string
  observable_behavior: GenerationSpec["targets"][number]["observable_behavior"]
  importance: GenerationSpec["targets"][number]["importance"]
  required_fact_ids: string[]
  citations: CitationRef[]
  concept: {
    /** Stable objective order. Provider-specific batching is intentionally separate. */
    sequence_index: number
    required_parts: Array<"explanation" | "worked_example" | "misconception" | "micro_check" | "hints" | "summary">
    prerequisite_source_ids: string[]
  }
  code_lab: {
    instruction_block_id: string
    public_test_id: string
    hidden_test_ids: string[]
    practice_behavior: "guided_implementation"
  }
  assessment: Array<{
    item_id: string
    tier: 1 | 2 | 3
    modality: AssessmentItemPublic["modality"]
    max_score: number
    cognitive_operation: string
  }>
}

/**
 * CodeLab 的外部执行契约由 planning 层决定，而不是生成阶段用 evidence 关键词猜。
 *
 * - task_kind 回答"这一道 code-lab 被设计成什么外部任务"：
 *   callable_function = 判题器调用入口函数（execution_mode=function）
 *   stdin_stdout_program = 判题器喂 stdin、比较 stdout（execution_mode=stdin_stdout）
 * - primary_objective_id 显式标记本轮主要教学目标（来自上游 is_primary，
 *   不依赖数组顺序）；其余 objectives 只是支撑证据。
 * - execution_mode 是 task_kind 的直接映射，绝不因学习者水平而变（能力影响难度，不影响 ABI）。
 * - 程序入口/输入形式/输出形式/判题调用方式/输出约束是任务设计的完整契约，
 *   约束模型生成题面与评测时保持一致（先设计题，再定判题接口）。
 */
export interface CodeLabTaskContract {
  task_kind: "callable_function" | "stdin_stdout_program"
  primary_objective_id: string
  execution_mode: "function" | "stdin_stdout"
  /** 程序入口：function = "入口函数（def 定义，函数名由 instruction 指定）"；stdin_stdout = "stdin→stdout"。 */
  program_entry: string
  /** 输入形式：判题器向学习者程序提供输入的方式。 */
  input_form: "function_arguments" | "stdin_lines" | "none"
  /** 输出形式：判题器比较学习者程序的哪种产物。 */
  output_form: "return_value" | "stdout_lines"
  /** 判题调用方式：判题器如何驱动学习者程序。 */
  grading_invocation: "call_entry_function" | "feed_stdin_compare_stdout"
  /** 返回值或标准输出约束（模型命制题面/评测时遵循，不得混用）。 */
  output_constraint: string
}

/**
 * One deterministic teaching decision shared by all three Role C agents.
 * The model authors explanations and tasks; this blueprint owns identities,
 * evidence bindings, coverage, assessment modality and score allocation.
 */
export interface ResourceBlueprint {
  schema_version: "1.0"
  blueprint_id: string
  spec_id: string
  evidence_ref: string
  evidence_content_hash: string
  objectives: ResourceBlueprintObjective[]
  code_lab: {
    lab_id: string
    test_suite_id: string
    objective_plan: CodeLabObjectivePlan[]
    secure_plan: CodeLabSecurePlan
    task_contract: CodeLabTaskContract
  }
  assessment: {
    item_plan: AssessmentItemPlan[]
    total_items: number
    total_score: number
  }
}

export function buildResourceBlueprint(
  spec: GenerationSpec,
  evidence: RagEvidencePack,
): ResourceBlueprint {
  const evidenceHash = contentHash(evidence)
  if (evidence.retrieval_id !== spec.evidence_ref
    || evidenceHash !== spec.evidence_content_hash) {
    throw new Error("RESOURCE_BLUEPRINT_EVIDENCE_IDENTITY_MISMATCH")
  }
  const identity = buildLabIdentity(spec)
  const codeObjectivePlan = buildCodeLabObjectivePlan(spec)
  const codeSecurePlan = buildCodeLabSecurePlan(spec, identity.test_suite_id)
  const assessmentPlan = buildAssessmentItemPlan(spec)
  const taskContract = decideCodeLabTaskContract(spec, evidence)
  const objectives = spec.targets.map((target, index) => {
    const code = codeObjectivePlan.find((entry) =>
      entry.objective_id === target.objective_id)!
    return {
      objective_id: target.objective_id,
      source_id: target.source_id,
      observable_behavior: target.observable_behavior,
      importance: target.importance,
      required_fact_ids: [...target.required_fact_ids],
      citations: target.required_fact_ids.map((factId) => ({
        source_id: target.source_id,
        fact_id: factId,
        relation: "derived_from" as const,
      })),
      concept: {
        sequence_index: index,
        required_parts: [
          "explanation" as const,
          "worked_example" as const,
          "misconception" as const,
          "micro_check" as const,
          "hints" as const,
          "summary" as const,
        ],
        prerequisite_source_ids: index === 0
          ? [...spec.path_node.prerequisite_source_ids]
          : [],
      },
      code_lab: {
        instruction_block_id: code.instruction_block_id,
        public_test_id: code.public_test_id,
        hidden_test_ids: codeSecurePlan.hidden_tests
          .filter((test) => test.objective_id === target.objective_id)
          .map((test) => test.test_id),
        practice_behavior: "guided_implementation" as const,
      },
      assessment: assessmentPlan
        .filter((item) => item.objective_id === target.objective_id)
        .map((item) => ({
          item_id: item.item_id,
          tier: item.tier,
          modality: item.modality,
          max_score: item.max_score,
          cognitive_operation: item.cognitive_operation,
        })),
    }
  })
  const blueprintIdentity = {
    spec_id: spec.spec_id,
    evidence_ref: evidence.retrieval_id,
    evidence_content_hash: evidenceHash,
    objectives,
    code_lab: {
      lab_id: identity.lab_id,
      test_suite_id: identity.test_suite_id,
      objective_plan: codeObjectivePlan,
      secure_plan: codeSecurePlan,
      task_contract: taskContract,
    },
    assessment: assessmentPlan,
  }
  return deepFreeze({
    schema_version: "1.0",
    blueprint_id: stableId("RESOURCE-BLUEPRINT", blueprintIdentity),
    spec_id: spec.spec_id,
    evidence_ref: evidence.retrieval_id,
    evidence_content_hash: evidenceHash,
    objectives,
    code_lab: {
      lab_id: identity.lab_id,
      test_suite_id: identity.test_suite_id,
      objective_plan: codeObjectivePlan,
      secure_plan: codeSecurePlan,
      task_contract: taskContract,
    },
    assessment: {
      item_plan: assessmentPlan,
      total_items: assessmentPlan.length,
      total_score: assessmentPlan.reduce((sum, item) => sum + item.max_score, 0),
    },
  })
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value
  Object.values(value as Record<string, unknown>).forEach(deepFreeze)
  return Object.freeze(value)
}

/**
 * Planning 层决定 CodeLab 外部执行契约（"先设计题，再确定判题接口"）。
 *
 * 判定基于 primary objective 的教学语义，而不是 evidence 的代码语法：
 * - 函数专题（函数定义/参数与返回值/函数调用）→ callable_function：判题器调用入口函数，execution_mode=function
 * - 其余知识点 → stdin_stdout_program：判题器喂 stdin、比较 stdout，产出可运行程序
 *
 * primary objective 决定契约；supporting objectives（如综合项目里的函数先修）只提供证据，
 * 它们的 def/return 不能改变 primary 决定的执行接口。execution_mode 也绝不因学习者水平而变。
 *
 * task_kind 由"本轮教学意图"决定（先设计题，再定判题接口）：
 * - 教学意图 = primary 目标的知识描述（primaryItem.title）+ 节点 goal。
 *   primary 是本轮主修知识的权威描述（显式 is_primary 标记），信号以它为锚；
 *   goal 是整轮意图的补充。输出型语义（综合项目/完整程序/读取输入输出/统计）
 *   → 设计"产出可运行程序"任务 → stdin_stdout；
 *   函数专题语义（函数定义/调用/参数与返回值）→ 设计"实现可调用函数"任务 → callable_function。
 * - primary 的 title/goal 均无信号时，看 primary 证据的 facts 兜底。
 * 不再用知识库标题关键词猜执行方式；相同 primary 标记下改变目标顺序不改变契约。
 */
function decideCodeLabTaskContract(
  spec: GenerationSpec,
  evidence: RagEvidencePack,
): CodeLabTaskContract {
  // primary 由上游显式 is_primary 标记决定，绝不依赖数组顺序
  const explicitPrimaries = spec.targets.filter((target) => target.is_primary)
  if (explicitPrimaries.length > 1) {
    throw new Error("MULTIPLE_CODE_LAB_PRIMARY_OBJECTIVES: 一个代码实验只能声明一个 primary objective")
  }
  const primary = explicitPrimaries[0]
    ?? spec.targets.find((t) => t.importance === "core")
    ?? spec.targets[0]
  if (!primary) {
    throw new Error("MISSING_CODE_LAB_PRIMARY_OBJECTIVE: 无法确定代码实验的 primary objective")
  }
  const primaryItem = evidence.results.find((r) => r.source_id === primary.source_id)
  const primaryTitle = (primaryItem?.title ?? "").normalize("NFKC").toLocaleLowerCase()
  const goal = (spec.path_node.goal ?? "").normalize("NFKC").toLocaleLowerCase()
  const facts = (primaryItem?.facts ?? [])
    .map((fact) => typeof fact === "string" ? fact : (fact as { content?: string }).content ?? "")
    .join(" ")
    .normalize("NFKC")
    .toLocaleLowerCase()
  // 教学意图信号。primary 的 title 是"本轮主修知识"的权威描述（显式标记，
  // 与目标顺序无关）；节点级 goal 是整轮意图，可能含其他目标（如综合项目里
  // 的先修函数），因此 goal 只在 primary title 无信号时兜底，绝不让 goal 覆盖
  // primary 决定的任务形态。
  const primaryOutputSignal = /(?:综合项目|完整程序|读取用户输入|读取输入|标准输出|输出结果|统计|计算.*输出|输入.*输出)/u.test(primaryTitle)
  const primaryFunctionSignal = /(?:函数定义|函数调用|参数与返回值|定义函数|封装成函数)/u.test(primaryTitle)
  const goalOutputSignal = /(?:综合项目|完整程序|读取用户输入|读取输入|标准输出|输出结果|统计|计算.*输出|输入.*输出)/u.test(goal)
  const goalFunctionSignal = /(?:函数定义|函数调用|参数与返回值|定义函数|封装成函数)/u.test(goal)
  const functionFactSignal = /(?:定义函数|def|参数|返回值|函数调用|封装成函数)/u.test(facts)
  const outputFactSignal = /(?:输入输出|stdin|stdout|读取|print|输出)/u.test(facts)
  const taskKind: CodeLabTaskContract["task_kind"] = primaryOutputSignal
    ? "stdin_stdout_program"
    : primaryFunctionSignal
      ? "callable_function"
      : goalOutputSignal
        ? "stdin_stdout_program"
        : goalFunctionSignal
          ? "callable_function"
          : (functionFactSignal && !outputFactSignal)
            ? "callable_function"
            : "stdin_stdout_program"
  const callable = taskKind === "callable_function"
  return {
    task_kind: taskKind,
    primary_objective_id: primary.objective_id,
    execution_mode: callable ? "function" : "stdin_stdout",
    program_entry: callable
      ? "入口函数（def 定义，函数名由 instruction 指定）"
      : "stdin→stdout（整个程序读取 stdin 并打印结果）",
    input_form: callable ? "function_arguments" : "stdin_lines",
    output_form: callable ? "return_value" : "stdout_lines",
    grading_invocation: callable
      ? "call_entry_function"
      : "feed_stdin_compare_stdout",
    output_constraint: callable
      ? "判题器调用入口函数并比较返回值；不得要求 print 输出作为评分结果"
      : "判题器喂 stdin、比较 stdout；不得以函数 return 值作为判题产物。完整程序内可以定义和调用辅助函数，starter_code 与 hidden_test 均围绕标准输入输出",
  }
}
