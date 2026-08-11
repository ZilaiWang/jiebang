import { randomUUID } from "node:crypto"
import type {
  AssessmentPublicArtifact,
  AssessmentSecureArtifact,
  CodeLabPublicArtifact,
  CodeLabSecureArtifact,
  SessionState,
  SubmissionEnvelope,
} from "../contracts/artifacts"
import { contentHash, stableId } from "../contracts/common"
import {
  aggregateObjectiveResults,
  buildDynamicFeedbackResult,
  decideRoundAction,
  type DynamicFeedbackResult,
} from "../contracts/dynamic-feedback"
import type {
  LearningEvidenceEvent,
  ProfileDriftSuggestion,
} from "../contracts/learning-evidence-event"
import {
  deliverRoleCToB,
  type RoleBLearningProgressPort,
  type RoleCDeliveryAck,
  type RoleCLearningSessionHandoff,
} from "../contracts/external-api"
import {
  EvidencePhraseRubricJudge,
  gradeSubmission,
  type BlindRubricJudge,
  type SubmissionGrade,
} from "../grading/grade-submission"
import { routeAssessmentFromAnchors } from "../grading/assessment-routing"
import {
  finalizeGradeResult,
  finalizeGradeResultWithFeedback,
} from "../grading/finalize-grade-result"
import type { GradeFeedbackGenerator } from "../grading/model-feedback-generator"
import {
  detectProfileDrift,
  prepareMasteryUpdateFromEvidence,
  type MasteryStateWrite,
  type MasteryStateStore,
  type ObjectiveMasteryState,
} from "../mastery/beta-mastery"
import { emitLearningEvidence } from "../mastery/emit-learning-evidence"
import {
  LearningCycleStoreError,
  learningSubmissionInputHash,
  type AssessmentRoutingState,
  type LearningCycleStore,
  type LearningRunRecord,
  type LearningSessionRecord,
  type LearningSubmissionRecord,
} from "../reliability/learning-cycle-store"
import {
  executeWithRunnerRetry,
  type CodeRunner,
} from "../security/code-runner"
import {
  SecureArtifactStoreError,
  type SecureArtifactStore,
} from "../security/secure-artifact-store"
import type { ReviewedCPipelineResult } from "../review/types"
import { assertReviewedReadyPipeline } from "../review/validate-reviewed-release"
import { validateRoleCSchema } from "../validators/runtime-schema-validator"
import {
  validateAssessmentPublicSecureSeparation,
  validateCodeLabPublicSecureSeparation,
} from "../validators/public-secure-leak-validator"
import type { CPipelineInput } from "./content-pipeline"
import type { LearnerProfileSnapshot } from "../contracts/profile-adapter"
import {
  prepareNextRound,
  type NextRoundPreparation,
  type PrepareNextRoundInput,
} from "./next-round"

export interface RegisterReadyRunInput {
  pipeline_input: CPipelineInput
  pipeline_result: ReviewedCPipelineResult
  profile_snapshot: LearnerProfileSnapshot
  /** Trusted learner subject supplied by the authenticated backend orchestration layer. */
  learner_id_hash: string
}

export interface OpenTrustedPreselectedSessionInput {
  /** All fields in this request are assembled by the authenticated backend. */
  routing_policy: "trusted_preselected_v1"
  session_id: string
  run_id: string
  authenticated_learner_id_hash: string
  attempt_no: number
  required_item_ids: string[]
  /** Read from backend-owned hint state; never accepted from the browser as authority. */
  revealed_hint_levels: Record<string, 0 | 1 | 2 | 3>
  /** Derived from the registered profile snapshot. */
  profile_expectations_by_objective?: Record<string, "known" | "weak">
  /** Derived from backend submission history. */
  repeat_exposure_by_item?: Record<string, number>
}

export type OpenLearningSessionInput = Omit<
  OpenTrustedPreselectedSessionInput,
  "routing_policy"
>

export interface OpenAnchorFirstSessionInput {
  routing_request_id: string
  session_id: string
  run_id: string
  authenticated_learner_id_hash: string
  attempt_no: number
  profile_expectations_by_objective?: Record<string, "known" | "weak">
  repeat_exposure_by_item?: Record<string, number>
}

/**
 * Trusted pre-session routing input. D sends only the learner's anchor answers;
 * C reads the answer key from secure storage, freezes the score-derived route,
 * and then opens the formal session.
 */
export interface RouteAssessmentAnchorsInput {
  routing_request_id: string
  session_id: string
  run_id: string
  authenticated_learner_id_hash: string
  attempt_no: number
  anchor_submission: SubmissionEnvelope
  /** Backend-owned hint state for the anchor items. */
  revealed_anchor_hint_levels: Record<string, 0 | 1 | 2 | 3>
  profile_expectations_by_objective?: Record<string, "known" | "weak">
  repeat_exposure_by_item?: Record<string, number>
}

export type AssessmentAnchorRoutingOutcome =
  | {
      status: "routed"
      routing_request_id: string
      anchor_score_ratio: number
      route_id: string
      action: "remediate" | "reinforce" | "advance"
      required_item_ids: string[]
      /** Safe D-facing projection; backend SessionState and secure refs stay private. */
      learning_session: Extract<
        RoleCLearningSessionHandoff,
        { phase: "route_locked" }
      >
    }
  | {
      status: "needs_review"
      routing_request_id: string
      unresolved_anchor_item_ids: string[]
    }
  | {
      status: "blocked"
      routing_request_id: string
      issues: string[]
    }

export interface ProcessSubmissionInput {
  session_id: string
  /** Derived from the authenticated request context, independently of SubmissionEnvelope. */
  authenticated_learner_id_hash: string
  submission: SubmissionEnvelope
  expected_session_revision?: number
}

export interface ExecutePublishedCodeLabInput {
  execution_id: string
  session_id: string
  run_id: string
  authenticated_learner_id_hash: string
  lab_id: string
  code: string
}

export interface ExecuteAssessmentCodeInput {
  execution_id: string
  session_id: string
  run_id: string
  authenticated_learner_id_hash: string
  item_id: string
  code: string
}

export type ExecuteAssessmentCodeBlockedCode = "INVALID_REQUEST" | "SESSION_NOT_FOUND" | "LEARNER_IDENTITY_MISMATCH" | "RUN_NOT_FOUND" | "ITEM_NOT_FOUND" | "SECURE_ASSESSMENT_UNAVAILABLE" | "RUNNER_UNAVAILABLE"

export type ExecuteAssessmentCodeOutcome =
  | {
      status: "passed" | "failed" | "timeout"
      execution_id: string
      run_id: string
      item_id: string
      passed_checks: number
      total_checks: number
      score_ratio: number
      feedback_codes: PublishedCodeLabFeedbackCode[]
    }
  | {
      status: "blocked"
      execution_id: string
      item_id: string
      code: ExecuteAssessmentCodeBlockedCode
      message: string
    }

export type PublishedCodeLabFeedbackCode =
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

