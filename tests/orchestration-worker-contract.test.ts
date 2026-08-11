import { describe, expect, test } from "bun:test"
import {
  expectedMarkerForWorker,
  validateWorkerResult,
} from "../src/orchestration/worker-contract"
import type {
  WorkerInvocation,
  WorkerResult,
} from "../src/orchestration/types"

const baseInvocation: WorkerInvocation = {
  schema_version: "1.0",
  session_id: "SESSION-001",
  run_id: "RUN-001",
  step_index: 1,
  stage: "intake_ready",
  worker: "background-collector",
  learner_request: {
    goal: "学习 Python 循环",
    background: "JavaScript beginner",
  },
  upstream_artifacts: {},
  input_refs: [],
  evidence_refs: [],
  retry_count: 0,
  mode: "scaffold",
}

function validResult(overrides: Partial<WorkerResult> = {}): WorkerResult {
  const result: WorkerResult = {
    schema_version: "1.0",
    run_id: "RUN-001",
    step_index: 1,
    worker: "background-collector",
    stage: "intake_ready",
    status: "completed",
    marker: "[executed:background-collector]",
    execution: {
      worker: "background-collector",
      status: "completed",
      execution_id: "EXEC-BACKGROUND-001",
      marker: "[executed:background-collector]",
    },
    summary: "background evidence collected",
    artifacts: {
      background_evidence: {
        scaffold: true,
      },
    },
    output_refs: ["background_evidence"],
    evidence_refs: [],
    next: "background_collected",
    errors: [],
    ...overrides,
  }
  result.execution = overrides.execution ?? {
    worker: result.worker,
    status: result.status,
    execution_id: "EXEC-BACKGROUND-001",
    marker: result.marker,
  }
  return result
}

