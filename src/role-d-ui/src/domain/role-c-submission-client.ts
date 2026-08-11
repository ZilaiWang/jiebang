import type { RoleDSession } from "./types"
import { buildRoleCSubmissionAnswers, type RoleCSubmissionOutcome } from "./role-c-submission"

const ROLE_C_SUBMIT_ENDPOINT = "/api/role-c/submit"

export interface RoleCSubmissionRequest {
  sessionId: string
  runId: string
  learnerId: string
  formId: string
  attemptNo: number
  submissionId: string
  answers: ReturnType<typeof buildRoleCSubmissionAnswers>
}

export interface RoleCSubmissionResult {
  submissionId: string
  outcome: RoleCSubmissionOutcome
}

export async function submitRoleCAssessment(session: RoleDSession): Promise<RoleCSubmissionResult> {
  if (!session.roleC) {
    return {
      submissionId: "",
      outcome: { status: "blocked", submission_id: "", code: "ROLE_C_SESSION_MISSING", message: "当前学习计划没有 C 正式学习会话。" },
    }
  }
  const submissionId = `SUB-${session.sessionId}-${Date.now()}`
  const request: RoleCSubmissionRequest = {
    sessionId: session.roleC.learningSessionId,
    runId: session.roleC.runId,
    learnerId: session.profile.learnerId,
    formId: session.roleC.formId,
    attemptNo: session.roleC.attemptNo,
    submissionId,
    answers: buildRoleCSubmissionAnswers(session),
  }
  try {
    const response = await fetch(ROLE_C_SUBMIT_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    })
    const payload: unknown = await response.json()
    if (isRoleCSubmissionOutcome(payload)) {
      return { submissionId, outcome: payload }
    }
    return {
      submissionId,
      outcome: {
        status: "blocked",
        submission_id: submissionId,
        code: "ROLE_C_RESPONSE_INVALID",
        message: errorMessage(payload) ?? "C 返回了不符合公开合同的评分响应",
      },
    }
  } catch (error) {
    return {
      submissionId,
      outcome: {
        status: "blocked",
        submission_id: submissionId,
        code: "ROLE_C_SUBMISSION_UNAVAILABLE",
        message: error instanceof Error ? error.message : "C 正式评分服务不可用",
      },
    }
  }
}

function isRoleCSubmissionOutcome(value: unknown): value is RoleCSubmissionOutcome {
  if (!isRecord(value) || typeof value.status !== "string") return false
  if (value.status === "blocked") {
    return nonEmpty(value.submission_id) && nonEmpty(value.code) && typeof value.message === "string"
  }
  if (value.status === "needs_review") {
    return nonEmpty(value.submission_id)
      && Array.isArray(value.unresolved_item_ids)
      && value.unresolved_item_ids.every(nonEmpty)
  }
  return value.status === "completed" && isRoleCFeedback(value.feedback)
}

function isRoleCFeedback(value: unknown): boolean {
  if (!isRecord(value)
    || !nonEmpty(value.feedback_id)
    || !nonEmpty(value.submission_id)
    || !nonEmpty(value.run_id)
    || !nonEmpty(value.session_id)
    || !nonEmpty(value.learner_id_hash)
    || !nonEmpty(value.profile_version)
    || !nonEmpty(value.path_node_id)
    || !nonEmpty(value.form_id)
    || !Number.isInteger(value.attempt_no)
    || !isScore(value.round_score)
    || !Array.isArray(value.objective_results)
    || !value.objective_results.every(isObjectiveResult)
    || !Array.isArray(value.mastery_snapshot)
    || !value.mastery_snapshot.every(isMasteryState)
    || !isFinalDecision(value.final_decision)
    || !isGradeResult(value.grade_result)) return false
  return true
}

function isGradeResult(value: unknown): boolean {
  if (!isRecord(value) || !nonEmpty(value.artifact_id)) return false
  if (value.payload === undefined || value.payload === null) return true
  if (!isRecord(value.payload)) return false
  if (value.payload.item_results !== undefined
    && (!Array.isArray(value.payload.item_results) || !value.payload.item_results.every(isItemResult))) return false
  return true
}

function isItemResult(value: unknown): boolean {
  return isRecord(value)
    && nonEmpty(value.item_id)
    && nonEmpty(value.objective_id)
    && nonEmpty(value.status ?? value.feedback_code)
    && finiteNonNegative(value.raw_score)
    && finitePositive(value.max_score)
    && finiteRatio(value.evidence_score)
    && Number(value.raw_score) <= Number(value.max_score)
    && Array.isArray(value.misconception_tags)
    && value.misconception_tags.every((entry) => typeof entry === "string")
}

function isScore(value: unknown): boolean {
  return isRecord(value)
    && finiteNonNegative(value.raw_score)
    && finitePositive(value.max_score)
    && finiteRatio(value.accuracy)
    && finiteRatio(value.evidence_score)
    && Number(value.raw_score) <= Number(value.max_score)
}

function isObjectiveResult(value: unknown): boolean {
  return isRecord(value)
    && nonEmpty(value.objective_id)
    && finiteNonNegative(value.raw_score)
    && finitePositive(value.max_score)
    && finiteRatio(value.accuracy)
    && finiteRatio(value.evidence_score)
    && Number(value.raw_score) <= Number(value.max_score)
    && Array.isArray(value.misconception_tags)
    && value.misconception_tags.every((entry) => typeof entry === "string")
}

function isMasteryState(value: unknown): boolean {
  return isRecord(value)
    && nonEmpty(value.objective_id)
    && finiteRatio(value.mastery)
    && Number.isInteger(value.evidence_batches)
    && Number(value.evidence_batches) >= 0
    && Array.isArray(value.observed_modalities)
    && value.observed_modalities.every(nonEmpty)
    && Number.isInteger(value.revision)
    && Number(value.revision) >= 0
}

function isFinalDecision(value: unknown): boolean {
  return isRecord(value)
    && ["remediate", "reinforce", "advance", "reprofile"].includes(String(value.action))
    && (value.basis === "round_accuracy" || value.basis === "profile_drift")
    && finiteRatio(value.confidence)
    && Array.isArray(value.reason_codes)
    && value.reason_codes.every(nonEmpty)
    && Array.isArray(value.target_objective_ids)
    && value.target_objective_ids.every(nonEmpty)
    && nonEmpty(value.policy_ref)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function finiteNonNegative(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
}

function finitePositive(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0
}

function finiteRatio(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
}

function errorMessage(value: unknown): string | undefined {
  return isRecord(value) && typeof value.error === "string" ? value.error : undefined
}
