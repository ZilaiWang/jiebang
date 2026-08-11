import { describe, expect, test } from "vitest"
import type { RoleDSession } from "./types"
import { applyRoleCSubmissionOutcome, buildRoleCSubmissionAnswers } from "./role-c-submission"

const session: RoleDSession = {
  version: 1,
  eventMode: "live",
  sessionId: "session-d-1",
  updatedAt: "2026-07-29T00:00:00.000Z",
  profile: { learnerId: "learner-1", level: "integrated", knownConcepts: [], weakConcepts: [], goal: "完成成绩统计" },
  conflicts: [],
  retrieval: { query: "成绩统计", topK: 0, items: [] },
  artifacts: [{
    id: "assessment-1",
    kind: "assessment",
    title: "正式测评",
    status: "real",
    content: "",
    options: [],
    citations: [],
    evidenceStatus: "gap",
    items: [
      { id: "mcq-1", tier: 1, modality: "mcq", prompt: "选择", options: ["A", "B"], optionIds: ["opt-a", "opt-b"], citations: [] },
      { id: "trace-1", tier: 2, modality: "trace", prompt: "追踪", options: [], citations: [] },
      { id: "code-1", tier: 3, modality: "code", prompt: "代码", options: [], starterCode: "def solve():\n    pass", citations: [] },
    ],
  }],
  evidenceGaps: [],
  workflow: [],
  path: [
    { id: "K018", title: "成绩统计", difficulty: "integrated", status: "current", reason: "当前节点" },
    { id: "K019", title: "进阶项目", difficulty: "integrated", status: "upcoming", reason: "下一节点" },
  ],
  decision: { next: "remediate", reason: "等待评分" },
  assessmentGraded: false,
  roleC: { runId: "RUN-1", learningSessionId: "C-SESSION-1", formId: "FORM-1", attemptNo: 1 },
  planSource: "real-ab",
  planInput: { learnerId: "learner-1", educationContext: "", timeBudget: "", knownConcepts: [], weakConcepts: [] },
  diagnosis: { sourceId: "UNKNOWN", factId: "UNKNOWN", concept: "", difficulty: "beginner", question: "", options: [], answer: "" },
  view: {
    currentStage: "learning",
    maxUnlockedStage: "feedback",
    activeArtifactKind: "assessment",
    selectedSourceId: "",
    remediationStarted: false,
    goalDraft: "完成成绩统计",
    selfRatingDraft: "integrated",
    diagnosisAnswer: "",
    diagnosisSubmitted: false,
    assessmentAnswers: { "mcq-1": "opt-b", "trace-1": "变量最终为 8", "code-1": "def solve():\n    return 8" },
    assessmentSubmitted: false,
    assessmentStatus: "idle",
    detailDrawer: "none",
  },
}

