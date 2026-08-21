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

/**
 * One reviewed Role C candidate can use up to twenty calls when staged
 * authoring, one targeted repair per stage, and three semantic artifact audits
 * are all exercised. Two external revisions mean at most three candidates.
 * The budget is a hard safety ceiling; successful workflows stop far earlier.
 */
export const ROLE_C_CONTENT_MODEL_CALL_BUDGET = 20 * 3

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
    soft_deadline_ms: 180_000,
    hard_deadline_ms: 360_000,
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