export type ExecutePublishedCodeLabOutcome =
  | {
      status: "passed" | "failed" | "timeout"
      execution_id: string
      run_id: string
      lab_id: string
      passed_checks: number
      total_checks: number
      score_ratio: number
      feedback_codes: PublishedCodeLabFeedbackCode[]
    }
  | {
      status: "blocked"
      execution_id: string
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
 * Trusted next-round boundary. Feedback, parent spec, and current evidence are
 * resolved from C-owned durable records rather than accepted from a public caller.
 */
export type PrepareNextRoundFromCompletedSubmissionInput = Omit<
  PrepareNextRoundInput,
  "feedback" | "parent_spec" | "current_evidence_pack" | "profile_snapshot"
> & {
  session_id: string
  submission_id: string
  /** Compatibility assertion only; the authoritative snapshot is loaded from the run. */
  profile_snapshot?: LearnerProfileSnapshot
}

export interface LearningCycleCompletion {
  feedback: DynamicFeedbackResult
  outbound_to_b: {
    evidence_events: LearningEvidenceEvent[]
    profile_drift_suggestion?: ProfileDriftSuggestion
  }
  /** Explicit outcome; a missing B adapter can no longer be mistaken for delivery. */
  delivery_to_b: LearningProgressDeliveryOutcome
  /** Backend-only state; public callers use feedback.mastery_snapshot. */
  mastery_states: ObjectiveMasteryState[]
}

export type LearningProgressDeliveryPolicy =
  | {
      mode: "required"
      port: RoleBLearningProgressPort
    }
  | {
      mode: "offline"
      reason: "test" | "local_development"
    }

export type LearningProgressDeliveryOutcome =
  | {
      mode: "required"
      ack: RoleCDeliveryAck
    }
  | {
      mode: "offline"
      reason: "test" | "local_development"
    }
  | {
      mode: "deferred"
      reason: "port_not_configured"
    }

export type LearningCycleOutcome =
  | { status: "completed"; completion: LearningCycleCompletion }
  | {
      status: "needs_review"
      submission_id: string
      unresolved_item_ids: string[]
      grade: SubmissionGrade
    }
  | {
      status: "blocked"
      submission_id: string
      code: LearningCycleBlockCode
      issues: string[]
      grade?: SubmissionGrade
    }

/** D-facing result. Backend mastery state, B evidence, and internal grades are excluded. */
export type LearningCyclePublicOutcome =
  | { status: "completed"; feedback: DynamicFeedbackResult }
  | {
      status: "needs_review"
      submission_id: string
      unresolved_item_ids: string[]
    }
  | {
      status: "blocked"
      submission_id: string
      code: LearningCycleBlockCode
      message: string
    }

export type LearningCycleBlockCode =
  | "RUN_NOT_FOUND"
  | "RUN_NOT_READY"
  | "SESSION_NOT_FOUND"
  | "SESSION_REVISION_CONFLICT"
  | "SESSION_BUSY"
  | "SESSION_ALREADY_COMPLETED"
  | "ANCHOR_ROUTING_REQUIRED"
  | "ANCHOR_ANSWERS_CHANGED"
  | "SUBMISSION_BUSY"
  | "LEARNER_IDENTITY_MISMATCH"
  | "SUBMISSION_ID_CONFLICT"
  | "SUBMISSION_BOUNDARY_BLOCKED"
  | "SECURE_ARTIFACT_NOT_FOUND"
  | "SECURE_ARTIFACT_TYPE_MISMATCH"
  | "PERSISTENCE_CONFLICT"

export class LearningCycleServiceError extends Error {
  constructor(
    readonly code:
      | "INVALID_READY_RUN"
      | "INVALID_SESSION"
      | "RUN_ID_CONFLICT"
      | "SESSION_ID_CONFLICT"
      | "MASTERY_REVISION_CONFLICT"
      | "PERSISTENCE_ERROR",
    message: string,
  ) {
    super(message)
    this.name = "LearningCycleServiceError"
  }
}

export interface LearningCycleServiceDependencies {
  cycle_store: LearningCycleStore
  secure_store: SecureArtifactStore
  mastery_store: MasteryStateStore
  /**
   * Production B adapter. When configured, every completed formal submission
   * is delivered before the backend completion is returned. Replays reuse the
   * deterministic delivery_id and are safe with B's duplicate acknowledgement.
   */
  learning_progress_delivery?: LearningProgressDeliveryPolicy
  code_runner?: CodeRunner
  rubric_judge?: BlindRubricJudge
  feedback_generator?: GradeFeedbackGenerator
  grader_version?: string
  mastery_retry_limit?: number
  profile_drift_minimum_conflicts?: number
  submission_lease_ms?: number
}

interface ActiveSubmission {
  input_hash: string
  authenticated_learner_id_hash: string
  promise: Promise<LearningCycleOutcome>
}

/**
 * Formal backend boundary for one generated run. Browser/D inputs contain only the
 * session ID and public SubmissionEnvelope; trusted session and secure answers are
 * resolved from C-owned stores.
 */
export class LearningCycleService {
  private readonly rubricJudge: BlindRubricJudge
  private readonly graderVersion: string
  private readonly workerId = `role-c-worker-${randomUUID()}`
  private readonly inFlight = new Map<string, ActiveSubmission>()

  constructor(private readonly dependencies: LearningCycleServiceDependencies) {
    if (dependencies.submission_lease_ms !== undefined
      && (!Number.isSafeInteger(dependencies.submission_lease_ms)
        || dependencies.submission_lease_ms < 1_000)) {
      throw new LearningCycleServiceError(
        "PERSISTENCE_ERROR",
        "submission_lease_ms 必须为至少 1000 的整数",
      )
    }
    this.rubricJudge = dependencies.rubric_judge ?? new EvidencePhraseRubricJudge()
    this.graderVersion = dependencies.grader_version
      ?? `role-c-hybrid-grader-1.0.0+${this.rubricJudge.grader_version}`
  }

  async registerReadyRun(input: RegisterReadyRunInput): Promise<LearningRunRecord> {
    if (!input.learner_id_hash.trim()) {
      throw new LearningCycleServiceError("INVALID_READY_RUN", "learner_id_hash 不能为空")
    }
    assertReadyPipeline(input)
    const secureArtifacts = await Promise.all(input.pipeline_result.secure_refs.map(async (ref) => ({
      ref,
      artifact: await this.dependencies.secure_store.get(ref, {
        principal: "role-c-grader",
        run_id: input.pipeline_input.generation_spec.run_id,
      }),
    })))
    const codeLabs = secureArtifacts.filter(({ artifact }) => artifact.artifact_type === "code_lab_secure")
    const assessments = secureArtifacts.filter(({ artifact }) => artifact.artifact_type === "assessment_secure")
    if (codeLabs.length !== 1 || assessments.length !== 1) {
      throw new LearningCycleServiceError(
        "INVALID_READY_RUN",
        "READY run 必须恰好包含一份 code_lab_secure 和 assessment_secure",
      )
    }
    assertRegisteredSecurePair(
      input.pipeline_result.public_artifacts.code_lab!,
      codeLabs[0]!.artifact as CodeLabSecureArtifact,
      input.pipeline_result.public_artifacts.assessment!,
      assessments[0]!.artifact as AssessmentSecureArtifact,
    )
    const record: LearningRunRecord = {
      schema_version: "1.0",
      run_id: input.pipeline_input.generation_spec.run_id,
      learner_id_hash: input.learner_id_hash,
      profile_snapshot: structuredClone(input.profile_snapshot),
      pipeline_input: structuredClone(input.pipeline_input),
      pipeline_result: structuredClone(input.pipeline_result),
      secure_artifact_refs: {
        code_lab: codeLabs[0]!.ref,
        assessment: assessments[0]!.ref,
      },
      revision: 0,
    }
    const existing = await this.dependencies.cycle_store.loadRun(record.run_id)
    if (existing) {
      if (recordIdentity(existing) !== recordIdentity(record)) {
        throw new LearningCycleServiceError("RUN_ID_CONFLICT", "同一 run_id 已绑定不同生成结果")
      }
      return existing
    }
    try {
      await this.dependencies.cycle_store.createRun(record)
      return structuredClone(record)
    } catch (error) {
      if (error instanceof LearningCycleStoreError && error.code === "ALREADY_EXISTS") {
        const raced = await this.dependencies.cycle_store.loadRun(record.run_id)
        if (raced && recordIdentity(raced) === recordIdentity(record)) return raced
        throw new LearningCycleServiceError("RUN_ID_CONFLICT", "并发注册使用了冲突的 run_id")
      }
      throw persistenceError(error)
    }
  }

  /**
   * Opens a session whose route was selected by a trusted backend policy.
   *
   * Learner-facing flows use openAnchorFirstSession and routeAssessmentAnchors.
   * This explicit entry is retained for backend imports and deterministic demos.
   */
  async openTrustedPreselectedSession(
    input: OpenTrustedPreselectedSessionInput,
  ): Promise<LearningSessionRecord> {
    const run = await this.dependencies.cycle_store.loadRun(input.run_id)
    if (!run) throw new LearningCycleServiceError("INVALID_SESSION", "run 不存在")
    if (run.learner_id_hash !== input.authenticated_learner_id_hash) {
      throw new LearningCycleServiceError("INVALID_SESSION", "学习者身份与 run 不一致")
    }
    const assessment = readyAssessment(run)
    validateSessionInput(input, run, assessment)
    const sessionState: SessionState = {
      schema_version: "1.0",
      session_id: input.session_id,
      run_id: input.run_id,
      learner_id_hash: input.authenticated_learner_id_hash,
      current_path_node_id: run.pipeline_input.generation_spec.path_node.node_id,
      current_form_id: assessment.payload!.form_id,
      attempt_no: input.attempt_no,
      required_item_ids: [...input.required_item_ids],
      revealed_hint_levels: structuredClone(input.revealed_hint_levels),
      public_artifact_refs: Object.values(run.pipeline_result.public_artifacts)
        .filter((artifact): artifact is NonNullable<typeof artifact> => Boolean(artifact))
        .map((artifact) => artifact.artifact_id),
      secure_artifact_refs: [
        run.secure_artifact_refs.code_lab,
        run.secure_artifact_refs.assessment,
      ],
    }
    const sessionReport = validateRoleCSchema("session_state.schema.json", sessionState)
    if (!sessionReport.ok) {
      throw new LearningCycleServiceError(
        "INVALID_SESSION",
        sessionReport.issues.map((issue) => `${issue.path}:${issue.message}`).join("；"),
      )
    }
    const record: LearningSessionRecord = {
      schema_version: "1.0",
      session_id: input.session_id,
      run_id: input.run_id,
      session_state: sessionState,
      profile_expectations_by_objective: structuredClone(
        input.profile_expectations_by_objective ?? {},
      ),
      repeat_exposure_by_item: structuredClone(input.repeat_exposure_by_item ?? {}),
      revision: 0,
    }
    const existing = await this.dependencies.cycle_store.loadSession(input.session_id)
    if (existing) {
      if (recordIdentity(existing) !== recordIdentity(record)) {
        throw new LearningCycleServiceError("SESSION_ID_CONFLICT", "同一 session_id 已绑定不同会话")
      }
      return existing
    }
    try {
      await this.dependencies.cycle_store.createSession(record)
      return structuredClone(record)
    } catch (error) {
      if (error instanceof LearningCycleStoreError && error.code === "ALREADY_EXISTS") {
        const raced = await this.dependencies.cycle_store.loadSession(input.session_id)
        if (raced && recordIdentity(raced) === recordIdentity(record)) return raced
        throw new LearningCycleServiceError("SESSION_ID_CONFLICT", "并发创建了冲突会话")
      }
      throw persistenceError(error)
    }
  }

  async openSession(
    input: OpenLearningSessionInput,
  ): Promise<LearningSessionRecord> {
    return this.openTrustedPreselectedSession({
      ...structuredClone(input),
      routing_policy: "trusted_preselected_v1",
    })
  }

  /**
   * Opens a durable anchor-only phase. No route is selected until C has graded
   * the anchor submission against the registered secure assessment.
   */
  async openAnchorFirstSession(
    input: OpenAnchorFirstSessionInput,
  ): Promise<LearningSessionRecord> {
    if (!input.routing_request_id.trim() || !input.session_id.trim()
      || !input.authenticated_learner_id_hash.trim()
      || !Number.isSafeInteger(input.attempt_no) || input.attempt_no < 1) {
      throw new LearningCycleServiceError(
        "INVALID_SESSION",
        "锚点会话身份或 attempt_no 无效",
      )
    }
    const run = await this.dependencies.cycle_store.loadRun(input.run_id)
    if (!run) {
      throw new LearningCycleServiceError("INVALID_SESSION", "run 不存在")
    }
    if (run.learner_id_hash !== input.authenticated_learner_id_hash) {
      throw new LearningCycleServiceError(
        "INVALID_SESSION",
        "学习者身份与 run 不一致",
      )
    }
    const assessment = readyAssessment(run)
    const payload = assessment.payload!
    const anchorItemIds = [...payload.routing.anchor_item_ids]
    if (anchorItemIds.length === 0) {
      throw new LearningCycleServiceError(
        "INVALID_SESSION",
        "assessment 未提供锚点题",
      )
    }
    const objectives = new Set(
      run.pipeline_input.generation_spec.targets.map((target) =>
        target.objective_id),
    )
    if (Object.keys(input.profile_expectations_by_objective ?? {})
      .some((objectiveId) => !objectives.has(objectiveId))) {
      throw new LearningCycleServiceError(
        "INVALID_SESSION",
        "画像预期包含当前 Spec 之外的 objective",
      )
    }
    const itemIds = new Set(payload.items.map((item) => item.item_id))
    if (Object.keys(input.repeat_exposure_by_item ?? {})
      .some((itemId) => !itemIds.has(itemId))) {
      throw new LearningCycleServiceError(
        "INVALID_SESSION",
        "repeat exposure 包含未知题目",
      )
    }
    const sessionState: SessionState = {
      schema_version: "1.0",
      session_id: input.session_id,
      run_id: input.run_id,
      learner_id_hash: input.authenticated_learner_id_hash,
      current_path_node_id:
        run.pipeline_input.generation_spec.path_node.node_id,
      current_form_id: payload.form_id,
      attempt_no: input.attempt_no,
      required_item_ids: anchorItemIds,
      revealed_hint_levels: Object.fromEntries(
        anchorItemIds.map((itemId) => [itemId, 0 as const]),
      ),
      public_artifact_refs: Object.values(run.pipeline_result.public_artifacts)
        .filter((artifact): artifact is NonNullable<typeof artifact> =>
          Boolean(artifact))
        .map((artifact) => artifact.artifact_id),
      secure_artifact_refs: [
        run.secure_artifact_refs.code_lab,
        run.secure_artifact_refs.assessment,
      ],
    }
    const sessionReport = validateRoleCSchema(
      "session_state.schema.json",
      sessionState,
    )
    if (!sessionReport.ok) {
      throw new LearningCycleServiceError(
        "INVALID_SESSION",
        sessionReport.issues.map((issue) =>
          `${issue.path}:${issue.message}`).join("；"),
      )
    }
    const record: LearningSessionRecord = {
      schema_version: "1.0",
      session_id: input.session_id,
      run_id: input.run_id,
      session_state: sessionState,
      profile_expectations_by_objective: structuredClone(
        input.profile_expectations_by_objective ?? {},
      ),
      repeat_exposure_by_item: structuredClone(
        input.repeat_exposure_by_item ?? {},
      ),
      assessment_routing_state: {
        mode: "anchor_first",
        phase: "ANCHOR_PENDING",
        routing_request_id: input.routing_request_id,
        assessment_policy_hash: assessmentRoutingPolicyHash(assessment),
        anchor_item_ids: anchorItemIds,
      },
      revision: 0,
    }
    const existing = await this.dependencies.cycle_store.loadSession(
      input.session_id,
    )
    if (existing) {
      if (!sameAnchorFirstSessionIdentity(existing, record)) {
        throw new LearningCycleServiceError(
          "SESSION_ID_CONFLICT",
          "同一 session_id 已绑定不同锚点会话",
        )
      }
      return existing
    }
    try {
      await this.dependencies.cycle_store.createSession(record)
      return structuredClone(record)
    } catch (error) {
      if (error instanceof LearningCycleStoreError
        && error.code === "ALREADY_EXISTS") {
        const raced = await this.dependencies.cycle_store.loadSession(
          input.session_id,
        )
        if (raced && sameAnchorFirstSessionIdentity(raced, record)) {
          return raced
        }
        throw new LearningCycleServiceError(
          "SESSION_ID_CONFLICT",
          "并发创建了冲突锚点会话",
        )
      }
      throw persistenceError(error)
    }
  }

  /**
   * Grades only the declared anchor items against backend-owned answers. The
   * resulting route, not a prior learning action, determines the formal
   * session's required item set.
   */
  async routeAssessmentAnchors(
    input: RouteAssessmentAnchorsInput,
  ): Promise<AssessmentAnchorRoutingOutcome> {
    if (!input.routing_request_id.trim() || !input.session_id.trim()
      || !input.run_id.trim() || !input.authenticated_learner_id_hash.trim()
      || !Number.isSafeInteger(input.attempt_no) || input.attempt_no < 1) {
      throw new LearningCycleServiceError(
        "INVALID_SESSION",
        "锚点路由身份或 attempt_no 无效",
      )
    }
    const session = await this.dependencies.cycle_store.loadSession(
      input.session_id,
    )
    if (!session || session.run_id !== input.run_id) {
      return {
        status: "blocked",
        routing_request_id: input.routing_request_id,
        issues: ["锚点路由会话不存在或 run 不一致"],
      }
    }
    const state = session.assessment_routing_state
    if (!state || state.mode !== "anchor_first"
      || state.routing_request_id !== input.routing_request_id) {
      return {
        status: "blocked",
        routing_request_id: input.routing_request_id,
        issues: ["会话不是当前锚点路由请求创建的"],
      }
    }
    if (session.session_state.learner_id_hash
      !== input.authenticated_learner_id_hash) {
      return {
        status: "blocked",
        routing_request_id: input.routing_request_id,
        issues: ["认证学习者与锚点路由会话不一致"],
      }
    }
    if (session.session_state.attempt_no !== input.attempt_no) {
      return {
        status: "blocked",
        routing_request_id: input.routing_request_id,
        issues: ["锚点路由 attempt_no 与会话不一致"],
      }
    }
    const inputHash = anchorRoutingInputHash(input.anchor_submission)
    const answersHash = anchorAnswersHash(
      input.anchor_submission,
      state.anchor_item_ids,
    )
    if (state.phase === "ROUTE_LOCKED") {
      return state.anchor_input_hash === inputHash
        && state.anchor_answers_hash === answersHash
        ? routedOutcome(session, state)
        : {
            status: "blocked",
            routing_request_id: input.routing_request_id,
            issues: ["锚点路由已由另一份答案冻结"],
          }
    }
    const run = await this.dependencies.cycle_store.loadRun(input.run_id)
    if (!run) {
      return {
        status: "blocked",
        routing_request_id: input.routing_request_id,
        issues: ["锚点路由对应的 run 不存在"],
      }
    }
    if (run.learner_id_hash !== input.authenticated_learner_id_hash) {
      return {
        status: "blocked",
        routing_request_id: input.routing_request_id,
        issues: ["认证学习者与锚点路由 run 不一致"],
      }
    }
    const assessment = readyAssessment(run)
    const payload = assessment.payload!
    const anchorItemIds = [...state.anchor_item_ids]
    if (state.assessment_policy_hash
      !== assessmentRoutingPolicyHash(assessment)
      || !sameSet(anchorItemIds, payload.routing.anchor_item_ids)) {
      return {
        status: "blocked",
        routing_request_id: input.routing_request_id,
        issues: ["assessment 路由策略已改变"],
      }
    }
    const anchorSet = new Set(anchorItemIds)
    const hintKeys = Object.keys(input.revealed_anchor_hint_levels)
    if (hintKeys.some((itemId) => !anchorSet.has(itemId))) {
      return {
        status: "blocked",
        routing_request_id: input.routing_request_id,
        issues: ["锚点提示状态包含非锚点题"],
      }
    }
    if (anchorItemIds.some((itemId) =>
      (input.revealed_anchor_hint_levels[itemId] ?? 0)
        !== (session.session_state.revealed_hint_levels[itemId] ?? 0))) {
      return {
        status: "blocked",
        routing_request_id: input.routing_request_id,
        issues: ["锚点提示状态与可信会话记录不一致"],
      }
    }
    const secure = await this.loadAssessmentSecure(
      run,
      input.anchor_submission.submission_id,
    )
    if (!secure.ok) {
      return {
        status: "blocked",
        routing_request_id: input.routing_request_id,
        issues: secure.retryable
          ? ["assessment_secure 暂时无法读取"]
          : secure.outcome.status === "blocked"
            ? [...secure.outcome.issues]
            : ["assessment_secure 无法读取"],
      }
    }
    const routingState: SessionState = {
      ...structuredClone(session.session_state),
    }
    const grade = await gradeSubmission(
      input.anchor_submission,
      secure.artifact,
      {
        code_runner: this.dependencies.code_runner,
        rubric_judge: this.rubricJudge,
        public_artifact: assessment,
        session_state: routingState,
        repeat_exposure_by_item: input.repeat_exposure_by_item,
        expected_path_node_id:
          run.pipeline_input.generation_spec.path_node.node_id,
        assessment_secure_ref: run.secure_artifact_refs.assessment,
        max_tool_retries:
          run.pipeline_input.generation_spec.policies.max_tool_retry,
        allow_anchor_only: true,
      },
    )
    if (grade.status === "blocked") {
      return {
        status: "blocked",
        routing_request_id: input.routing_request_id,
        issues: grade.validation_issues
          ?? [grade.blocked_reason ?? "锚点成绩无法可信冻结"],
      }
    }
    if (grade.status === "needs_review") {
      return {
        status: "needs_review",
        routing_request_id: input.routing_request_id,
        unresolved_anchor_item_ids: [...grade.unresolved_item_ids],
      }
    }
    const routing = routeAssessmentFromAnchors(
      assessment,
      grade.item_results.map((item) => ({
        item_id: item.item_id,
        raw_score: item.raw_score,
      })),
    )
    if (!routing.ok) {
      return {
        status: "blocked",
        routing_request_id: input.routing_request_id,
        issues: [...routing.issues],
      }
    }
    const revealedHintLevels: Record<string, 0 | 1 | 2 | 3> =
      Object.fromEntries(
        routing.required_item_ids.map((itemId) => [
        itemId,
        session.session_state.revealed_hint_levels[itemId] ?? 0,
      ]),
      )
    const anchorGradeHash = contentHash({
      contract: "role-c-anchor-grade-v1",
      status: grade.status,
      item_results: grade.item_results,
      raw_score: grade.raw_score,
      max_score: grade.max_score,
    })
    const routeLockId = stableId("ROUTE-LOCK", {
      session_id: session.session_id,
      run_id: session.run_id,
      form_id: payload.form_id,
      attempt_no: input.attempt_no,
      assessment_policy_hash: state.assessment_policy_hash,
      anchor_input_hash: inputHash,
      anchor_grade_hash: anchorGradeHash,
      route_id: routing.route_id,
    })
    const locked: LearningSessionRecord = {
      ...structuredClone(session),
      session_state: {
        ...structuredClone(session.session_state),
        required_item_ids: [...routing.required_item_ids],
        revealed_hint_levels: revealedHintLevels,
      },
      assessment_routing_state: {
        mode: "anchor_first",
        phase: "ROUTE_LOCKED",
        routing_request_id: input.routing_request_id,
        assessment_policy_hash: state.assessment_policy_hash,
        anchor_item_ids: anchorItemIds,
        anchor_submission_id: input.anchor_submission.submission_id,
        anchor_input_hash: inputHash,
        anchor_answers_hash: answersHash,
        anchor_grade_hash: anchorGradeHash,
        route_lock_id: routeLockId,
        anchor_score_ratio: routing.anchor_score_ratio,
        route_id: routing.route_id,
        action: routing.action,
        reveal_tiers: [...routing.reveal_tiers],
        required_item_ids: [...routing.required_item_ids],
      },
      revision: session.revision + 1,
    }
    try {
      await this.dependencies.cycle_store.saveSession(
        locked,
        session.revision,
      )
      return routedOutcome(locked, locked.assessment_routing_state!)
    } catch (error) {
      if (!isCycleRevisionConflict(error)) throw persistenceError(error)
      const winner = await this.dependencies.cycle_store.loadSession(
        session.session_id,
      )
      const winnerState = winner?.assessment_routing_state
      if (winner && winnerState?.phase === "ROUTE_LOCKED"
        && winnerState.anchor_input_hash === inputHash
        && winnerState.anchor_answers_hash === answersHash) {
        return routedOutcome(winner, winnerState)
      }
      return {
        status: "blocked",
        routing_request_id: input.routing_request_id,
        issues: ["锚点路由已由另一份答案并发冻结"],
      }
    }
  }

  async processSubmission(
    input: ProcessSubmissionInput,
  ): Promise<LearningCyclePublicOutcome> {
    const outcome = await this.processSubmissionInternal(input)
    if (outcome.status === "completed") {
      return {
        status: "completed",
        feedback: structuredClone(outcome.completion.feedback),
      }
    }
    if (outcome.status === "needs_review") {
      return {
        status: "needs_review",
        submission_id: outcome.submission_id,
        unresolved_item_ids: [...outcome.unresolved_item_ids],
      }
    }
    return {
      status: "blocked",
      submission_id: outcome.submission_id,
      code: outcome.code,
      message: publicBlockMessage(outcome.code),
    }
  }

  /**
   * Executes learner code for one published lab. The caller supplies public
   * identities and code only; C resolves the verified hidden suite from its
   * secure store and returns an answer-free summary.
   */
  async executePublishedCodeLab(
    input: ExecutePublishedCodeLabInput,
  ): Promise<ExecutePublishedCodeLabOutcome> {
    if (!input.execution_id.trim() || !input.session_id.trim()
      || !input.run_id.trim() || !input.authenticated_learner_id_hash.trim()
      || !input.lab_id.trim() || !input.code.trim()
      || Buffer.byteLength(input.code, "utf8") > 100_000) {
      return blockedCodeLabExecution(
        input.execution_id,
        "INVALID_REQUEST",
        "代码实验请求缺少必要字段或代码超过 100 KB",
      )
    }
    if (!this.dependencies.code_runner) {
      return blockedCodeLabExecution(
        input.execution_id,
        "RUNNER_UNAVAILABLE",
        "代码执行服务暂不可用",
      )
    }

    const session = await this.dependencies.cycle_store.loadSession(
      input.session_id,
    )
    if (!session || session.run_id !== input.run_id) {
      return blockedCodeLabExecution(
        input.execution_id,
        "SESSION_NOT_FOUND",
        "代码实验对应的学习会话不存在",
      )
    }
    if (session.session_state.learner_id_hash
      !== input.authenticated_learner_id_hash) {
      return blockedCodeLabExecution(
        input.execution_id,
        "LEARNER_IDENTITY_MISMATCH",
        "学习者身份与代码实验会话不一致",
      )
    }

    const run = await this.dependencies.cycle_store.loadRun(input.run_id)
    if (!run) {
      return blockedCodeLabExecution(
        input.execution_id,
        "RUN_NOT_FOUND",
        "代码实验对应的学习轮次不存在",
      )
    }
    if (run.learner_id_hash !== input.authenticated_learner_id_hash) {
      return blockedCodeLabExecution(
        input.execution_id,
        "LEARNER_IDENTITY_MISMATCH",
        "学习者身份与代码实验轮次不一致",
      )
    }

    const publicLab = run.pipeline_result.public_artifacts.code_lab
    if (!publicLab?.payload || publicLab.status !== "ready"
      || publicLab.payload.lab_id !== input.lab_id
      || !session.session_state.public_artifact_refs.includes(
        publicLab.artifact_id,
      )) {
      return blockedCodeLabExecution(
        input.execution_id,
        "LAB_NOT_FOUND",
        "当前学习会话没有这项可运行的代码实验",
      )
    }

    let secureLab: CodeLabSecureArtifact
    try {
      const artifact = await this.dependencies.secure_store.get(
        run.secure_artifact_refs.code_lab,
        { principal: "role-c-grader", run_id: run.run_id },
      )
      if (artifact.artifact_type !== "code_lab_secure") {
        return blockedCodeLabExecution(
          input.execution_id,
          "SECURE_LAB_UNAVAILABLE",
          "代码实验测试套件暂不可用",
        )
      }
      secureLab = artifact
    } catch {
      return blockedCodeLabExecution(
        input.execution_id,
        "SECURE_LAB_UNAVAILABLE",
        "代码实验测试套件暂不可用",
      )
    }
    if (!secureLab.payload || secureLab.status !== "ready"
      || secureLab.payload.lab_id !== input.lab_id
      || secureLab.run_id !== run.run_id
      || contentHash(publicLab.payload.execution_contract)
        !== contentHash(secureLab.payload.execution_contract)) {
      return blockedCodeLabExecution(
        input.execution_id,
        "SECURE_LAB_UNAVAILABLE",
        "代码实验测试套件与当前实验不一致",
      )
    }

    const contract = publicLab.payload.execution_contract
    const result = await executeWithRunnerRetry(
      this.dependencies.code_runner,
      {
        language: "python",
        code: input.code,
        test_suite_id: secureLab.payload.test_suite_id,
        test_suite: {
          test_suite_id: secureLab.payload.test_suite_id,
          execution_contract: structuredClone(contract),
          tests: structuredClone(secureLab.payload.hidden_tests),
        },
        timeout_ms: contract.resource_limits.timeout_ms,
        memory_mb: contract.resource_limits.memory_mb,
        max_output_bytes: contract.resource_limits.max_output_bytes,
        network_allowed: false,
      },
      run.pipeline_input.generation_spec.policies.max_tool_retry,
    )
    if (result.status === "runner_error"
      || result.runner_image_digest
        !== this.dependencies.code_runner.runner_image_digest) {
      return blockedCodeLabExecution(
        input.execution_id,
        "RUNNER_UNAVAILABLE",
        "代码执行服务暂不可用",
      )
    }
    return {
      status: result.status,
      execution_id: input.execution_id,
      run_id: input.run_id,
      lab_id: input.lab_id,
      passed_checks: result.passed_tests,
      total_checks: result.total_tests,
      score_ratio: result.score_ratio,
      feedback_codes: publicCodeLabFeedbackCodes(result.failure_codes),
    }
  }

  /** Executes one formal-assessment code item through the C-owned secure suite. */
  async executeAssessmentCode(input: ExecuteAssessmentCodeInput): Promise<ExecuteAssessmentCodeOutcome> {
    const blocked = (code: ExecuteAssessmentCodeBlockedCode, message: string): ExecuteAssessmentCodeOutcome => ({
      status: "blocked", execution_id: input.execution_id, item_id: input.item_id, code, message,
    })
    if (!input.execution_id.trim() || !input.session_id.trim() || !input.run_id.trim()
      || !input.authenticated_learner_id_hash.trim() || !input.item_id.trim()
      || !input.code.trim() || Buffer.byteLength(input.code, "utf8") > 100_000) {
      return blocked("INVALID_REQUEST", "代码运行请求缺少必要字段或代码超过 100 KB")
    }
    if (!this.dependencies.code_runner) return blocked("RUNNER_UNAVAILABLE", "代码执行服务暂不可用")
    const session = await this.dependencies.cycle_store.loadSession(input.session_id)
    if (!session || session.run_id !== input.run_id) return blocked("SESSION_NOT_FOUND", "正式测评会话不存在")
    if (session.session_state.learner_id_hash !== input.authenticated_learner_id_hash) return blocked("LEARNER_IDENTITY_MISMATCH", "学习者身份与测评会话不一致")
    const run = await this.dependencies.cycle_store.loadRun(input.run_id)
    if (!run) return blocked("RUN_NOT_FOUND", "正式测评轮次不存在")
    const publicAssessment = run.pipeline_result.public_artifacts.assessment
    if (!publicAssessment?.payload || publicAssessment.status !== "ready") return blocked("ITEM_NOT_FOUND", "正式测评题目尚未可信发布")
    const publicItem = publicAssessment.payload.items.find((item) => item.item_id === input.item_id)
    if (!publicItem || publicItem.modality !== "code" || !session.session_state.required_item_ids.includes(input.item_id)) return blocked("ITEM_NOT_FOUND", "当前测评没有这道可运行代码题")
    let secure: AssessmentSecureArtifact
    try {
      const artifact = await this.dependencies.secure_store.get(run.secure_artifact_refs.assessment, { principal: "role-c-grader", run_id: run.run_id })
      if (artifact.artifact_type !== "assessment_secure" || artifact.status !== "ready" || !artifact.payload) return blocked("SECURE_ASSESSMENT_UNAVAILABLE", "正式测评私有测试套件暂不可用")
      secure = artifact as AssessmentSecureArtifact
    } catch { return blocked("SECURE_ASSESSMENT_UNAVAILABLE", "正式测评私有测试套件暂不可用") }
    const secureItem = secure.payload?.items.find((item) => item.item_id === input.item_id)
    const suiteId = secureItem?.answer_spec?.kind === "code" ? secureItem.answer_spec.test_suite_id : undefined
    const suite = suiteId ? secure.payload?.code_test_suites.find((candidate) => candidate.test_suite_id === suiteId) : undefined
    if (!secureItem || secureItem.modality !== "code" || !suite) return blocked("SECURE_ASSESSMENT_UNAVAILABLE", "这道代码题没有可用的私有测试套件")
    const contract = suite.execution_contract
    const result = await executeWithRunnerRetry(this.dependencies.code_runner, {
      language: "python", code: input.code, test_suite_id: suite.test_suite_id,
      test_suite: { test_suite_id: suite.test_suite_id, execution_contract: structuredClone(contract), tests: structuredClone(suite.hidden_tests) },
      timeout_ms: contract.resource_limits.timeout_ms, memory_mb: contract.resource_limits.memory_mb,
      max_output_bytes: contract.resource_limits.max_output_bytes, network_allowed: false,
    }, run.pipeline_input.generation_spec.policies.max_tool_retry)
    if (result.status === "runner_error" || result.runner_image_digest !== this.dependencies.code_runner.runner_image_digest) return blocked("RUNNER_UNAVAILABLE", "代码执行服务暂不可用")
    return { status: result.status, execution_id: input.execution_id, run_id: input.run_id, item_id: input.item_id, passed_checks: result.passed_tests, total_checks: result.total_tests, score_ratio: result.score_ratio, feedback_codes: publicCodeLabFeedbackCodes(result.failure_codes) }
  }

  /** Backend orchestration result used for the B handoff and durable mastery flow. */
  processSubmissionInternal(input: ProcessSubmissionInput): Promise<LearningCycleOutcome> {
    const inputHash = learningSubmissionInputHash(input.submission)
    const key = submissionKey(input.session_id, input.submission.submission_id)
    const active = this.inFlight.get(key)
    if (active) {
      if (active.authenticated_learner_id_hash !== input.authenticated_learner_id_hash) {
        return Promise.resolve(blocked(
          input.submission.submission_id,
          "LEARNER_IDENTITY_MISMATCH",
          ["认证学习者与正在处理的提交不一致"],
        ))
      }
      if (active.input_hash !== inputHash) {
        return Promise.resolve(blocked(
          input.submission.submission_id,
          "SUBMISSION_ID_CONFLICT",
          ["同一 submission_id 的提交内容不一致"],
        ))
      }
      return active.promise
    }
    const promise = this.processSubmissionOnce(input, inputHash)
      .finally(() => {
        if (this.inFlight.get(key)?.promise === promise) this.inFlight.delete(key)
      })
    this.inFlight.set(key, {
      input_hash: inputHash,
      authenticated_learner_id_hash: input.authenticated_learner_id_hash,
      promise,
    })
    return promise
  }

  async getResult(
    sessionId: string,
    submissionId: string,
    authenticatedLearnerIdHash: string,
  ): Promise<DynamicFeedbackResult | undefined> {
    const session = await this.dependencies.cycle_store.loadSession(sessionId)
    if (!session
      || session.session_state.learner_id_hash !== authenticatedLearnerIdHash) return undefined
    const record = await this.dependencies.cycle_store.loadSubmission(sessionId, submissionId)
    return record?.status === "COMPLETED"
      && record.run_id === session.run_id
      && record.submission.learner_id_hash === authenticatedLearnerIdHash
      && record.feedback?.learner_id_hash === authenticatedLearnerIdHash
      && record.feedback.session_id === sessionId
      && record.feedback.submission_id === submissionId
      ? structuredClone(record.feedback)
      : undefined
  }

  async prepareNextRoundFromCompletedSubmission(
    input: PrepareNextRoundFromCompletedSubmissionInput,
  ): Promise<NextRoundPreparation> {
    if (!input.session_id.trim() || !input.submission_id.trim()
      || !input.authenticated_learner_id_hash.trim()) {
      throw new LearningCycleServiceError(
        "INVALID_SESSION",
        "session_id、submission_id 和认证学习者不能为空",
      )
    }

    let session: LearningSessionRecord | undefined
    let record: LearningSubmissionRecord | undefined
    try {
      [session, record] = await Promise.all([
        this.dependencies.cycle_store.loadSession(input.session_id),
        this.dependencies.cycle_store.loadSubmission(
          input.session_id,
          input.submission_id,
        ),
      ])
    } catch (error) {
      throw persistenceError(error)
    }
    if (!session) {
      throw new LearningCycleServiceError("INVALID_SESSION", "学习会话不存在")
    }
    if (session.session_state.learner_id_hash
      !== input.authenticated_learner_id_hash) {
      throw new LearningCycleServiceError("INVALID_SESSION", "认证学习者与会话不一致")
    }
    if (!record || record.status !== "COMPLETED" || !record.feedback) {
      throw new LearningCycleServiceError(
        "INVALID_SESSION",
        "下一轮只能由已完成并冻结的提交生成",
      )
    }
    if (record.session_id !== session.session_id
      || record.submission_id !== input.submission_id
      || record.run_id !== session.run_id
      || record.submission.learner_id_hash !== input.authenticated_learner_id_hash
      || record.feedback.session_id !== session.session_id
      || record.feedback.submission_id !== record.submission_id
      || record.feedback.run_id !== record.run_id
      || record.feedback.learner_id_hash !== input.authenticated_learner_id_hash
      || session.latest_feedback_id !== record.feedback.feedback_id) {
      throw new LearningCycleServiceError(
        "INVALID_SESSION",
        "已完成提交、会话与认证学习者的绑定不一致",
      )
    }

    let run: LearningRunRecord | undefined
    try {
      run = await this.dependencies.cycle_store.loadRun(record.run_id)
    } catch (error) {
      throw persistenceError(error)
    }
    if (!run
      || run.run_id !== session.run_id
      || run.learner_id_hash !== input.authenticated_learner_id_hash) {
      throw new LearningCycleServiceError(
        "INVALID_SESSION",
        "已完成提交对应的可信 run 不存在或身份不一致",
      )
    }
    if (!run.profile_snapshot) {
      throw new LearningCycleServiceError(
        "INVALID_SESSION",
        "当前学习 run 缺少可信画像；请重新生成本轮内容后再继续",
      )
    }
    if (input.profile_snapshot
      && contentHash(input.profile_snapshot) !== contentHash(run.profile_snapshot)) {
      throw new LearningCycleServiceError(
        "INVALID_SESSION",
        "调用方画像与 run 中冻结的画像快照不一致",
      )
    }

    return prepareNextRound({
      authenticated_learner_id_hash: input.authenticated_learner_id_hash,
      feedback: structuredClone(record.feedback),
      parent_spec: structuredClone(run.pipeline_input.generation_spec),
      profile_snapshot: structuredClone(run.profile_snapshot),
      current_evidence_pack: structuredClone(run.pipeline_input.evidence_pack),
      ...(input.next_path_node
        ? { next_path_node: structuredClone(input.next_path_node) }
        : {}),
      ...(input.next_evidence_pack
        ? { next_evidence_pack: structuredClone(input.next_evidence_pack) }
        : {}),
      ...(input.next_profile_snapshot
        ? { next_profile_snapshot: structuredClone(input.next_profile_snapshot) }
        : {}),
      ...(input.next_generation_action
        ? { next_generation_action: input.next_generation_action }
        : {}),
      ...(input.current_generation_versions
        ? {
            current_generation_versions: structuredClone(
              input.current_generation_versions,
            ),
          }
        : {}),
    })
  }

  private async processSubmissionOnce(
    input: ProcessSubmissionInput,
    inputHash: string,
  ): Promise<LearningCycleOutcome> {
    let session = await this.dependencies.cycle_store.loadSession(input.session_id)
    if (!session) {
      return blocked(input.submission.submission_id, "SESSION_NOT_FOUND", ["学习会话不存在"])
    }
    const run = await this.dependencies.cycle_store.loadRun(session.run_id)
    if (!run) return blocked(input.submission.submission_id, "RUN_NOT_FOUND", ["会话对应的 run 不存在"])
    if (run.pipeline_result.status !== "ready") {
      return blocked(input.submission.submission_id, "RUN_NOT_READY", ["run 尚未达到 READY"])
    }
    if (run.learner_id_hash !== input.authenticated_learner_id_hash
      || session.session_state.learner_id_hash !== input.authenticated_learner_id_hash
      || input.submission.learner_id_hash !== input.authenticated_learner_id_hash) {
      return blocked(input.submission.submission_id, "LEARNER_IDENTITY_MISMATCH", [
        "认证学习者、run、会话与提交的身份不一致",
      ])
    }
    const routingState = session.assessment_routing_state
    if (routingState?.phase === "ANCHOR_PENDING") {
      return blocked(
        input.submission.submission_id,
        "ANCHOR_ROUTING_REQUIRED",
        ["必须先完成锚点题并冻结测评路由"],
      )
    }
    if (routingState?.phase === "ROUTE_LOCKED"
      && anchorAnswersHash(
        input.submission,
        routingState.anchor_item_ids,
      ) !== routingState.anchor_answers_hash) {
      return blocked(
        input.submission.submission_id,
        "ANCHOR_ANSWERS_CHANGED",
        ["最终提交中的锚点答案与冻结路由时不一致"],
      )
    }

    let record = await this.dependencies.cycle_store.loadSubmission(
      input.session_id,
      input.submission.submission_id,
    )
    if (record && record.input_hash !== inputHash) {
      return blocked(input.submission.submission_id, "SUBMISSION_ID_CONFLICT", [
        "同一 submission_id 的提交内容不一致",
      ])
    }
    if (record?.status === "COMPLETED" && record.feedback && record.grade) {
      const completedRecord = record as LearningSubmissionRecord & {
        grade: SubmissionGrade
        feedback: DynamicFeedbackResult
      }
      session = await this.completeSession(
        session,
        completedRecord,
        readyAssessment(run).payload!.submission_policy.max_attempts,
      )
      return {
        status: "completed",
        completion: await this.restoreCompletion(completedRecord),
      }
    }
    if (record?.status === "BLOCKED") {
      session = await this.clearSessionActive(session, record.submission_id)
      return blocked(
        record.submission_id,
        "SUBMISSION_BOUNDARY_BLOCKED",
        record.issues ?? record.grade?.validation_issues ?? [record.grade?.blocked_reason ?? "提交已阻塞"],
        record.grade,
      )
    }
    if (record?.status === "NEEDS_REVIEW" && record.grade) {
      session = await this.clearSessionActive(session, record.submission_id)
      return {
        status: "needs_review",
        submission_id: record.submission_id,
        unresolved_item_ids: [...record.grade.unresolved_item_ids],
        grade: structuredClone(record.grade),
      }
    }
    if (session.latest_feedback_id) {
      const maxAttempts = readyAssessment(run).payload!.submission_policy.max_attempts
      // 已完成作答后仅放行"下一次作答"（attempt_no 与 session 推进一致）且未达上限；
      // 同一 attempt 的重复提交（并发输家重试）仍按已完成拒绝。
      if (session.session_state.attempt_no > maxAttempts
        || input.submission.attempt_no !== session.session_state.attempt_no) {
        return blocked(input.submission.submission_id, "SESSION_ALREADY_COMPLETED", [
          `会话已完成，${maxAttempts} 次作答机会已用完`,
        ])
      }
    }

    if (!record) {
      if (input.expected_session_revision !== undefined
        && session.revision !== input.expected_session_revision) {
        return blocked(input.submission.submission_id, "SESSION_REVISION_CONFLICT", [
          `会话 revision 已更新为 ${session.revision}`,
        ])
      }
      if (session.active_submission_id
        && session.active_submission_id !== input.submission.submission_id) {
        return blocked(input.submission.submission_id, "SESSION_BUSY", [
          `会话正在处理提交 ${session.active_submission_id}`,
        ])
      }
      record = {
        schema_version: "1.0",
        session_id: input.session_id,
        submission_id: input.submission.submission_id,
        run_id: input.submission.run_id,
        submission: structuredClone(input.submission),
        input_hash: inputHash,
        status: "RECEIVED",
        revision: 0,
      }
      try {
        await this.dependencies.cycle_store.createSubmission(record)
      } catch (error) {
        if (!(error instanceof LearningCycleStoreError) || error.code !== "ALREADY_EXISTS") {
          throw persistenceError(error)
        }
        const raced = await this.dependencies.cycle_store.loadSubmission(
          input.session_id,
          input.submission.submission_id,
        )
        if (!raced || raced.input_hash !== inputHash) {
          return blocked(input.submission.submission_id, "SUBMISSION_ID_CONFLICT", [
            "并发提交使用了冲突的 submission_id",
          ])
        }
        record = raced
      }
    }
    const claim = await this.claimSession(
      session.session_id,
      input.submission.submission_id,
      readyAssessment(run).payload!.submission_policy.max_attempts,
      input.submission.attempt_no,
    )
    if (!claim.ok) {
      if ("completed_feedback_id" in claim) {
        return blocked(input.submission.submission_id, "SESSION_ALREADY_COMPLETED", [
          `会话已完成，最新反馈为 ${claim.completed_feedback_id}`,
        ])
      }
      return blocked(input.submission.submission_id, "SESSION_BUSY", [
        `会话正在处理提交 ${claim.active_submission_id}`,
      ])
    }
    session = claim.session
    const activeSession = claim.session
    const submissionClaim = await this.claimSubmission(record)
    if (!submissionClaim.ok) {
      if (submissionClaim.reason === "terminal") {
        return this.processSubmissionOnce(input, inputHash)
      }
      return blocked(record.submission_id, "SUBMISSION_BUSY", [
        "相同提交正在由另一处理实例执行",
      ])
    }
    record = submissionClaim.record

    const assessment = readyAssessment(run)
    const secureRead = await this.runWithSubmissionLeaseHeartbeat(
      record,
      () => this.loadAssessmentSecure(run, record!.submission_id),
    )
    if (!secureRead.ok) {
      return blocked(record.submission_id, "SUBMISSION_BUSY", [
        "提交处理租约已由另一实例接管",
      ])
    }
    record = secureRead.record
    const secure = secureRead.value
    if (!secure.ok) {
      if (secure.retryable) {
        record = await this.saveSubmission(record, {
          status: record.status,
          processing_owner_id: undefined,
          processing_lease_expires_at: undefined,
        })
        await this.clearSessionActive(session, record.submission_id)
        throw new LearningCycleServiceError(
          "PERSISTENCE_ERROR",
          "assessment_secure 暂时无法读取",
        )
      }
      const issues = secure.outcome.status === "blocked"
        ? secure.outcome.issues
        : ["assessment_secure 无法读取"]
      record = await this.saveSubmission(record, {
        status: "BLOCKED",
        issues,
        processing_owner_id: undefined,
        processing_lease_expires_at: undefined,
      })
      await this.clearSessionActive(session, record.submission_id)
      return secure.outcome
    }

    if (record.status === "RECEIVED") {
      const receivedRecord = record
      const grading = await this.runWithSubmissionLeaseHeartbeat(
        receivedRecord,
        () => gradeSubmission(receivedRecord.submission, secure.artifact, {
          code_runner: this.dependencies.code_runner,
          rubric_judge: this.rubricJudge,
          public_artifact: assessment,
          session_state: activeSession.session_state,
          repeat_exposure_by_item: activeSession.repeat_exposure_by_item,
          expected_path_node_id: run.pipeline_input.generation_spec.path_node.node_id,
          assessment_secure_ref: run.secure_artifact_refs.assessment,
          max_tool_retries: run.pipeline_input.generation_spec.policies.max_tool_retry,
        }),
      )
      if (!grading.ok) {
        return blocked(record.submission_id, "SUBMISSION_BUSY", [
          "提交处理租约已由另一实例接管",
        ])
      }
      record = grading.record
      const grade = grading.value
      if (grade.status === "blocked") {
        record = await this.saveSubmission(record, {
          status: "BLOCKED",
          grade,
          issues: grade.validation_issues ?? [grade.blocked_reason ?? "评分阻塞"],
          processing_owner_id: undefined,
          processing_lease_expires_at: undefined,
        })
        await this.clearSessionActive(session, record.submission_id)
        return blocked(
          record.submission_id,
          "SUBMISSION_BOUNDARY_BLOCKED",
          record.issues!,
          grade,
        )
      }
      if (grade.status === "needs_review") {
        record = await this.saveSubmission(record, {
          status: "NEEDS_REVIEW",
          grade,
          issues: grade.unresolved_item_ids,
          processing_owner_id: undefined,
          processing_lease_expires_at: undefined,
        })
        await this.clearSessionActive(session, record.submission_id)
        return {
          status: "needs_review",
          submission_id: record.submission_id,
          unresolved_item_ids: [...grade.unresolved_item_ids],
          grade,
        }
      }
      record = await this.saveSubmission(record, { status: "SCORED", grade })
    }

    if (record.status === "SCORED") {
      if (!record.grade) {
        return blocked(record.submission_id, "PERSISTENCE_CONFLICT", ["SCORED 记录缺少 grade"])
      }
      const scoredRecord = record as LearningSubmissionRecord & { grade: SubmissionGrade }
      const decision = await this.runWithSubmissionLeaseHeartbeat(
        scoredRecord,
        () => this.prepareMasteryDecision(
          run,
          activeSession,
          scoredRecord,
          secure.artifact,
        ),
      )
      if (!decision.ok) {
        return blocked(record.submission_id, "SUBMISSION_BUSY", [
          "提交处理租约已由另一实例接管",
        ])
      }
      record = decision.record
      const completed = decision.value
      record = await this.saveSubmission(record, {
        status: "DECIDED",
        grade: completed.grade,
        feedback: completed.feedback,
        evidence_events: completed.evidence_events,
        mastery_states: completed.mastery_states,
        mastery_writes: completed.mastery_writes,
      })
    }

    if (record.status === "DECIDED" && record.feedback && record.grade
      && record.evidence_events && record.mastery_states && record.mastery_writes) {
      record = await this.commitMasteryIntentWithRetry(
        run,
        session,
        record as LearningSubmissionRecord & {
          grade: SubmissionGrade
          feedback: DynamicFeedbackResult
          evidence_events: LearningEvidenceEvent[]
          mastery_states: ObjectiveMasteryState[]
          mastery_writes: MasteryStateWrite[]
        },
        secure.artifact,
      )
      record = await this.saveSubmission(record, {
        status: "MASTERY_APPLIED",
        grade: record.grade,
        feedback: record.feedback,
        evidence_events: record.evidence_events,
        mastery_states: record.mastery_states,
        mastery_writes: record.mastery_writes,
      })
    }

    if (record.status === "MASTERY_APPLIED" && record.feedback && record.grade
      && record.evidence_events && record.mastery_states && record.mastery_writes) {
      record = await this.saveSubmission(record, {
        status: "COMPLETED",
        grade: record.grade,
        feedback: record.feedback,
        evidence_events: record.evidence_events,
        mastery_states: record.mastery_states,
        mastery_writes: record.mastery_writes,
        processing_owner_id: undefined,
        processing_lease_expires_at: undefined,
      })
      session = await this.completeSession(
        session,
        record as LearningSubmissionRecord & { feedback: DynamicFeedbackResult },
        readyAssessment(run).payload!.submission_policy.max_attempts,
      )
    }

    if (record.status !== "COMPLETED" || !record.feedback || !record.grade
      || !record.evidence_events || !record.mastery_states) {
      return blocked(record.submission_id, "PERSISTENCE_CONFLICT", [
        `提交停留在未完成状态 ${record.status}`,
      ])
    }
    return {
      status: "completed",
      completion: await this.restoreCompletion(
        record as LearningSubmissionRecord & {
          grade: SubmissionGrade
          feedback: DynamicFeedbackResult
        },
      ),
    }
  }

  private async prepareMasteryDecision(
    run: LearningRunRecord,
    session: LearningSessionRecord,
    record: LearningSubmissionRecord & { grade: SubmissionGrade },
    secure: AssessmentSecureArtifact,
  ): Promise<{
    grade: SubmissionGrade
    feedback: DynamicFeedbackResult
    evidence_events: LearningEvidenceEvent[]
    mastery_states: ObjectiveMasteryState[]
    mastery_writes: MasteryStateWrite[]
  }> {
    const spec = run.pipeline_input.generation_spec
    const evidence = run.pipeline_input.evidence_pack
    const objectiveResults = aggregateObjectiveResults(record.grade.item_results)
    const roundDecision = decideRoundAction({
      raw_score: record.grade.raw_score,
      max_score: record.grade.max_score,
      objective_results: objectiveResults,
    })
    const provisionalGrade = finalizeGradeResult({
      grade: record.grade,
      spec,
      evidence,
      assessment_secure: secure,
      assessment_public_artifact_id: readyAssessment(run).artifact_id,
      formative: readyAssessment(run).payload!.submission_policy.formative,
      recommendation: roundDecision,
      cycle_identity: cycleIdentity(session, record),
    })
    if (provisionalGrade.status !== "ready" || !provisionalGrade.payload) {
      throw new LearningCycleServiceError("PERSISTENCE_ERROR", "可信评分无法冻结为 GradeResult")
    }

    const previewEvents = emitLearningEvidence(record.grade, spec, secure, {
      session_id: session.session_id,
      learner_id_hash: record.submission.learner_id_hash,
      attempt_no: record.submission.attempt_no,
      submission_hash: record.input_hash,
      grader_version: this.graderVersion,
      grade_artifact_id: provisionalGrade.artifact_id,
      hint_levels_by_item: session.session_state.revealed_hint_levels,
      final_decision: roundDecision,
    })
    const preview = await prepareMasteryUpdateFromEvidence(
      previewEvents,
      this.dependencies.mastery_store,
    )
    const drift = detectExplicitProfileDrift(
      session,
      preview.states,
      this.dependencies.profile_drift_minimum_conflicts,
    )
    const finalDecision = decideRoundAction({
      raw_score: record.grade.raw_score,
      max_score: record.grade.max_score,
      objective_results: objectiveResults,
      profile_drift_suggestion: drift,
    })
    const gradeArtifact = this.dependencies.feedback_generator
      ? await finalizeGradeResultWithFeedback({
          grade: record.grade,
          spec,
          evidence,
          assessment_secure: secure,
          assessment_public_artifact_id: readyAssessment(run).artifact_id,
          formative: readyAssessment(run).payload!.submission_policy.formative,
          recommendation: finalDecision,
          cycle_identity: cycleIdentity(session, record),
        }, this.dependencies.feedback_generator)
      : finalizeGradeResult({
          grade: record.grade,
          spec,
          evidence,
          assessment_secure: secure,
          assessment_public_artifact_id: readyAssessment(run).artifact_id,
          formative: readyAssessment(run).payload!.submission_policy.formative,
          recommendation: finalDecision,
          cycle_identity: cycleIdentity(session, record),
        })
    if (gradeArtifact.status !== "ready" || !gradeArtifact.payload) {
      throw new LearningCycleServiceError("PERSISTENCE_ERROR", "最终 GradeResult 未通过发布门禁")
    }
    const events = emitLearningEvidence(record.grade, spec, secure, {
      session_id: session.session_id,
      learner_id_hash: record.submission.learner_id_hash,
      attempt_no: record.submission.attempt_no,
      submission_hash: record.input_hash,
      grader_version: this.graderVersion,
      grade_artifact_id: gradeArtifact.artifact_id,
      hint_levels_by_item: session.session_state.revealed_hint_levels,
      final_decision: finalDecision,
    })
    const plan = await prepareMasteryUpdateFromEvidence(
      events,
      this.dependencies.mastery_store,
    )
    const feedback = buildDynamicFeedbackResult({
      session_id: session.session_id,
      learner_id_hash: record.submission.learner_id_hash,
      profile_version: spec.profile_ref.profile_version,
      path_node_id: spec.path_node.node_id,
      attempt_no: record.submission.attempt_no,
      grade_result: gradeArtifact,
      mastery_states: plan.states,
      final_decision: finalDecision,
      profile_drift_suggestion: drift,
    })
    return {
      grade: record.grade,
      feedback,
      evidence_events: events,
      mastery_states: plan.states,
      mastery_writes: plan.writes,
    }
  }

  private async restoreCompletion(
    record: LearningSubmissionRecord & {
      grade: SubmissionGrade
      feedback: DynamicFeedbackResult
    },
  ): Promise<LearningCycleCompletion> {
    if (!record.evidence_events || !record.mastery_states
      || record.mastery_states.length !== record.feedback.mastery_snapshot.length) {
      throw new LearningCycleServiceError(
        "PERSISTENCE_ERROR",
        "已完成提交缺少冻结的学习证据或掌握度状态",
      )
    }
    const configuredDelivery = this.dependencies.learning_progress_delivery
    const requiredPort = configuredDelivery?.mode === "required"
      ? configuredDelivery.port
      : undefined
    let deliveryToB: LearningProgressDeliveryOutcome
    if (requiredPort) {
      try {
        const ack = await deliverRoleCToB(
          requiredPort,
          record.evidence_events,
          record.feedback.profile_drift_suggestion,
        )
        deliveryToB = {
          mode: "required",
          ack,
        }
      } catch (error) {
        throw new LearningCycleServiceError(
          "PERSISTENCE_ERROR",
          `学习进展尚未被 B 确认：${error instanceof Error ? error.message : "未知投递错误"}`,
        )
      }
    } else if (configuredDelivery?.mode === "offline") {
      deliveryToB = {
        mode: "offline",
        reason: configuredDelivery.reason,
      }
    } else {
      deliveryToB = {
        mode: "deferred",
        reason: "port_not_configured",
      }
    }
    return {
      feedback: structuredClone(record.feedback),
      outbound_to_b: {
        evidence_events: structuredClone(record.evidence_events),
        profile_drift_suggestion: record.feedback.profile_drift_suggestion
          ? structuredClone(record.feedback.profile_drift_suggestion)
          : undefined,
      },
      delivery_to_b: structuredClone(deliveryToB),
      mastery_states: structuredClone(record.mastery_states),
    }
  }

  private async commitMasteryIntentWithRetry(
    run: LearningRunRecord,
    session: LearningSessionRecord,
    initial: LearningSubmissionRecord & {
      grade: SubmissionGrade
      feedback: DynamicFeedbackResult
      evidence_events: LearningEvidenceEvent[]
      mastery_states: ObjectiveMasteryState[]
      mastery_writes: MasteryStateWrite[]
    },
    secure: AssessmentSecureArtifact,
  ): Promise<typeof initial> {
    const retryLimit = Math.max(1, this.dependencies.mastery_retry_limit ?? 4)
    let current = initial
    for (let attempt = 1; attempt <= retryLimit; attempt += 1) {
      try {
        if (current.mastery_writes.length > 0) {
          await this.dependencies.mastery_store.saveBatch(
            structuredClone(current.mastery_writes),
          )
        }
        return current
      } catch (error) {
        if (!isMasteryRevisionConflict(error)) {
          throw new LearningCycleServiceError(
            "PERSISTENCE_ERROR",
            "掌握度 outbox 提交失败",
          )
        }
        if (await this.masteryIntentAlreadyApplied(current.evidence_events)) {
          return current
        }
        if (attempt >= retryLimit) {
          throw new LearningCycleServiceError(
            "MASTERY_REVISION_CONFLICT",
            `掌握度并发更新在 ${attempt} 次尝试后仍冲突`,
          )
        }
        const refreshed = await this.prepareMasteryDecision(
          run,
          session,
          current,
          secure,
        )
        current = await this.saveSubmission(current, {
          status: "DECIDED",
          grade: refreshed.grade,
          feedback: refreshed.feedback,
          evidence_events: refreshed.evidence_events,
          mastery_states: refreshed.mastery_states,
          mastery_writes: refreshed.mastery_writes,
        }) as typeof initial
      }
    }
    throw new LearningCycleServiceError("MASTERY_REVISION_CONFLICT", "掌握度更新未完成")
  }

  private async masteryIntentAlreadyApplied(
    events: LearningEvidenceEvent[],
  ): Promise<boolean> {
    const batches = new Map<string, LearningEvidenceEvent>()
    for (const event of events) {
      batches.set([
        event.learner_id_hash,
        event.profile_version,
        event.objective_id,
        event.provenance.idempotency_key,
      ].join("\u0000"), event)
    }
    if (batches.size === 0) return false
    const checks = await Promise.all([...batches.values()].map(async (event) => {
      const state = await this.dependencies.mastery_store.load(
        event.learner_id_hash,
        event.profile_version,
        event.objective_id,
      )
      return state?.processed_artifact_ids.includes(
        event.provenance.idempotency_key,
      ) === true
    }))
    return checks.every(Boolean)
  }

  private async loadAssessmentSecure(
    run: LearningRunRecord,
    submissionId = "",
  ): Promise<
    | { ok: true; artifact: AssessmentSecureArtifact }
    | {
        ok: false
        retryable: false
        outcome: LearningCycleOutcome
      }
    | {
        ok: false
        retryable: true
      }
  > {
    try {
      const artifact = await this.dependencies.secure_store.get(
        run.secure_artifact_refs.assessment,
        { principal: "role-c-grader", run_id: run.run_id },
      )
      if (artifact.artifact_type !== "assessment_secure") {
        return {
          ok: false,
          retryable: false,
          outcome: blocked(submissionId, "SECURE_ARTIFACT_TYPE_MISMATCH", [
            "命名 assessment ref 未指向 assessment_secure",
          ]),
        }
      }
      return { ok: true, artifact: artifact as AssessmentSecureArtifact }
    } catch (error) {
      if (!(error instanceof SecureArtifactStoreError)
        || error.code === "STORAGE_ERROR") {
        return { ok: false, retryable: true }
      }
      return {
        ok: false,
        retryable: false,
        outcome: blocked(submissionId, "SECURE_ARTIFACT_NOT_FOUND", [
          "assessment_secure 无法读取或校验",
        ]),
      }
    }
  }

  private async saveSubmission(
    current: LearningSubmissionRecord,
    patch: Pick<LearningSubmissionRecord, "status">
      & Partial<Pick<
        LearningSubmissionRecord,
        | "grade"
        | "feedback"
        | "evidence_events"
        | "mastery_states"
        | "mastery_writes"
        | "processing_owner_id"
        | "processing_lease_expires_at"
        | "issues"
      >>,
  ): Promise<LearningSubmissionRecord> {
    const next: LearningSubmissionRecord = {
      ...structuredClone(current),
      ...structuredClone(patch),
      revision: current.revision + 1,
    }
    try {
      await this.dependencies.cycle_store.saveSubmission(next, current.revision)
      return next
    } catch (error) {
      throw persistenceError(error)
    }
  }

  private async runWithSubmissionLeaseHeartbeat<T>(
    initial: LearningSubmissionRecord,
    task: () => Promise<T>,
  ): Promise<
    | { ok: true; record: LearningSubmissionRecord; value: T }
    | { ok: false }
  > {
    const leaseMs = this.dependencies.submission_lease_ms ?? 300_000
    const heartbeatMs = Math.min(30_000, Math.max(250, Math.floor(leaseMs / 3)))
    let record = initial
    let stopped = false
    let ownershipLost = false
    let wakeDelay: (() => void) | undefined

    const waitForHeartbeat = (): Promise<void> => new Promise((resolve) => {
      const timer = setTimeout(() => {
        wakeDelay = undefined
        resolve()
      }, heartbeatMs)
      wakeDelay = () => {
        clearTimeout(timer)
        wakeDelay = undefined
        resolve()
      }
    })
    const heartbeat = (async () => {
      while (!stopped) {
        await waitForHeartbeat()
        if (stopped) break
        try {
          const current = await this.dependencies.cycle_store.loadSubmission(
            initial.session_id,
            initial.submission_id,
          )
          if (!current
            || current.processing_owner_id !== this.workerId
            || ["COMPLETED", "BLOCKED", "NEEDS_REVIEW"].includes(current.status)) {
            ownershipLost = true
            break
          }
          const renewed: LearningSubmissionRecord = {
            ...structuredClone(current),
            processing_lease_expires_at: Date.now() + leaseMs,
            revision: current.revision + 1,
          }
          await this.dependencies.cycle_store.saveSubmission(
            renewed,
            current.revision,
          )
          record = renewed
        } catch {
          ownershipLost = true
          break
        }
      }
    })()

    let value: T
    try {
      value = await task()
    } finally {
      stopped = true
      wakeDelay?.()
      await heartbeat
    }
    return ownershipLost
      ? { ok: false }
      : { ok: true, record, value }
  }

  private async claimSubmission(
    record: LearningSubmissionRecord,
  ): Promise<
    | { ok: true; record: LearningSubmissionRecord }
    | { ok: false; reason: "busy" | "terminal" }
  > {
    const terminal = new Set(["COMPLETED", "BLOCKED", "NEEDS_REVIEW"])
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const current = await this.dependencies.cycle_store.loadSubmission(
        record.session_id,
        record.submission_id,
      )
      if (!current) {
        throw new LearningCycleServiceError("PERSISTENCE_ERROR", "提交记录在处理中消失")
      }
      if (terminal.has(current.status)) return { ok: false, reason: "terminal" }
      if (current.processing_owner_id === this.workerId) {
        return { ok: true, record: current }
      }
      if (current.processing_owner_id
        && (current.processing_lease_expires_at ?? 0) > Date.now()) {
        return { ok: false, reason: "busy" }
      }
      const next: LearningSubmissionRecord = {
        ...structuredClone(current),
        processing_owner_id: this.workerId,
        processing_lease_expires_at: Date.now()
          + (this.dependencies.submission_lease_ms ?? 300_000),
        revision: current.revision + 1,
      }
      try {
        await this.dependencies.cycle_store.saveSubmission(next, current.revision)
        return { ok: true, record: next }
      } catch (error) {
        if (isCycleRevisionConflict(error) && attempt < 4) continue
        throw persistenceError(error)
      }
    }
    throw new LearningCycleServiceError("PERSISTENCE_ERROR", "提交处理租约获取失败")
  }

  private async claimSession(
    sessionId: string,
    submissionId: string,
    maxAttempts: number,
    submissionAttemptNo: number,
  ): Promise<
    | { ok: true; session: LearningSessionRecord }
    | { ok: false; active_submission_id: string }
    | { ok: false; completed_feedback_id: string }
  > {
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const current = await this.dependencies.cycle_store.loadSession(sessionId)
      if (!current) {
        throw new LearningCycleServiceError("PERSISTENCE_ERROR", "学习会话在提交处理中消失")
      }
      if (current.latest_feedback_id) {
        if (current.session_state.attempt_no > maxAttempts
          || submissionAttemptNo !== current.session_state.attempt_no) {
          return { ok: false, completed_feedback_id: current.latest_feedback_id }
        }
      }
      if (current.active_submission_id) {
        return current.active_submission_id === submissionId
          ? { ok: true, session: current }
          : { ok: false, active_submission_id: current.active_submission_id }
      }
      const next: LearningSessionRecord = {
        ...structuredClone(current),
        active_submission_id: submissionId,
        revision: current.revision + 1,
      }
      try {
        await this.dependencies.cycle_store.saveSession(next, current.revision)
        return { ok: true, session: next }
      } catch (error) {
        if (isCycleRevisionConflict(error) && attempt < 4) continue
        throw persistenceError(error)
      }
    }
    throw new LearningCycleServiceError("PERSISTENCE_ERROR", "学习会话占用状态更新失败")
  }

  private async clearSessionActive(
    session: LearningSessionRecord,
    submissionId: string,
  ): Promise<LearningSessionRecord> {
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const latest = await this.dependencies.cycle_store.loadSession(session.session_id)
        ?? session
      if (latest.active_submission_id !== submissionId) return latest
      const next: LearningSessionRecord = {
        ...structuredClone(latest),
        active_submission_id: undefined,
        revision: latest.revision + 1,
      }
      try {
        await this.dependencies.cycle_store.saveSession(next, latest.revision)
        return next
      } catch (error) {
        if (isCycleRevisionConflict(error) && attempt < 4) continue
        throw persistenceError(error)
      }
    }
    throw new LearningCycleServiceError("PERSISTENCE_ERROR", "学习会话释放失败")
  }

  private async completeSession(
    session: LearningSessionRecord,
    record: LearningSubmissionRecord & { feedback: DynamicFeedbackResult },
    maxAttempts: number,
  ): Promise<LearningSessionRecord> {
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const latest = await this.dependencies.cycle_store.loadSession(session.session_id)
        ?? session
      if (latest.latest_feedback_id
        && latest.latest_feedback_id !== record.feedback.feedback_id
        && latest.session_state.attempt_no > maxAttempts) {
        throw new LearningCycleServiceError(
          "PERSISTENCE_ERROR",
          "学习会话已绑定另一份完成反馈",
        )
      }
      if (latest.active_submission_id
        && latest.active_submission_id !== record.submission_id) {
        throw new LearningCycleServiceError(
          "PERSISTENCE_ERROR",
          "学习会话由另一份提交占用",
        )
      }
      if (latest.latest_feedback_id === record.feedback.feedback_id
        && latest.active_submission_id === undefined) {
        return latest
      }
      const repeatExposure = { ...latest.repeat_exposure_by_item }
      const isNewAttempt = latest.latest_feedback_id !== record.feedback.feedback_id
      if (isNewAttempt) {
        for (const answer of record.submission.answers) {
          repeatExposure[answer.item_id] = (repeatExposure[answer.item_id] ?? 0) + 1
        }
      }
      const next: LearningSessionRecord = {
        ...structuredClone(latest),
        active_submission_id: undefined,
        latest_feedback_id: record.feedback.feedback_id,
        repeat_exposure_by_item: repeatExposure,
        session_state: isNewAttempt
          ? { ...latest.session_state, attempt_no: latest.session_state.attempt_no + 1 }
          : latest.session_state,
        revision: latest.revision + 1,
      }
      try {
        await this.dependencies.cycle_store.saveSession(next, latest.revision)
        return next
      } catch (error) {
        if (isCycleRevisionConflict(error) && attempt < 4) continue
        throw persistenceError(error)
      }
    }
    throw new LearningCycleServiceError("PERSISTENCE_ERROR", "学习会话完成状态写入失败")
  }
}

