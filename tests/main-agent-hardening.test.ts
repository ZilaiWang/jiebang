import { describe, expect, test } from "bun:test"
import {
  ORCHESTRATOR_PROMPT,
  ORCHESTRATOR_PROMPTS,
  getOrchestratorPrompt,
} from "../src/prompts/orchestration"
import { validateWorkerResult } from "../src/orchestration/worker-contract"
import { runLearningOrchestrator } from "../src/orchestration/learning-orchestrator-runner"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { WorkerInvocation, WorkerResult } from "../src/orchestration/types"

const baseInvocation: WorkerInvocation = {
  schema_version: "1.0",
  session_id: "SESSION-MAIN-AGENT-HARDENING",
  run_id: "RUN-MAIN-AGENT-HARDENING",
  step_index: 1,
  stage: "intake_ready",
  worker: "background-collector",
  learner_request: { goal: "学习 Python 循环" },
  upstream_artifacts: {},
  input_refs: [],
  evidence_refs: [],
  retry_count: 0,
  mode: "deterministic",
}

function structuredResult(overrides: Partial<WorkerResult> = {}): WorkerResult {
  return {
    schema_version: "1.0",
    run_id: baseInvocation.run_id,
    step_index: baseInvocation.step_index,
    worker: baseInvocation.worker,
    stage: baseInvocation.stage,
    status: "completed",
    marker: "[executed:background-collector]",
    execution: {
      worker: "background-collector",
      status: "completed",
      execution_id: "EXEC-BACKGROUND-001",
      marker: "[executed:background-collector]",
    },
    summary: "background evidence collected",
    artifacts: { background_evidence: { ok: true } },
    output_refs: ["background_evidence"],
    evidence_refs: [],
    next: "background_collected",
    errors: [],
    ...overrides,
  }
}

describe("main agent hardening", () => {
  test("separates production and scaffold prompts", () => {
    expect(Object.keys(ORCHESTRATOR_PROMPTS).sort()).toEqual(["production", "scaffold"])
    expect(getOrchestratorPrompt("production")).toBe(ORCHESTRATOR_PROMPT)
    expect(getOrchestratorPrompt("scaffold")).toContain("scaffold")
    expect(getOrchestratorPrompt("production")).not.toMatch(/scaffold|placeholder/i)
    expect(getOrchestratorPrompt("production")).toContain("structured worker envelope")
  })

  test("requires a structured execution envelope instead of trusting marker text alone", () => {
    expect(validateWorkerResult(baseInvocation, structuredResult())).toEqual({ ok: true, result: structuredResult() })

    expect(validateWorkerResult(baseInvocation, structuredResult({
      execution: undefined,
    }))).toEqual({
      ok: false,
      status: "invalid",
      errors: [
        {
          code: "EXECUTION_ENVELOPE_INVALID",
          message: "execution must be a non-null object",
          severity: "fatal",
        },
      ],
    })

    expect(validateWorkerResult(baseInvocation, structuredResult({
      execution: {
        worker: "profile-builder",
        status: "completed",
        execution_id: "EXEC-WRONG",
        marker: "[executed:profile-builder]",
      },
    }))).toEqual({
      ok: false,
      status: "invalid",
      errors: [
        {
          code: "EXECUTION_WORKER_MISMATCH",
          message: "expected execution.worker background-collector, received profile-builder",
          severity: "fatal",
        },
        {
          code: "EXECUTION_MARKER_MISMATCH",
          message: "expected execution.marker [executed:background-collector], received [executed:profile-builder]",
          severity: "recoverable",
        },
      ],
    })
  })

  test("records duration and result size telemetry for worker events", async () => {
    const root = await mkdtemp(join(tmpdir(), "main-agent-telemetry-"))
    try {
      let tick = 0
      const result = await runLearningOrchestrator({
        root_dir: root,
        run_id: "RUN-TELEMETRY-001",
        session_id: "SESSION-TELEMETRY-001",
        mode: "scaffold",
        learner_request: { goal: "学习 Python 循环" },
        now: () => new Date(Date.UTC(2026, 7, 5, 0, 0, tick++)).toISOString(),
      })
      const workerEvents = result.summary.events.filter((event) => event.event_type === "worker_completed")
      expect(workerEvents.length).toBe(8)
      expect(workerEvents.every((event) => typeof event.duration_ms === "number" && event.duration_ms >= 1000)).toBe(true)
      expect(workerEvents.every((event) => typeof event.result_size_bytes === "number" && event.result_size_bytes > 0)).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
