import type { NextRoundGenerationContext } from "../role-c-content/agents/types"
import type { RagResult } from "../rag/retriever"
import type { LearnerProfile } from "../role-b-profile/types"
import type {
  AssessmentAnchorRoutingOutcome,
  ContinueCompletedLearningCycleResult,
  ExecutionContract,
  LearnerProfileSnapshot,
  LearningPathNode,
  ProfileDriftSuggestion,
  PublicRagEvidencePack,
  RoleCLearningSessionDelivery,
  RoleCReviewedReleaseDelivery,
  RoleCReviewRecoveryStatusDelivery,
  SubmissionEnvelope,
} from "../role-c-content"

export const ROLE_C_API_PATHS = {
  generate: "/api/role-c/generate",
  runCodeLab: "/api/role-c/run-code-lab",
  submit: "/api/role-c/submit",
  continue: "/api/role-c/continue",
  routeAnchors: "/api/role-c/route-anchors",
} as const

export type RoleCApiPath = typeof ROLE_C_API_PATHS[keyof typeof ROLE_C_API_PATHS]

export interface RoleDPublicCitation {
  source_id: string
  fact_id: string
}

export interface RoleDAssessmentItem {
  id: string
  tier: 1 | 2 | 3
  modality: "mcq" | "true_false" | "trace" | "short_answer" | "code"
  prompt: string
  options: string[]
  option_ids: string[]
  maxScore?: number
  starter_code?: string
  citations: RoleDPublicCitation[]
}

export interface RoleDGeneratedArtifact {
  id: string
  kind: "lesson" | "lab" | "assessment"
  title: string
  status: "real"
  content: string
  options: string[]
  citations: RoleDPublicCitation[]
  items: RoleDAssessmentItem[]
  sections?: RoleDLearningSection[]
  /** Structured code-lab payload. Present only when kind is "lab". */
  lab?: RoleDCodeLab
}

export interface RoleDLearningSection {
  id: string
  title: string
  kind: "heading" | "paragraph" | "code" | "callout" | "comparison"
  text?: string
  code?: string
  language?: string
  citations: RoleDPublicCitation[]
}

export interface RoleDCodeLabPublicTest {
  id: string
  objective_id: string
  description: string
  input: unknown
  expected_behavior: string
  citations: RoleDPublicCitation[]
}

export interface RoleDCodeLabHintLadder {
  objective_id: string
  hints: Array<{
    level: 1 | 2 | 3
    text: string
    citations: RoleDPublicCitation[]
  }>
}

/** Complete public lab data; secure answers and hidden tests never enter this DTO. */
export interface RoleDCodeLab {
  lab_id: string
  instructions: RoleDLearningSection[]
  execution_contract: ExecutionContract
  starter_code: string
  public_tests: RoleDCodeLabPublicTest[]
  hint_ladders: RoleDCodeLabHintLadder[]
  reflection_questions: string[]
}

export interface RoleDWorkflowEvent {
  id: string
  agent: string
  stage: string
  status: "pending" | "running" | "completed" | "review" | "blocked"
  summary: string
  timestamp: string
}

export type RoleDAuditStatus = "pass" | "revise" | "reject"

export interface RoleDFactAuditSummary {
  artifactId: string
  artifactTitle: string
  artifactKind: "lesson" | "lab" | "assessment"
  status: RoleDAuditStatus
  checkedClaims: number
  conflicts: number
  notes: string[]
}

export interface RoleDTeachingAuditSummary {
  artifactId: string
  status: RoleDAuditStatus
  summary: string
  revisionHints: string[]
}

export interface RoleDArbitrationSummary {
  artifactId: string
  decision: RoleDAuditStatus
  revisionRound: number
  maxRevisionRounds: number
  canRevise: boolean
  reason: string
}

export interface RoleDContentAuditSummary {
  factStatus: RoleDAuditStatus
  factAudits: RoleDFactAuditSummary[]
  teachingAudit: RoleDTeachingAuditSummary
  arbitration: RoleDArbitrationSummary
}

export interface RoleDReviewRecoverySummary {
  code: "READY" | "BLOCKED" | "UNSUPPORTED_TARGET"
  failedDimensions: string[]
  missingPrerequisiteSourceIds: string[]
  unknownPrerequisiteRefs: string[]
  requiredAction: "adjust_content" | "request_new_evidence" | "replan_path" | "reprofile_learner" | "none"
  fixScope: "artifact" | "new_evidence" | "new_spec" | "none"
  recommendedLevel?: LearnerProfile["level"]
  canRecover: boolean
  attempts: number
  message: string
}

export interface RoleDFinalContentContext {
  /** Final answer-free profile selected by the recoverable C pipeline. */
  profileSnapshot: LearnerProfileSnapshot
  profileVersion: string
  pathNode: LearningPathNode
  evidencePack: PublicRagEvidencePack
}

export type RoleCForRoleDResult =
  | {
      status: "ready"
      artifacts: RoleDGeneratedArtifact[]
      workflow: RoleDWorkflowEvent[]
      runId: string
      learningSession: {
        sessionId: string
        formId: string
        attemptNo: number
        /** 锚点路由请求与锚点题（锚点模式生成时存在，D 据此进入锚点阶段）。 */
        routing_request_id?: string
        anchor_item_ids?: string[]
      }
      /** Exact reviewed public Role C artifacts; secure artifacts are excluded. */
      reviewedRelease?: RoleCReviewedReleaseDelivery
      audit?: RoleDContentAuditSummary
      recovery?: RoleDReviewRecoverySummary
      finalContext: RoleDFinalContentContext
    }
  | {
      status: "blocked" | "failed"
      artifacts: RoleDGeneratedArtifact[]
      workflow: RoleDWorkflowEvent[]
      runId: string
      reason: string
      audit?: RoleDContentAuditSummary
      recovery?: RoleDReviewRecoverySummary
    }

