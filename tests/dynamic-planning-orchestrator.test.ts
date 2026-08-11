import { describe, expect, test } from "bun:test"
import { runDynamicPlanningLoop } from "../src/orchestration/dynamic-planning-orchestrator"
import type { ContinueRoleCForRoleDResult } from "../src/role-d-ui/src/domain/role-c-continuation"

const initialSubmission = {
  sessionId: "SESSION-1",
  submissionId: "SUB-1",
  learnerId: "learner-1",
}

function publishedResult(): ContinueRoleCForRoleDResult {
  const raw: unknown = {
    status: "published",
    continuation: {
      status: "published",
      preparation: {
        status: "generation_ready",
        action: "remediate",
        generation_action: "remediate",
        request_id: "REQ-2",
        idempotency_key: "KEY-2",
        parent_spec_id: "SPEC-1",
        prior_feedback_ref: "FEEDBACK-1",
        trigger_objective_ids: ["O1"],
        focus_objective_ids: ["O1"],
        run_id: "RUN-2",
        spec_id: "SPEC-2",
        path_node_id: "PATH-1",
        profile_version: "PROFILE-1",
        evidence_ref: "RAG-2",
      },
      generation: {
        schema_version: "1.0",
        result_kind: "review_recovery",
        run_id: "RUN-2",
        spec_id: "SPEC-2",
        pipeline_input_hash: `sha256:${"1".repeat(64)}`,
        generation_spec_hash: `sha256:${"2".repeat(64)}`,
        pipeline_status: "ready",
        pipeline_state: "READY",
        review_policy_version: "test-review-v1",
        recovery: {
          code: "READY",
          failed_dimensions: [],
          missing_prerequisite_source_ids: [],
          unknown_prerequisite_refs: [],
          required_action: "none",
          fix_scope: "none",
          can_recover: false,
          recovery_attempts: 0,
          message: "ready",
        },
        recovery_history: [],
      },
      learning_session: {
        delivery_kind: "learning_session",
        delivery_id: "DLV-SESSION-2",
        schema_version: "1.0",
        session: {
          phase: "route_locked",
          routing_request_id: "ROUTE-2",
          session_id: "SESSION-2",
          run_id: "RUN-2",
          form_id: "FORM-2",
          attempt_no: 1,
          route_lock_id: "LOCK-2",
          route_id: "ROUTE-ID-2",
          action: "remediate",
          anchor_score_ratio: 1,
          required_item_ids: ["I1"],
        },
      },
      delivery_to_d: {
        reviewed_release: { accepted: true, delivery_id: "DLV-REL-2", received_at: "2026-08-05T00:00:00.000Z" },
        learning_session: { accepted: true, delivery_id: "DLV-SESSION-2", received_at: "2026-08-05T00:00:00.000Z" },
      },
    },
    reviewedRelease: {
      delivery_kind: "reviewed_release",
      delivery_id: "DLV-REL-2",
      run_id: "RUN-2",
      artifacts: [],
      trace_events: [],
    },
    learningSession: {
      delivery_kind: "learning_session",
      delivery_id: "DLV-SESSION-2",
      schema_version: "1.0",
      session: {
        phase: "route_locked",
        routing_request_id: "ROUTE-2",
        session_id: "SESSION-2",
        run_id: "RUN-2",
        form_id: "FORM-2",
        attempt_no: 1,
        route_lock_id: "LOCK-2",
        route_id: "ROUTE-ID-2",
        action: "remediate",
        anchor_score_ratio: 1,
        required_item_ids: ["I1"],
      },
    },
    artifacts: [],
    finalContext: {
      profileSnapshot: {
        profile_id: "PROFILE-1",
        profile_version: "PROFILE-1",
        learner_id: "learner-1",
        learner_id_hash: "learner-1",
        level: "beginner",
        goal: "learn loops",
        known_concepts: [],
        weak_concepts: [],
        objective_mastery: [],
      },
      profileVersion: "PROFILE-1",
      pathNode: {
        node_id: "PATH-1",
        source_id: "K007",
        title: "循环",
        difficulty: "beginner",
        prerequisites: [],
        objective_ids: ["O1"],
        target_source_ids: ["K007"],
      },
      evidencePack: {
        schema_version: "1.0",
        retrieval_id: "RAG-2",
        kb_version: "kb-test",
        rag_version: "rag-test",
        query: "test",
        learner_level: "beginner",
        top_k: 0,
        match_status: "strong",
        results: [],
      },
    },
  }
  return raw as ContinueRoleCForRoleDResult
}

describe("dynamic planning orchestrator", () => {
  test("publishes the next round and stops at awaiting_submission instead of fabricating another answer", async () => {
    let calls = 0
    const result = await runDynamicPlanningLoop({
      initial_submission: initialSubmission,
      max_rounds: 3,
      continue_after_submission: async () => {
        calls += 1
        return publishedResult()
      },
    })

    expect(calls).toBe(1)
    expect(result.status).toBe("awaiting_submission")
    expect(result.rounds).toHaveLength(1)
    expect(result.final_round).toMatchObject({
      round_no: 1,
      decision: "awaiting_submission",
      run_id: "RUN-2",
      session_id: "SESSION-2",
      form_id: "FORM-2",
      attempt_no: 1,
    })
  })

  test("returns awaiting_input when B/A context is required before dynamic replanning", async () => {
    const result = await runDynamicPlanningLoop({
      initial_submission: initialSubmission,
      max_rounds: 2,
      continue_after_submission: async () => ({
        status: "awaiting_input",
        action: "advance",
        requestId: "REQ-ADVANCE",
        requiredInputs: ["nextPathNode"],
      }),
    })

    expect(result.status).toBe("awaiting_input")
    expect(result.final_round?.required_inputs).toEqual(["nextPathNode"])
  })

  test("terminates on blocked continuation", async () => {
    const result = await runDynamicPlanningLoop({
      initial_submission: initialSubmission,
      max_rounds: 2,
      continue_after_submission: async () => ({
        status: "blocked",
        stage: "preparation",
        reason: "next round evidence missing",
      }),
    })

    expect(result.status).toBe("blocked")
    expect(result.final_round).toMatchObject({
      decision: "blocked",
      reason: "next round evidence missing",
    })
  })

  test("rejects invalid max_rounds", async () => {
    await expect(runDynamicPlanningLoop({
      initial_submission: initialSubmission,
      max_rounds: 0,
      continue_after_submission: async () => publishedResult(),
    })).rejects.toThrow("DYNAMIC_PLANNING_MAX_ROUNDS_INVALID")
  })
})