function assertReadyPipeline(input: RegisterReadyRunInput): void {
  if (input.profile_snapshot.profile_id
    !== input.pipeline_input.generation_spec.profile_ref.profile_id
    || input.profile_snapshot.profile_version
      !== input.pipeline_input.generation_spec.profile_ref.profile_version
    || contentHash(input.profile_snapshot)
      !== input.pipeline_input.generation_spec.profile_ref.profile_content_hash) {
    throw new LearningCycleServiceError("INVALID_READY_RUN", "画像快照与 GenerationSpec 不一致")
  }
  if (input.pipeline_input.evidence_pack.retrieval_id
    !== input.pipeline_input.generation_spec.evidence_ref) {
    throw new LearningCycleServiceError("INVALID_READY_RUN", "pipeline 结果不满足正式学习周期注册条件")
  }
  try {
    assertReviewedReadyPipeline(input.pipeline_result, {
      pipeline_input: input.pipeline_input,
      evidence_pack: input.pipeline_input.evidence_pack,
      expected_spec_id: input.pipeline_input.generation_spec.spec_id,
      error_prefix: "ROLE_C_LEARNING_RUN",
    })
  } catch {
    throw new LearningCycleServiceError("INVALID_READY_RUN", "pipeline 结果不满足正式学习周期注册条件")
  }
}

