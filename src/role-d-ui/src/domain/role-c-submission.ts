import type { RoleDSession, RoleCDecisionView, RoleCFeedbackView, RoleCAction } from "./types"

type AssessmentItem = NonNullable<RoleDSession["artifacts"][number]["items"]>[number]

export interface RoleCFeedbackPayload {
  feedback_id: string
  submission_id: string
  run_id: string
  session_id: string
  learner_id_hash: string
  profile_version: string
  path_node_id: string
  form_id: string
  attempt_no: number
  round_score: {
    raw_score: number
    max_score: number
    accuracy: number
    evidence_score: number
  }
  objective_results: Array<{
    objective_id: string
    raw_score: number
    max_score: number
    accuracy: number
    evidence_score: number
    misconception_tags: string[]
  }>
  mastery_snapshot: Array<{
    objective_id: string
    mastery: number
    evidence_batches: number
    observed_modalities: string[]
    revision: number
  }>
  final_decision: {
    action: RoleCAction
    basis: "round_accuracy" | "profile_drift"
    confidence: number
    reason_codes: string[]
    target_objective_ids: string[]
    policy_ref: string
  }
  grade_result: {
    artifact_id: string
    payload?: {
      item_results?: Array<{
        item_id: string
        objective_id: string
        raw_score: number
        max_score: number
        evidence_score: number
        grader_confidence?: number
        hint_factor?: number
        repeat_factor?: number
        misconception_tags: string[]
        feedback_code: string
      }>
      score_frozen?: boolean
      recommendation?: {
        action: string
        confidence: number
        reason_codes: string[]
      }
      feedback?: {
        generated_after_score_freeze?: boolean
        mode?: string
        summary?: string
        item_feedback?: Array<{
          item_id: string
          feedback_code: string
          message: string
          next_step?: string
        }>
      }
    } | null
  }
}

export type RoleCSubmissionOutcome =
  | { status: "completed"; feedback: RoleCFeedbackPayload }
  | { status: "needs_review"; submission_id: string; unresolved_item_ids: string[] }
  | { status: "blocked"; submission_id: string; code: string; message: string }

export function buildRoleCSubmissionAnswers(session: RoleDSession) {
  const assessment = session.artifacts.find((artifact) => artifact.kind === "assessment")
  const answers = session.view.assessmentAnswers ?? {}
  return (assessment?.items ?? []).map((item) => toSubmissionAnswer(item, answers[item.id] ?? ""))
}

export function applyRoleCSubmissionOutcome(
  session: RoleDSession,
  expectedSubmissionId: string,
  outcome: RoleCSubmissionOutcome,
): RoleDSession {
  if (outcome.status === "blocked") {
    return {
      ...session,
      assessmentGraded: false,
      roleC: session.roleC ? { ...session.roleC, submissionId: expectedSubmissionId } : session.roleC,
      view: {
        ...session.view,
        assessmentSubmitted: true,
        assessmentStatus: "blocked",
        assessmentMessage: outcome.code === "SESSION_ALREADY_COMPLETED"
          ? "本轮已完成正式评分；请到反馈页进入下一学习阶段，C 会为下一轮重新生成内容并再次评分。"
          : outcome.message,
      },
    }
  }
  if (outcome.status === "needs_review") {
    return {
      ...session,
      assessmentGraded: false,
      roleC: session.roleC ? { ...session.roleC, submissionId: expectedSubmissionId } : session.roleC,
      view: {
        ...session.view,
        assessmentSubmitted: true,
        assessmentStatus: "needs_review",
        assessmentMessage: `C 已接收提交，${outcome.unresolved_item_ids.length} 道题需要进一步审核。`,
      },
    }
  }

  if (!matchesSubmissionContext(session, expectedSubmissionId, outcome.feedback)) {
    return {
      ...session,
      assessmentGraded: false,
      feedback: undefined,
      decision: { next: "remediate", reason: "C 评分响应身份不匹配，已拒绝写入当前计划。" },
      view: {
        ...session.view,
        assessmentSubmitted: true,
        assessmentStatus: "blocked",
        assessmentMessage: "C 评分响应身份不匹配，未更新当前计划。",
      },
    }
  }
  const feedback = normalizeFeedback(outcome.feedback)
  return {
    ...session,
    assessmentGraded: true,
    feedback,
    decision: {
      next: feedback.finalDecision.action,
      reason: feedback.feedbackSummary || feedback.finalDecision.reasonCodes.join("；"),
    },
    path: updatePath(session.path, feedback.finalDecision.action),
    roleC: session.roleC ? { ...session.roleC, submissionId: expectedSubmissionId } : session.roleC,
    view: {
      ...session.view,
      assessmentSubmitted: true,
      assessmentStatus: "completed",
      assessmentMessage: feedback.feedbackSummary,
    },
  }
}

