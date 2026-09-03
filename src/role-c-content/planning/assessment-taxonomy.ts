import type { AssessmentItemPublic } from "../contracts/artifacts"
import type { ObjectiveProgressBand } from "./objective-skill-estimate"

export type AssessmentDifficultyBand = "foundation" | "improvement" | "integration" | "extension"
export type AssessmentCognitiveLevel = "remember" | "understand" | "apply" | "analyze" | "create"

export interface AssessmentTaxonomyInputItem {
  item_id: string
  objective_id: string
  tier: 1 | 2 | 3
  modality: AssessmentItemPublic["modality"]
  cognitive_operation:
    | "recognize_fact"
    | "explain_reasoning"
    | "trace_execution"
    | "apply_rule"
    | "diagnose_error"
    | "construct_solution"
  presentation_mode?: string
  transfer_context?: string
}

export interface AssessmentTaxonomyEntry {
  item_id: string
  objective_id: string
  difficulty_band: AssessmentDifficultyBand
  cognitive_level: AssessmentCognitiveLevel
  rationale: string
}

export interface AssessmentTaxonomyPlan {
  schema_version: "assessment-taxonomy.v1"
  entries: AssessmentTaxonomyEntry[]
  distribution: {
    difficulty_bands: Record<AssessmentDifficultyBand, number>
    cognitive_levels: Record<AssessmentCognitiveLevel, number>
  }
}

export function buildAssessmentTaxonomyPlan(input: {
  items: AssessmentTaxonomyInputItem[]
  emphasis: { recall: number; understanding: number; application: number; analysis: number; creation: number }
  progress_by_objective?: Record<string, ObjectiveProgressBand>
}): AssessmentTaxonomyPlan {
  const weightSum = Object.values(input.emphasis).reduce((sum, value) => sum + value, 0)
  if (!Number.isFinite(weightSum) || weightSum <= 0 || Object.values(input.emphasis).some((value) => value < 0)) {
    throw new Error("ASSESSMENT_EMPHASIS_INVALID")
  }
  const entries = input.items.map((item): AssessmentTaxonomyEntry => {
    const cognitiveLevel = chooseCognitiveLevel(item, input.emphasis)
    const progress = input.progress_by_objective?.[item.objective_id]
    const transferReady = progress === "mastered" || progress === "ready_for_transfer"
    const transferTask = item.presentation_mode === "scenario_transfer"
      || Boolean(item.transfer_context)
      || cognitiveLevel === "create"
    const difficultyBand: AssessmentDifficultyBand = item.tier === 1
      ? "foundation"
      : item.tier === 2
        ? "improvement"
        : transferTask && transferReady ? "extension" : "integration"
    return {
      item_id: item.item_id,
      objective_id: item.objective_id,
      difficulty_band: difficultyBand,
      cognitive_level: cognitiveLevel,
      rationale: `Tier ${item.tier}、${item.modality}、${item.cognitive_operation}${progress ? `、进度 ${progress}` : ""}`,
    }
  })
  const plan: AssessmentTaxonomyPlan = {
    schema_version: "assessment-taxonomy.v1",
    entries,
    distribution: {
      difficulty_bands: count(entries.map((entry) => entry.difficulty_band), ["foundation", "improvement", "integration", "extension"]),
      cognitive_levels: count(entries.map((entry) => entry.cognitive_level), ["remember", "understand", "apply", "analyze", "create"]),
    },
  }
  const issues = validateAssessmentTaxonomyPlan(input.items, plan)
  if (issues.length > 0) throw new Error(`ASSESSMENT_TAXONOMY_INVALID:${issues.join("|")}`)
  return plan
}

export function validateAssessmentTaxonomyPlan(
  items: AssessmentTaxonomyInputItem[],
  plan: AssessmentTaxonomyPlan,
): string[] {
  if (items.length !== plan.entries.length) return [`taxonomy entries 数量应为 ${items.length}`]
  const issues: string[] = []
  const entries = new Map(plan.entries.map((entry) => [entry.item_id, entry]))
  for (const item of items) {
    const entry = entries.get(item.item_id)
    if (!entry) { issues.push(`缺少题目 ${item.item_id} 的 taxonomy`); continue }
    if (entry.objective_id !== item.objective_id) issues.push(`${item.item_id} 的 objective_id 不一致`)
    if (item.tier === 1 && entry.difficulty_band !== "foundation") issues.push(`${item.item_id} 的 Tier 1 必须为 foundation`)
    if (item.tier === 2 && entry.difficulty_band !== "improvement") issues.push(`${item.item_id} 的 Tier 2 必须为 improvement`)
    if (entry.difficulty_band === "extension" && item.tier !== 3) issues.push(`${item.item_id} 的 extension 只能用于 Tier 3`)
    if (entry.cognitive_level === "create" && (item.tier !== 3 || !["code", "short_answer"].includes(item.modality))) {
      issues.push(`${item.item_id} 的 create 必须为 Tier 3 code/short_answer`)
    }
    if (entry.cognitive_level === "remember" && item.tier !== 1) issues.push(`${item.item_id} 的 remember 只能用于 Tier 1`)
    if (item.cognitive_operation === "diagnose_error" && entry.cognitive_level !== "analyze") issues.push(`${item.item_id} 的 diagnose_error 必须为 analyze`)
    if (item.cognitive_operation === "construct_solution" && item.tier === 3 && entry.cognitive_level !== "create") {
      issues.push(`${item.item_id} 的 Tier 3 construct_solution 必须为 create`)
    }
  }
  // Distribution describes the frozen item plan. A uniform foundation set is
  // valid; item count alone cannot justify inventing a second difficulty band.
  return issues
}

function chooseCognitiveLevel(
  item: AssessmentTaxonomyInputItem,
  emphasis: { recall: number; understanding: number; application: number; analysis: number; creation: number },
): AssessmentCognitiveLevel {
  if (item.cognitive_operation === "diagnose_error") return "analyze"
  const feasible = item.tier === 1
    ? (["remember", "understand"] as const)
    : item.cognitive_operation === "recognize_fact" || item.cognitive_operation === "explain_reasoning"
      ? (["understand", ...(item.tier === 3 ? ["analyze" as const] : [])] as const)
      : item.cognitive_operation === "trace_execution" || item.cognitive_operation === "apply_rule"
        ? (["apply", ...(item.tier === 3 ? ["analyze" as const] : [])] as const)
        : item.tier === 3 ? (["create"] as const) : (["apply", "analyze"] as const)
  const native: AssessmentCognitiveLevel = item.tier === 1
    ? item.cognitive_operation === "recognize_fact" ? "remember" : "understand"
    : item.cognitive_operation === "construct_solution" && item.tier === 3 ? "create"
        : item.cognitive_operation === "trace_execution" || item.cognitive_operation === "apply_rule" ? "apply" : "understand"
  const weights: Record<AssessmentCognitiveLevel, number> = {
    remember: emphasis.recall, understand: emphasis.understanding, apply: emphasis.application,
    analyze: emphasis.analysis, create: emphasis.creation,
  }
  return [...feasible].sort((left, right) =>
    weights[right] + (right === native ? 0.75 : 0) - weights[left] - (left === native ? 0.75 : 0))[0]!
}

function count<T extends string>(values: T[], keys: T[]): Record<T, number> {
  return Object.fromEntries(keys.map((key) => [key, values.filter((value) => value === key).length])) as Record<T, number>
}