function validateSessionInput(
  input: OpenTrustedPreselectedSessionInput,
  run: LearningRunRecord,
  assessment: AssessmentPublicArtifact,
): void {
  if (input.routing_policy !== "trusted_preselected_v1") {
    throw new LearningCycleServiceError(
      "INVALID_SESSION",
      "预选会话缺少可信路由策略",
    )
  }
  if (!input.session_id.trim() || !input.authenticated_learner_id_hash.trim()
    || !Number.isSafeInteger(input.attempt_no) || input.attempt_no < 1) {
    throw new LearningCycleServiceError("INVALID_SESSION", "session 身份或 attempt_no 无效")
  }
  if (input.required_item_ids.length === 0
    || new Set(input.required_item_ids).size !== input.required_item_ids.length) {
    throw new LearningCycleServiceError("INVALID_SESSION", "required_item_ids 必须非空且唯一")
  }
  const payload = assessment.payload!
  const itemIds = new Set(payload.items.map((item) => item.item_id))
  if (input.required_item_ids.some((itemId) => !itemIds.has(itemId))) {
    throw new LearningCycleServiceError("INVALID_SESSION", "required_item_ids 包含未知题目")
  }
  if (!allowedRoutedSet(assessment, input.required_item_ids)) {
    throw new LearningCycleServiceError("INVALID_SESSION", "required_item_ids 不符合测评路由规则")
  }
  const hintedItems = Object.keys(input.revealed_hint_levels)
  if (hintedItems.some((itemId) => !itemIds.has(itemId))) {
    throw new LearningCycleServiceError("INVALID_SESSION", "revealed_hint_levels 包含未知题目")
  }
  const objectives = new Set(run.pipeline_input.generation_spec.targets.map((target) => target.objective_id))
  if (Object.keys(input.profile_expectations_by_objective ?? {})
    .some((objectiveId) => !objectives.has(objectiveId))) {
    throw new LearningCycleServiceError("INVALID_SESSION", "画像预期包含当前 Spec 之外的 objective")
  }
  if (Object.keys(input.repeat_exposure_by_item ?? {}).some((itemId) => !itemIds.has(itemId))) {
    throw new LearningCycleServiceError("INVALID_SESSION", "repeat exposure 包含未知题目")
  }
}

