import { describe, expect, test } from "bun:test"
import {
  aggregateObjectiveResults,
  buildDynamicFeedbackResult,
  decideRoundAction,
  deliverDynamicFeedbackToD,
  validateRoleCSchema,
  type DynamicFeedbackResult,
  type GradeResultArtifact,
  type ObjectiveMasteryState,
  type RoleCDynamicFeedbackDelivery,
} from "../src/role-c-content"

const versions = {
  profile_version: "profile-v1",
  kb_version: "kb-v1",
  rag_version: "rag-v1",
  prompt_version: "prompt-v1",
  model_config_hash: "model-v1",
  schema_version: "1.0" as const,
}

function gradeArtifact(
  rawScore: number,
  maxScore: number,
  action: "remediate" | "reinforce" | "advance" | "reprofile",
  confidence: number,
  reasonCodes: string[],
): GradeResultArtifact {
  return {
    schema_version: "1.0",
    run_id: "RUN-DYNAMIC-01",
    artifact_id: "ART-GRADE-01",
    artifact_type: "grade_result",
    agent: "tiered-evaluator",
    status: "ready",
    versions,
    seed: 7,
    input_refs: ["SUB-01"],
    citations: [],
    quality: {
      schema_ok: true,
      citation_coverage: 1,
      objective_coverage: 1,
      alignment_score: 1,
      answer_key_verified: true,
    },
    payload: {
      submission_id: "SUB-01",
      form_id: "FORM-01",
      score_frozen: true,
      raw_score: rawScore,
      max_score: maxScore,
      evidence_score: 0.45,
      item_results: [
        {
          item_id: "I1",
          objective_id: "O1",
          raw_score: rawScore,
          max_score: maxScore,
          evidence_score: 0.45,
          grader_confidence: 1,
          hint_factor: 0.45,
          repeat_factor: 1,
          misconception_tags: [],
          feedback_code: rawScore === maxScore ? "correct" : "incorrect",
        },
      ],
      recommendation: { action, confidence, reason_codes: reasonCodes },
      feedback: {
        generated_after_score_freeze: true,
        mode: "formative",
        summary: "评分已冻结。",
        item_feedback: [{
          item_id: "I1",
          feedback_code: rawScore === maxScore ? "correct" : "incorrect",
          message: "反馈",
          next_step: "下一步",
        }],
      },
    },
    trace_ref: "TRACE-01",
  }
}

function masteryState(): ObjectiveMasteryState {
  return {
    schema_version: "1.0",
    learner_id_hash: "learner-hash",
    profile_version: "profile-v1",
    objective_id: "O1",
    alpha: 1.45,
    beta: 1.55,
    mastery: 0.483333,
    evidence_batches: 1,
    observed_modalities: ["mcq"],
    processed_artifact_ids: ["ART-GRADE-01"],
    last_action: "remediate",
    revision: 1,
  }
}