describe("Role D formal C submission adapter", () => {
  test("maps every public response modality into C SubmissionAnswer without inventing grading fields", () => {
    expect(buildRoleCSubmissionAnswers(session)).toEqual([
      { item_id: "mcq-1", selected_option_id: "opt-b", hint_level_used: 0 },
      { item_id: "trace-1", text_response: "变量最终为 8", hint_level_used: 0 },
      { item_id: "code-1", code_response: "def solve():\n    return 8", hint_level_used: 0 },
    ])
  })

  test("applies C completed feedback and advances the displayed path without recomputing the decision in D", () => {
    const updated = applyRoleCSubmissionOutcome(session, "SUB-1", {
      status: "completed",
      feedback: {
        feedback_id: "DFR-1",
        submission_id: "SUB-1",
        run_id: "RUN-1",
        session_id: "C-SESSION-1",
        learner_id_hash: "learner-1",
        profile_version: "RUN-1-profile-v1",
        path_node_id: "RUN-1-PATH-K018",
        form_id: "FORM-1",
        attempt_no: 1,
        round_score: { raw_score: 8, max_score: 10, accuracy: 0.8, evidence_score: 0.72 },
        objective_results: [],
        mastery_snapshot: [],
        final_decision: {
          action: "advance",
          basis: "round_accuracy",
          confidence: 0.8,
          reason_codes: ["round_accuracy_at_or_above_advancement_threshold"],
          target_objective_ids: [],
          policy_ref: "role-c-round-accuracy-v1",
        },
        grade_result: {
          artifact_id: "GRADE-1",
          payload: { feedback: { summary: "本轮达到进阶标准。" } },
        },
      },
    })

    expect(updated.assessmentGraded).toBe(true)
    expect(updated.decision.next).toBe("advance")
    expect(updated.feedback?.roundScore.accuracy).toBe(0.8)
    expect(updated.path.map((node) => node.status)).toEqual(["completed", "current"])
    expect(updated.view.assessmentStatus).toBe("completed")
  })

  test("keeps blocked C outcomes ungraded and visible instead of fabricating a local score", () => {
    const updated = applyRoleCSubmissionOutcome(session, "SUB-2", {
      status: "blocked",
      submission_id: "SUB-2",
      code: "SUBMISSION_BOUNDARY_BLOCKED",
      message: "提交未通过可信边界校验",
    })

    expect(updated.assessmentGraded).toBe(false)
    expect(updated.feedback).toBeUndefined()
    expect(updated.roleC?.submissionId).toBe("SUB-2")
    expect(updated.view.assessmentStatus).toBe("blocked")
    expect(updated.view.assessmentMessage).toContain("可信边界")
  })

  test("remembers the completed submission id even when C marks the response needs_review", () => {
    const updated = applyRoleCSubmissionOutcome(session, "SUB-3", {
      status: "needs_review",
      submission_id: "SUB-3",
      unresolved_item_ids: ["trace-1"],
    })

    expect(updated.assessmentGraded).toBe(false)
    expect(updated.roleC?.submissionId).toBe("SUB-3")
    expect(updated.view.assessmentStatus).toBe("needs_review")
    expect(updated.view.assessmentMessage).toContain("需要进一步审核")
  })

  test("rejects completed feedback that belongs to another run, session, form, attempt, or submission", () => {
    const foreign = applyRoleCSubmissionOutcome(session, "SUB-EXPECTED", {
      status: "completed",
      feedback: {
        feedback_id: "DFR-FOREIGN",
        submission_id: "SUB-FOREIGN",
        run_id: "RUN-FOREIGN",
        session_id: "SESSION-FOREIGN",
        learner_id_hash: "learner-foreign",
        profile_version: "RUN-FOREIGN-profile-v1",
        path_node_id: "RUN-FOREIGN-PATH-K018",
        form_id: "FORM-FOREIGN",
        attempt_no: 2,
        round_score: { raw_score: 10, max_score: 10, accuracy: 1, evidence_score: 1 },
        objective_results: [],
        mastery_snapshot: [],
        final_decision: {
          action: "advance",
          basis: "round_accuracy",
          confidence: 1,
          reason_codes: ["round_accuracy_at_or_above_advancement_threshold"],
          target_objective_ids: [],
          policy_ref: "role-c-round-accuracy-v1",
        },
        grade_result: { artifact_id: "GRADE-FOREIGN", payload: { feedback: { summary: "伪造进阶" } } },
      },
    })

    expect(foreign.assessmentGraded).toBe(false)
    expect(foreign.feedback).toBeUndefined()
    expect(foreign.decision.next).toBe("remediate")
    expect(foreign.view.assessmentStatus).toBe("blocked")
    expect(foreign.view.assessmentMessage).toContain("身份不匹配")
  })

  test("rejects completed feedback whose learner identity belongs to another learner", () => {
    const foreign = applyRoleCSubmissionOutcome(session, "SUB-EXPECTED", {
      status: "completed",
      feedback: {
        feedback_id: "DFR-FOREIGN-LEARNER",
        submission_id: "SUB-EXPECTED",
        run_id: "RUN-1",
        session_id: "C-SESSION-1",
        learner_id_hash: "learner-foreign",
        profile_version: "RUN-1-profile-v1",
        path_node_id: "RUN-1-PATH-K018",
        form_id: "FORM-1",
        attempt_no: 1,
        round_score: { raw_score: 10, max_score: 10, accuracy: 1, evidence_score: 1 },
        objective_results: [],
        mastery_snapshot: [],
        final_decision: {
          action: "advance",
          basis: "round_accuracy",
          confidence: 1,
          reason_codes: ["round_accuracy_at_or_above_advancement_threshold"],
          target_objective_ids: [],
          policy_ref: "role-c-round-accuracy-v1",
        },
        grade_result: { artifact_id: "GRADE-FOREIGN-LEARNER", payload: { feedback: { summary: "错误身份" } } },
      },
    })

    expect(foreign.assessmentGraded).toBe(false)
    expect(foreign.view.assessmentStatus).toBe("blocked")
    expect(foreign.view.assessmentMessage).toContain("身份不匹配")
  })
})