describe("orchestration worker contract", () => {
  test("accepts a valid completed worker result for the current invocation", () => {
    expect(expectedMarkerForWorker("background-collector")).toBe("[executed:background-collector]")

    expect(validateWorkerResult(baseInvocation, validResult())).toEqual({
      ok: true,
      result: validResult(),
    })
  })

  test("rejects identity mismatches instead of trusting worker output", () => {
    expect(validateWorkerResult(baseInvocation, validResult({ run_id: "RUN-OTHER" }))).toEqual({
      ok: false,
      status: "invalid",
      errors: [
        {
          code: "RUN_ID_MISMATCH",
          message: "expected run_id RUN-001, received RUN-OTHER",
          severity: "fatal",
        },
      ],
    })

    expect(validateWorkerResult(baseInvocation, validResult({ worker: "profile-builder" }))).toEqual({
      ok: false,
      status: "invalid",
      errors: [
        {
          code: "WORKER_MISMATCH",
          message: "expected worker background-collector, received profile-builder",
          severity: "fatal",
        },
        {
          code: "MARKER_MISMATCH",
          message: "expected marker [executed:profile-builder], received [executed:background-collector]",
          severity: "recoverable",
        },
        {
          code: "EXECUTION_WORKER_MISMATCH",
          message: "expected execution.worker background-collector, received profile-builder",
          severity: "fatal",
        },
      ],
    })
  })

  test("rejects missing or forged execution markers", () => {
    expect(validateWorkerResult(baseInvocation, validResult({ marker: "" }))).toEqual({
      ok: false,
      status: "invalid",
      errors: [
        {
          code: "MARKER_MISMATCH",
          message: "expected marker [executed:background-collector], received ",
          severity: "recoverable",
        },
        {
          code: "EXECUTION_MARKER_MISMATCH",
          message: "expected execution.marker [executed:background-collector], received ",
          severity: "recoverable",
        },
      ],
    })

    expect(validateWorkerResult(baseInvocation, validResult({ marker: "[executed:profile-builder]" }))).toEqual({
      ok: false,
      status: "invalid",
      errors: [
        {
          code: "MARKER_MISMATCH",
          message: "expected marker [executed:background-collector], received [executed:profile-builder]",
          severity: "recoverable",
        },
        {
          code: "EXECUTION_MARKER_MISMATCH",
          message: "expected execution.marker [executed:background-collector], received [executed:profile-builder]",
          severity: "recoverable",
        },
      ],
    })
  })

  test("rejects next-state jumps for completed workers", () => {
    expect(validateWorkerResult(baseInvocation, validResult({ next: "profile_built" }))).toEqual({
      ok: false,
      status: "invalid",
      errors: [
        {
          code: "NEXT_STATE_MISMATCH",
          message: "expected next background_collected, received profile_built",
          severity: "fatal",
        },
      ],
    })
  })

  test("allows blocked and failed results only with matching terminal next and errors", () => {
    expect(validateWorkerResult(baseInvocation, validResult({
      status: "blocked",
      next: "blocked",
      errors: [
        {
          code: "MISSING_MARKER",
          message: "worker output missing marker",
          severity: "recoverable",
        },
      ],
    }))).toEqual({
      ok: true,
      result: validResult({
        status: "blocked",
        next: "blocked",
        errors: [
          {
            code: "MISSING_MARKER",
            message: "worker output missing marker",
            severity: "recoverable",
          },
        ],
      }),
    })

    expect(validateWorkerResult(baseInvocation, validResult({
      status: "failed",
      next: "failed",
      errors: [
        {
          code: "WORKER_EXCEPTION",
          message: "worker crashed",
          severity: "fatal",
        },
      ],
    }))).toEqual({
      ok: true,
      result: validResult({
        status: "failed",
        next: "failed",
        errors: [
          {
            code: "WORKER_EXCEPTION",
            message: "worker crashed",
            severity: "fatal",
          },
        ],
      }),
    })

    expect(validateWorkerResult(baseInvocation, validResult({ status: "blocked", next: "background_collected" }))).toEqual({
      ok: false,
      status: "invalid",
      errors: [
        {
          code: "NEXT_STATE_MISMATCH",
          message: "blocked worker must point next to blocked, received background_collected",
          severity: "fatal",
        },
        {
          code: "ERRORS_REQUIRED",
          message: "blocked worker result must include at least one error",
          severity: "fatal",
        },
      ],
    })
  })

  test("rejects malformed artifact, refs, evidence, and errors containers", () => {
    const malformed = {
      ...validResult(),
      artifacts: null,
      output_refs: "background_evidence",
      evidence_refs: {},
      errors: {},
    } as unknown as WorkerResult

    expect(validateWorkerResult(baseInvocation, malformed)).toEqual({
      ok: false,
      status: "invalid",
      errors: [
        {
          code: "ARTIFACTS_INVALID",
          message: "artifacts must be a non-null object and not an array",
          severity: "fatal",
        },
        {
          code: "OUTPUT_REFS_INVALID",
          message: "output_refs must be an array",
          severity: "fatal",
        },
        {
          code: "EVIDENCE_REFS_INVALID",
          message: "evidence_refs must be an array",
          severity: "fatal",
        },
        {
          code: "ERRORS_INVALID",
          message: "errors must be an array",
          severity: "fatal",
        },
      ],
    })
  })

  test("accepts structured worker callbacks for persistence, mastery, and clarification", () => {
    const result = validResult({
      persistence_events: [
        {
          event_type: "learned_user_fact",
          source: "background-collector",
          key: "preferred_context",
          value: "成绩统计",
          evidence: "learner goal mentions score statistics",
        },
      ],
      mastery_updates: [
        {
          source_id: "K007",
          mastery: 0.32,
          evidence: "diagnostic loop item incorrect",
        },
      ],
      learned_facts_about_user: [
        {
          key: "goal_domain",
          value: "score_project",
          confidence: 0.9,
        },
      ],
      clarification_requests: [
        {
          question: "你是否学过函数定义与调用？",
          reason: "成绩统计项目需要函数基础，但历史记录缺少 K013 掌握证据",
          expected_answer_type: "choice",
          options: ["学过并能使用", "学过但不熟", "没学过"],
        },
      ],
      next_step_recommendation: {
        action: "continue",
        reason: "history and diagnostic evidence are sufficient for the next worker",
      },
    })

    expect(validateWorkerResult(baseInvocation, result)).toEqual({
      ok: true,
      result,
    })
  })

  test("rejects malformed worker callback containers", () => {
    const malformed = {
      ...validResult(),
      persistence_events: {},
      mastery_updates: {},
      learned_facts_about_user: {},
      clarification_requests: {},
      next_step_recommendation: "continue",
    } as unknown as WorkerResult

    expect(validateWorkerResult(baseInvocation, malformed)).toEqual({
      ok: false,
      status: "invalid",
      errors: [
        {
          code: "PERSISTENCE_EVENTS_INVALID",
          message: "persistence_events must be an array when provided",
          severity: "fatal",
        },
        {
          code: "MASTERY_UPDATES_INVALID",
          message: "mastery_updates must be an array when provided",
          severity: "fatal",
        },
        {
          code: "LEARNED_FACTS_INVALID",
          message: "learned_facts_about_user must be an array when provided",
          severity: "fatal",
        },
        {
          code: "CLARIFICATION_REQUESTS_INVALID",
          message: "clarification_requests must be an array when provided",
          severity: "fatal",
        },
        {
          code: "NEXT_STEP_RECOMMENDATION_INVALID",
          message: "next_step_recommendation must be an object when provided",
          severity: "fatal",
        },
      ],
    })
  })
})
