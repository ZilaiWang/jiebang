import {
  INTERACTIVE_SESSION_COMMAND_TYPES,
  type InteractiveSessionCommand,
} from "./interactive-session"
import type { LearnerRequest, OrchestrationMode } from "./types"

export interface RunRequestBody {
  root_dir?: string
  run_id?: string
  session_id?: string
  mode?: OrchestrationMode
  learner_request?: LearnerRequest
}

export interface SessionRequestBody {
  session_id?: string
  run_id?: string
  mode?: OrchestrationMode
  learner_request?: LearnerRequest
}

export type OrchestratorApiBodyKind = "run" | "session" | "command"

export type OrchestratorApiSchemaResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] }

export function validateOrchestratorApiBody(kind: "run", value: unknown): OrchestratorApiSchemaResult<RunRequestBody>
export function validateOrchestratorApiBody(kind: "session", value: unknown): OrchestratorApiSchemaResult<SessionRequestBody>
export function validateOrchestratorApiBody(kind: "command", value: unknown): OrchestratorApiSchemaResult<InteractiveSessionCommand>
export function validateOrchestratorApiBody(kind: OrchestratorApiBodyKind, value: unknown): OrchestratorApiSchemaResult<RunRequestBody | SessionRequestBody | InteractiveSessionCommand> {
  if (!isRecord(value)) return { ok: false, errors: ["JSON request body must be an object"] }
  if (kind === "command") return validateCommandBody(value)

  const errors: string[] = []
  if (kind === "run") {
    if (value.mode !== "scaffold" && value.mode !== "deterministic") errors.push("mode must be scaffold or deterministic")
  } else if (value.mode !== "deterministic") {
    errors.push("interactive sessions currently require deterministic mode")
  }
  validateLearnerRequest(value.learner_request, errors)
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: value as RunRequestBody | SessionRequestBody }
}

