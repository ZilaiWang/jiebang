import { ORCHESTRATION_WORKER_SEQUENCE } from "./state-machine"
import type {
  OrchestrationState,
  WorkerError,
  WorkerInvocation,
  WorkerName,
  WorkerResult,
} from "./types"

export interface WorkerContractValidationFailure {
  ok: false
  status: "invalid"
  errors: WorkerError[]
}

export interface WorkerContractValidationSuccess {
  ok: true
  result: WorkerResult
}

export type WorkerContractValidationResult =
  | WorkerContractValidationSuccess
  | WorkerContractValidationFailure

export function expectedMarkerForWorker(worker: WorkerName): string {
  return `[executed:${worker}]`
}

export function validateWorkerResult(
  invocation: WorkerInvocation,
  result: WorkerResult,
): WorkerContractValidationResult {
  const errors: WorkerError[] = []

  if (result.schema_version !== "1.0") {
    errors.push(fatal(
      "SCHEMA_VERSION_INVALID",
      `expected schema_version 1.0, received ${String(result.schema_version)}`,
    ))
  }

  if (result.run_id !== invocation.run_id) {
    errors.push(fatal(
      "RUN_ID_MISMATCH",
      `expected run_id ${invocation.run_id}, received ${String(result.run_id)}`,
    ))
  }

  if (result.step_index !== invocation.step_index) {
    errors.push(fatal(
      "STEP_INDEX_MISMATCH",
      `expected step_index ${invocation.step_index}, received ${String(result.step_index)}`,
    ))
  }

  if (result.worker !== invocation.worker) {
    errors.push(fatal(
      "WORKER_MISMATCH",
      `expected worker ${invocation.worker}, received ${String(result.worker)}`,
    ))
  }

  if (result.stage !== invocation.stage) {
    errors.push(fatal(
      "STAGE_MISMATCH",
      `expected stage ${invocation.stage}, received ${String(result.stage)}`,
    ))
  }

  const markerWorker = result.worker ?? invocation.worker
  const expectedMarker = expectedMarkerForWorker(markerWorker)
  if (result.marker !== expectedMarker) {
    errors.push({
      code: "MARKER_MISMATCH",
      message: `expected marker ${expectedMarker}, received ${String(result.marker)}`,
      severity: "recoverable",
    })
  }

  validateExecutionEnvelope(invocation, result, errors)

  validateContainers(result, errors)
  validateNextState(invocation, result, errors)

  if (errors.length > 0) {
    return { ok: false, status: "invalid", errors }
  }

  return { ok: true, result }
}

function validateExecutionEnvelope(
  invocation: WorkerInvocation,
  result: WorkerResult,
  errors: WorkerError[],
): void {
  if (!isRecord(result.execution)) {
    errors.push(fatal("EXECUTION_ENVELOPE_INVALID", "execution must be a non-null object"))
    return
  }

  if (result.execution.worker !== invocation.worker) {
    errors.push(fatal(
      "EXECUTION_WORKER_MISMATCH",
      `expected execution.worker ${invocation.worker}, received ${String(result.execution.worker)}`,
    ))
  }

  if (result.execution.status !== result.status) {
    errors.push(fatal(
      "EXECUTION_STATUS_MISMATCH",
      `expected execution.status ${result.status}, received ${String(result.execution.status)}`,
    ))
  }

  if (typeof result.execution.execution_id !== "string" || result.execution.execution_id.trim().length === 0) {
    errors.push(fatal("EXECUTION_ID_INVALID", "execution.execution_id must be a non-empty string"))
  }

  const expectedMarker = expectedMarkerForWorker(invocation.worker)
  if (result.execution.marker !== expectedMarker) {
    errors.push({
      code: "EXECUTION_MARKER_MISMATCH",
      message: `expected execution.marker ${expectedMarker}, received ${String(result.execution.marker)}`,
      severity: "recoverable",
    })
  }
}

function validateContainers(result: WorkerResult, errors: WorkerError[]): void {
  if (!isRecord(result.artifacts)) {
    errors.push(fatal(
      "ARTIFACTS_INVALID",
      "artifacts must be a non-null object and not an array",
    ))
  }

  if (!Array.isArray(result.output_refs)) {
    errors.push(fatal("OUTPUT_REFS_INVALID", "output_refs must be an array"))
  }

  if (!Array.isArray(result.evidence_refs)) {
    errors.push(fatal("EVIDENCE_REFS_INVALID", "evidence_refs must be an array"))
  }

  if (!Array.isArray(result.errors)) {
    errors.push(fatal("ERRORS_INVALID", "errors must be an array"))
  }

  if (result.persistence_events !== undefined && !Array.isArray(result.persistence_events)) {
    errors.push(fatal("PERSISTENCE_EVENTS_INVALID", "persistence_events must be an array when provided"))
  }

  if (result.mastery_updates !== undefined && !Array.isArray(result.mastery_updates)) {
    errors.push(fatal("MASTERY_UPDATES_INVALID", "mastery_updates must be an array when provided"))
  }

  if (result.learned_facts_about_user !== undefined && !Array.isArray(result.learned_facts_about_user)) {
    errors.push(fatal("LEARNED_FACTS_INVALID", "learned_facts_about_user must be an array when provided"))
  }

  if (result.clarification_requests !== undefined && !Array.isArray(result.clarification_requests)) {
    errors.push(fatal("CLARIFICATION_REQUESTS_INVALID", "clarification_requests must be an array when provided"))
  }

  if (result.next_step_recommendation !== undefined && !isRecord(result.next_step_recommendation)) {
    errors.push(fatal("NEXT_STEP_RECOMMENDATION_INVALID", "next_step_recommendation must be an object when provided"))
  }
}

function validateNextState(
  invocation: WorkerInvocation,
  result: WorkerResult,
  errors: WorkerError[],
): void {
  if (result.status === "completed") {
    const expectedNext = expectedCompletedNext(invocation.stage)
    if (result.next !== expectedNext) {
      errors.push(fatal(
        "NEXT_STATE_MISMATCH",
        `expected next ${expectedNext}, received ${String(result.next)}`,
      ))
    }
    return
  }

  if (result.next !== result.status) {
    errors.push(fatal(
      "NEXT_STATE_MISMATCH",
      `${result.status} worker must point next to ${result.status}, received ${String(result.next)}`,
    ))
  }

  if (!Array.isArray(result.errors) || result.errors.length === 0) {
    errors.push(fatal(
      "ERRORS_REQUIRED",
      `${result.status} worker result must include at least one error`,
    ))
  }
}

function expectedCompletedNext(stage: OrchestrationState): OrchestrationState {
  const step = ORCHESTRATION_WORKER_SEQUENCE.find((candidate) => candidate.from === stage)
  if (!step) return "failed"
  return step.to
}

function fatal(code: string, message: string): WorkerError {
  return { code, message, severity: "fatal" }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