export interface GenerateRoleCForRoleDInput {
  profile: LearnerProfile
  ragResult: RagResult
  kbVersion: string
  runId: string
  /** Formal B path consumed verbatim by C. */
  pathNode: LearningPathNode
  /**
   * 跨轮稳定的画像版本标识。缺省时回退为 `${runId}-profile-v1`（runId 每轮变化
   * → 每轮独立评估）。传入稳定值（如会话级 run_id）后，同一画像生命周期内的
   * 多轮 evidence 会在 mastery 状态上跨轮累积，reprofile 才可能触发。
   */
  profile_version?: string
  /** 本轮相对上一轮的决策与反馈上下文（主 Agent 传入，C 用于定向生成与 adaptation 回传）。 */
  next_round_context?: NextRoundGenerationContext
}

export interface SubmitRoleCAssessmentInput {
  sessionId: string
  runId: string
  learnerId: string
  formId: string
  attemptNo: number
  submissionId: string
  answers: SubmissionEnvelope["answers"]
}

export interface RunRoleCAssessmentCodeInput {
  executionId: string
  sessionId: string
  runId: string
  learnerId: string
  itemId: string
  code: string
}

export type RunRoleCAssessmentCodeResult =
  | {
      status: "passed" | "failed" | "timeout"
      executionId: string
      runId: string
      itemId: string
      passedChecks: number
      totalChecks: number
      scoreRatio: number
      feedback: RoleCCodeLabFeedback[]
    }
  | {
      status: "blocked"
      executionId: string
      itemId: string
      code: "INVALID_REQUEST" | "SESSION_NOT_FOUND" | "LEARNER_IDENTITY_MISMATCH" | "RUN_NOT_FOUND" | "ITEM_NOT_FOUND" | "SECURE_ASSESSMENT_UNAVAILABLE" | "RUNNER_UNAVAILABLE"
      message: string
    }

export interface RunRoleCCodeLabInput {
  executionId: string
  sessionId: string
  runId: string
  learnerId: string
  labId: string
  code: string
}

export type RoleCCodeLabFeedbackCode =
  | "assertion_failed"
  | "syntax_error"
  | "runtime_error"
  | "output_limit"
  | "non_json_output"
  | "forbidden_import"
  | "forbidden_syntax"
  | "resource_limit_exceeded"
  | "execution_timeout"
  | "execution_failed"

export interface RoleCCodeLabFeedback {
  code: RoleCCodeLabFeedbackCode
  message: string
}

export type RunRoleCCodeLabResult =
  | {
      status: "passed" | "failed" | "timeout"
      executionId: string
      runId: string
      labId: string
      passedChecks: number
      totalChecks: number
      scoreRatio: number
      feedback: RoleCCodeLabFeedback[]
    }
  | {
      status: "blocked"
      executionId: string
      code:
        | "INVALID_REQUEST"
        | "SESSION_NOT_FOUND"
        | "LEARNER_IDENTITY_MISMATCH"
        | "RUN_NOT_FOUND"
        | "LAB_NOT_FOUND"
        | "SECURE_LAB_UNAVAILABLE"
        | "RUNNER_UNAVAILABLE"
      message: string
    }

/**
 * D sends only stable identities plus optional B-owned next context. C reloads
 * the completed submission and current profile/evidence from its private store.
 * Evidence for a new B path is refreshed through A on the server.
 */
export interface ContinueRoleCAfterSubmissionInput {
  sessionId: string
  submissionId: string
  learnerId: string
  nextPathNode?: LearningPathNode
  nextProfileSnapshot?: LearnerProfileSnapshot
  nextGenerationAction?: "remediate" | "reinforce" | "advance"
}

export type ContinueRoleCForRoleDResult =
  | {
      status: "published"
      continuation: Extract<
        ContinueCompletedLearningCycleResult,
        { status: "published" }
      >
      reviewedRelease: RoleCReviewedReleaseDelivery
      learningSession: RoleCLearningSessionDelivery
      artifacts: RoleDGeneratedArtifact[]
      finalContext: RoleDFinalContentContext
    }
  | {
      status: "awaiting_input"
      action: "advance" | "reprofile"
      requestId: string
      requiredInputs: Array<
        "nextPathNode" | "nextProfileSnapshot" | "nextGenerationAction"
      >
      profileDriftSuggestion?: ProfileDriftSuggestion
    }
  | {
      status: "blocked" | "failed"
      stage: "configuration" | "preparation" | "generation_review"
      reason: string
      continuation?: Extract<
        ContinueCompletedLearningCycleResult,
        { status: "blocked" | "failed" }
      >
      recoveryStatus?: RoleCReviewRecoveryStatusDelivery
    }

export interface RouteRoleCAssessmentAnchorsInput {
  routingRequestId: string
  sessionId: string
  runId: string
  learnerId: string
  formId: string
  attemptNo: number
  submissionId: string
  answers: SubmissionEnvelope["answers"]
}

export type RouteRoleCAssessmentAnchorsResult = AssessmentAnchorRoutingOutcome
