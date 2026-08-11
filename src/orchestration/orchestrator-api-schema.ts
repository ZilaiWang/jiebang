import type { InteractiveSessionCommand } from "./interactive-session"
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
  if (!["submit_diagnosis_answers", "submit_assessment_answers", "run_assessment_code", "retry"].includes(String(value.type))) {
    errors.push("Unsupported command type")
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
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: value as unknown as InteractiveSessionCommand }
}

function validateLearnerRequest(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push("learner_request is required")
  } else if (typeof value.goal !== "string" || value.goal.trim().length === 0) {
    errors.push("learner_request.goal is required")
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