function assertRegisteredSecurePair(
  codePublic: CodeLabPublicArtifact,
  codeSecure: CodeLabSecureArtifact,
  assessmentPublic: AssessmentPublicArtifact,
  assessmentSecure: AssessmentSecureArtifact,
): void {
  const codePayload = codePublic.payload
  const codeSecurePayload = codeSecure.payload
  const assessmentPayload = assessmentPublic.payload
  const assessmentSecurePayload = assessmentSecure.payload
  if (!codePayload || !codeSecurePayload || !assessmentPayload || !assessmentSecurePayload
    || codeSecure.artifact_type !== "code_lab_secure"
    || assessmentSecure.artifact_type !== "assessment_secure"
    || codeSecure.status !== "ready"
    || assessmentSecure.status !== "ready"
    || codeSecure.quality.execution_verified !== true
    || assessmentSecure.quality.answer_key_verified !== true
    || codePayload.lab_id !== codeSecurePayload.lab_id
    || assessmentPayload.form_id !== assessmentSecurePayload.form_id
    || codePublic.run_id !== codeSecure.run_id
    || assessmentPublic.run_id !== assessmentSecure.run_id
    || codePublic.seed !== codeSecure.seed
    || assessmentPublic.seed !== assessmentSecure.seed
    || contentHash(codePublic.versions) !== contentHash(codeSecure.versions)
    || contentHash(assessmentPublic.versions) !== contentHash(assessmentSecure.versions)
    || contentHash(codePayload.execution_contract)
      !== contentHash(codeSecurePayload.execution_contract)
    || !validateCodeLabPublicSecureSeparation(codePayload, codeSecurePayload).ok
    || !validateAssessmentPublicSecureSeparation(
      assessmentPayload,
      assessmentSecurePayload,
    ).ok) {
    throw new LearningCycleServiceError("INVALID_READY_RUN", "public/secure 产物配对校验失败")
  }
  const publicItems = new Map(assessmentPayload.items.map((item) => [
    item.item_id,
    item,
  ]))
  if (publicItems.size !== assessmentPayload.items.length
    || assessmentSecurePayload.items.length !== publicItems.size
    || assessmentSecurePayload.items.some((secureItem) => {
      const publicItem = publicItems.get(secureItem.item_id)
      return !publicItem
        || publicItem.objective_id !== secureItem.objective_id
        || publicItem.tier !== secureItem.tier
        || publicItem.modality !== secureItem.modality
        || publicItem.max_score !== secureItem.max_score
    })) {
    throw new LearningCycleServiceError("INVALID_READY_RUN", "assessment public/secure 题目映射不一致")
  }
}