describe("role C dynamic feedback contract", () => {
  test("uses round accuracy at exact policy boundaries", () => {
    expect(decideRoundAction({ raw_score: 0, max_score: 10 }).action).toBe("remediate")
    expect(decideRoundAction({ raw_score: 4, max_score: 10 }).action).toBe("reinforce")
    expect(decideRoundAction({ raw_score: 8, max_score: 10 }).action).toBe("advance")
    expect(decideRoundAction({ raw_score: 10, max_score: 10 }).action).toBe("advance")
  })

  test("keeps a full-score action independent from discounted evidence and prior mastery", () => {
    const itemResults = gradeArtifact(10, 10, "advance", 0.8, [
      "round_accuracy_at_or_above_advancement_threshold",
    ]).payload!.item_results
    const objectiveResults = aggregateObjectiveResults(itemResults)
    const decision = decideRoundAction({ raw_score: 10, max_score: 10, objective_results: objectiveResults })
    expect(decision.action).toBe("advance")
    expect(objectiveResults[0]).toMatchObject({ accuracy: 1, evidence_score: 0.45 })
  })

  test("gives an explicit profile drift suggestion priority", () => {
    const decision = decideRoundAction({
      raw_score: 10,
      max_score: 10,
      objective_results: [{
        objective_id: "O1",
        raw_score: 10,
        max_score: 10,
        accuracy: 1,
        evidence_score: 0.45,
        misconception_tags: [],
      }],
      profile_drift_suggestion: {
        schema_version: "1.0",
        suggestion_id: "PDS-01",
        learner_id_hash: "learner-hash",
        profile_version: "profile-v1",
        conflicting_objective_ids: ["O1"],
        reason_codes: ["repeated_profile_evidence_conflict"],
        confidence: 0.86,
        action: "reprofile",
      },
    })
    expect(decision).toMatchObject({ action: "reprofile", basis: "profile_drift", target_objective_ids: ["O1"] })
  })

  test("assembles a schema-valid public result without mastery internals", () => {
    const decision = decideRoundAction({
      raw_score: 10,
      max_score: 10,
      objective_results: [{
        objective_id: "O1",
        raw_score: 10,
        max_score: 10,
        accuracy: 1,
        evidence_score: 0.45,
        misconception_tags: [],
      }],
    })
    const result = buildDynamicFeedbackResult({
      session_id: "SESSION-01",
      learner_id_hash: "learner-hash",
      profile_version: "profile-v1",
      path_node_id: "NODE-01",
      attempt_no: 1,
      grade_result: gradeArtifact(10, 10, decision.action, decision.confidence, decision.reason_codes),
      mastery_states: [masteryState()],
      final_decision: decision,
    })
    expect(validateRoleCSchema("dynamic_feedback_result.schema.json", result).ok).toBe(true)
    expect(JSON.stringify(result)).not.toContain("processed_artifact_ids")
    expect(JSON.stringify(result)).not.toContain("\"alpha\"")
    expect(JSON.stringify(result)).not.toContain("secure://")
    expect(Object.isFrozen(result)).toBe(true)
  })

  test("delivers feedback as one stable idempotency envelope", async () => {
    const feedback = dynamicFeedbackFixture()
    const received: RoleCDynamicFeedbackDelivery[] = []
    const committed = new Set<string>()
    const port = {
      async publishDynamicFeedback(delivery: RoleCDynamicFeedbackDelivery) {
        received.push(structuredClone(delivery))
        const status = committed.has(delivery.delivery_id) ? "duplicate" as const : "accepted" as const
        committed.add(delivery.delivery_id)
        return {
          schema_version: "1.0" as const,
          delivery_kind: delivery.delivery_kind,
          delivery_id: delivery.delivery_id,
          status,
        }
      },
    }

    const first = await deliverDynamicFeedbackToD(port, feedback)
    const replay = await deliverDynamicFeedbackToD(port, structuredClone(feedback))

    expect(received).toHaveLength(2)
    expect(received[0]!.delivery_id).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(received[0]!.delivery_id).toBe(received[1]!.delivery_id)
    expect(received[0]!.feedback).toEqual(feedback)
    expect(first.status).toBe("accepted")
    expect(replay.status).toBe("duplicate")
  })

  test("rejects a second contradictory public action", () => {
    const decision = decideRoundAction({ raw_score: 10, max_score: 10 })
    expect(() => buildDynamicFeedbackResult({
      session_id: "SESSION-01",
      learner_id_hash: "learner-hash",
      profile_version: "profile-v1",
      path_node_id: "NODE-01",
      attempt_no: 1,
      grade_result: gradeArtifact(10, 10, "reinforce", 0.75, ["old_evidence_action"]),
      mastery_states: [masteryState()],
      final_decision: decision,
    })).toThrow("DYNAMIC_FEEDBACK_DECISION_MISMATCH")
  })

  test("rejects an internally consistent action that contradicts the round policy", () => {
    const forgedDecision = {
      action: "reinforce" as const,
      basis: "round_accuracy" as const,
      confidence: 0.75,
      reason_codes: ["forged_reinforcement"],
      target_objective_ids: ["O1"],
      policy_ref: "role-c-round-accuracy-v1",
    }
    expect(() => buildDynamicFeedbackResult({
      session_id: "SESSION-01",
      learner_id_hash: "learner-hash",
      profile_version: "profile-v1",
      path_node_id: "NODE-01",
      attempt_no: 1,
      grade_result: gradeArtifact(
        10,
        10,
        forgedDecision.action,
        forgedDecision.confidence,
        forgedDecision.reason_codes,
      ),
      mastery_states: [masteryState()],
      final_decision: forgedDecision,
    })).toThrow("DYNAMIC_FEEDBACK_DECISION_MISMATCH")
  })

  test("requires one same-learner mastery snapshot for every graded objective", () => {
    const decision = decideRoundAction({ raw_score: 10, max_score: 10 })
    const grade = gradeArtifact(
      10,
      10,
      decision.action,
      decision.confidence,
      decision.reason_codes,
    )
    const wrongLearner = masteryState()
    wrongLearner.learner_id_hash = "another-learner"
    expect(() => buildDynamicFeedbackResult({
      session_id: "SESSION-01",
      learner_id_hash: "learner-hash",
      profile_version: "profile-v1",
      path_node_id: "NODE-01",
      attempt_no: 1,
      grade_result: grade,
      mastery_states: [wrongLearner],
      final_decision: decision,
    })).toThrow("DYNAMIC_FEEDBACK_MASTERY_IDENTITY_MISMATCH")

    expect(() => buildDynamicFeedbackResult({
      session_id: "SESSION-01",
      learner_id_hash: "learner-hash",
      profile_version: "profile-v1",
      path_node_id: "NODE-01",
      attempt_no: 1,
      grade_result: grade,
      mastery_states: [],
      final_decision: decision,
    })).toThrow("DYNAMIC_FEEDBACK_MASTERY_OBJECTIVE_MISMATCH")
  })
})

function dynamicFeedbackFixture(): DynamicFeedbackResult {
  const decision = decideRoundAction({
    raw_score: 10,
    max_score: 10,
    objective_results: [{
      objective_id: "O1",
      raw_score: 10,
      max_score: 10,
      accuracy: 1,
      evidence_score: 0.45,
      misconception_tags: [],
    }],
  })
  return buildDynamicFeedbackResult({
    session_id: "SESSION-01",
    learner_id_hash: "learner-hash",
    profile_version: "profile-v1",
    path_node_id: "NODE-01",
    attempt_no: 1,
    grade_result: gradeArtifact(
      10,
      10,
      decision.action,
      decision.confidence,
      decision.reason_codes,
    ),
    mastery_states: [masteryState()],
    final_decision: decision,
  })
}
