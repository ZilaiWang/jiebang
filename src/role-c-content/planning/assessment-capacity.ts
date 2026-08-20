import type { AssessmentBlueprint, ObservableBehavior } from "../contracts/profile-adapter"
import { modalityMeasuresBehavior, type AssessmentModality } from "../contracts/assessment-measurement"

/**
 * Assessment Capacity Planning（测评容量规划）。
 *
 * 背景：历史上 GenerationSpec 冻结了测评题量（tier_1/2/3_count），而 knowledge
 * 事实不足 + novelty 结构饱和时，可行解集合接近空集，却仍要求生成模型随机搜索，
 * 最终 CONTENT_NOT_NOVEL / blocked。这不是模型不够聪明，而是约束不可满足。
 *
 * 本模块在生成**之前**估算"当前 objective × 证据 × 可用结构 × novelty 约束"
 * 能支撑多少道有区分度、证据支持且不重复的题，形成 decision：
 *   FULL   —— 可行题量 >= 需求，正常生成；
 *   REDUCE —— 可行题量不足但能覆盖 core objective，按优先级缩减蓝图（不静默少题）；
 *   REPLAN —— 连 core objective 都覆盖不了，需要上游（B 路径）重新规划。
 */

export interface AssessmentCapacityObjective {
  objective_id: string
  observable_behavior: ObservableBehavior
  importance: "core" | "supporting"
  /** 该 objective 在证据包里可用的事实数（required_fact_ids 长度或检索命中数）。 */
  available_facts: number
  /** 该 objective 历史里已占用的任务结构数（novelty 约束）。 */
  used_structures: number
}

export interface AssessmentCapacityInput {
  requested: AssessmentBlueprint
  objectives: AssessmentCapacityObjective[]
}

export interface AssessmentCapacityPlan {
  requested_items: number
  feasible_items: number
  per_objective: Array<{
    objective_id: string
    importance: "core" | "supporting"
    requested: number
    feasible: number
  }>
  limiting_factors: Array<"EVIDENCE_DIVERSITY_LOW" | "HISTORY_STRUCTURE_SATURATION">
  decision: "FULL" | "REDUCE" | "REPLAN"
  /** REDUCE 时给出缩减后的蓝图；FULL/REPLAN 时为 undefined。 */
  adjusted_blueprint?: AssessmentBlueprint
}

/** 单个 measurement 目标最多支撑的结构数（operation × representation 组合空间）。 */
export const STRUCTURE_BUDGET_PER_OBJECTIVE = 6

/** 每个 objective 默认最少请求题数（core 至少 1，supporting 可 0）。 */
function capacityForObjective(
  objective: AssessmentCapacityObjective,
): { capacity: number; limiting: AssessmentCapacityPlan["limiting_factors"] } {
  const limiting: AssessmentCapacityPlan["limiting_factors"] = []
  // 同一事实可以通过不同、且与 observable behavior 相容的题型进行复测，
  // 因此事实数不是题数的一比一上限。容量取“事实 × 可测题型”与剩余结构空间的交集。
  const evidenceCapacity = Math.max(0, objective.available_facts)
    * measuringModalityCount(objective.observable_behavior)
  const structureCapacity = Math.max(0,
    STRUCTURE_BUDGET_PER_OBJECTIVE - Math.max(0, objective.used_structures))
  if (evidenceCapacity < STRUCTURE_BUDGET_PER_OBJECTIVE) {
    limiting.push("EVIDENCE_DIVERSITY_LOW")
  }
  if (structureCapacity < STRUCTURE_BUDGET_PER_OBJECTIVE) {
    limiting.push("HISTORY_STRUCTURE_SATURATION")
  }
  return { capacity: Math.min(evidenceCapacity, structureCapacity), limiting }
}