function blockedCodeLabExecution(
  executionId: string,
  code: Extract<ExecutePublishedCodeLabOutcome, { status: "blocked" }>["code"],
  message: string,
): Extract<ExecutePublishedCodeLabOutcome, { status: "blocked" }> {
  return {
    status: "blocked",
    execution_id: executionId,
    code,
    message,
  }
}

function publicCodeLabFeedbackCodes(
  failureCodes: string[],
): PublishedCodeLabFeedbackCode[] {
  const mapped = failureCodes.map((raw): PublishedCodeLabFeedbackCode => {
    const code = raw.toLocaleLowerCase()
    if (code.includes("assertion_failed")) return "assertion_failed"
    if (code.includes("syntax_error")) return "syntax_error"
    if (code.includes("runtime_")) return "runtime_error"
    if (code.includes("output_limit")) return "output_limit"
    if (code.includes("non_json_output")) return "non_json_output"
    if (code.includes("forbidden_import")) return "forbidden_import"
    if (code.includes("forbidden")) return "forbidden_syntax"
    if (code.includes("resource_limit_exceeded")) {
      return "resource_limit_exceeded"
    }
    if (code.includes("timeout")) return "execution_timeout"
    return "execution_failed"
  })
  return [...new Set(mapped)]
}

function readyAssessment(run: LearningRunRecord): AssessmentPublicArtifact {
  const artifact = run.pipeline_result.public_artifacts.assessment
  if (!artifact || artifact.status !== "ready" || !artifact.payload) {
    throw new LearningCycleServiceError("INVALID_READY_RUN", "run 缺少 ready assessment_public")
  }
  return artifact
}

