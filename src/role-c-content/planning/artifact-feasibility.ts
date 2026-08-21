import type { ObservableBehavior } from "../contracts/profile-adapter"
import type { AssessmentCapacityPlan } from "./assessment-capacity"

/**
 * 生成前可行性判断（改进方案4 第七节 / 第 4 层 ArtifactFeasibilityPlan）。
 *
 * 历史上 required_fact_ids 只能证明"事实存在"，不能证明"事实足以支撑
 * trace/apply/debug/create，也不能证明足以产出固定数量的唯一答案测评题"。
 * 本模块在调用任何生成模型之前，判断每个 objective 的 evidence capability
 * 与 artifact support，产出 status = ready / need_evidence / need_spec。
 */

export type FeasibilityStatus = "ready" | "need_evidence" | "need_spec"
export type ArtifactSupport = "full" | "compact" | "reduced" | "unsupported"

export interface ObjectiveSupportPlan {
  objective_id: string
  fact_refs: Array<{ source_id: string; fact_id: string }>
  supported_behaviors: ObservableBehavior[]
  allowed_content_moves: Array<
    | "direct_paraphrase"
    | "direct_instance"
    | "fact_negation"
    | "recognition_check"
    | "procedure_trace"
    | "normative_task"
  >
  artifact_support: {
    concept: "full" | "compact" | "unsupported"
    code_lab: "full" | "unsupported"
    assessment: "full" | "reduced" | "unsupported"
  }
  missing_support: string[]
}

export interface ArtifactFeasibilityPlan {
  status: FeasibilityStatus
  objectives: ObjectiveSupportPlan[]
  assessment_capacity: {
    requested_items: number
    feasible_items: number
    feasible_modalities: string[]
    limiting_factors: string[]
  }
}

export interface FeasibilityInput {
  objectives: Array<{
    objective_id: string
    observable_behavior: ObservableBehavior
    importance: "core" | "supporting"
    fact_refs: Array<{ source_id: string; fact_id: string }>
    facts: Array<{ content: string }>
  }>
  capacity: AssessmentCapacityPlan
}

/**
 * 每个 observable behavior 的最低证据能力（文档 7.1）。
 * 用确定性文本特征启发式判断 fact 内容能否支撑对应能力。
 */
export const BEHAVIOR_MINIMUM_CAPABILITY: Record<ObservableBehavior, string> = {
  recognize: "定义、身份或直接区别事实",
  explain: "定义或描述事实",
  trace: "明确的操作步骤、状态变化或执行顺序",
  apply: "明确规则及输入到输出关系",
  debug: "正确规则加约束、边界或可验证冲突",
  create: "程序过程、外部合同及可观察结果",
}

// 文本特征启发式：判断 fact 集合是否支撑更高等级行为。
const PROCESS_PATTERN = /步骤|顺序|先.*后|然后|接着|遍历|循环|迭代|状态|执行/i
const RULE_PATTERN = /规则|如果.*(?:那么|则)|输入.*(?:输出|结果)|返回(?:值|结果)|换算|计算|逐项|每次/i
const BOUNDARY_PATTERN = /边界|约束|不能|不允许|错误|异常|越界|冲突|限制|上限|下限/i
const CODE_PATTERN = /函数|def |程序|接口|合同|参数|调用|返回|print|input|lambda/i

export function supportedBehaviorsFor(facts: Array<{ content: string }>): ObservableBehavior[] {
  const text = facts.map((fact) => fact.content).join("\n")
  if (facts.length === 0) return []
  const behaviors: ObservableBehavior[] = ["recognize", "explain"]
  if (PROCESS_PATTERN.test(text)) behaviors.push("trace")
  if (RULE_PATTERN.test(text)) behaviors.push("apply")
  if (BOUNDARY_PATTERN.test(text)) behaviors.push("debug")
  if (CODE_PATTERN.test(text)) behaviors.push("create")
  return behaviors
}

export function assessObjectiveSupport(input: {
  objective_id: string
  observable_behavior: ObservableBehavior
  fact_refs: Array<{ source_id: string; fact_id: string }>
  facts: Array<{ content: string }>
}): ObjectiveSupportPlan {
  const supported = supportedBehaviorsFor(input.facts)
  const supportsBehavior = supported.includes(input.observable_behavior)
  const missing_support: string[] = []
  if (!supportsBehavior) {
    missing_support.push(
      `${input.observable_behavior} 需要 ${BEHAVIOR_MINIMUM_CAPABILITY[input.observable_behavior]}，但当前证据仅支撑 ${supported.join("/") || "无"}`,
    )
  }

  const allowedMoves = ["direct_paraphrase", "direct_instance", "fact_negation", "recognition_check"] as ObjectiveSupportPlan["allowed_content_moves"]
  if (supported.includes("trace")) allowedMoves.push("procedure_trace")
  if (supported.includes("create") || supported.includes("apply")) allowedMoves.push("normative_task")

  const concept: ObjectiveSupportPlan["artifact_support"]["concept"] = input.facts.length === 0
    ? "unsupported"
    : input.facts.length <= 2
      ? "compact"
      : "full"
  const codeLab: ObjectiveSupportPlan["artifact_support"]["code_lab"] = supported.includes("create")
    ? "full"
    : "unsupported"
  const assessment: ObjectiveSupportPlan["artifact_support"]["assessment"] = !supportsBehavior
    ? "unsupported"
    : input.facts.length <= 2
      ? "reduced"
      : "full"

  return {
    objective_id: input.objective_id,
    fact_refs: input.fact_refs,
    supported_behaviors: supported,
    allowed_content_moves: allowedMoves,
    artifact_support: { concept, code_lab: codeLab, assessment },
    missing_support,
  }
}

export function planArtifactFeasibility(input: FeasibilityInput): ArtifactFeasibilityPlan {
  const objectives = input.objectives.map((objective) =>
    assessObjectiveSupport(objective))

  const coreMissingFacts = objectives.some((objective) => {
    const meta = input.objectives.find((entry) => entry.objective_id === objective.objective_id)!
    return meta.importance === "core" && meta.facts.length === 0
  })

  const capacityDecision = input.capacity.decision
  let status: FeasibilityStatus = "ready"
  if (coreMissingFacts) {
    // 只有可确定证明的缺口才在生成前硬阻断。知识库尚未提供显式
    // capability 元数据，不能把中文关键词启发式当作发布门禁；高阶行为
    // 的可证性继续交给后续 typed semantic audit 判断并精确归因。
    status = "need_evidence"
  } else if (capacityDecision === "REPLAN") {
    status = "need_spec"
  } else if (capacityDecision === "REDUCE") {
    status = "ready" // 可缩减题量继续
  }

  return {
    status,
    objectives,
    assessment_capacity: {
      requested_items: input.capacity.requested_items,
      feasible_items: input.capacity.feasible_items,
      feasible_modalities: [],
      limiting_factors: input.capacity.limiting_factors,
    },
  }
}
