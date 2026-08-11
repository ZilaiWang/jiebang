import type {
  OrchestrationState,
  OrchestrationStepDefinition,
  OrchestrationTransitionEvent,
  OrchestrationTransitionResult,
  WorkerName,
} from "./types"

export const ORCHESTRATION_WORKER_SEQUENCE = [
  {
    from: "intake_ready",
    worker: "background-collector",
    to: "background_collected",
  },
  {
    from: "background_collected",
    worker: "self-assessor",
    to: "self_assessed",
  },
  {
    from: "self_assessed",
    worker: "objective-diagnostician",
    to: "objective_diagnosed",
  },
  {
    from: "objective_diagnosed",
    worker: "profile-builder",
    to: "profile_built",
  },
  {
    from: "profile_built",
    worker: "path-planner",
    to: "path_planned",
  },
  {
    from: "path_planned",
    worker: "concept-tutor",
    to: "concept_ready",
  },
  {
    from: "concept_ready",
    worker: "code-lab",
    to: "lab_ready",
  },
  {
    from: "lab_ready",
    worker: "tiered-evaluator",
    to: "assessment_ready",
  },
] as const satisfies readonly OrchestrationStepDefinition[]

const TERMINAL_STATES = new Set<OrchestrationState>([
  "completed",
  "blocked",
  "failed",
])

export function isTerminalOrchestrationState(
  state: OrchestrationState,
): state is "completed" | "blocked" | "failed" {
  return TERMINAL_STATES.has(state)
}

export function getNextWorkerForState(
  state: OrchestrationState,
): WorkerName | undefined {
  return ORCHESTRATION_WORKER_SEQUENCE.find((step) => step.from === state)?.worker
}

export function transitionOrchestrationState(
  state: OrchestrationState,
  event: OrchestrationTransitionEvent,
): OrchestrationTransitionResult {
  if (isTerminalOrchestrationState(state)) {
    return {
      ok: false,
      state,
      error: {
        code: "TERMINAL_STATE",
        message: `${state} cannot transition further`,
      },
    }
  }

  if (event.type === "block") {
    return { ok: true, state: "blocked", reason: event.reason }
  }

  if (event.type === "fail") {
    return { ok: true, state: "failed", reason: event.reason }
  }

  if (event.type === "intake_ready") {
    if (state === "created") {
      return { ok: true, state: "intake_ready" }
    }
    return {
      ok: false,
      state: "failed",
      error: {
        code: "ILLEGAL_TRANSITION",
        message: `${state} cannot become intake_ready`,
      },
    }
  }

  if (event.type === "complete") {
    if (state === "assessment_ready") {
      return { ok: true, state: "completed" }
    }
    return {
      ok: false,
      state: "failed",
      error: {
        code: "ILLEGAL_TRANSITION",
        message: `${state} cannot complete workflow`,
      },
    }
  }

  const expected = ORCHESTRATION_WORKER_SEQUENCE.find((step) => step.from === state)
  if (!expected) {
    return {
      ok: false,
      state: "failed",
      error: {
        code: "ILLEGAL_TRANSITION",
        message: `${state} cannot complete worker ${event.worker}`,
      },
    }
  }

  if (expected.worker !== event.worker) {
    return {
      ok: false,
      state: "failed",
      error: {
        code: "WRONG_WORKER",
        message: `${state} expects ${expected.worker}, received ${event.worker}`,
      },
    }
  }

  return { ok: true, state: expected.to }
}
