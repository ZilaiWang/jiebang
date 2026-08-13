import { createTraceLedger, appendTraceEvent, writeTraceSummary, type TraceLedger } from "./trace-ledger"
import { transitionOrchestrationState, ORCHESTRATION_WORKER_SEQUENCE } from "./state-machine"
import { validateWorkerResult } from "./worker-contract"
import { createScaffoldWorkerInvocation, runWorkerAdapter } from "./worker-adapters"
import { appendPersistenceEvents, loadLearnerMemory, saveLearnerMemory, type PersistenceEvent } from "./learner-memory"
import type {
  ClarificationRequest,
  LearnerRequest,
  OrchestrationMode,
  OrchestrationRunSummary,
  OrchestrationState,
  TraceEvent,
  WorkerResult,
} from "./types"

export interface RunLearningOrchestratorInput {
  root_dir: string
  run_id?: string
  session_id?: string
  mode: OrchestrationMode
  learner_request: LearnerRequest
  now?: () => string
}

export interface RunLearningOrchestratorResult {
  summary: OrchestrationRunSummary
  ledger: TraceLedger
}

export async function runLearningOrchestrator(
  input: RunLearningOrchestratorInput,
): Promise<RunLearningOrchestratorResult> {
  const now = input.now ?? (() => new Date().toISOString())
  const runId = input.run_id ?? `RUN-${Date.now()}`
  const sessionId = input.session_id ?? `SESSION-${Date.now()}`
  const startedAt = now()
  const ledger = await createTraceLedger({ root_dir: input.root_dir, run_id: runId })
  const events: TraceEvent[] = []
  let state: OrchestrationState = "created"
  let completedSteps = 0
  let status: OrchestrationRunSummary["status"] = "failed"
  let blockedStage: OrchestrationState | undefined
  let failedStage: OrchestrationState | undefined
  let upstreamArtifacts: Record<string, unknown> = {}
  let inputRefs: string[] = []
  let evidenceRefs: OrchestrationRunSummary["events"][number]["evidence_refs"] = []
  const learnerId = input.learner_request.learner_id ?? "demo_loop_weak_001"
  let learnerMemory = await loadLearnerMemory(input.root_dir, learnerId)
  let learnerMemoryRef: string | undefined
  const persistenceEvents: PersistenceEvent[] = []
  const clarificationRequests: ClarificationRequest[] = []
  const encoder = new TextEncoder()
  upstreamArtifacts = {
    ...upstreamArtifacts,
    "learner-memory": learnerMemory,
  }

  async function record(event: Omit<TraceEvent, "schema_version" | "run_id" | "session_id" | "timestamp">): Promise<void> {
    const fullEvent: TraceEvent = {
      schema_version: "1.0",
      run_id: runId,
      session_id: sessionId,
      timestamp: now(),
      ...event,
    }
    events.push(fullEvent)
    await appendTraceEvent(ledger, fullEvent)
  }

  await record({
    step_index: 0,
    event_type: "session_started",
    stage: state,
    message: `learning-orchestrator started in ${input.mode} mode`,
    input_refs: [],
    output_refs: [],
    evidence_refs: [],
  })

  const intake = transitionOrchestrationState(state, { type: "intake_ready" })
  if (!intake.ok) {
    failedStage = state
    await record({
      step_index: 0,
      event_type: "session_failed",
      stage: state,
      message: intake.error.message,
      input_refs: [],
      output_refs: [],
      evidence_refs: [],
      error: { code: intake.error.code, message: intake.error.message, severity: "fatal" },
    })
    return finish()
  }
  state = intake.state
  await record({
    step_index: 0,
    event_type: "state_transition",
    stage: state,
    message: "created -> intake_ready",
    input_refs: [],
    output_refs: [],
    evidence_refs: [],
  })

  for (const [index, step] of ORCHESTRATION_WORKER_SEQUENCE.entries()) {
    const stepIndex = index + 1
    await record({
      step_index: stepIndex,
      event_type: "orchestrator_decision",
      stage: state,
      worker: step.worker,
      message: `delegate ${step.from} to ${step.worker}`,
      input_refs: inputRefs,
      output_refs: [],
      evidence_refs: evidenceRefs,
    })

    const invocation = createScaffoldWorkerInvocation({
      session_id: sessionId,
      run_id: runId,
      step_index: stepIndex,
      stage: state,
      worker: step.worker,
      learner_request: input.learner_request,
      upstream_artifacts: upstreamArtifacts,
      input_refs: inputRefs,
      evidence_refs: evidenceRefs,
    })
    const finalInvocation = { ...invocation, mode: input.mode }

    const workerStartedAt = now()
    await record({
      step_index: stepIndex,
      event_type: "worker_invoked",
      stage: state,
      worker: step.worker,
      message: `invoke ${step.worker}`,
      input_refs: inputRefs,
      output_refs: [],
      evidence_refs: evidenceRefs,
    })

    const workerResult = await runWorkerAdapter(finalInvocation)
    const workerFinishedAt = now()
    const workerDurationMs = Math.max(0, Date.parse(workerFinishedAt) - Date.parse(workerStartedAt))
    const workerResultSizeBytes = encoder.encode(JSON.stringify(workerResult)).byteLength
    const validation = validateWorkerResult(finalInvocation, workerResult)
    if (!validation.ok) {
      const error = validation.errors[0]
      failedStage = state
      status = "failed"
      await record({
        step_index: stepIndex,
        event_type: "worker_failed",
        stage: state,
        worker: step.worker,
        message: `worker contract invalid: ${error.message}`,
        input_refs: inputRefs,
        output_refs: [],
        evidence_refs: evidenceRefs,
        error,
      })
      await recordTerminal("session_failed", state, error.code, error.message)
      return finish()
    }

    await recordWorkerTerminal(stepIndex, state, workerResult, workerDurationMs, workerResultSizeBytes)

    if (workerResult.status === "blocked") {
      blockedStage = state
      status = "blocked"
      await recordTerminal(
        "session_blocked",
        state,
        workerResult.errors[0]?.code ?? "WORKER_BLOCKED",
        workerResult.errors[0]?.message ?? workerResult.summary,
      )
      return finish()
    }

    if (workerResult.status === "failed") {
      failedStage = state
      status = "failed"
      await recordTerminal(
        "session_failed",
        state,
        workerResult.errors[0]?.code ?? "WORKER_FAILED",
        workerResult.errors[0]?.message ?? workerResult.summary,
      )
      return finish()
    }

    const transition = transitionOrchestrationState(state, {
      type: "worker_completed",
      worker: step.worker,
    })
    if (!transition.ok) {
      failedStage = state
      status = "failed"
      await recordTerminal("session_failed", state, transition.error.code, transition.error.message)
      return finish()
    }

    completedSteps += 1
    persistenceEvents.push(...(workerResult.persistence_events ?? []))
    persistenceEvents.push(...(workerResult.mastery_updates ?? []).map((update) => ({
      event_type: "mastery_update" as const,
      source: workerResult.worker,
      source_id: update.source_id,
      mastery: update.mastery,
      evidence: update.evidence,
    })))
    clarificationRequests.push(...(workerResult.clarification_requests ?? []))
    learnerMemory = appendPersistenceEvents(learnerMemory, persistenceEvents, now())
    upstreamArtifacts = {
      ...upstreamArtifacts,
      "learner-memory": learnerMemory,
      [step.worker]: workerResult.artifacts,
    }
    inputRefs = workerResult.output_refs
    evidenceRefs = workerResult.evidence_refs
    state = transition.state
    await record({
      step_index: stepIndex,
      event_type: "state_transition",
      stage: state,
      worker: step.worker,
      message: `${step.from} -> ${state}`,
      input_refs: [],
      output_refs: workerResult.output_refs,
      evidence_refs: workerResult.evidence_refs,
    })
  }

  const complete = transitionOrchestrationState(state, { type: "complete" })
  if (complete.ok) {
    state = complete.state
    status = "completed"
    persistenceEvents.push({
      event_type: "session_completed",
      source: "learning-orchestrator",
      session_id: sessionId,
      summary: `learning-orchestrator completed ${input.mode} workflow`,
    })
    learnerMemory = appendPersistenceEvents(learnerMemory, persistenceEvents, now())
    learnerMemoryRef = await saveLearnerMemory(input.root_dir, learnerMemory)
    await record({
      step_index: ORCHESTRATION_WORKER_SEQUENCE.length + 1,
      event_type: "session_completed",
      stage: state,
      message: "learning-orchestrator completed scaffold workflow",
      input_refs: inputRefs,
      output_refs: [],
      evidence_refs: evidenceRefs,
    })
  } else {
    failedStage = state
    status = "failed"
    await recordTerminal("session_failed", state, complete.error.code, complete.error.message)
  }

  return finish()

  async function recordWorkerTerminal(
    stepIndex: number,
    currentState: OrchestrationState,
    workerResult: WorkerResult,
    durationMs: number,
    resultSizeBytes: number,
  ): Promise<void> {
    await record({
      step_index: stepIndex,
      event_type: workerResult.status === "completed"
        ? "worker_completed"
        : workerResult.status === "blocked"
          ? "worker_blocked"
          : "worker_failed",
      stage: currentState,
      worker: workerResult.worker,
      message: workerResult.summary,
      input_refs: inputRefs,
      output_refs: workerResult.output_refs,
      evidence_refs: workerResult.evidence_refs,
      duration_ms: durationMs,
      result_size_bytes: resultSizeBytes,
      error: workerResult.errors[0],
    })
  }

  async function recordTerminal(
    eventType: "session_blocked" | "session_failed",
    currentState: OrchestrationState,
    code: string,
    message: string,
  ): Promise<void> {
    await record({
      step_index: completedSteps + 1,
      event_type: eventType,
      stage: currentState,
      message,
      input_refs: inputRefs,
      output_refs: [],
      evidence_refs: evidenceRefs,
      error: { code, message, severity: eventType === "session_failed" ? "fatal" : "recoverable" },
    })
  }

  async function finish(): Promise<RunLearningOrchestratorResult> {
    const summary: OrchestrationRunSummary = {
      schema_version: "1.0",
      run_id: runId,
      session_id: sessionId,
      mode: input.mode,
      status,
      started_at: startedAt,
      finished_at: now(),
      total_steps: ORCHESTRATION_WORKER_SEQUENCE.length,
      completed_steps: completedSteps,
      blocked_stage: blockedStage,
      failed_stage: failedStage,
      events,
      artifacts: {
        trace: ledger.trace_path,
        summary_json: ledger.summary_json_path,
        summary_md: ledger.summary_md_path,
      },
      persistence_events: persistenceEvents,
      clarification_requests: clarificationRequests,
      learner_memory_ref: learnerMemoryRef,
    }
    await writeTraceSummary(ledger, summary)
    return { summary, ledger }
  }
}