function allowedRoutedSet(
  assessment: AssessmentPublicArtifact,
  requiredItemIds: string[],
): boolean {
  const payload = assessment.payload
  if (!payload) return false
  const candidates = payload.routing.rules.map((rule) => payload.items
    .filter((item) => payload.routing.anchor_item_ids.includes(item.item_id)
      || rule.reveal_tiers.includes(item.tier))
    .map((item) => item.item_id))
  return candidates.some((candidate) => sameSet(candidate, requiredItemIds))
}

function detectExplicitProfileDrift(
  session: LearningSessionRecord,
  states: ObjectiveMasteryState[],
  minimumConflicts?: number,
): ProfileDriftSuggestion | undefined {
  const observations = states.flatMap((state) => {
    const expected = session.profile_expectations_by_objective[state.objective_id]
    return expected
      ? [{ objective_id: state.objective_id, expected, mastery: state.mastery }]
      : []
  })
  if (observations.length === 0) return undefined
  return detectProfileDrift({
    learner_id_hash: session.session_state.learner_id_hash,
    profile_version: states[0]?.profile_version
      ?? session.session_state.run_id,
    observations,
    minimum_conflicts: minimumConflicts,
  })
}

function cycleIdentity(
  session: LearningSessionRecord,
  record: LearningSubmissionRecord,
): NonNullable<Parameters<typeof finalizeGradeResult>[0]["cycle_identity"]> {
  return {
    session_id: session.session_id,
    learner_id_hash: record.submission.learner_id_hash,
    attempt_no: record.submission.attempt_no,
    submission_hash: record.input_hash,
  }
}