function validateCommandBody(value: Record<string, unknown>): OrchestratorApiSchemaResult<InteractiveSessionCommand> {
  const errors: string[] = []
  if (typeof value.command_id !== "string" || !/^[A-Za-z0-9_-]{1,120}$/.test(value.command_id)) {
    errors.push("command_id is required and must be safe")
  }
  if (!INTERACTIVE_SESSION_COMMAND_TYPES.some((type) => type === value.type)
    && value.type !== "submit_profile_gap_answer") {
    errors.push("Unsupported command type")
  }
  if (value.type === "submit_profile_answers") {
    const payload = isRecord(value.payload) ? value.payload : null
    const answers = payload?.answers
    if (!Array.isArray(answers) || answers.length === 0
      || !answers.every((answer) => isRecord(answer)
        && typeof answer.question_id === "string"
        && "value" in answer)) {
      errors.push("submit_profile_answers.payload.answers must be a non-empty profile answer array")
    }
  }
  if (value.type === "submit_profile_gap_answer") {
    const payload = isRecord(value.payload) ? value.payload : null
    if (!payload || typeof payload.question_id !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(payload.question_id)) errors.push("profile gap question_id is required and must be safe")
    if (!payload || typeof payload.source_id !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(payload.source_id)) errors.push("profile gap source_id is required and must be safe")
    if (!payload || typeof payload.answer !== "string" || payload.answer.trim().length === 0 || payload.answer.length > 500) errors.push("profile gap answer is required and bounded")
  }
  if (value.type === "run_code_lab" || value.type === "submit_code_lab" || value.type === "debug_code_lab") {
    const payload = isRecord(value.payload) ? value.payload : null
    if (!payload || typeof payload.lab_id !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(payload.lab_id)) {
      errors.push(`${String(value.type)}.payload.lab_id is required and must be safe`)
    }
    const validCode = typeof payload?.code === "string" && payload.code.trim().length > 0 && Buffer.byteLength(payload.code, "utf8") <= 100_000
    const validGaps = isRecord(payload?.gap_answers)
      && Object.keys(payload.gap_answers).length > 0
      && Object.values(payload.gap_answers).every((entry) => typeof entry === "string")
    if (!validCode && !validGaps) {
      errors.push(`${String(value.type)}.payload requires code or non-empty gap_answers`)
    }
    if (value.type === "debug_code_lab") {
      const publicCase = typeof payload?.public_case_id === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(payload.public_case_id)
      const customInput = payload && Object.prototype.hasOwnProperty.call(payload, "custom_input")
      if ((publicCase ? 1 : 0) + (customInput ? 1 : 0) !== 1) {
        errors.push("debug_code_lab.payload requires exactly one of public_case_id or custom_input")
      }
    }
  }
  if (value.type === "run_assessment_code") {
    const payload = isRecord(value.payload) ? value.payload : null
    if (!payload || typeof payload.item_id !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(payload.item_id)) {
      errors.push("run_assessment_code.payload.item_id is required and must be safe")
    }
    if (!payload || typeof payload.code !== "string" || payload.code.trim().length === 0 || Buffer.byteLength(payload.code, "utf8") > 100_000) {
      errors.push("run_assessment_code.payload.code is required and must be at most 100 KB")
    }
  }
  if (value.type === "run_example_code") {
    const payload = isRecord(value.payload) ? value.payload : null
    if (!payload || typeof payload.code !== "string" || payload.code.trim().length === 0 || Buffer.byteLength(payload.code, "utf8") > 100_000) {
      errors.push("run_example_code.payload.code is required and must be at most 100 KB")
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: value as unknown as InteractiveSessionCommand }
}

function validateLearnerRequest(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("learner_request is required")
    return
  }
  if (typeof value.goal !== "string" || value.goal.trim().length === 0) {
    errors.push("learner_request.goal is required")
  }
  if (value.goal_profile !== undefined
    && !["coursework", "algorithm_competition", "job_interview", "general_learning"].includes(String(value.goal_profile))) {
    errors.push("learner_request.goal_profile is invalid")
  }
  const intake = value.profile_intake
  if (intake === undefined) return
  if (!isRecord(intake)) {
    errors.push("learner_request.profile_intake must be an object")
    return
  }
  if (intake.learner_id !== value.learner_id) {
    errors.push("profile_intake.learner_id must match learner_request.learner_id")
  }
  if (typeof intake.goal !== "string"
    || typeof value.goal !== "string"
    || intake.goal.trim() !== value.goal.trim()) {
    errors.push("profile_intake.goal must match learner_request.goal")
  }
  validateOptionalEnum(intake, "self_rating", ["beginner", "basic", "intermediate", "integrated"], errors)
  validateOptionalEnum(intake, "goal_use_case", ["coursework", "competition", "job", "project", "certification", "interest", "other"], errors)
  validateOptionalEnum(intake, "explanation_preference", ["analogy_first", "principle_first", "example_first", "step_by_step", "balanced"], errors)
  validateOptionalEnum(intake, "practice_preference", ["quiz", "coding", "project", "mixed"], errors)
  validateOptionalEnum(intake, "pace_preference", ["slow", "steady", "fast"], errors)
  for (const field of ["weekly_time_budget_minutes", "session_time_budget_minutes"] as const) {
    if (intake[field] !== undefined
      && (typeof intake[field] !== "number" || !Number.isFinite(intake[field]) || intake[field] <= 0)) {
      errors.push(`profile_intake.${field} must be a positive number`)
    }
  }
  for (const field of ["discipline_background", "prior_languages", "prior_topics", "preferred_contexts", "tool_constraints", "accommodations"] as const) {
    if (intake[field] !== undefined
      && (!Array.isArray(intake[field]) || !intake[field].every((item) => typeof item === "string"))) {
      errors.push(`profile_intake.${field} must be a string array`)
    }
  }
  if (intake.privacy !== undefined) {
    if (!isRecord(intake.privacy)) {
      errors.push("profile_intake.privacy must be an object")
    } else {
      validateOptionalEnum(intake.privacy, "retention", ["session_only", "cross_session"], errors, "profile_intake.privacy")
      for (const field of ["personalization_enabled", "allow_profile_display"] as const) {
        if (intake.privacy[field] !== undefined && typeof intake.privacy[field] !== "boolean") {
          errors.push(`profile_intake.privacy.${field} must be boolean`)
        }
      }
    }
  }
}

function validateOptionalEnum(
  value: Record<string, unknown>,
  field: string,
  allowed: string[],
  errors: string[],
  prefix = "profile_intake",
): void {
  if (value[field] !== undefined && !allowed.includes(String(value[field]))) {
    errors.push(`${prefix}.${field} must be one of ${allowed.join(", ")}`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
