import type { AssessmentSecureArtifact } from "../contracts/artifacts"
import { C_SCHEMA_VERSION, contentHash, stableId } from "../contracts/common"
import {
  aggregateObjectiveResults,
  decideRoundAction,
  type FinalLearningDecision,
} from "../contracts/dynamic-feedback"
import type { LearningEvidenceEvent } from "../contracts/learning-evidence-event"
import type { GenerationSpec } from "../contracts/generation-spec"
import type { SubmissionGrade } from "../grading/grade-submission"

export interface EmitLearningEvidenceContext {
  session_id: string
  learner_id_hash: string
  attempt_no: number
  submission_hash: string
  grader_version: string
  grade_artifact_id: string
  hint_levels_by_item?: Record<string, 0 | 1 | 2 | 3>
  /** One public decision copied into every event; it is never recomputed per objective. */
  final_decision?: FinalLearningDecision
}

export function emitLearningEvidence(
  grade: SubmissionGrade,
  spec: GenerationSpec,
  secureArtifact: AssessmentSecureArtifact,
  context: EmitLearningEvidenceContext,
): LearningEvidenceEvent[] {
  // Only a fully graded submission may influence B's formal profile/path decisions.
  if (grade.status !== "graded" || !grade.boundary_verified || secureArtifact.status !== "ready"
    || secureArtifact.quality.answer_key_verified !== true || !secureArtifact.payload) return []
  const secureItems = new Map(secureArtifact.payload.items.map((item) => [item.item_id, item]))
  const targets = new Map(spec.targets.map((target) => [target.objective_id, target]))
  const decision = context.final_decision ?? decideRoundAction({
    raw_score: grade.raw_score,
    max_score: grade.max_score,
    objective_results: aggregateObjectiveResults(grade.item_results),
  })
  const idempotencyKey = contentHash({
    contract: "role-c-mastery-evidence-batch-v1",
    run_id: spec.run_id,
    session_id: context.session_id,
    learner_id_hash: context.learner_id_hash,
    profile_version: spec.profile_ref.profile_version,
    submission_id: grade.submission_id,
    submission_hash: context.submission_hash,
    attempt_no: context.attempt_no,
    grade_artifact_id: context.grade_artifact_id,
  })

  return grade.item_results.flatMap((result) => {
    const item = secureItems.get(result.item_id)
    const target = targets.get(result.objective_id)
    if (!item || !target) return []
    return [{
      schema_version: C_SCHEMA_VERSION,
      event_id: stableId("LEE", {
        idempotency_key: idempotencyKey,
        item_id: result.item_id,
      }),
      learner_id_hash: context.learner_id_hash,
      profile_version: spec.profile_ref.profile_version,
      path_node_id: spec.path_node.node_id,
      objective_id: result.objective_id,
      source_id: target.source_id,
      evidence: {
        modality: item.modality,
        raw_score: result.raw_score,
        evidence_score: result.evidence_score,
        grader_confidence: result.grader_confidence,
        hint_level: context.hint_levels_by_item?.[result.item_id] ?? 0,
        attempt_no: context.attempt_no,
      },
      misconceptions: [...result.misconception_tags],
      recommendation: {
        action: decision.action,
        confidence: decision.confidence,
        reason_codes: [...decision.reason_codes],
      },
      provenance: {
        artifact_id: context.grade_artifact_id,
        idempotency_key: idempotencyKey,
        item_id: result.item_id,
        grader_version: context.grader_version,
      },
    }]
  })
}
