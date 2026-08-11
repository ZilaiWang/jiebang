import type { GradeResultArtifact } from "./artifacts"
import { C_SCHEMA_VERSION, stableId, type SchemaVersion } from "./common"
import type { ProfileDriftSuggestion } from "./learning-evidence-event"
import type { ObjectiveMasteryState } from "../mastery/beta-mastery"
import { validateRoleCSchema } from "../validators/runtime-schema-validator"

export type LearningAction = "remediate" | "reinforce" | "advance" | "reprofile"

export interface FinalLearningDecision {
  action: LearningAction
  basis: "round_accuracy" | "profile_drift"
  confidence: number
  reason_codes: string[]
  target_objective_ids: string[]
  policy_ref: string
}

export interface ObjectiveRoundResult {
  objective_id: string
  raw_score: number
  max_score: number
  accuracy: number
  evidence_score: number
  misconception_tags: string[]
}

export interface PublicMasterySnapshot {
  objective_id: string
  mastery: number
  evidence_batches: number
  observed_modalities: ObjectiveMasteryState["observed_modalities"]
  revision: number
}

/**
 * Public, program-assembled result of one formal submission. It contains no secure
 * refs, answers, hidden tests, Beta parameters, or idempotency ledgers.
 */
export interface DynamicFeedbackResult {
  schema_version: SchemaVersion
  feedback_id: string
  run_id: string
  session_id: string
  submission_id: string
  learner_id_hash: string
  profile_version: string
  path_node_id: string
  form_id: string
  attempt_no: number
  round_score: {
    raw_score: number
    max_score: number
    accuracy: number
    evidence_score: number
  }
  objective_results: ObjectiveRoundResult[]
  grade_result: GradeResultArtifact
  mastery_snapshot: PublicMasterySnapshot[]
  final_decision: FinalLearningDecision
  profile_drift_suggestion?: ProfileDriftSuggestion
}

export const ROUND_ACCURACY_POLICY_REF = "role-c-round-accuracy-v1"

export interface RoundActionPolicy {
  policy_ref: string
  remediate_below: number
  advance_at_least: number
}

export const DEFAULT_ROUND_ACTION_POLICY: Readonly<RoundActionPolicy> = Object.freeze({
  policy_ref: ROUND_ACCURACY_POLICY_REF,
  remediate_below: 0.4,
  advance_at_least: 0.8,
})

export function decideRoundAction(input: {
  raw_score: number
  max_score: number
  objective_results?: ObjectiveRoundResult[]
  profile_drift_suggestion?: ProfileDriftSuggestion
}): FinalLearningDecision {
  const policy = DEFAULT_ROUND_ACTION_POLICY
  const accuracy = scoreRatio(input.raw_score, input.max_score)
  const objectiveResults = input.objective_results ?? []

  if (input.profile_drift_suggestion) {
    return {
      action: "reprofile",
      basis: "profile_drift",
      confidence: input.profile_drift_suggestion.confidence,
      reason_codes: [...new Set(input.profile_drift_suggestion.reason_codes)],
      target_objective_ids: [...new Set(input.profile_drift_suggestion.conflicting_objective_ids)],
      policy_ref: policy.policy_ref,
    }
  }

  if (accuracy < policy.remediate_below) {
    return {
      action: "remediate",
      basis: "round_accuracy",
      confidence: confidenceFromBoundary(accuracy, policy.remediate_below),
      reason_codes: ["round_accuracy_below_remediation_threshold"],
      target_objective_ids: focusObjectives(
        objectiveResults,
        (result) => result.accuracy < policy.remediate_below,
      ),
      policy_ref: policy.policy_ref,
    }
  }

  if (accuracy < policy.advance_at_least) {
    return {
      action: "reinforce",
      basis: "round_accuracy",
      confidence: confidenceFromBand(accuracy, policy.remediate_below, policy.advance_at_least),
      reason_codes: ["round_accuracy_in_reinforcement_band"],
      target_objective_ids: focusObjectives(
        objectiveResults,
        (result) => result.accuracy < policy.advance_at_least,
      ),
      policy_ref: policy.policy_ref,
    }
  }

  return {
    action: "advance",
    basis: "round_accuracy",
    confidence: confidenceFromBoundary(accuracy, policy.advance_at_least),
    reason_codes: ["round_accuracy_at_or_above_advancement_threshold"],
    target_objective_ids: [],
    policy_ref: policy.policy_ref,
  }
}