function assessmentRoutingPolicyHash(
  assessment: AssessmentPublicArtifact,
): string {
  return contentHash({
    contract: "role-c-assessment-routing-policy-v1",
    artifact_id: assessment.artifact_id,
    artifact_hash: contentHash(assessment),
    routing: assessment.payload?.routing,
  })
}

function anchorAnswersHash(
  submission: SubmissionEnvelope,
  anchorItemIds: string[],
): string {
  const anchors = new Set(anchorItemIds)
  const answers = submission.answers
    .filter((answer) => anchors.has(answer.item_id))
    .map((answer) => structuredClone(answer))
    .sort((left, right) => left.item_id.localeCompare(right.item_id))
  return contentHash({
    contract: "role-c-anchor-answers-v1",
    run_id: submission.run_id,
    learner_id_hash: submission.learner_id_hash,
    form_id: submission.form_id,
    attempt_no: submission.attempt_no,
    answers,
  })
}

function anchorRoutingInputHash(submission: SubmissionEnvelope): string {
  const normalized = structuredClone(submission)
  normalized.answers.sort((left, right) =>
    left.item_id.localeCompare(right.item_id))
  return contentHash({
    contract: "role-c-anchor-routing-input-v1",
    submission: normalized,
  })
}

function routedOutcome(
  session: LearningSessionRecord,
  state: AssessmentRoutingState,
): AssessmentAnchorRoutingOutcome {
  if (state.phase !== "ROUTE_LOCKED") {
    throw new LearningCycleServiceError(
      "PERSISTENCE_ERROR",
      "锚点路由尚未冻结",
    )
  }
  return {
    status: "routed",
    routing_request_id: state.routing_request_id,
    anchor_score_ratio: state.anchor_score_ratio,
    route_id: state.route_id,
    action: state.action,
    required_item_ids: [...state.required_item_ids],
    learning_session: {
      phase: "route_locked",
      routing_request_id: state.routing_request_id,
      session_id: session.session_id,
      run_id: session.run_id,
      form_id: session.session_state.current_form_id,
      attempt_no: session.session_state.attempt_no,
      route_lock_id: state.route_lock_id,
      route_id: state.route_id,
      action: state.action,
      anchor_score_ratio: state.anchor_score_ratio,
      required_item_ids: [...state.required_item_ids],
    },
  }
}

function sameAnchorFirstSessionIdentity(
  existing: LearningSessionRecord,
  pending: LearningSessionRecord,
): boolean {
  const existingState = existing.assessment_routing_state
  const pendingState = pending.assessment_routing_state
  return Boolean(
    existingState?.mode === "anchor_first"
      && pendingState?.phase === "ANCHOR_PENDING"
      && existing.session_id === pending.session_id
      && existing.run_id === pending.run_id
      && existing.session_state.learner_id_hash
        === pending.session_state.learner_id_hash
      && existing.session_state.current_form_id
        === pending.session_state.current_form_id
      && existing.session_state.attempt_no
        === pending.session_state.attempt_no
      && existingState.routing_request_id
        === pendingState.routing_request_id
      && existingState.assessment_policy_hash
        === pendingState.assessment_policy_hash
      && sameSet(
        existingState.anchor_item_ids,
        pendingState.anchor_item_ids,
      ),
  )
}

function recordIdentity(record: { revision: number }): string {
  const clone = structuredClone(record) as Record<string, unknown>
  delete clone.revision
  return contentHash(clone)
}

function sameSet(left: string[], right: string[]): boolean {
  const leftSet = new Set(left)
  const rightSet = new Set(right)
  return leftSet.size === left.length && rightSet.size === right.length
    && leftSet.size === rightSet.size
    && [...leftSet].every((value) => rightSet.has(value))
}

function submissionKey(sessionId: string, submissionId: string): string {
  return `${sessionId}\u0000${submissionId}`
}

function blocked(
  submissionId: string,
  code: LearningCycleBlockCode,
  issues: string[],
  grade?: SubmissionGrade,
): Extract<LearningCycleOutcome, { status: "blocked" }> {
  return {
    status: "blocked",
    submission_id: submissionId,
    code,
    issues: [...new Set(issues.filter(Boolean))],
    grade: grade ? structuredClone(grade) : undefined,
  }
}

function publicBlockMessage(code: LearningCycleBlockCode): string {
  if (code === "SESSION_NOT_FOUND" || code === "RUN_NOT_FOUND") return "学习会话不存在或已失效"
  if (code === "SESSION_BUSY" || code === "SUBMISSION_BUSY") return "当前提交正在处理中"
  if (code === "SESSION_ALREADY_COMPLETED") return "本次学习会话已经完成"
  if (code === "ANCHOR_ROUTING_REQUIRED") return "请先完成锚点题以确定测评路线"
  if (code === "ANCHOR_ANSWERS_CHANGED") return "锚点答案与已确定的测评路线不一致"
  if (code === "LEARNER_IDENTITY_MISMATCH") return "学习者身份校验失败"
  if (code === "SUBMISSION_ID_CONFLICT") return "提交标识与已有记录冲突"
  return "本次提交暂时无法完成"
}

function isMasteryRevisionConflict(error: unknown): boolean {
  return Boolean(
    error
      && typeof error === "object"
      && "code" in error
      && error.code === "REVISION_CONFLICT",
  ) || (error instanceof Error && error.message.includes("MASTERY_REVISION_CONFLICT"))
}

function isCycleRevisionConflict(error: unknown): boolean {
  return error instanceof LearningCycleStoreError
    ? error.code === "REVISION_CONFLICT"
    : error instanceof Error && error.message.includes("REVISION_CONFLICT")
}

function persistenceError(error: unknown): LearningCycleServiceError {
  if (error instanceof LearningCycleServiceError) return error
  const message = error instanceof Error ? error.message : "学习周期持久化失败"
  return new LearningCycleServiceError("PERSISTENCE_ERROR", message)
}
