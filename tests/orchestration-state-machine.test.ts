import { describe, expect, test } from "bun:test"
import {
  ORCHESTRATION_WORKER_SEQUENCE,
  getNextWorkerForState,
  isTerminalOrchestrationState,
  transitionOrchestrationState,
} from "../src/orchestration/state-machine"
import type { OrchestrationState } from "../src/orchestration/types"

describe("Learning Orchestrator state machine", () => {
  test("maps the canonical eight-step workflow to the expected workers", () => {
    expect(ORCHESTRATION_WORKER_SEQUENCE.map((step) => step.worker)).toEqual([
      "background-collector",
      "self-assessor",
      "objective-diagnostician",
      "profile-builder",
      "path-planner",
      "concept-tutor",
      "code-lab",
      "tiered-evaluator",
    ])

    expect(ORCHESTRATION_WORKER_SEQUENCE.map((step) => step.from)).toEqual([
      "intake_ready",
      "background_collected",
      "self_assessed",
      "objective_diagnosed",
      "profile_built",
      "path_planned",
      "concept_ready",
      "lab_ready",
    ])
  })

  test("advances through every legal state transition and reaches completed", () => {
    let state: OrchestrationState = "created"

    state = transitionOrchestrationState(state, { type: "intake_ready" }).state
    expect(state).toBe("intake_ready")

    for (const step of ORCHESTRATION_WORKER_SEQUENCE) {
      expect(getNextWorkerForState(state)).toBe(step.worker)
      const result = transitionOrchestrationState(state, {
        type: "worker_completed",
        worker: step.worker,
      })
      expect(result.ok).toBe(true)
      state = result.state
      expect(state).toBe(step.to)
    }

    const completed = transitionOrchestrationState(state, { type: "complete" })
    expect(completed).toEqual({ ok: true, state: "completed" })
    expect(isTerminalOrchestrationState(completed.state)).toBe(true)
  })

  test("rejects illegal jumps and wrong worker completions", () => {
    expect(transitionOrchestrationState("created", {
      type: "worker_completed",
      worker: "background-collector",
    })).toEqual({
      ok: false,
      state: "failed",
      error: {
        code: "ILLEGAL_TRANSITION",
        message: "created cannot complete worker background-collector",
      },
    })

    expect(transitionOrchestrationState("intake_ready", {
      type: "worker_completed",
      worker: "profile-builder",
    })).toEqual({
      ok: false,
      state: "failed",
      error: {
        code: "WRONG_WORKER",
        message: "intake_ready expects background-collector, received profile-builder",
      },
    })
  })

  test("enters blocked or failed from any active orchestration state", () => {
    const activeStates: OrchestrationState[] = [
      "created",
      "intake_ready",
      "background_collected",
      "self_assessed",
      "objective_diagnosed",
      "profile_built",
      "path_planned",
      "concept_ready",
      "lab_ready",
      "assessment_ready",
    ]

    for (const state of activeStates) {
      expect(transitionOrchestrationState(state, {
        type: "block",
        reason: "worker output missing marker",
      })).toEqual({
        ok: true,
        state: "blocked",
        reason: "worker output missing marker",
      })
      expect(transitionOrchestrationState(state, {
        type: "fail",
        reason: "runtime exception",
      })).toEqual({
        ok: true,
        state: "failed",
        reason: "runtime exception",
      })
    }
  })

  test("does not allow terminal states to continue", () => {
    for (const terminal of ["completed", "blocked", "failed"] as const) {
      expect(isTerminalOrchestrationState(terminal)).toBe(true)
      expect(getNextWorkerForState(terminal)).toBeUndefined()
      expect(transitionOrchestrationState(terminal, { type: "complete" })).toEqual({
        ok: false,
        state: terminal,
        error: {
          code: "TERMINAL_STATE",
          message: `${terminal} cannot transition further`,
        },
      })
    }
  })
})