export function planAssessmentCapacity(input: AssessmentCapacityInput): AssessmentCapacityPlan {
  const requested = input.requested.tier_1_count
    + input.requested.tier_2_count
    + input.requested.tier_3_count
  const coreCount = input.objectives.filter((objective) => objective.importance === "core").length
  const requiredModalityCount = new Set(input.requested.required_modalities).size
  const limiting = new Set<AssessmentCapacityPlan["limiting_factors"][number]>()
  const capacities = input.objectives.map((objective) => {
    const { capacity, limiting: factors } = capacityForObjective(objective)
    for (const factor of factors) limiting.add(factor)
    return capacity
  })
  const coreIndexes = input.objectives.flatMap((objective, index) =>
    objective.importance === "core" ? [index] : [])

  // 每个 core 必须至少保留一个直接测量槽位；任何 core 容量为零都不能靠别的目标补齐。
  if (coreIndexes.some((index) => capacities[index] === 0)
    || requested < coreCount
    || requested < requiredModalityCount) {
    return {
      requested_items: requested,
      feasible_items: 0,
      per_objective: input.objectives.map((objective, index) => ({
        objective_id: objective.objective_id,
        importance: objective.importance,
        requested: objective.importance === "core" ? 1 : 0,
        feasible: Math.min(objective.importance === "core" ? 1 : 0, capacities[index]!),
      })),
      limiting_factors: [...limiting],
      decision: "REPLAN",
    }
  }

  const allocation = new Array(input.objectives.length).fill(0) as number[]
  for (const index of coreIndexes) allocation[index] = 1
  let remaining = requested - coreCount
  const allocationOrder = [
    ...coreIndexes,
    ...input.objectives.flatMap((objective, index) =>
      objective.importance === "supporting" ? [index] : []),
  ]
  while (remaining > 0) {
    const available = allocationOrder.filter((index) => allocation[index]! < capacities[index]!)
    if (available.length === 0) break
    for (const index of available) {
      if (remaining === 0) break
      allocation[index] = allocation[index]! + 1
      remaining -= 1
    }
  }

  const feasibleItems = allocation.reduce((sum, value) => sum + value, 0)
  const perObjective = input.objectives.map((objective, index) => ({
    objective_id: objective.objective_id,
    importance: objective.importance,
    requested: allocation[index]!,
    feasible: allocation[index]!,
  }))
  if (feasibleItems < requested) {
    if (capacities.reduce((sum, value) => sum + value, 0) < requested) {
      if (input.objectives.reduce((sum, objective) => sum + objective.available_facts, 0) === 0) {
        limiting.add("EVIDENCE_DIVERSITY_LOW")
      }
      if (capacities.some((capacity) => capacity === 0)) {
        limiting.add("HISTORY_STRUCTURE_SATURATION")
      }
    }
  }

  if (feasibleItems >= requested) {
    return {
      requested_items: requested,
      feasible_items: feasibleItems,
      per_objective: perObjective,
      limiting_factors: [...limiting],
      decision: "FULL",
    }
  }

  if (feasibleItems >= Math.max(coreCount, requiredModalityCount)) {
    return {
      requested_items: requested,
      feasible_items: feasibleItems,
      per_objective: perObjective,
      limiting_factors: [...limiting],
      decision: "REDUCE",
      adjusted_blueprint: reduceBlueprint(input.requested, feasibleItems),
    }
  }

  return {
    requested_items: requested,
    feasible_items: feasibleItems,
    per_objective: perObjective,
    limiting_factors: [...limiting],
    decision: "REPLAN",
  }
}

/**
 * 缩减蓝图：优先保留 Tier 1（基础认知）与 core objective 覆盖；
 * 从 Tier 3 开始砍，不足再砍 Tier 2，最后 Tier 1。
 */
function reduceBlueprint(
  requested: AssessmentBlueprint,
  feasibleItems: number,
): AssessmentBlueprint {
  let remaining = feasibleItems
  const tier1 = Math.min(requested.tier_1_count, remaining)
  remaining -= tier1
  const tier2 = Math.min(requested.tier_2_count, remaining)
  remaining -= tier2
  const tier3 = Math.min(requested.tier_3_count, remaining)
  return {
    tier_1_count: tier1,
    tier_2_count: tier2,
    tier_3_count: tier3,
    required_modalities: [...requested.required_modalities],
  }
}

/** 便捷：从 LearningObjective + 证据事实数 + 历史已用结构数构造 capacity input。 */
export function capacityObjectiveFromLearningObjective(
  objective: {
    objective_id: string
    observable_behavior: ObservableBehavior
    importance: "core" | "supporting"
    required_fact_ids: string[]
  },
  availableFacts: number,
  usedStructures: number,
): AssessmentCapacityObjective {
  return {
    objective_id: objective.objective_id,
    observable_behavior: objective.observable_behavior,
    importance: objective.importance,
    available_facts: Math.max(0, availableFacts),
    used_structures: Math.max(0, usedStructures),
  }
}

/** 便捷：该 behavior 可测的 modality 数（用于 capacity 结构多样性评估）。 */
export function measuringModalityCount(behavior: ObservableBehavior): number {
  const modalities: AssessmentModality[] = ["mcq", "true_false", "trace", "short_answer", "code"]
  return modalities.filter((modality) => modalityMeasuresBehavior(behavior, modality)).length
}