export function buildDynamicFeedbackResult(input: {
  session_id: string
  learner_id_hash: string
  profile_version: string
  path_node_id: string
  attempt_no: number
  grade_result: GradeResultArtifact
  mastery_states: ObjectiveMasteryState[]
  final_decision: FinalLearningDecision
  profile_drift_suggestion?: ProfileDriftSuggestion
}): DynamicFeedbackResult {
  const payload = input.grade_result.payload
  if (input.grade_result.status !== "ready" || !payload || !payload.score_frozen) {
    throw new Error("DYNAMIC_FEEDBACK_REQUIRES_READY_FROZEN_GRADE")
  }
  if (input.grade_result.run_id.trim() === "" || input.session_id.trim() === "") {
    throw new Error("DYNAMIC_FEEDBACK_IDENTITY_EMPTY")
  }
  const objectiveResults = aggregateObjectiveResults(payload.item_results)
  const knownObjectives = new Set(objectiveResults.map((result) => result.objective_id))
  if (input.final_decision.target_objective_ids.some((objectiveId) => !knownObjectives.has(objectiveId))) {
    throw new Error("DYNAMIC_FEEDBACK_TARGET_OBJECTIVE_UNKNOWN")
  }
  const expectedDecision = decideRoundAction({
    raw_score: payload.raw_score,
    max_score: payload.max_score,
    objective_results: objectiveResults,
    profile_drift_suggestion: input.profile_drift_suggestion,
  })
  if (!sameDecision(expectedDecision, input.final_decision)
    || payload.recommendation.action !== input.final_decision.action
    || payload.recommendation.confidence !== input.final_decision.confidence
    || !sameStrings(payload.recommendation.reason_codes, input.final_decision.reason_codes)) {
    throw new Error("DYNAMIC_FEEDBACK_DECISION_MISMATCH")
  }
  if (input.profile_drift_suggestion
    && (input.profile_drift_suggestion.learner_id_hash !== input.learner_id_hash
      || input.profile_drift_suggestion.profile_version !== input.profile_version)) {
    throw new Error("DYNAMIC_FEEDBACK_DRIFT_IDENTITY_MISMATCH")
  }
  const masteryObjectiveIds = input.mastery_states.map((state) => state.objective_id)
  if (new Set(masteryObjectiveIds).size !== masteryObjectiveIds.length
    || masteryObjectiveIds.some((objectiveId) => !knownObjectives.has(objectiveId))
    || [...knownObjectives].some((objectiveId) => !masteryObjectiveIds.includes(objectiveId))) {
    throw new Error("DYNAMIC_FEEDBACK_MASTERY_OBJECTIVE_MISMATCH")
  }
  if (input.mastery_states.some((state) =>
    state.learner_id_hash !== input.learner_id_hash
      || state.profile_version !== input.profile_version)) {
    throw new Error("DYNAMIC_FEEDBACK_MASTERY_IDENTITY_MISMATCH")
  }
  const masterySnapshot = input.mastery_states
    .map((state) => ({
      objective_id: state.objective_id,
      mastery: state.mastery,
      evidence_batches: state.evidence_batches,
      observed_modalities: [...state.observed_modalities],
      revision: state.revision,
    }))
    .sort((left, right) => left.objective_id.localeCompare(right.objective_id))
  const result: DynamicFeedbackResult = {
    schema_version: C_SCHEMA_VERSION,
    feedback_id: stableId("DFR", {
      grade_artifact_id: input.grade_result.artifact_id,
      session_id: input.session_id,
      decision: input.final_decision,
      mastery_snapshot: masterySnapshot,
    }),
    run_id: input.grade_result.run_id,
    session_id: input.session_id,
    submission_id: payload.submission_id,
    learner_id_hash: input.learner_id_hash,
    profile_version: input.profile_version,
    path_node_id: input.path_node_id,
    form_id: payload.form_id,
    attempt_no: input.attempt_no,
    round_score: {
      raw_score: payload.raw_score,
      max_score: payload.max_score,
      accuracy: scoreRatio(payload.raw_score, payload.max_score),
      evidence_score: payload.evidence_score,
    },
    objective_results: objectiveResults,
    grade_result: structuredClone(input.grade_result),
    mastery_snapshot: masterySnapshot,
    final_decision: structuredClone(input.final_decision),
    profile_drift_suggestion: input.profile_drift_suggestion
      ? structuredClone(input.profile_drift_suggestion)
      : undefined,
  }
  const report = validateRoleCSchema("dynamic_feedback_result.schema.json", result)
  if (!report.ok) {
    throw new Error(`INVALID_DYNAMIC_FEEDBACK:${report.issues.map((issue) => `${issue.path}:${issue.message}`).join(",")}`)
  }
  return deepFreeze(result)
}