function matchesSubmissionContext(
  session: RoleDSession,
  expectedSubmissionId: string,
  feedback: RoleCFeedbackPayload,
): boolean {
  return Boolean(session.roleC)
    && feedback.submission_id === expectedSubmissionId
    && feedback.run_id === session.roleC?.runId
    && feedback.session_id === session.roleC?.learningSessionId
    && feedback.learner_id_hash === session.profile.learnerId
    && feedback.form_id === session.roleC?.formId
    && feedback.attempt_no === session.roleC?.attemptNo
}

function toSubmissionAnswer(item: AssessmentItem, answer: string) {
  const base = { item_id: item.id, hint_level_used: 0 as const }
  if (item.modality === "mcq" || item.modality === "true_false") {
    return { ...base, selected_option_id: answer }
  }
  if (item.modality === "code") return { ...base, code_response: answer }
  return { ...base, text_response: answer }
}

function normalizeFeedback(feedback: RoleCFeedbackPayload): RoleCFeedbackView {
  return {
    feedbackId: feedback.feedback_id,
    submissionId: feedback.submission_id,
    learnerId: feedback.learner_id_hash,
    profileVersion: feedback.profile_version,
    pathNodeId: feedback.path_node_id,
    roundScore: {
      rawScore: feedback.round_score.raw_score,
      maxScore: feedback.round_score.max_score,
      accuracy: feedback.round_score.accuracy,
      evidenceScore: feedback.round_score.evidence_score,
    },
    objectiveResults: feedback.objective_results.map((result) => ({
      objectiveId: result.objective_id,
      rawScore: result.raw_score,
      maxScore: result.max_score,
      accuracy: result.accuracy,
      evidenceScore: result.evidence_score,
      misconceptionTags: [...result.misconception_tags],
    })),
    itemResults: (feedback.grade_result.payload?.item_results ?? []).map((result) => ({
      itemId: result.item_id,
      objectiveId: result.objective_id,
      status: result.feedback_code,
      rawScore: result.raw_score,
      maxScore: result.max_score,
      evidenceScore: result.evidence_score,
      misconceptionTags: [...result.misconception_tags],
    })),
    masterySnapshot: feedback.mastery_snapshot.map((state) => ({
      objectiveId: state.objective_id,
      mastery: state.mastery,
      evidenceBatches: state.evidence_batches,
      observedModalities: [...state.observed_modalities],
      revision: state.revision,
    })),
    finalDecision: {
      action: feedback.final_decision.action,
      basis: feedback.final_decision.basis,
      confidence: feedback.final_decision.confidence,
      reasonCodes: [...feedback.final_decision.reason_codes],
      targetObjectiveIds: [...feedback.final_decision.target_objective_ids],
      policyRef: feedback.final_decision.policy_ref,
    },
    feedbackSummary: feedback.grade_result.payload?.feedback?.summary
      ?? "C 已完成正式评分和动态决策。",
  }
}

export function updatePath(path: RoleDSession["path"], action: RoleCAction): RoleDSession["path"] {
  if (action !== "advance") return path
  const currentIndex = path.findIndex((node) => node.status === "current")
  if (currentIndex < 0) return path
  const nextIndex = path.findIndex((node, index) => index > currentIndex && node.status === "upcoming")
  return path.map((node, index) => {
    if (index === currentIndex) return { ...node, status: "completed" as const, reason: "C 正式评分达到进阶阈值。" }
    if (index === nextIndex) return { ...node, status: "current" as const, reason: "由 C 的正式动态反馈推进到当前节点。" }
    return node
  })
}
