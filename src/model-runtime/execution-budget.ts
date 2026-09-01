export interface ExecutionBudgetLimits {
  soft_deadline_ms: number
  hard_deadline_ms: number
  max_model_calls: number
  max_transport_retries_total: number
}
export interface ExecutionBudgetSnapshot extends ExecutionBudgetLimits {
  started_at_ms: number
  deadline_at_ms: number
  used_model_calls: number
  used_transport_retries: number
}

export interface RoleCContentBudgetWorkload {
  objective_count: number
  assessment_item_count: number
  public_candidate_count: 1 | 2 | 3
  max_internal_repairs?: number
  max_external_revisions?: number
}

/**
 * Candidate authoring, independent critics, secure materialization and A/B
 * semantic review form one quality workflow. The durable job deliberately
 * outlives its model budget so the accepted release can still be persisted.
 */
// A five-item form with three public candidates, secure authoring, independent
// critics and one evidence-driven revision can legitimately exceed eight
// minutes on a reasoning model even though every individual call is healthy.
// Keep the durable lease above the model budget; call-count limits still
// prevent runaway loops while the longer lease lets a completed release be
// persisted after model authoring finishes.
export const ROLE_C_REVIEWED_WORKFLOW_SOFT_DEADLINE_MS = 600_000
export const ROLE_C_REVIEWED_WORKFLOW_HARD_DEADLINE_MS = 900_000
export const ROLE_C_DURABLE_JOB_DEADLINE_MS = 1_200_000

/**
 * Derive the hard call ceiling from the actual Role C authoring workload.
 *
 * Public authoring is a candidate tournament: every objective/assessment item
 * may author several candidates, and every candidate can consume the initial
 * call plus targeted repairs.  The former fixed ceiling (60) predated that
 * architecture and could abort an otherwise healthy five-item assessment.
 * This ceiling is deliberately conservative; normal runs stop as soon as an
 * eligible winner passes and the workflow deadline remains the time boundary.
 */
export function roleCContentModelCallBudget(input: RoleCContentBudgetWorkload): number {
  const objectiveCount = positiveCount(input.objective_count)
  const assessmentItemCount = positiveCount(input.assessment_item_count)
  const candidateCount = input.public_candidate_count
  const authorAttempts = 1 + nonNegativeCount(input.max_internal_repairs ?? 2)
  const reviewedReleases = 1 + nonNegativeCount(input.max_external_revisions ?? 2)

  const conceptCalls = objectiveCount * candidateCount * authorAttempts
  // Public tournament plus independent reference and input-author stages.
  const codeLabCalls = candidateCount * authorAttempts + 2 * authorAttempts
  const assessmentCalls = assessmentItemCount * candidateCount * authorAttempts + authorAttempts
  // One independent batch critic per concept segment, code lab, and assessment item.
  const candidateCriticCalls = objectiveCount + 1 + assessmentItemCount
  // One semantic plan and up to two semantic passes per public artifact.
  const planningAndAuditCalls = 1 + 3 * 2
  const callsPerReviewedRelease = conceptCalls
    + codeLabCalls
    + assessmentCalls
    + candidateCriticCalls
    + planningAndAuditCalls

  return callsPerReviewedRelease * reviewedReleases
}

/** Standard one-objective, five-item, three-candidate reviewed workflow. */
export const ROLE_C_CONTENT_MODEL_CALL_BUDGET = roleCContentModelCallBudget({
  objective_count: 1,
  assessment_item_count: 5,
  public_candidate_count: 3,
})

function positiveCount(value: number): number {
  return Number.isInteger(value) && value > 0 ? value : 1
}

function nonNegativeCount(value: number): number {
  return Number.isInteger(value) && value >= 0 ? value : 0
}

export class ModelExecutionBudgetExceededError extends Error {
  constructor(readonly reason: "DEADLINE" | "MODEL_CALLS" | "TRANSPORT_RETRIES") {
    super(`MODEL_EXECUTION_BUDGET_EXCEEDED:${reason}`)
    this.name = "ModelExecutionBudgetExceededError"
  }
}

export class ModelExecutionBudget {
  private readonly startedAt = Date.now()
  private usedModelCalls = 0
  private usedTransportRetries = 0

  constructor(readonly limits: ExecutionBudgetLimits = {
    soft_deadline_ms: ROLE_C_REVIEWED_WORKFLOW_SOFT_DEADLINE_MS,
    hard_deadline_ms: ROLE_C_REVIEWED_WORKFLOW_HARD_DEADLINE_MS,
    max_model_calls: ROLE_C_CONTENT_MODEL_CALL_BUDGET,
    max_transport_retries_total: 3,
  }) {
    if (limits.soft_deadline_ms < 1
      || limits.hard_deadline_ms < limits.soft_deadline_ms
      || limits.max_model_calls < 1
      || limits.max_transport_retries_total < 0) {
      throw new Error("MODEL_EXECUTION_BUDGET_LIMITS_INVALID")
    }
  }

  consumeModelCall(now = Date.now()): void {
    this.assertWithinDeadline(now)
    if (this.usedModelCalls >= this.limits.max_model_calls) {
      throw new ModelExecutionBudgetExceededError("MODEL_CALLS")
    }
    this.usedModelCalls += 1
  }

  consumeTransportRetry(now = Date.now()): void {
    this.assertWithinDeadline(now)
    if (this.usedTransportRetries >= this.limits.max_transport_retries_total) {
      throw new ModelExecutionBudgetExceededError("TRANSPORT_RETRIES")
    }
    this.usedTransportRetries += 1
  }

  remainingMs(now = Date.now()): number {
    return Math.max(0, this.startedAt + this.limits.hard_deadline_ms - now)
  }

  snapshot(): ExecutionBudgetSnapshot {
    return {
      ...this.limits,
      started_at_ms: this.startedAt,
      deadline_at_ms: this.startedAt + this.limits.hard_deadline_ms,
      used_model_calls: this.usedModelCalls,
      used_transport_retries: this.usedTransportRetries,
    }
  }

  private assertWithinDeadline(now: number): void {
    if (this.remainingMs(now) <= 0) throw new ModelExecutionBudgetExceededError("DEADLINE")
  }
}