export function aggregateObjectiveResults(
  itemResults: NonNullable<GradeResultArtifact["payload"]>["item_results"],
): ObjectiveRoundResult[] {
  const grouped = new Map<string, typeof itemResults>()
  for (const item of itemResults) {
    const bucket = grouped.get(item.objective_id) ?? []
    bucket.push(item)
    grouped.set(item.objective_id, bucket)
  }
  return [...grouped.entries()]
    .map(([objectiveId, items]) => {
      const rawScore = round(items.reduce((sum, item) => sum + item.raw_score, 0))
      const maxScore = round(items.reduce((sum, item) => sum + item.max_score, 0))
      return {
        objective_id: objectiveId,
        raw_score: rawScore,
        max_score: maxScore,
        accuracy: scoreRatio(rawScore, maxScore),
        evidence_score: round(items.reduce((sum, item) => sum + item.evidence_score, 0) / items.length),
        misconception_tags: [...new Set(items.flatMap((item) => item.misconception_tags))].sort(),
      }
    })
    .sort((left, right) => left.objective_id.localeCompare(right.objective_id))
}

function focusObjectives(
  results: ObjectiveRoundResult[],
  predicate: (result: ObjectiveRoundResult) => boolean,
): string[] {
  const selected = results.filter(predicate).map((result) => result.objective_id)
  if (selected.length > 0) return [...new Set(selected)]
  if (results.length === 0) return []
  const minimum = Math.min(...results.map((result) => result.accuracy))
  return [...new Set(results.filter((result) => result.accuracy === minimum).map((result) => result.objective_id))]
}

function confidenceFromBoundary(value: number, boundary: number): number {
  return round(Math.min(0.95, 0.75 + Math.abs(value - boundary) * 0.25))
}

function confidenceFromBand(value: number, lower: number, upper: number): number {
  const midpoint = (lower + upper) / 2
  const halfWidth = (upper - lower) / 2
  return round(Math.min(0.9, 0.72 + (1 - Math.abs(value - midpoint) / halfWidth) * 0.12))
}

function scoreRatio(rawScore: number, maxScore: number): number {
  if (!Number.isFinite(rawScore) || !Number.isFinite(maxScore) || maxScore <= 0 || rawScore < 0 || rawScore > maxScore) {
    throw new Error("INVALID_ROUND_SCORE")
  }
  return round(rawScore / maxScore)
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function sameDecision(left: FinalLearningDecision, right: FinalLearningDecision): boolean {
  return left.action === right.action
    && left.basis === right.basis
    && left.confidence === right.confidence
    && left.policy_ref === right.policy_ref
    && sameStrings(left.reason_codes, right.reason_codes)
    && sameStrings(left.target_objective_ids, right.target_objective_ids)
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value
  Object.values(value as Record<string, unknown>).forEach(deepFreeze)
  return Object.freeze(value)
}
