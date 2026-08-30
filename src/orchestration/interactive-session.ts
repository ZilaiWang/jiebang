import { chmod, mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { createHash, randomUUID } from "node:crypto"
import { join } from "node:path"
import { loadKnowledgeBase } from "../knowledge/loader"
import { resolveLearningGoalSpec } from "../knowledge/curriculum"
import {
  selectDiagnosticEvidenceTargets,
  type DiagnosticEvidenceTarget,
} from "../knowledge/diagnostic-selector"
import { loadLearnerMemory, saveLearnerMemory, appendPersistenceEvents, type PersistenceEvent } from "./learner-memory"
import { createScaffoldWorkerInvocation, runWorkerAdapter } from "./worker-adapters"
import { ORCHESTRATION_WORKER_SEQUENCE } from "./state-machine"
import { validateWorkerResult } from "./worker-contract"
import type { LearnerRequest, OrchestrationMode, WorkerName } from "./types"
import type { BackgroundEvidence, DiagnosisItem, ObjectiveDiagnosisEvidence, SelfAssessmentEvidence } from "../role-b-profile/types"
import type { SubmissionAnswer } from "../role-c-content/contracts/artifacts"
import type { GenerationRecoveryContext, NextRoundGenerationContext, PriorAssessmentItem } from "../role-c-content/agents/types"
import type { RoleCAdaptationInfo } from "../role-c-content/contracts/external-api"
import type { ResourceFitReport } from "../role-c-content/contracts/resource-fit"
import type { DynamicFeedbackResult, ObjectiveRoundResult } from "../role-c-content/contracts/dynamic-feedback"
import { DEFAULT_ROUND_ACTION_POLICY } from "../role-c-content/contracts/dynamic-feedback"
import type { RagResult } from "../rag/retriever"
import { buildLearningEvidenceRequest, retrieveLearningEvidence } from "../rag/learning-evidence"
import {
  createAtomicRoleCLearningPersistence,
  generationFailure,
  generateRoleCForRoleDWithRuntime,
  runRoleCAssessmentCode,
  runRoleCCodeLab,
  debugRoleCCodeLab,
  runRoleCExampleCode,
  submitRoleCAssessment,
  createRoleCRecoveryEvidenceRefreshPort,
  type RoleCForRoleDRuntimeOptions,
} from "../role-d-integration/role-c-service"
import type { RoleCGenerationFailure } from "../role-d-integration/contracts"
import type { LearnerProfile } from "../role-b-profile/types"
import type { LearningPathNode } from "../role-c-content/contracts/profile-adapter"
import { bindObjectiveEvidence } from "../role-c-content/planning/objective-evidence-bundle"
import { buildFormalPath, advanceToNextNode, isFormalPathMastered, startPath, type FormalLearningPath } from "../role-b-profile/teaching-audit/formal-path"
import { RoleBLearningProgressAdapter } from "../role-b-profile/teaching-audit/learning-progress-adapter"
import {
  applyProfileClarificationAnswer,
  assessProfileIntake,
  isLearnerProfileV2,
  type ProfileClarificationAnswer,
} from "../role-b-profile/learner-profile-v2"
import { createLocalBPathPlanningPort } from "../role-c-content/review/local-b-path-planning-port"
import type { KnowledgeBase } from "../knowledge/types"
import type { LearnerProfileSnapshot } from "../role-c-content/contracts/profile-adapter"
import { createRoleCModelGatewayFromEnv } from "../role-c-content/contracts/model-gateway"
import {
  ModelDiagnosticQuestionAuthor,
  type DiagnosticQuestionAuthorPort,
} from "./diagnostic-question-author"
import {
  AtomicFileDurableJobStore,
  DurableJobRunner,
  ROLE_C_CONTENT_MODEL_CALL_BUDGET,
  ROLE_C_DURABLE_JOB_DEADLINE_MS,
  createModelWorkflowJob,
  type ModelWorkflowJobKind,
} from "../model-runtime"

export type InteractiveSessionStatus = "waiting_for_user" | "running" | "completed" | "blocked" | "failed"
export type InteractiveStage = "objective_diagnosis" | "assessment" | "completed" | "blocked" | "failed"

/** 会话锁超过该时长（毫秒）视为陈旧：持有进程可能已崩溃，允许接管。 */
const STALE_LOCK_MS = 60_000
export const LEARNING_SUPPORT_REQUIRED = "LEARNING_SUPPORT_REQUIRED"

export interface LearningTerminalOutcome {
  kind: "completed_mastered" | "unsupported_goal" | "insufficient_evidence" | "planning_failed" | "learning_support_required" | "content_generation_failed"
  code: "PATH_MASTERED" | "UNSUPPORTED_GOAL" | "INSUFFICIENT_EVIDENCE" | "PATH_PLANNING_FAILED" | "LEARNING_SUPPORT_REQUIRED" | "C_GENERATION_FAILED"
  message: string
  recommended_actions: Array<"return_home" | "change_goal" | "expand_knowledge_base" | "retry_retrieval" | "retry_planning" | "reprofile" | "regenerate_concept" | "regenerate_code_lab" | "regenerate_assessment" | "retry_provider">
  evidence_refs: string[]
  generation_failure?: RoleCGenerationFailure
}

export interface PublicWorkerLedgerEntry {
  worker: WorkerName
  status: "completed" | "waiting_for_user" | "running" | "blocked" | "failed" | "pending"
  summary: string
  updated_at: string
}

export interface LedgerRef {
  ref_id: string
  kind: "session" | "event" | "trace" | "artifact" | "evidence" | "review" | "assessment" | "file"
  source: "A" | "B" | "C" | "D" | "orchestrator" | "opencode"
  locator: string | null
  content_hash?: string
  visibility: "public" | "internal" | "secure"
  verified_exists: boolean
}

export interface WorkerLedgerHistoryEntry {
  schema_version: "1.0"
  entry_id: string
  run_id: string
  session_id: string
  round_no: number
  step_index: number
  attempt_no: number
  parent_entry_id: string | null
  orchestrator: "learning-orchestrator"
  unit_name: WorkerName | "learning-orchestrator" | "role-c-round"
  execution_type: "opencode_primary" | "opencode_subagent" | "deterministic_adapter" | "reviewed_pipeline" | "external_port" | "session_logic" | "manual" | "unknown"
  stage: InteractiveStage
  status: "invoked" | "running" | "waiting_for_user" | "completed" | "blocked" | "failed" | "skipped"
  started_at: string
  finished_at: string | null
  duration_ms: number | null
  input_refs: LedgerRef[]
  output_refs: LedgerRef[]
  evidence_refs: LedgerRef[]
  execution_ref: LedgerRef | null
  summary: string
  next_action: string | null
  decision_source: "worker_output" | "orchestrator" | "user" | "policy" | "unknown" | null
  errors: Array<{ code?: string; message: string; severity: "warning" | "recoverable" | "fatal"; source: string; details_ref?: LedgerRef }>
  retry: { eligible: boolean; scheduled: boolean; reason: string | null; next_attempt_no: number | null } | null
  manual_intervention: { occurred: boolean; kind: "user_input" | "operator_retry" | "operator_override" | "data_repair" | null; reason: string | null; occurred_at: string | null; evidence_ref: string | null }
  observability: { execution_observed: boolean; input_observed: boolean; output_observed: boolean; artifact_verified: boolean; evidence_level: "E0" | "E1" | "E2" | "E3"; source_event_ids: string[]; limitations: string[] }
}

export type ContentReviewWorkerStatus = "pending" | "reviewing" | "repairing" | "passed" | "failed" | "degraded" | "blocked"

export interface ContentReviewWorkerState {
  status: ContentReviewWorkerStatus
  published: boolean
  review_attempt_no: number
  repair_attempt_no: number
  last_error: string | null
  updated_at: string
}

export interface ContentReviewState {
  overall_status: ContentReviewWorkerStatus
  publish_allowed: boolean
  blocked_or_degraded: boolean
  round_no: number
  policy: "local-ab-content-review"
  workers: Record<"concept-tutor" | "code-lab" | "tiered-evaluator", ContentReviewWorkerState>
}

export type Day4NextRoundAction = "remediate" | "reinforce" | "advance" | "reprofile"

export interface Day4NextRoundActionState {
  action: Day4NextRoundAction
  round_no: number
  target_node_id: string | null
  feedback_id: string
  status: "generating_next_round" | "waiting_for_reprofile"
}

export interface InteractiveEvent {
  event_id: string
  event_type: "session_created" | "worker_completed" | "worker_invoked" | "waiting_for_user" | "command_received" | "session_updated" | "session_completed" | "session_blocked"
  stage: InteractiveStage
  worker?: WorkerName
  message: string
  timestamp: string
}

export interface PublicDiagnosisItem {
  item_id: string
  source_id: string
  fact_id: string | null
  concept: string
  difficulty: string
  question: string
  options?: string[]
}

export interface InteractiveSessionRecord {
  schema_version: "1.0"
  revision: number
  session_id: string
  run_id: string
  owner_id: string
  mode: OrchestrationMode
  learner_request: LearnerRequest
  status: InteractiveSessionStatus
  current_stage: InteractiveStage
  round_no: number
  waiting_for: null | {
    type: "profile_answers" | "diagnosis_answers" | "assessment_answers" | "clarification_answer"
    items: unknown[]
  }
  worker_ledger: PublicWorkerLedgerEntry[]
  /** Append-only worker execution history; worker_ledger remains the latest-state compatibility view. */
  worker_ledger_history: WorkerLedgerHistoryEntry[]
  /** Public Role C review lifecycle; artifacts are only published after review passes. */
  content_review: ContentReviewState | null
  profile: unknown | null
  /** 完整 LearnerProfileV2（背景/目标用途/偏好/约束/进度/溯源），publicSessionView 附加，供前端画像详情展示。 */
  profile_v2?: Record<string, unknown>
  formal_path: unknown | null
  current_path_node: unknown | null
  rag_result: unknown | null
  learning_resources: { concept_lesson: unknown | null; code_lab: unknown | null }
  assessment: unknown | null
  /** 本轮生成相对上一轮的适配信息（remediate/reinforce 时存在）。 */
  adaptation: unknown | null
  /** 三类资源各自 target/observed 难度与 fit 结论（Resource Fit Report）。 */
  resource_fit: ResourceFitReport | null
  /** Day4 多轮决策公开状态：测评后明确告诉 D/前端下一步动作，而不是让 UI 从 feedback 猜。 */
  next_round_action: Day4NextRoundActionState | null
  /** 最近一次代码实验或正式测评代码运行的公开摘要；不含隐藏测试、参考答案或私有套件。 */
  code_execution: unknown | null
  feedback: unknown | null
  blocked_reason: string | null
  /** 正式课程终态；临时生成/运行故障保持为 null。 */
  terminal_outcome: LearningTerminalOutcome | null
  events: InteractiveEvent[]
  processed_commands: Record<string, { request_hash: string; response: InteractiveSessionPublicView }>
  private: {
    diagnosis_answer_key: Record<string, string>
    diagnosis_answers: Record<string, string> | null
    diagnosis_items: PublicDiagnosisItem[]
    upstream_artifacts: Record<string, unknown>
    /** 评分后暂存给后台生成的下一轮上下文；生成完成即清空。 */
    next_round_context: NextRoundGenerationContext | null
    /** 全部已发布的纯公开题面历史；确定性防重使用全量，模型只接收最近 200 道。 */
    assessment_history: PriorAssessmentItem[]
    role_c_generation_attempt: number
    /** Consecutive artifact-generation failures in the current round; reset on publication. */
    role_c_failed_generations: number
    /** Private stage-local retry directive; cleared after a successful publication. */
    role_c_generation_recovery: GenerationRecoveryContext | null
    /** 画像纪元：初始 0，reprofile 重建画像时 +1，作为 profile_version 的一部分，
     *  使新画像的 mastery 状态不与旧画像累积串扰（旧画像 evidence 不污染新画像）。 */
    profile_epoch: number
    /** 当前节点内已发生的补救轮次计数（advance/reprofile 时清零）。 */
    node_remediate_rounds: number
    /** 当前节点内已发生的巩固强化轮次计数（advance/reprofile 时清零）。 */
    node_reinforce_rounds: number
    role_c: null | {
      data_directory: string
      session_id: string
      run_id: string
      /** GenerationSpec identity for parent/child round lineage. Missing on legacy sessions. */
      spec_id?: string
      learner_id: string
      form_id: string
      attempt_no: number
    }
  }
  created_at: string
  updated_at: string
}

export type InteractiveSessionPublicView = Omit<InteractiveSessionRecord, "revision" | "private" | "processed_commands" | "learner_request" | "owner_id" | "events"> & {
  events?: never
}

export interface CreateInteractiveSessionInput {
  session_id?: string
  run_id?: string
  mode: OrchestrationMode
  learner_request: LearnerRequest
  owner_id: string
}

export interface InteractiveSessionStoreOptions {
  diagnostic_question_author?: DiagnosticQuestionAuthorPort
  model_environment?: Record<string, string | undefined>
}

export const INTERACTIVE_SESSION_COMMAND_TYPES = [
  "submit_profile_answers",
  "submit_diagnosis_answers",
  "submit_assessment_answers",
  "debug_code_lab",
  "submit_code_lab",
  "run_code_lab",
  "run_assessment_code",
  "run_example_code",
  "retry",
] as const

export type InteractiveSessionCommandType = (typeof INTERACTIVE_SESSION_COMMAND_TYPES)[number]

export interface InteractiveSessionCommand {
  command_id: string
  type: InteractiveSessionCommandType
  payload?: {
    answers?: Record<string, string> | SubmissionAnswer[] | ProfileClarificationAnswer[]
    item_id?: string
    lab_id?: string
    code?: string
    gap_answers?: Record<string, string>
    public_case_id?: string
    custom_input?: unknown
  }
}

export class InteractiveSessionStore {
  private readonly commandQueues = new Map<string, Promise<unknown>>()
  private readonly createQueues = new Map<string, Promise<InteractiveSessionRecord>>()
  private readonly durableJobs: AtomicFileDurableJobStore
  private readonly jobRunner: DurableJobRunner

  constructor(
    readonly data_root: string,
    private readonly options: InteractiveSessionStoreOptions = {},
  ) {
    this.durableJobs = new AtomicFileDurableJobStore(join(data_root, "jobs"))
    this.jobRunner = new DurableJobRunner(this.durableJobs, {
      owner: `interactive-session-${process.pid}-${randomUUID()}`,
      max_in_flight: 2,
      lease_ms: 30_000,
    })
    this.jobRunner.register("initial_content_round", async (job) => {
      await this.generateInitialRoundInBackground(job.session_id)
    })
    this.jobRunner.register("diagnostic", async (job) => {
      await this.generateDiagnosisInBackground(job.session_id)
    })
    this.jobRunner.register("next_content_round", async (job) => {
      const record = await this.load(job.session_id)
      const context = record.private.next_round_context
      if (!context) throw new Error("NEXT_ROUND_CONTEXT_MISSING")
      await this.generateNextRoundInBackground(job.session_id, context)
    })
    this.jobRunner.register("artifact_revision", async (job) => {
      const record = await this.load(job.session_id)
      const recovery = record.private.role_c_generation_recovery ?? undefined
      if (record.private.next_round_context) {
        await this.generateNextRoundInBackground(job.session_id, record.private.next_round_context, recovery)
      } else if (!recovery && record.private.role_c) {
        await this.repairLegacyAssessmentInBackground(job.session_id)
      } else {
        await this.generateInitialRoundInBackground(job.session_id, recovery)
      }
    })
  }

  /** Starts the worker and recovers queued or lease-expired jobs from disk. */
  async ready(): Promise<void> {
    await this.jobRunner.start()
  }

  jobWorkerStatus(): { running: boolean } {
    return { running: this.jobRunner.isRunning() }
  }

  private async enqueueContentJob(kind: Extract<ModelWorkflowJobKind,
    "initial_content_round" | "next_content_round" | "artifact_revision">,
    record: InteractiveSessionRecord,
  ): Promise<void> {
    const identity = JSON.stringify({
      session_id: record.session_id,
      round_no: record.round_no,
      generation_attempt: record.private.role_c_generation_attempt,
      failed_generations: record.private.role_c_failed_generations,
      recovery_fingerprint: record.private.role_c_generation_recovery?.failure_fingerprint ?? null,
      next_request_id: record.private.next_round_context?.request_id ?? null,
      kind,
    })
    const jobId = `JOB-${createHash("sha256").update(identity).digest("hex").slice(0, 32)}`
    await this.jobRunner.enqueue(createModelWorkflowJob({
      job_id: jobId,
      session_id: record.session_id,
      run_id: record.run_id,
      kind,
      current_stage: kind === "initial_content_round" ? "initial_content" : "next_content",
      deadline_ms: ROLE_C_DURABLE_JOB_DEADLINE_MS,
      // Model/runtime retries and explicit user recovery own retry policy. The
      // durable job itself is replayed only after a crashed/expired lease.
      max_attempts: 1,
      policy_snapshot: { policy_version: "glm52-policy-v1", profile: "mixed" },
      budget_snapshot: {
        max_model_calls: ROLE_C_CONTENT_MODEL_CALL_BUDGET,
        max_transport_retries: 3,
      },
      checkpoint_refs: [join(this.data_root, "role-c", "generation-checkpoints")],
    }))
  }

  private diagnosticQuestionAuthor(): DiagnosticQuestionAuthorPort {
    return this.options.diagnostic_question_author
      ?? new ModelDiagnosticQuestionAuthor(createRoleCModelGatewayFromEnv(
        this.options.model_environment ?? process.env,
      ))
  }

  async create(input: CreateInteractiveSessionInput): Promise<InteractiveSessionRecord> {
    const sessionId = safeId(input.session_id ?? `SESSION-${randomUUID()}`)
    const existingCreate = this.createQueues.get(sessionId)
    if (existingCreate) {
      await existingCreate.catch(() => undefined)
      throw new InteractiveSessionError("SESSION_ALREADY_EXISTS", `Session ${sessionId} already exists`, 409)
    }
    const operation = this.withSessionLock(sessionId, () => this.createUnlocked({ ...input, session_id: sessionId }))
    this.createQueues.set(sessionId, operation)
    try {
      return await operation
    } finally {
      if (this.createQueues.get(sessionId) === operation) this.createQueues.delete(sessionId)
    }
  }

  /** HTTP-facing creation: persist the session first and let the durable worker author diagnosis. */
  async createQueued(input: CreateInteractiveSessionInput): Promise<InteractiveSessionRecord> {
    const sessionId = safeId(input.session_id ?? `SESSION-${randomUUID()}`)
    const operation = this.withSessionLock(sessionId, async () => {
      const record = await this.buildSessionShell({ ...input, session_id: sessionId }, true)
      await this.save(record, null)
      if (record.waiting_for?.type === "profile_answers") return record
      await this.jobRunner.enqueue(createModelWorkflowJob({
        job_id: `JOB-${createHash("sha256").update(`${sessionId}:diagnostic`).digest("hex").slice(0, 32)}`,
        session_id: sessionId,
        run_id: record.run_id,
        kind: "diagnostic",
        current_stage: "diagnosis",
        deadline_ms: 3 * 60_000,
        max_attempts: 1,
        policy_snapshot: { policy_version: "glm52-policy-v1", profile: "fast" },
        budget_snapshot: { max_model_calls: 4, max_transport_retries: 2 },
      }))
      return record
    })
    return operation
  }

  private async createUnlocked(input: CreateInteractiveSessionInput): Promise<InteractiveSessionRecord> {
    const sessionId = safeId(input.session_id!)
    const existing = await this.loadOptional(sessionId)
    if (existing) throw new InteractiveSessionError("SESSION_ALREADY_EXISTS", `Session ${sessionId} already exists`, 409)
    const record = await this.buildSessionShell(input, false)
    if (record.waiting_for?.type !== "profile_answers") await this.populateDiagnosis(record)
    await this.save(record, null)
    return record
  }

  private async buildSessionShell(
    input: CreateInteractiveSessionInput,
    queued: boolean,
  ): Promise<InteractiveSessionRecord> {
    const sessionId = safeId(input.session_id!)
    const existing = await this.loadOptional(sessionId)
    if (existing) throw new InteractiveSessionError("SESSION_ALREADY_EXISTS", `Session ${sessionId} already exists`, 409)
    const now = new Date().toISOString()
    const runId = safeId(input.run_id ?? `RUN-${randomUUID()}`)
    const learnerId = input.learner_request.learner_id ?? sessionId
    const learnerMemory = await loadLearnerMemory(this.data_root, learnerId)
    const events: InteractiveEvent[] = [
      event(sessionId, "session_created", "objective_diagnosis", "learning-orchestrator created a persistent session", now),
      event(sessionId, "worker_completed", "objective_diagnosis", "background-collector accepted learner background", now, "background-collector"),
      event(sessionId, "worker_completed", "objective_diagnosis", "self-assessor accepted learner self assessment", now, "self-assessor"),
      ...(queued
        ? [event(sessionId, "worker_invoked", "objective_diagnosis", "正在准备客观诊断题", now, "objective-diagnostician")]
        : []),
    ]
    const record: InteractiveSessionRecord = {
      schema_version: "1.0",
      revision: 0,
      session_id: sessionId,
      run_id: runId,
      owner_id: input.owner_id,
      mode: input.mode,
      learner_request: structuredClone(input.learner_request),
      status: queued ? "running" : "waiting_for_user",
      current_stage: "objective_diagnosis",
      round_no: 1,
      waiting_for: null,
      worker_ledger: [
        { worker: "background-collector", status: "completed", summary: "已收集学习背景", updated_at: now },
        { worker: "self-assessor", status: "completed", summary: "已收集学习者自评", updated_at: now },
        ...(queued
          ? [{ worker: "objective-diagnostician" as const, status: "running" as const, summary: "正在准备客观诊断题", updated_at: now }]
          : []),
      ],
      worker_ledger_history: [
        createWorkerLedgerHistoryEntry(sessionId, runId, 1, 1, 1, "background-collector", "completed", "已收集学习背景", "objective_diagnosis", now, now, "session_logic", false, [], ["background-collector:session-input"]),
        createWorkerLedgerHistoryEntry(sessionId, runId, 1, 2, 1, "self-assessor", "completed", "已收集学习者自评", "objective_diagnosis", now, now, "session_logic", false, ["background-collector:session-input"], ["self-assessor:session-input"]),
        ...(queued
          ? [createWorkerLedgerHistoryEntry(sessionId, runId, 1, 3, 1, "objective-diagnostician", "running", "正在准备客观诊断题", "objective_diagnosis", now, null, "session_logic", false, ["background-collector:session-input", "self-assessor:session-input"], [])]
          : []),
      ],
      content_review: null,
      profile: null,
      formal_path: null,
      current_path_node: null,
      rag_result: null,
      learning_resources: { concept_lesson: null, code_lab: null },
      assessment: null,
      adaptation: null,
      resource_fit: null,
      next_round_action: null,
      feedback: null,
      blocked_reason: null,
      terminal_outcome: null,
      events,
      processed_commands: {},
      private: {
        diagnosis_answer_key: {},
        diagnosis_answers: null,
        diagnosis_items: [],
        upstream_artifacts: {},
        next_round_context: null,
        assessment_history: structuredClone(learnerMemory.recent_assessment_items ?? []),
        role_c_generation_attempt: 0,
        role_c_failed_generations: 0,
        role_c_generation_recovery: null,
        profile_epoch: 0,
        node_remediate_rounds: 0,
        node_reinforce_rounds: 0,
        role_c: null,
      },
      code_execution: null,
      created_at: now,
      updated_at: now,
    }
    const intake = record.learner_request.profile_intake
    if (intake) {
      const assessment = assessProfileIntake(intake)
      if (assessment.status === "needs_clarification") {
        record.status = "waiting_for_user"
        record.waiting_for = { type: "profile_answers", items: assessment.questions }
        record.worker_ledger = [
          { worker: "background-collector", status: "waiting_for_user", summary: "等待补充结构化画像", updated_at: now },
          { worker: "self-assessor", status: "pending", summary: "等待画像采集完成", updated_at: now },
        ]
        record.worker_ledger_history = [
          createWorkerLedgerHistoryEntry(sessionId, runId, 1, 1, 1, "background-collector", "waiting_for_user", "等待补充结构化画像", "objective_diagnosis", now, null, "session_logic", true, [], []),
        ]
        record.events = [
          event(sessionId, "session_created", "objective_diagnosis", "learning-orchestrator created a persistent session", now),
          event(sessionId, "waiting_for_user", "objective_diagnosis", "waiting for structured profile answers", now, "background-collector"),
        ]
      }
    }
    return record
  }

  private async populateDiagnosis(record: InteractiveSessionRecord): Promise<void> {
    const knowledgeBase = await loadKnowledgeBase()
    const goalSpec = resolveLearningGoalSpec(record.learner_request.learning_goal_spec ?? {
      mode: "custom_goal",
      custom_goal: record.learner_request.goal,
    })
    const learnerId = record.learner_request.learner_id ?? record.session_id
    const learnerMemory = await loadLearnerMemory(this.data_root, learnerId)
    const targetItems = knowledgeBase.items.filter((item) => goalSpec.mapped_source_ids.includes(item.sourceId))
    const targets = selectDiagnosticEvidenceTargets({
      knowledgeBase,
      target_source_ids: goalSpec.mapped_source_ids,
      prerequisite_source_ids: [...new Set(targetItems.flatMap((item) => item.prerequisites))],
      learner_memory: learnerMemory,
      max_items: 5,
    })
    let diagnosis: Awaited<ReturnType<typeof authorDiagnosisForm>>
    try {
      diagnosis = await authorDiagnosisForm(
        this.diagnosticQuestionAuthor(),
        record.session_id,
        record.learner_request.goal,
        targets,
        learnerMemory.recent_assessment_items ?? [],
      )
    } catch (error) {
      throw new InteractiveSessionError(
        "DIAGNOSTIC_GENERATION_FAILED",
        error instanceof Error ? error.message : "AI 诊断题生成失败",
        503,
      )
    }
    const diagnosisItems = diagnosis.items
    const answerKey = diagnosis.answerKey
    const now = new Date().toISOString()
    record.status = "waiting_for_user"
    record.current_stage = "objective_diagnosis"
    record.waiting_for = { type: "diagnosis_answers", items: diagnosisItems }
    record.worker_ledger = [
      { worker: "background-collector", status: "completed", summary: "已收集学习背景", updated_at: now },
      { worker: "self-assessor", status: "completed", summary: "已收集学习者自评", updated_at: now },
      { worker: "objective-diagnostician", status: "waiting_for_user", summary: "等待诊断作答", updated_at: now },
    ]
    record.worker_ledger_history = [
      ...record.worker_ledger_history.filter((entry) => entry.unit_name !== "objective-diagnostician"),
      createWorkerLedgerHistoryEntry(record.session_id, record.run_id, 1, 3, 1, "objective-diagnostician", "waiting_for_user", "等待诊断作答", "objective_diagnosis", now, null, "session_logic", true, ["background-collector:session-input", "self-assessor:session-input"], ["objective-diagnostician:diagnosis-form"]),
    ]
    record.private.diagnosis_answer_key = answerKey
    record.private.diagnosis_items = diagnosisItems
    record.private.assessment_history = mergeAssessmentHistory(learnerMemory.recent_assessment_items ?? [], diagnosis.history)
    record.events.push(event(record.session_id, "worker_invoked", "objective_diagnosis", "objective-diagnostician prepared grounded questions", now, "objective-diagnostician"))
    record.events.push(event(record.session_id, "waiting_for_user", "objective_diagnosis", "waiting for diagnosis answers", now, "objective-diagnostician"))
    record.updated_at = now
    await saveLearnerMemory(this.data_root, {
      ...learnerMemory,
      recent_assessment_items: record.private.assessment_history,
      updated_at: now,
    })
  }

  private async generateDiagnosisInBackground(sessionId: string): Promise<void> {
    await this.withSessionLock(sessionId, async () => {
      const record = await this.load(sessionId)
      if (record.status !== "running" || record.private.diagnosis_items.length > 0) return
      try {
        await this.populateDiagnosis(record)
      } catch (error) {
        applyDiagnosticGenerationFailure(record, error)
      }
      await this.save(record)
    })
  }

  async load(sessionId: string): Promise<InteractiveSessionRecord> {
    const record = await this.loadOptional(safeId(sessionId))
    if (!record) throw new InteractiveSessionError("SESSION_NOT_FOUND", `Session ${sessionId} was not found`, 404)
    return record
  }

  /** 已有旧会话若含 short_answer 或学习资源目标与当前B节点不一致，后台按当前节点重新生成。 */
  async repairLegacyAssessment(sessionId: string): Promise<InteractiveSessionPublicView> {
    const safeSessionId = safeId(sessionId)
    return this.withSessionLock(safeSessionId, async () => {
      const record = await this.load(safeSessionId)
      const staleResources = learningResourcesTargetOtherNode(record)
      if ((!assessmentHasShortAnswer(record.assessment) && !staleResources)
        || record.status !== "waiting_for_user"
        || !record.profile || !record.formal_path || !record.current_path_node || !record.rag_result) {
        return publicSessionView(record)
      }
      record.status = "running"
      record.current_stage = "assessment"
      record.waiting_for = null
      record.blocked_reason = null
      record.private.role_c_generation_attempt = (record.private.role_c_generation_attempt ?? 0) + 1
      record.updated_at = new Date().toISOString()
      record.events.push(event(record.session_id, "session_updated", "assessment", staleResources ? "学习资源与当前节点不一致，正在通过C按当前节点重新生成" : "旧测评含简答题，正在通过C重新生成代码题", record.updated_at, "tiered-evaluator"))
      const response = publicSessionView(record)
      await this.save(record)
      await this.enqueueContentJob("artifact_revision", record)
      return response
    })
  }

  private async repairLegacyAssessmentInBackground(sessionId: string): Promise<void> {
    try {
      const record = structuredClone(await this.load(sessionId))
      const path = record.formal_path as FormalLearningPath
      const node = record.current_path_node as LearningPathNode
      const canonicalNode = bindPathNodeFactsForRoleC(node, record.rag_result as RagResult)
      const next = await generateFormalRoleCRound(record, path, canonicalNode, this.data_root)
      const current = await this.load(sessionId)
      if (current.status !== "running" || current.round_no !== record.round_no) return
      if (!next.ok) {
        applyRoleCGenerationFailure(current, next)
        current.updated_at = new Date().toISOString()
        await this.save(current)
        return
      }
      await applyFormalRoleCRound(current, next, this.data_root)
      current.updated_at = new Date().toISOString()
      await this.save(current)
    } catch (error) {
      const current = await this.loadOptional(sessionId)
      if (!current || current.status !== "running") return
      current.status = "blocked"
      current.current_stage = "blocked"
      current.blocked_reason = error instanceof Error ? error.message : "旧测评格式修复失败"
      current.updated_at = new Date().toISOString()
      await this.save(current)
    }
  }

  async command(sessionId: string, command: InteractiveSessionCommand): Promise<InteractiveSessionPublicView> {
    const safeSessionId = safeId(sessionId)
    const previous = this.commandQueues.get(safeSessionId) ?? Promise.resolve()
    const operation = previous.catch(() => undefined).then(() => this.withSessionLock(safeSessionId, () => this.executeCommand(safeSessionId, command)))
    this.commandQueues.set(safeSessionId, operation)
    try {
      return await operation
    } finally {
      if (this.commandQueues.get(safeSessionId) === operation) this.commandQueues.delete(safeSessionId)
    }
  }

  private async executeCommand(sessionId: string, command: InteractiveSessionCommand): Promise<InteractiveSessionPublicView> {
    validateCommand(command)
    const record = await this.load(sessionId)
    const requestHash = hashJson(command)
    const replay = record.processed_commands[command.command_id]
    if (replay) {
      if (replay.request_hash !== requestHash) {
        throw new InteractiveSessionError("COMMAND_ID_REUSED", "command_id was already used with different content", 409)
      }
      return structuredClone(replay.response)
    }

    let updated: InteractiveSessionRecord
    if (command.type === "submit_profile_answers") {
      if (record.status !== "waiting_for_user" || record.waiting_for?.type !== "profile_answers") {
        throw new InteractiveSessionError("COMMAND_NOT_ALLOWED", "This session is not waiting for profile answers", 409)
      }
      const answers = command.payload?.answers
      if (!Array.isArray(answers) || answers.length === 0) {
        throw new InteractiveSessionError("INVALID_COMMAND", "submit_profile_answers requires a non-empty answers array", 400)
      }
      const asked = new Set((record.waiting_for.items as Array<{ id?: unknown }>)
        .flatMap((item) => typeof item?.id === "string" ? [item.id] : []))
      let intake = record.learner_request.profile_intake
      if (!intake) throw new InteractiveSessionError("PROFILE_INTAKE_MISSING", "Structured profile intake is missing", 409)
      for (const candidate of answers) {
        if (!candidate || typeof candidate !== "object" || !("question_id" in candidate) || !("value" in candidate)) {
          throw new InteractiveSessionError("INVALID_COMMAND", "Each profile answer requires question_id and value", 400)
        }
        const answer = candidate as ProfileClarificationAnswer
        if (!asked.has(answer.question_id)) {
          throw new InteractiveSessionError("INVALID_COMMAND", `Profile question was not requested: ${answer.question_id}`, 400)
        }
        intake = applyProfileClarificationAnswer(intake, answer)
      }
      if (intake.learner_id !== record.learner_request.learner_id
        || intake.goal?.trim() !== record.learner_request.goal.trim()) {
        throw new InteractiveSessionError("PROFILE_INTAKE_IDENTITY_MISMATCH", "Profile answers cannot change learner or learning goal", 400)
      }
      record.learner_request.profile_intake = intake
      const assessment = assessProfileIntake(intake)
      const now = new Date().toISOString()
      record.events.push(event(record.session_id, "command_received", "objective_diagnosis", "received structured profile answers", now, "background-collector"))
      if (assessment.status === "needs_clarification") {
        record.waiting_for = { type: "profile_answers", items: assessment.questions }
        record.status = "waiting_for_user"
        record.updated_at = now
        updated = record
      } else {
        record.status = "running"
        record.waiting_for = null
        record.worker_ledger = [
          { worker: "background-collector", status: "completed", summary: "已收集结构化学习背景", updated_at: now },
          { worker: "self-assessor", status: "completed", summary: "已收集学习者自评与偏好", updated_at: now },
          { worker: "objective-diagnostician", status: "running", summary: "正在准备客观诊断题", updated_at: now },
        ]
        await this.populateDiagnosis(record)
        updated = record
      }
    } else if (command.type === "submit_diagnosis_answers") {
      if (record.status !== "waiting_for_user" || record.waiting_for?.type !== "diagnosis_answers") {
        throw new InteractiveSessionError("COMMAND_NOT_ALLOWED", "This session is not waiting for diagnosis answers", 409)
      }
      updated = await continueAfterDiagnosis(record, command, this.data_root)
      if (updated.status === "running" && updated.profile && updated.formal_path && updated.current_path_node) {
        const response = publicSessionView(updated)
        updated.processed_commands[command.command_id] = { request_hash: requestHash, response }
        await this.save(updated)
        await this.enqueueContentJob("initial_content_round", updated)
        return response
      }
    } else if (command.type === "debug_code_lab") {
      if (record.status !== "waiting_for_user" || record.waiting_for?.type !== "assessment_answers") {
        throw new InteractiveSessionError("COMMAND_NOT_ALLOWED", "This session does not have a published code lab", 409)
      }
      const labId = command.payload?.lab_id
      const code = command.payload?.code
      const gapAnswers = command.payload?.gap_answers
      const roleC = record.private.role_c
      if (!roleC || !labId || (!code && !gapAnswers)) throw new InteractiveSessionError("INVALID_COMMAND", "debug_code_lab requires lab_id and a matching submission", 400)
      record.code_execution = await debugRoleCCodeLab({
        executionId: `DEBUG-${record.session_id}-${command.command_id}`, sessionId: roleC.session_id,
        runId: roleC.run_id, learnerId: roleC.learner_id, labId,
        ...(code ? { code } : {}), ...(gapAnswers ? { gapAnswers } : {}),
        ...(command.payload?.public_case_id ? { publicCaseId: command.payload.public_case_id } : {}),
        ...(command.payload?.custom_input !== undefined ? { customInput: command.payload.custom_input } : {}),
      }, roleCRuntime(this.data_root))
      record.updated_at = new Date().toISOString()
      updated = record
    } else if (command.type === "run_code_lab" || command.type === "submit_code_lab") {
      if (record.status !== "waiting_for_user" || record.waiting_for?.type !== "assessment_answers") {
        throw new InteractiveSessionError("COMMAND_NOT_ALLOWED", "This session does not have a published code lab", 409)
      }
      const labId = command.payload?.lab_id
      const code = command.payload?.code
      const gapAnswers = command.payload?.gap_answers
      const roleC = record.private.role_c
      if (!roleC || !labId || (!code && !gapAnswers)) throw new InteractiveSessionError("INVALID_COMMAND", "run_code_lab requires lab_id and a matching submission", 400)
      const result = await runRoleCCodeLab({ executionId: `EXEC-${record.session_id}-${command.command_id}`, sessionId: roleC.session_id, runId: roleC.run_id, learnerId: roleC.learner_id, labId, ...(code ? { code } : {}), ...(gapAnswers ? { gapAnswers } : {}) }, roleCRuntime(this.data_root))
      record.code_execution = result
      record.updated_at = new Date().toISOString()
      updated = record
    } else if (command.type === "run_assessment_code") {
      if (record.status !== "waiting_for_user" || record.waiting_for?.type !== "assessment_answers") {
        throw new InteractiveSessionError("COMMAND_NOT_ALLOWED", "This session is not waiting for assessment code", 409)
      }
      const itemId = command.payload?.item_id
      const code = command.payload?.code
      const roleC = record.private.role_c
      if (!roleC || !itemId || !code) throw new InteractiveSessionError("INVALID_COMMAND", "run_assessment_code requires item_id and code", 400)
      const result = await runRoleCAssessmentCode({ executionId: `EXEC-${record.session_id}-${command.command_id}`, sessionId: roleC.session_id, runId: roleC.run_id, learnerId: roleC.learner_id, itemId, code }, roleCRuntime(this.data_root))
      record.code_execution = result
      record.updated_at = new Date().toISOString()
      updated = record
    } else if (command.type === "run_example_code") {
      // 分步示例/讲义示例独立运行：Docker 真实执行，返回 stdout（不判分、不依赖 C 会话）
      const code = command.payload?.code
      if (typeof code !== "string" || code.trim().length === 0) {
        throw new InteractiveSessionError("INVALID_COMMAND", "run_example_code requires code", 400)
      }
      const result = await runRoleCExampleCode({
        executionId: `EXEC-${record.session_id}-${command.command_id}`,
        sessionId: record.session_id,
        runId: `RUN-${command.command_id}`,
        learnerId: record.learner_request.learner_id ?? record.session_id,
        code,
      }, roleCRuntime(this.data_root))
      record.code_execution = result
      record.updated_at = new Date().toISOString()
      updated = record
    } else if (command.type === "submit_assessment_answers") {
      if (record.status !== "waiting_for_user" || record.waiting_for?.type !== "assessment_answers") {
        throw new InteractiveSessionError("COMMAND_NOT_ALLOWED", "This session is not waiting for assessment answers", 409)
      }
      updated = await continueAfterAssessment(
        record,
        command,
        this.data_root,
        this.diagnosticQuestionAuthor(),
      )
      // 评分已返回；下一轮内容后台生成，完成后写回会话（前端轮询状态）。
      if (updated.status === "running" && updated.private.next_round_context) {
        // 先由本方法保存 running 检查点，再启动后台任务，避免后台读取到旧快照。
        const response = publicSessionView(updated)
        updated.processed_commands[command.command_id] = { request_hash: requestHash, response }
        await this.save(updated)
        await this.enqueueContentJob("next_content_round", updated)
        return response
      }
    } else {
      if (record.blocked_reason?.startsWith("DIAGNOSTIC_GENERATION_FAILED:")) {
        try {
          updated = await resetToDiagnosisPhase(
            record,
            this.data_root,
            this.diagnosticQuestionAuthor(),
          )
        } catch (error) {
          applyDiagnosticGenerationFailure(record, error)
          updated = record
        }
        const response = publicSessionView(updated)
        updated.processed_commands[command.command_id] = { request_hash: requestHash, response }
        await this.save(updated)
        return response
      }
      const generationFailure = record.terminal_outcome?.generation_failure
      if (record.terminal_outcome?.kind === "content_generation_failed"
        && generationFailure?.canRetry
        && record.profile && record.formal_path && record.current_path_node) {
        // Every explicit recovery is a new generation attempt. This changes
        // both the Role C run identity and durable job identity, so a prior
        // completed/failed artifact_revision job cannot swallow a later retry.
        record.private.role_c_generation_attempt = (record.private.role_c_generation_attempt ?? 0) + 1
        record.status = "running"
        record.current_stage = "assessment"
        record.waiting_for = null
        record.blocked_reason = null
        record.terminal_outcome = null
        const recovery = generationRecoveryContext(
          generationFailure,
          record.private.role_c_generation_attempt,
        )
        record.private.role_c_generation_recovery = recovery
        const startedAt = new Date().toISOString()
        const recoveryWorker = workerForRoleCFailure(generationFailure)
        const recoveryAttemptNo = nextWorkerAttemptNo(record, recoveryWorker, record.round_no)
        upsertLedger(record, recoveryWorker, "running", `${generationFailure.nextAction} 已开始`, {
          startedAt,
          attemptNo: recoveryAttemptNo,
          executionType: "reviewed_pipeline",
        })
        record.events.push(event(record.session_id, "session_updated", "assessment", `${generationFailure.nextAction} started`, startedAt, workerForRoleCFailure(generationFailure)))
        record.updated_at = startedAt
        const response = publicSessionView(record)
        record.processed_commands[command.command_id] = { request_hash: requestHash, response }
        await this.save(record)
        if (record.private.next_round_context) {
          await this.enqueueContentJob("artifact_revision", record)
        } else {
          await this.enqueueContentJob("artifact_revision", record)
        }
        return response
      }
      if (record.terminal_outcome?.kind === "content_generation_failed"
        && generationFailure && !generationFailure.canRetry) {
        throw new InteractiveSessionError(
          "C_RECOVERY_EXHAUSTED",
          "当前生成策略未能产生有效内容，请调整学习目标后重新开始",
          409,
        )
      }
      const resumableNextRound = Boolean(record.private.next_round_context && record.formal_path && record.current_path_node)
      // running 会话的后台生成进程可能随服务重启中断（nrc 为 null 但 checkpoint 完整）：
      // 允许这类会话进入 retryInteractiveSession，由其按当前节点重新生成或恢复等待。
      const resumeableCheckpoint = Boolean(record.private.role_c && record.assessment && record.current_path_node && record.formal_path)
      if (record.status !== "blocked" && record.status !== "failed" && !(record.status === "running" && (resumableNextRound || resumeableCheckpoint))) {
        throw new InteractiveSessionError("COMMAND_NOT_ALLOWED", "This session is not blocked and cannot be retried", 409)
      }
      if (resumableNextRound) {
        record.status = "running"
        record.current_stage = "assessment"
        record.waiting_for = null
        record.blocked_reason = null
        record.private.role_c_generation_attempt = (record.private.role_c_generation_attempt ?? 0) + 1
        record.updated_at = new Date().toISOString()
        record.events.push(event(record.session_id, "session_updated", "assessment", `round ${record.round_no} generation resumed from persisted feedback`, record.updated_at, "tiered-evaluator"))
        const response = publicSessionView(record)
        record.processed_commands[command.command_id] = { request_hash: requestHash, response }
        await this.save(record)
        // 持久化上下文可能携带上一轮节点目标（advance 旧缺陷）：C 合同要求
        // focus 非空、不重复且属于当前 GenerationSpec，先对齐到当前节点目标再生成。
        const node = record.current_path_node as LearningPathNode | null
        const nodeObjectiveIds = (node?.objectives ?? [])
          .map((objective) => objective.objective_id)
          .filter((objectiveId): objectiveId is string => Boolean(objectiveId))
        const persistedContext = record.private.next_round_context!
        const persistedFocus = Array.isArray(persistedContext.focus_objective_ids)
          ? persistedContext.focus_objective_ids
          : []
        const focusMatchesCurrentNode = persistedFocus.length > 0
          && persistedFocus.every((objectiveId: string) => nodeObjectiveIds.includes(objectiveId))
        const retryContext = focusMatchesCurrentNode
          ? persistedContext
          : { ...persistedContext, focus_objective_ids: nodeObjectiveIds }
        record.private.next_round_context = retryContext
        await this.save(record)
        await this.enqueueContentJob("next_content_round", record)
        return response
      }
      updated = await retryInteractiveSession(record, this.data_root)
    }

    const response = publicSessionView(updated)
    updated.processed_commands[command.command_id] = { request_hash: requestHash, response }
    await this.save(updated)
    return response
  }

  async save(record: InteractiveSessionRecord, expectedRevision: number | null = record.revision): Promise<void> {
    const dir = join(this.data_root, "sessions")
    await ensureUsableDataDirectory(dir, "sessions")
    const path = join(dir, `${safeId(record.session_id)}.json`)
    let current: InteractiveSessionRecord | null = null
    try {
      current = normalizeSessionRecord(JSON.parse(await readFile(path, "utf8")) as InteractiveSessionRecord)
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error
    }
    if (expectedRevision === null) {
      if (current || record.revision !== 0) {
        throw new InteractiveSessionError("SESSION_REVISION_CONFLICT", `Session ${record.session_id} creation revision conflict`, 409)
      }
    } else if (!current || current.revision !== expectedRevision || record.revision !== expectedRevision) {
      throw new InteractiveSessionError("SESSION_REVISION_CONFLICT", `Session ${record.session_id} revision conflict`, 409)
    }
    const persisted = structuredClone(record)
    if (expectedRevision !== null) persisted.revision = expectedRevision + 1
    const temporary = `${path}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, `${JSON.stringify(persisted, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      })
      await rename(temporary, path)
      await chmod(path, 0o600).catch(() => undefined)
      record.revision = persisted.revision
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined)
      throw error
    }
  }

  /**
   * 后台生成下一轮内容（不占命令锁）。生成中会话为 running 状态，
   * 其他命令会被拒绝；完成后写回 round 2 内容与 adaptation。
   */
  private async generateNextRoundInBackground(
    sessionId: string,
    nextRoundContext: NextRoundGenerationContext,
    generationRecovery?: GenerationRecoveryContext,
  ): Promise<void> {
    try {
      const current = await this.load(sessionId)
      const record = structuredClone(current)
      const path = record.formal_path as FormalLearningPath | null
      const node = record.current_path_node as LearningPathNode | null
      if (!path || !node) throw new Error("next round generation missing path or node")
      const canonicalNode = record.rag_result ? bindPathNodeFactsForRoleC(node, record.rag_result as RagResult) : node
      const next = await generateFormalRoleCRound(
        record,
        path,
        canonicalNode,
        this.data_root,
        nextRoundContext,
        generationRecovery ?? record.private.role_c_generation_recovery ?? undefined,
      )
      // 乐观检查：保存前确认会话仍是"生成中"且轮次未被推进，避免覆盖并发写入。
      const currentBeforeSave = await this.load(sessionId)
      if (currentBeforeSave.status !== "running"
        || currentBeforeSave.round_no !== record.round_no) {
        return
      }
      if (!next.ok) {
        applyRoleCGenerationFailure(record, next)
        record.events.push(event(record.session_id, "session_blocked", "blocked", next.reason, new Date().toISOString()))
        record.updated_at = new Date().toISOString()
        await this.save(record)
        return
      }
      await applyFormalRoleCRound(record, next, this.data_root)
      record.private.next_round_context = null
      record.updated_at = new Date().toISOString()
      record.events.push(event(
        record.session_id,
        "waiting_for_user",
        "assessment",
        `round ${record.round_no} waiting for assessment answers`,
        record.updated_at,
        "tiered-evaluator",
      ))
      await this.save(record)
    } catch (error) {
      try {
        const current = await this.load(sessionId)
        if (current.status !== "running") return
        applyUnexpectedRoleCGenerationFailure(current, error, "next round generation failed")
        current.updated_at = new Date().toISOString()
        await this.save(current)
      } catch { /* 后台失败时不再二次写入 */ }
    }
  }

  private async generateInitialRoundInBackground(
    sessionId: string,
    generationRecovery?: GenerationRecoveryContext,
  ): Promise<void> {
    try {
      const current = await this.load(sessionId)
      if (current.status !== "running" || current.private.role_c) return
      const record = structuredClone(current)
      const path = record.formal_path as FormalLearningPath | null
      const node = record.current_path_node as LearningPathNode | null
      if (!path || !node) throw new Error("initial Role C generation missing path or node")
      const next = await generateFormalRoleCRound(
        record,
        path,
        node,
        this.data_root,
        undefined,
        generationRecovery ?? record.private.role_c_generation_recovery ?? undefined,
      )
      const currentBeforeSave = await this.load(sessionId)
      if (currentBeforeSave.status !== "running"
        || currentBeforeSave.round_no !== record.round_no
        || currentBeforeSave.private.role_c) return
      if (!next.ok) {
        applyRoleCGenerationFailure(record, next)
        record.events.push(event(record.session_id, "session_blocked", "blocked", next.reason, new Date().toISOString(), workerForRoleCFailure(next.failure)))
        record.updated_at = new Date().toISOString()
        await this.save(record)
        return
      }
      await applyFormalRoleCRound(record, next, this.data_root)
      markReviewedRoleCWorkers(record)
      record.updated_at = new Date().toISOString()
      record.events.push(event(record.session_id, "waiting_for_user", "assessment", "waiting for assessment answers", record.updated_at, "tiered-evaluator"))
      await this.save(record)
    } catch (error) {
      try {
        const current = await this.load(sessionId)
        if (current.status !== "running") return
        applyUnexpectedRoleCGenerationFailure(current, error, "initial Role C generation failed")
        current.updated_at = new Date().toISOString()
        await this.save(current)
      } catch { /* 后台失败时不再二次写入 */ }
    }
  }

  private async withSessionLock<T>(sessionId: string, action: () => Promise<T>): Promise<T> {
    const lockDirectory = join(this.data_root, "locks")
    await ensureUsableLockDirectory(lockDirectory)
    const lockPath = join(lockDirectory, `${safeId(sessionId)}.lock`)
    const ownerToken = randomUUID()
    let handle: Awaited<ReturnType<typeof open>> | undefined
    for (let attempt = 0; attempt < 200; attempt += 1) {
      try {
        handle = await open(lockPath, "wx")
        const now = Date.now()
        await handle.writeFile(JSON.stringify({ owner_token: ownerToken, pid: process.pid, acquired_at: now, heartbeat_at: now }))
        break
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error
        const stale = await staleLockIdentity(lockPath)
        if (stale) {
          await removeStaleLock(lockPath, stale)
          continue
        }
        await Bun.sleep(10)
      }
    }
    if (!handle) throw new InteractiveSessionError("SESSION_BUSY", `Session ${sessionId} is busy`, 409)
    // The lock's authority is the owner token stored in the file, not an open
    // descriptor. Close it before heartbeat replacement so Windows permits the
    // atomic rename of the refreshed lock file.
    await handle.close()
    handle = undefined
    let heartbeatPromise: Promise<void> | null = null
    const heartbeat = setInterval(() => {
      if (heartbeatPromise) return
      heartbeatPromise = refreshOwnedLock(lockPath, ownerToken)
        .catch(() => undefined)
        .finally(() => { heartbeatPromise = null })
    }, Math.min(500, Math.max(100, Math.floor(STALE_LOCK_MS / 3))))
    try {
      return await action()
    } finally {
      clearInterval(heartbeat)
      // A heartbeat may already have passed its final ownership check and be
      // about to rename its temporary file. Releasing first would allow that
      // rename to recreate a ghost lock after the command completed.
      await heartbeatPromise
      await releaseOwnedLock(lockPath, ownerToken)
    }
  }

  private async loadOptional(sessionId: string): Promise<InteractiveSessionRecord | null> {
    try {
      const parsed = JSON.parse(await readFile(join(this.data_root, "sessions", `${sessionId}.json`), "utf8")) as InteractiveSessionRecord
      return normalizeSessionRecord(parsed)
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null
      throw error
    }
  }
}

interface LockIdentity {
  owner_token?: string
  heartbeat_at?: number
  mtime_ms?: number
}

async function ensureUsableLockDirectory(lockDirectory: string): Promise<void> {
  await ensureUsableDataDirectory(lockDirectory, "locks")
}

async function ensureUsableDataDirectory(directory: string, label: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await chmod(directory, 0o700).catch(() => undefined)
  const probePath = join(directory, `.probe-${process.pid}-${randomUUID()}.tmp`)
  try {
    const probe = await open(probePath, "wx")
    await probe.close()
    await rm(probePath, { force: true })
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code) : ""
    if (code !== "EACCES" && code !== "EPERM") throw error
    const brokenPath = `${directory}.broken-${label}-${Date.now()}-${randomUUID().slice(0, 8)}`
    try {
      await rename(directory, brokenPath)
    } catch {
      await rm(directory, { recursive: true, force: true })
    }
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await chmod(directory, 0o700).catch(() => undefined)
  }
}

/** 锁文件是否陈旧：使用 owner heartbeat；老格式回退到 mtime。 */
async function staleLockIdentity(lockPath: string): Promise<LockIdentity | null> {
  try {
    const parsed = JSON.parse(await readFile(lockPath, "utf8")) as { owner_token?: unknown; heartbeat_at?: unknown }
    if (typeof parsed.heartbeat_at === "number" && Number.isFinite(parsed.heartbeat_at)) {
      return Date.now() - parsed.heartbeat_at > STALE_LOCK_MS
        ? { owner_token: typeof parsed.owner_token === "string" ? parsed.owner_token : undefined, heartbeat_at: parsed.heartbeat_at }
        : null
    }
    const metadata = await stat(lockPath)
    return Date.now() - metadata.mtimeMs > STALE_LOCK_MS ? { mtime_ms: metadata.mtimeMs } : null
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return {}
    return null
  }
}

async function removeStaleLock(lockPath: string, expected: LockIdentity): Promise<void> {
  try {
    if (expected.owner_token !== undefined || expected.heartbeat_at !== undefined) {
      const current = JSON.parse(await readFile(lockPath, "utf8")) as { owner_token?: unknown; heartbeat_at?: unknown }
      if (current.owner_token !== expected.owner_token || current.heartbeat_at !== expected.heartbeat_at) return
    } else if (expected.mtime_ms !== undefined) {
      if ((await stat(lockPath)).mtimeMs !== expected.mtime_ms) return
    }
    await rm(lockPath)
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return
    throw error
  }
}

async function refreshOwnedLock(lockPath: string, ownerToken: string): Promise<void> {
  const parsed = JSON.parse(await readFile(lockPath, "utf8")) as { owner_token?: unknown; heartbeat_at?: unknown }
  if (parsed.owner_token !== ownerToken) return
  const now = Math.max(Date.now(), Number(parsed.heartbeat_at ?? 0) + 1)
  const temporary = `${lockPath}.${ownerToken}.heartbeat.tmp`
  await writeFile(temporary, JSON.stringify({ ...parsed, owner_token: ownerToken, heartbeat_at: now }), "utf8")
  const current = JSON.parse(await readFile(lockPath, "utf8")) as { owner_token?: unknown }
  if (current.owner_token !== ownerToken) {
    await rm(temporary, { force: true })
    return
  }
  await rename(temporary, lockPath)
}

async function releaseOwnedLock(lockPath: string, ownerToken: string): Promise<void> {
  try {
    const parsed = JSON.parse(await readFile(lockPath, "utf8")) as { owner_token?: unknown }
    if (parsed.owner_token === ownerToken) await rm(lockPath)
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return
    throw error
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** 旧版本会话字段迁移：缺失的新增字段补默认值，避免 undefined 访问。 */
function normalizeSessionRecord(record: InteractiveSessionRecord): InteractiveSessionRecord {
  const normalized: InteractiveSessionRecord = {
    ...record,
    revision: Number.isSafeInteger(record.revision) && record.revision >= 0 ? record.revision : 0,
    code_execution: record.code_execution ?? null,
    adaptation: record.adaptation ?? null,
    resource_fit: record.resource_fit ?? null,
    terminal_outcome: record.terminal_outcome ?? null,
    worker_ledger_history: record.worker_ledger_history ?? [],
    content_review: record.content_review ?? null,
    private: {
      diagnosis_answer_key: record.private?.diagnosis_answer_key ?? {},
      diagnosis_answers: record.private?.diagnosis_answers ?? null,
      diagnosis_items: record.private?.diagnosis_items ?? [],
      upstream_artifacts: record.private?.upstream_artifacts ?? {},
      next_round_context: record.private?.next_round_context ?? null,
      assessment_history: record.private?.assessment_history ?? [],
      role_c_generation_attempt: record.private?.role_c_generation_attempt ?? 0,
      role_c_failed_generations: record.private?.role_c_failed_generations ?? 0,
      role_c_generation_recovery: record.private?.role_c_generation_recovery ?? null,
      profile_epoch: record.private?.profile_epoch ?? 0,
      node_remediate_rounds: record.private?.node_remediate_rounds ?? 0,
      node_reinforce_rounds: record.private?.node_reinforce_rounds ?? 0,
      role_c: record.private?.role_c ?? null,
    },
  }
  // 剥离已废弃字段（锚点路由移除后的历史残留），防止经 publicSessionView 泄露给 D。
  delete (normalized as unknown as Record<string, unknown>).anchor_routing
  const privateRecord = normalized.private as unknown as Record<string, unknown>
  delete privateRecord.anchor_answers
  return normalized
}

export function publicSessionView(record: InteractiveSessionRecord): InteractiveSessionPublicView {
  const { private: _private, processed_commands: _processed, learner_request: _request, owner_id: _owner, events: _events, ...view } = structuredClone(record)
  if (view.rag_result && view.formal_path) {
    view.formal_path = canonicalizeFormalPathNodeTopics(view.formal_path as FormalLearningPath, view.rag_result as RagResult)
    view.current_path_node = canonicalizePathNodeTopic(view.current_path_node as LearningPathNode | null, view.rag_result as RagResult)
  }
  // 附加完整 LearnerProfileV2（背景/目标用途/偏好/约束/进度/溯源），供前端画像详情展示。
  // 只读字段：background_context / goal_context / self_assessment / learning_preferences /
  // learning_constraints / progress / provenance / profile_version / schema_version。
  const pbArtifact = (_private?.upstream_artifacts as Record<string, unknown> | undefined)?.["profile-builder"]
  const fullProfile = (pbArtifact as { profile?: unknown } | undefined)?.profile
  if (fullProfile && typeof fullProfile === "object") {
    view.profile_v2 = fullProfile as Record<string, unknown>
  }
  return view
}

export class InteractiveSessionError extends Error {
  constructor(readonly code: string, message: string, readonly http_status: number, readonly details?: string[]) {
    super(message)
  }
}

async function retryInteractiveSession(
  original: InteractiveSessionRecord,
  dataRoot: string,
): Promise<InteractiveSessionRecord> {
  const record = structuredClone(original)
  const blockedReason = record.blocked_reason
  if (record.blocked_reason?.startsWith(`${LEARNING_SUPPORT_REQUIRED}:`)) {
    throw new InteractiveSessionError(
      LEARNING_SUPPORT_REQUIRED,
      "当前目标尚未掌握，需要重新诊断或调整学习目标",
      409,
    )
  }
  record.blocked_reason = null
  record.terminal_outcome = null
  record.content_review = reviewState(record.round_no, "repairing", {
    "concept-tutor": "repairing",
    "code-lab": "pending",
    "tiered-evaluator": "pending",
  }, { repairAttemptNo: record.private.role_c_failed_generations + 1 })
  if (blockedReason?.startsWith("SUBMISSION_BOUNDARY_BLOCKED:")
    && record.formal_path && record.current_path_node && record.rag_result) {
    const path = record.formal_path as FormalLearningPath
    const node = record.current_path_node as LearningPathNode
    record.private.role_c_generation_attempt = (record.private.role_c_generation_attempt ?? 0) + 1
    const currentNode = bindPathNodeFactsForRoleC(node, record.rag_result as RagResult)
    const next = await generateFormalRoleCRound(record, path, currentNode, dataRoot)
    if (!next.ok) {
      applyRoleCGenerationFailure(record, next)
      record.events.push(event(record.session_id, "session_blocked", "blocked", next.reason, new Date().toISOString()))
      record.updated_at = new Date().toISOString()
      return record
    }
    await applyFormalRoleCRound(record, next, dataRoot)
    markReviewedRoleCWorkers(record)
    record.events.push(event(record.session_id, "session_updated", "assessment", "submission boundary changed; regenerated the current learning resources", new Date().toISOString()))
    record.updated_at = new Date().toISOString()
    return record
  }
  if (feedbackDecisionAction(record.feedback) === "advance") {
    const path = record.formal_path as FormalLearningPath | null
    const node = record.current_path_node as LearningPathNode | null
    if (!path || !node) {
      throw new InteractiveSessionError(
        "RETRY_CHECKPOINT_MISSING",
        "推进后的下一路径节点缺失，不能把缺少检查点解释为课程完成",
        409,
      )
    }
    // 重试生成：递增尝试序号避免 run_id 碰撞，并携带暂存的下一轮上下文。
    record.private.role_c_generation_attempt = (record.private.role_c_generation_attempt ?? 0) + 1
    const retryContext = record.private.next_round_context ?? undefined
    const currentNode = record.rag_result ? bindPathNodeFactsForRoleC(node, record.rag_result as RagResult) : node
    const next = await generateFormalRoleCRound(record, path, currentNode, dataRoot, retryContext)
    if (!next.ok) {
      applyRoleCGenerationFailure(record, next)
      record.events.push(event(record.session_id, "session_blocked", "blocked", next.reason, new Date().toISOString()))
      record.updated_at = new Date().toISOString()
      return record
    }
    await applyFormalRoleCRound(record, next, dataRoot)
    record.private.next_round_context = null
    record.updated_at = new Date().toISOString()
    return record
  }
  if (record.private.next_round_context && record.formal_path && record.current_path_node) {
    const path = record.formal_path as FormalLearningPath
    const node = record.current_path_node as LearningPathNode
    record.private.role_c_generation_attempt = (record.private.role_c_generation_attempt ?? 0) + 1
    // 旧持久化上下文可能带空 focus（advance 满分反馈无 objective_results 的旧缺陷）；
    // C 合同要求 focus 非空且属于当前节点目标，空时用当前节点目标补齐。
    const nodeObjectiveIds = (node.objectives ?? [])
      .map((objective) => objective.objective_id)
      .filter((objectiveId): objectiveId is string => Boolean(objectiveId))
    const persistedContext = record.private.next_round_context
    const persistedFocus = Array.isArray(persistedContext.focus_objective_ids)
      ? persistedContext.focus_objective_ids
      : []
    const focusMatchesCurrentNode = persistedFocus.length > 0
      && persistedFocus.every((objectiveId: string) => nodeObjectiveIds.includes(objectiveId))
    const retryContext = focusMatchesCurrentNode
      ? persistedContext
      : { ...persistedContext, focus_objective_ids: nodeObjectiveIds }
    const currentNode = record.rag_result ? bindPathNodeFactsForRoleC(node, record.rag_result as RagResult) : node
    const next = await generateFormalRoleCRound(record, path, currentNode, dataRoot, retryContext)
    if (!next.ok) {
      applyRoleCGenerationFailure(record, next)
      record.events.push(event(record.session_id, "session_blocked", "blocked", next.reason, new Date().toISOString()))
      record.updated_at = new Date().toISOString()
      return record
    }
    await applyFormalRoleCRound(record, next, dataRoot)
    record.private.next_round_context = null
    record.updated_at = new Date().toISOString()
    return record
  }
  if (record.private.role_c && record.assessment && record.current_path_node && record.formal_path) {
    record.status = "waiting_for_user"
    record.current_stage = "assessment"
    record.waiting_for = { type: "assessment_answers", items: assessmentItems(record.assessment) }
    record.events.push(event(record.session_id, "session_updated", "assessment", "retry restored the assessment checkpoint", new Date().toISOString()))
    record.updated_at = new Date().toISOString()
    return record
  }
  const path = record.formal_path as FormalLearningPath | null
  const node = record.current_path_node as LearningPathNode | null
  if (record.profile && path && node && record.rag_result) {
    record.private.role_c_generation_attempt = (record.private.role_c_generation_attempt ?? 0) + 1
    const currentNode = bindPathNodeFactsForRoleC(node, record.rag_result as RagResult)
    const next = await generateFormalRoleCRound(record, path, currentNode, dataRoot)
    if (!next.ok) {
      applyRoleCGenerationFailure(record, next)
      record.events.push(event(record.session_id, "session_blocked", "blocked", next.reason, new Date().toISOString()))
      record.updated_at = new Date().toISOString()
      return record
    }
    await applyFormalRoleCRound(record, next, dataRoot)
    markReviewedRoleCWorkers(record)
    record.updated_at = new Date().toISOString()
    return record
  }
  if (!record.private.diagnosis_answers) {
    throw new InteractiveSessionError("RETRY_CHECKPOINT_MISSING", "The original learner diagnosis answers are unavailable; create a new plan instead of fabricating answers", 409)
  }
  const retryCommand: InteractiveSessionCommand = {
    command_id: `RETRY-${Date.now()}`,
    type: "submit_diagnosis_answers",
    payload: { answers: structuredClone(record.private.diagnosis_answers) },
  }
  return continueAfterDiagnosis(record, retryCommand, dataRoot)
}

async function continueAfterAssessment(
  original: InteractiveSessionRecord,
  command: InteractiveSessionCommand,
  dataRoot: string,
  diagnosticQuestionAuthor: DiagnosticQuestionAuthorPort,
): Promise<InteractiveSessionRecord> {
  const answers = command.payload?.answers
  if (!assertSubmissionAnswers(answers, "submit_assessment_answers")) {
    throw new InteractiveSessionError("INVALID_COMMAND", "submit_assessment_answers requires answers array", 400)
  }
  const record = structuredClone(original)
  const roleC = record.private.role_c
  const path = record.formal_path as FormalLearningPath | null
  const currentNode = record.current_path_node as LearningPathNode | null
  if (!roleC || !record.assessment || !path || !currentNode) {
    throw new InteractiveSessionError("SESSION_ARTIFACT_MISSING", "Assessment session is missing trusted Role C identities", 409)
  }

  const submissionId = `SUB-${record.session_id}-R${record.round_no}-${command.command_id}`
  const knowledgeBase = await loadKnowledgeBase()
  const currentProfile = record.profile as LearnerProfile
  const profileVersion = isLearnerProfileV2(currentProfile)
    ? currentProfile.profile_version
    : `${record.run_id}-profile-E${record.private.profile_epoch ?? 0}`
  const progressAdapter = new RoleBLearningProgressAdapter({
    knowledgeBase,
    learners: [{
      learnerIdHash: roleC.learner_id,
      currentProfile,
      profileVersion,
      profileRevision: isLearnerProfileV2(currentProfile)
        ? currentProfile.revision
        : Math.max(0, record.round_no - 1),
    }],
  })
  let outcome: Awaited<ReturnType<typeof submitRoleCAssessment>>
  try {
    outcome = await submitRoleCAssessment({
      sessionId: roleC.session_id,
      runId: roleC.run_id,
      learnerId: roleC.learner_id,
      formId: roleC.form_id,
      attemptNo: roleC.attempt_no,
      submissionId,
      answers,
    }, {
      ...roleCRuntime(dataRoot),
      learningProgressPort: progressAdapter,
    })
  } catch (error) {
    // 评分服务异常（Docker runner、文件存储、并发冲突等）：转为可恢复的
    // blocked 并落盘原因，避免裸抛 500 且会话时间线无痕迹。
    record.status = "blocked"
    record.current_stage = "blocked"
    record.blocked_reason = `评分服务暂时不可用：${error instanceof Error ? error.message : "unknown grading error"}`
    record.events.push(event(record.session_id, "session_blocked", "blocked", record.blocked_reason, new Date().toISOString(), "tiered-evaluator"))
    record.updated_at = new Date().toISOString()
    return record
  }
  if (outcome.status === "blocked") {
    record.status = "blocked"
    record.current_stage = "blocked"
    record.blocked_reason = `${outcome.code}: ${outcome.message}`
    record.events.push(event(record.session_id, "session_blocked", "blocked", record.blocked_reason, new Date().toISOString(), "tiered-evaluator"))
    record.updated_at = new Date().toISOString()
    return record
  }
  if (outcome.status === "needs_review") {
    record.status = "blocked"
    record.current_stage = "blocked"
    record.blocked_reason = `assessment requires review: ${outcome.unresolved_item_ids.join(",")}`
    record.events.push(event(record.session_id, "session_blocked", "blocked", record.blocked_reason, new Date().toISOString(), "tiered-evaluator"))
    record.updated_at = new Date().toISOString()
    return record
  }

  record.feedback = {
    ...outcome.feedback,
    assessment_items: (record.assessment as { payload?: unknown } | null)?.payload ?? null,
    your_answers: answers.map((answer: any) => ({
      item_id: answer.item_id,
      selected_option_id: answer.selected_option_id ?? null,
      text_response: answer.text_response ?? null,
      code_response: answer.code_response ?? null,
    })),
  }
  // submitRoleCAssessment 已通过 C 的正式 LearningEvidenceEvent 端口把本轮
  // 题目级证据交给 B。这里持久化 B 返回的真实画像和快照；不再在主 Agent
  // 里把所有题目伪装成 mcq 后二次投递。
  const updatedBState = progressAdapter.getCurrentState(roleC.learner_id)
  if (!updatedBState) {
    throw new InteractiveSessionError("ROLE_B_PROGRESS_STATE_MISSING", "B did not retain the accepted learning progress", 500)
  }
  record.profile = updatedBState.currentProfile
  // 评分证据写回 learner-memory：跨会话学习记忆必须随真实作答更新，
  // 否则同一 learner 新会话诊断永远读不到历史掌握情况（此前交互流程只读不写）。
  await persistMasteryToLearnerMemory(record, outcome.feedback, dataRoot)
  record.events.push(event(record.session_id, "command_received", "assessment", "Role C accepted and graded assessment answers", new Date().toISOString(), "tiered-evaluator"))
  // 画像漂移：不推进路径、不生成下一轮，回到诊断阶段重建学习者画像。
  if (outcome.feedback.final_decision.action === "reprofile") {
    record.next_round_action = createDay4NextRoundActionState(
      "reprofile",
      record.round_no,
      currentNode.node_id,
      outcome.feedback.feedback_id,
    )
    try {
      return await resetToDiagnosisPhase(record, dataRoot, diagnosticQuestionAuthor)
    } catch (error) {
      applyDiagnosticGenerationFailure(record, error)
      return record
    }
  }

  // 同一教学变式反复无效时，交给 B 按最新画像重新规划。
  // 轮次限制只触发策略变化，永远不得改写 C 的掌握决策。
  const decisionAction = outcome.feedback.final_decision.action
  let supportLimitReached = false
  if (decisionAction === "remediate") {
    record.private.node_remediate_rounds = (record.private.node_remediate_rounds ?? 0) + 1
    supportLimitReached = record.private.node_remediate_rounds >= MAX_REMEDIATE_ROUNDS_PER_NODE
  } else if (decisionAction === "reinforce") {
    record.private.node_reinforce_rounds = (record.private.node_reinforce_rounds ?? 0) + 1
    supportLimitReached = record.private.node_reinforce_rounds >= MAX_REINFORCE_ROUNDS_PER_NODE
  }
  if (supportLimitReached) {
    const recovery = await replanAfterLearningStall(
      record,
      currentNode,
      updatedBState.currentProfile,
      updatedBState.currentSnapshot,
    )
    if (!recovery.ok) {
      record.status = "blocked"
      record.current_stage = "blocked"
      record.waiting_for = null
      record.private.next_round_context = null
      record.blocked_reason = `${LEARNING_SUPPORT_REQUIRED}: ${recovery.reason}`
      record.terminal_outcome = {
        kind: "learning_support_required",
        code: "LEARNING_SUPPORT_REQUIRED",
        message: recovery.reason,
        recommended_actions: ["reprofile", "change_goal"],
        evidence_refs: [outcome.feedback.feedback_id, currentNode.node_id],
      }
      record.events.push(event(
        record.session_id,
        "session_blocked",
        "blocked",
        record.blocked_reason,
        new Date().toISOString(),
        "path-planner",
      ))
      record.updated_at = new Date().toISOString()
      return record
    }
    record.formal_path = recovery.path
    record.current_path_node = recovery.nextPathNode
    record.private.node_remediate_rounds = 0
    record.private.node_reinforce_rounds = 0
    record.private.role_c_generation_attempt = 0
    record.round_no += 1
    const replannedObjectiveIds = recovery.nextPathNode.objectives.map((objective) => objective.objective_id)
    record.private.next_round_context = buildNextRoundContext(
      outcome.feedback,
      roleC.spec_id ?? roleC.run_id,
      `NRC-${record.session_id}-R${record.round_no}`,
      replannedObjectiveIds,
      replannedObjectiveIds,
    ) ?? null
    record.status = "running"
    record.current_stage = "assessment"
    record.waiting_for = null
    record.next_round_action = createDay4NextRoundActionState(
      decisionAction,
      record.round_no,
      recovery.nextPathNode.node_id,
      outcome.feedback.feedback_id,
    )
    record.events.push(event(
      record.session_id,
      "session_updated",
      "assessment",
      "B 已根据连续低掌握证据调整支持路径",
      new Date().toISOString(),
      "path-planner",
    ))
    record.updated_at = new Date().toISOString()
    return record
  }
  const advance = advanceToNextNode({
    path,
    updatedProfileSnapshot: updatedBState.currentSnapshot,
    decisionAction,
  })
  record.formal_path = advance.path
  if (advance.pathCompleted && isFormalPathMastered(advance.path)) {
    record.current_path_node = null
    record.status = "completed"
    record.current_stage = "completed"
    record.waiting_for = null
    record.terminal_outcome = {
      kind: "completed_mastered",
      code: "PATH_MASTERED",
      message: "正式学习路径中的全部节点均已通过测评",
      recommended_actions: ["return_home"],
      evidence_refs: [outcome.feedback.feedback_id, ...advance.path.nodes.map((node) => node.node_id)],
    }
    record.events.push(event(record.session_id, "session_completed", "completed", "formal learning path completed", new Date().toISOString()))
    record.updated_at = new Date().toISOString()
    return record
  }
  if (!advance.nextPathNode) {
    record.current_path_node = null
    record.status = "blocked"
    record.current_stage = "blocked"
    record.waiting_for = null
    record.blocked_reason = "PATH_PLANNING_FAILED: 路径没有下一节点，但尚未满足正式完成条件"
    record.terminal_outcome = {
      kind: "planning_failed",
      code: "PATH_PLANNING_FAILED",
      message: "路径没有下一节点，但尚未满足正式完成条件",
      recommended_actions: ["retry_planning", "change_goal"],
      evidence_refs: [outcome.feedback.feedback_id, advance.path.path_id],
    }
    record.events.push(event(record.session_id, "session_blocked", "blocked", record.blocked_reason, new Date().toISOString(), "path-planner"))
    record.updated_at = new Date().toISOString()
    return record
  }

  // 推进到下一节点：本节点轮次计数清零，新节点重新计数。
  record.current_path_node = advance.nextPathNode
  record.private.node_remediate_rounds = 0
  record.private.node_reinforce_rounds = 0
  record.private.role_c_generation_attempt = 0
  record.round_no += 1
  const nextNodeObjectives = ((record.current_path_node as LearningPathNode | null)?.objectives ?? [])
    .map((objective) => objective.objective_id)
    .filter((objectiveId): objectiveId is string => Boolean(objectiveId))
  const nextRoundContext = buildNextRoundContext(
    outcome.feedback,
    roleC.spec_id ?? roleC.run_id,
    `NRC-${record.session_id}-R${record.round_no}`,
    nextNodeObjectives,
  )
  // 提交响应先返回评分反馈：下一轮内容在后台生成，前端轮询会话状态。
  record.status = "running"
  record.current_stage = "assessment"
  record.waiting_for = null
  record.private.next_round_context = nextRoundContext ?? null
  record.next_round_action = createDay4NextRoundActionState(
    decisionAction,
    record.round_no,
    advance.nextPathNode.node_id,
    outcome.feedback.feedback_id,
  )
  const backgroundStartedAt = new Date().toISOString()
  record.updated_at = backgroundStartedAt
  record.events.push(event(
    record.session_id,
    "session_updated",
    "assessment",
    `round ${record.round_no} generation started in background`,
    backgroundStartedAt,
    "tiered-evaluator",
  ))
  return record
}

/**
 * 将本轮正式评分的掌握度写回 learner-memory（按 source_id 维度）。
 * 交互流程此前只 load 不 save，导致跨会话学习记忆永不更新；
 * 这里把 C 侧 mastery_snapshot（objective_id 维度）映射回当前节点的
 * target_source_ids 后落盘，使诊断选题能随历史掌握收敛。
 */
async function persistMasteryToLearnerMemory(
  record: InteractiveSessionRecord,
  feedback: DynamicFeedbackResult,
  dataRoot: string,
): Promise<void> {
  const learnerId = record.learner_request.learner_id ?? record.session_id
  const node = record.current_path_node as LearningPathNode | null
  const objectiveToSource = new Map<string, string>()
  for (const objective of node?.objectives ?? []) {
    objectiveToSource.set(objective.objective_id, objective.source_id)
  }
  const events: PersistenceEvent[] = feedback.mastery_snapshot
    .flatMap((state) => {
      const sourceId = objectiveToSource.get(state.objective_id)
      if (!sourceId) return []
      return [{
        event_type: "mastery_update" as const,
        source: "learning-orchestrator" as const,
        source_id: sourceId,
        mastery: state.mastery,
        evidence: `formal assessment round ${record.round_no}`,
      }]
    })
  const memory = await loadLearnerMemory(dataRoot, learnerId)
  const updated = appendPersistenceEvents(memory, events)
  // Persist the complete answer-free public history for lifetime duplicate
  // detection. Model inputs take only the latest 200 items.
  updated.recent_assessment_items = mergeAssessmentHistory(
    memory.recent_assessment_items ?? [],
    record.private.assessment_history,
  )
  await saveLearnerMemory(dataRoot, updated)
}

interface FormalRoleCRound {
  ok: true
  run_id: string
  spec_id: string
  learning_session: {
    session_id: string
    form_id: string
    attempt_no: number
  }
  concept_lesson: unknown
  code_lab: unknown
  assessment: unknown
  rag_result: RagResult
  /** 本轮相对上一轮的适配信息（remediate/reinforce 时存在），随会话公开给 D。 */
  adaptation?: RoleCAdaptationInfo
  /** 三类资源 target/observed 难度与 fit 结论。 */
  resource_fit?: ResourceFitReport
}

type FormalRoleCRoundResult = FormalRoleCRound | { ok: false; reason: string; failure?: RoleCGenerationFailure }

export function roleCRoundRunId(baseRunId: string, roundNo: number, generationAttempt: number): string {
  return `${baseRunId}-R${roundNo}-C${generationAttempt + 1}`
}

/** 轮次决策阈值单点来源：与 C 侧 `DEFAULT_ROUND_ACTION_POLICY` 对齐，
 *  <40% 针对性补救，≥80% 推进；避免主 Agent 与 C 各自维护一份导致调优漂移。 */
export const REMEDIATE_ACCURACY_THRESHOLD = DEFAULT_ROUND_ACTION_POLICY.remediate_below
export const REINFORCE_ACCURACY_THRESHOLD = DEFAULT_ROUND_ACTION_POLICY.advance_at_least

/**
 * 同一节点连续使用同类教学变式的上限。达到上限后由 B 重新规划
 * 先修或更小支持路径；无可用方案则诚实暂停为未掌握。
 */
export const MAX_REMEDIATE_ROUNDS_PER_NODE = 3
export const MAX_REINFORCE_ROUNDS_PER_NODE = 2

/**
 * 根据本轮评分结果选择下一轮的聚焦目标：
 * remediate → 低分目标（accuracy < 0.4）；reinforce → 不稳定目标（0.4..0.8）；
 * advance → 全部目标。
 */
export function focusObjectivesForNextRound(
  results: ObjectiveRoundResult[],
  action: DynamicFeedbackResult["final_decision"]["action"],
): string[] {
  if (action === "remediate") {
    return results
      .filter((result) => result.accuracy < REMEDIATE_ACCURACY_THRESHOLD)
      .map((result) => result.objective_id)
  }
  if (action === "reinforce") {
    return results
      .filter((result) => result.accuracy >= REMEDIATE_ACCURACY_THRESHOLD
        && result.accuracy < REINFORCE_ACCURACY_THRESHOLD)
      .map((result) => result.objective_id)
  }
  return results.map((result) => result.objective_id)
}

/**
 * 从本轮评分反馈构造传给 C 的 next_round_context：
 * action/聚焦目标/上一轮误区标签/反馈引用。reprofile 不进入生成轮（返回 undefined）。
 */
export function buildNextRoundContext(
  feedback: DynamicFeedbackResult,
  parentSpecId: string,
  requestId: string,
  fallbackObjectiveIds: string[] = [],
  replannedObjectiveIds: string[] = [],
): NextRoundGenerationContext | undefined {
  const action = feedback.final_decision.action
  if (action === "reprofile") return undefined
  // final_decision is the single source of truth for the objectives selected by
  // C's scoring policy. Do not independently reapply thresholds in the main
  // Agent, otherwise policy changes can make the next round focus disagree with
  // the action and rationale already published to B/D.
  const focus = action === "advance"
    ? feedback.objective_results.map((result) => result.objective_id)
    : [...feedback.final_decision.target_objective_ids]
  // C 合同要求 focus_objective_ids 非空、不重复且属于当前 GenerationSpec。
  // advance 表示已掌握本节点、进入下一节点：focus 必须是下一（当前）节点目标，
  // 上一轮 feedback.objective_results 里的旧节点目标不能透传给 C；
  // remediate/reinforce 时 focus 是当前节点子集，空则回落到当前节点目标。
  const effectiveFocus = replannedObjectiveIds.length > 0
    ? replannedObjectiveIds
    : action === "advance"
    ? (fallbackObjectiveIds.length > 0 ? fallbackObjectiveIds : focus)
    : (focus.length > 0 ? focus : fallbackObjectiveIds)
  const misconceptionTags = focus.length > 0
    ? [
        ...new Set(feedback.objective_results
          .filter((result) => focus.includes(result.objective_id))
          .flatMap((result) => result.misconception_tags)),
      ]
    : []
  return {
    request_id: requestId,
    parent_spec_id: parentSpecId,
    prior_feedback_ref: feedback.feedback_id,
    trigger_grade_artifact_id: feedback.grade_result.artifact_id,
    action,
    focus_objective_ids: effectiveFocus,
    reason_codes: [
      ...feedback.final_decision.reason_codes,
      ...(replannedObjectiveIds.length > 0 ? ["b_path_replanned_after_learning_stall"] : []),
    ],
    ...(misconceptionTags.length > 0 ? { misconception_tags: misconceptionTags } : {}),
  }
}

export function createDay4NextRoundActionState(
  action: Day4NextRoundAction,
  roundNo: number,
  targetNodeId: string | null,
  feedbackId: string,
): Day4NextRoundActionState {
  return {
    action,
    round_no: roundNo,
    target_node_id: targetNodeId,
    feedback_id: feedbackId,
    status: action === "reprofile" ? "waiting_for_reprofile" : "generating_next_round",
  }
}

async function replanAfterLearningStall(
  record: InteractiveSessionRecord,
  currentNode: LearningPathNode,
  learnerProfile: LearnerProfile,
  profileSnapshot: LearnerProfileSnapshot,
): Promise<
  | { ok: true; path: FormalLearningPath; nextPathNode: LearningPathNode }
  | { ok: false; reason: string }
> {
  const knowledgeBase = await loadKnowledgeBase()
  const priorRag = record.rag_result as RagResult | null
  const discovery = await retrieveLearningEvidence(buildLearningEvidenceRequest({
    run_id: `${record.run_id}-SUPPORT-PATH-R${record.round_no}`,
    retrieval_mode: "semantic_discovery",
    learner_profile: {
      profile_version: profileSnapshot.profile_version,
      level: learnerProfile.level,
      known_concepts: [...learnerProfile.known_concepts],
      weak_concepts: [...learnerProfile.weak_concepts],
      goal: learnerProfile.goal,
    },
    planning_context: {
      current_node_id: currentNode.node_id,
      current_goal: currentNode.goal,
      observable_behaviors: currentNode.objectives.map((item) => item.observable_behavior),
      excluded_source_ids: [...currentNode.target_source_ids],
    },
    learning_context: {
      action: "remediate",
      focus_objective_ids: currentNode.objectives.map((item) => item.objective_id),
      misconception_tags: [],
      reason_codes: ["learning_stall_path_replan"],
    },
    resource_needs: ["fact", "prerequisite", "example"],
    parent_retrieval_id: priorRag?.retrieval_id ?? priorRag?.retrieval_context?.request_id,
    top_k: 8,
  }), knowledgeBase)
  if (discovery.results.length === 0) {
    return {
      ok: false,
      reason: "A 未发现可供 B 规划支持路径的相关知识来源；当前节点保持未掌握",
    }
  }
  const replanned = buildFormalPath({
    learnerProfile,
    knowledgeBase,
    profileSnapshot,
    goalSourceIds: discovery.results.map((item) => item.source_id ?? item.sourceId),
  })
  const started = startPath(replanned)
  if (!started.nextPathNode || started.pathCompleted) {
    return {
      ok: false,
      reason: "B 未能为当前薄弱目标找到可用的支持路径；当前节点保持未掌握",
    }
  }
  const sameTarget = sameStringsUnordered(
    started.nextPathNode.target_source_ids,
    currentNode.target_source_ids,
  )
  const samePrerequisites = sameStringsUnordered(
    started.nextPathNode.prerequisite_source_ids,
    currentNode.prerequisite_source_ids,
  )
  if (sameTarget && samePrerequisites) {
    return {
      ok: false,
      reason: "B 重新规划后未产生新的先修或更小支持路径；请重新诊断或调整学习目标",
    }
  }
  record.events.push(event(
    record.session_id,
    "worker_completed",
    "assessment",
    `B 将支持路径调整为 ${started.nextPathNode.target_source_ids.join("、")}`,
    new Date().toISOString(),
    "path-planner",
  ))
  // 下一节点精确取证以本次语义发现为父级，形成完整检索血缘。
  record.rag_result = discovery
  return { ok: true, path: started.path, nextPathNode: started.nextPathNode }
}

function sameStringsUnordered(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  const sortedLeft = [...left].sort()
  const sortedRight = [...right].sort()
  return sortedLeft.every((value, index) => value === sortedRight[index])
}

export function interactiveSessionProductionBoundary() {
  return {
    adapter_workers: ["profile-builder", "path-planner"] as const,
    reviewed_role_c_workers: ["concept-tutor", "code-lab", "tiered-evaluator"] as const,
    review_port: "local-ab-content-review" as const,
    learning_progress_port: "role-b-learning-progress-adapter" as const,
    continuation: "continue-role-c-after-submission" as const,
    delivery_port: "durable-interactive-role-d" as const,
    adaptive_journal: "atomic-file" as const,
  }
}

function roleCRuntime(dataRoot: string): RoleCForRoleDRuntimeOptions {
  const dataDirectory = join(dataRoot, "role-c")
  return {
    providerMode: "model" as const,
    dataDirectory,
    learningPersistence: createAtomicRoleCLearningPersistence(dataDirectory),
    // 每路径节点通常仅 1 个 objective：单目标画像冲突即可触发 reprofile。
    profileDriftMinimumConflicts: 1,
  }
}

async function generateFormalRoleCRound(
  record: InteractiveSessionRecord,
  path: FormalLearningPath,
  node: LearningPathNode,
  dataRoot: string,
  nextRoundContext?: NextRoundGenerationContext,
  generationRecovery?: GenerationRecoveryContext,
): Promise<FormalRoleCRoundResult> {
  const ragResult = record.rag_result as RagResult | null
  if (!ragResult) return { ok: false, reason: "A RAG result is missing for Role C generation" }
  // B 已冻结当前路径节点后，A 按 source/fact 身份创建本轮独立取证结果。
  // 不追加或改写旧 RAG；旧结果只作为检索谱系的 parent。
  const profile = record.profile as LearnerProfile
  const profileVersion = isLearnerProfileV2(profile)
    ? profile.profile_version
    : `${record.run_id}-profile-E${record.private.profile_epoch ?? 0}`
  const action = nextRoundContext?.action ?? "advance"
  const currentRagResult = await retrieveLearningEvidence(buildLearningEvidenceRequest({
    run_id: `${record.run_id}-ROUND-${record.round_no}`,
    retrieval_mode: "identity_hydration",
    learner_profile: {
      profile_version: profileVersion,
      level: profile.level,
      known_concepts: [...profile.known_concepts],
      weak_concepts: [...profile.weak_concepts],
      goal: profile.goal,
    },
    path_context: node,
    learning_context: {
      action,
      focus_objective_ids: [...(nextRoundContext?.focus_objective_ids
        ?? node.objectives.map((objective) => objective.objective_id))],
      misconception_tags: [...(nextRoundContext?.misconception_tags ?? [])],
      reason_codes: [...(nextRoundContext?.reason_codes ?? ["path_node_activated"])],
    },
    resource_needs: action === "remediate"
      ? ["fact", "prerequisite", "example"]
      : action === "reinforce"
        ? ["fact", "example", "practice_task"]
        : ["fact", "prerequisite", "example", "practice_task"],
    parent_retrieval_id: ragResult.retrieval_id ?? ragResult.retrieval_context?.request_id,
    top_k: Math.max(1, node.target_source_ids.length + node.prerequisite_source_ids.length),
  }))
  if (currentRagResult.match_status !== "strong") {
    const gaps = (currentRagResult.objective_coverage ?? [])
      .filter((entry) => entry.status !== "strong")
      .flatMap((entry) => entry.reasons)
    return {
      ok: false,
      reason: `${currentRagResult.match_status === "no_match" ? "A_RAG_NO_MATCH" : "A_RAG_WEAK_MATCH"}：${gaps.join("；") || "当前节点证据不足"}`,
    }
  }
  const boundPathNode = bindPathNodeFactsForRoleC(node, currentRagResult)
  // C 的 GenerationSpec 必须使用绑定了 A 真实事实 ID 的节点；原始 B 节点可能只有 source_id，
  // 缺少 required_fact_ids 会让 code-lab secure 目标覆盖门禁拒绝整套互动资源。
  const baseAttempt = record.private.role_c_generation_attempt ?? 0
  const runId = roleCRoundRunId(record.run_id, record.round_no, baseAttempt)
  const result = await generateRoleCForRoleDWithRuntime({
      profile,
      ragResult: currentRagResult,
      kbVersion: await resolveRoleCKnowledgeBaseVersion(),
      runId,
      // 跨轮稳定的画像版本：mastery 状态按 learner+profile_version+objective
      // 建 key。同一画像纪元（profile_epoch）内多轮 evidence 跨轮累积，
      // reprofile（连续高分/低分与画像冲突）才可触发；reprofile 后 epoch+1
      // 进入新纪元，新画像不与旧画像累积串扰。若改为每轮派生则退化为每轮独立评估。
      profile_version: profileVersion,
      pathNode: boundPathNode,
      ...(nextRoundContext ? { next_round_context: nextRoundContext } : {}),
      ...(record.private.assessment_history.length > 0
        ? { prior_assessment_items: record.private.assessment_history }
        : {}),
      ...(generationRecovery ? { generation_recovery: generationRecovery } : {}),
    }, roleCRuntime(dataRoot))
  if (result.status === "ready") {
    if (!result.reviewedRelease) return { ok: false, reason: "Role C ready result omitted reviewed public release" }
    const [conceptLesson, codeLab, assessment] = result.reviewedRelease.artifacts
    record.private.role_c_generation_attempt = baseAttempt
    return {
      ok: true,
      run_id: result.runId,
      spec_id: result.specId,
      learning_session: {
        session_id: result.learningSession.sessionId,
        form_id: result.learningSession.formId,
        attempt_no: result.learningSession.attemptNo,
      },
      concept_lesson: conceptLesson,
      code_lab: codeLab,
      assessment,
      rag_result: currentRagResult,
      adaptation: result.reviewedRelease.adaptation,
      resource_fit: result.reviewedRelease.resource_fit,
    }
  }
  console.warn(`[orchestrator] Role C round ${record.round_no} ${result.failure.stage} blocked: ${result.reason}`)
  return { ok: false, reason: result.reason, failure: result.failure }
}

function applyRoleCGenerationFailure(
  record: InteractiveSessionRecord,
  result: Extract<FormalRoleCRoundResult, { ok: false }>,
): void {
  record.status = "blocked"
  record.current_stage = "blocked"
  record.waiting_for = null
  record.next_round_action = null
  record.blocked_reason = result.reason
  if (!result.failure) {
    record.terminal_outcome = null
    return
  }
  const contentFailure = result.failure.repairScope === "artifact"
  if (contentFailure) {
    record.private.role_c_failed_generations = (record.private.role_c_failed_generations ?? 0) + 1
  }
  const failure: RoleCGenerationFailure = contentFailure
    && record.private.role_c_failed_generations >= 2
    ? { ...result.failure, nextAction: "change_goal", canRetry: false }
    : result.failure
  markContentReviewFailed(record, { ...result, failure })
  if (failure.code === "TARGET_UNSUPPORTED") {
    record.terminal_outcome = {
      kind: "unsupported_goal",
      code: "UNSUPPORTED_GOAL",
      message: result.reason,
      recommended_actions: ["retry_planning", "change_goal"],
      evidence_refs: [failure.fingerprint],
      generation_failure: failure,
    }
    return
  }
  if (failure.code === "EVIDENCE_UNAVAILABLE") {
    record.terminal_outcome = {
      kind: "insufficient_evidence",
      code: "INSUFFICIENT_EVIDENCE",
      message: result.reason,
      recommended_actions: ["retry_retrieval", "expand_knowledge_base", "change_goal"],
      evidence_refs: [failure.fingerprint],
      generation_failure: failure,
    }
    return
  }
  const action = failure.nextAction
  const recommended = action === "regenerate_concept"
    || action === "regenerate_code_lab"
    || action === "regenerate_assessment"
    || action === "retry_provider"
    ? [action]
    : ["change_goal" as const]
  record.terminal_outcome = {
    kind: "content_generation_failed",
    code: "C_GENERATION_FAILED",
    message: result.reason,
    recommended_actions: recommended,
    evidence_refs: [failure.fingerprint],
    generation_failure: failure,
  }
}

function generationRecoveryContext(
  failure: RoleCGenerationFailure,
  attempt: number,
): GenerationRecoveryContext {
  const failedStage = failure.stage === "concept"
    || failure.stage === "code_lab"
    || failure.stage === "assessment"
    || failure.stage === "provider"
    ? failure.stage
    : "unknown"
  return {
    attempt: Math.max(1, attempt),
    failed_stage: failedStage,
    issue_codes: [...failure.issueCodes],
    failure_fingerprint: failure.fingerprint,
  }
}

function applyUnexpectedRoleCGenerationFailure(
  record: InteractiveSessionRecord,
  error: unknown,
  fallback: string,
): void {
  const message = error instanceof Error ? error.message : fallback
  const failure = generationFailure({
    code: "PROVIDER_ERROR",
    message,
    details: ["[UNEXPECTED_GENERATION_FAILURE]"],
    stage: "provider",
  })
  record.status = "failed"
  record.current_stage = "failed"
  record.waiting_for = null
  record.blocked_reason = message
  record.terminal_outcome = {
    kind: "content_generation_failed",
    code: "C_GENERATION_FAILED",
    message,
    recommended_actions: ["retry_provider"],
    evidence_refs: [failure.fingerprint],
    generation_failure: failure,
  }
}

async function applyFormalRoleCRound(
  record: InteractiveSessionRecord,
  round: FormalRoleCRound,
  dataRoot: string,
): Promise<void> {
  record.blocked_reason = null
  record.terminal_outcome = null
  record.next_round_action = null
  record.private.role_c_generation_recovery = null
  record.rag_result = round.rag_result
  markContentReviewPassed(record)
  record.private.role_c_failed_generations = 0
  record.learning_resources = { concept_lesson: round.concept_lesson, code_lab: round.code_lab }
  record.assessment = round.assessment
  record.private.assessment_history = mergeAssessmentHistory(
    record.private.assessment_history,
    publicAssessmentHistory(round.assessment, record.current_path_node),
  )
  // A public form is part of the novelty ledger as soon as it is published.
  // Waiting until submission would allow an abandoned form to reappear in a
  // later session. Persist before the session publication commit: a failure
  // blocks publication instead of silently weakening cross-session novelty.
  const learnerId = record.learner_request.learner_id ?? record.session_id
  const memory = await loadLearnerMemory(dataRoot, learnerId)
  await saveLearnerMemory(dataRoot, {
    ...memory,
    recent_assessment_items: mergeAssessmentHistory(
      memory.recent_assessment_items ?? [],
      record.private.assessment_history,
    ),
    updated_at: new Date().toISOString(),
  })
  record.adaptation = round.adaptation ?? null
  record.resource_fit = round.resource_fit ?? null
  record.code_execution = null
  record.private.role_c = {
    data_directory: "role-c",
    session_id: round.learning_session.session_id,
    run_id: round.run_id,
    spec_id: round.spec_id,
    learner_id: (record.profile as LearnerProfile).learner_id,
    form_id: round.learning_session.form_id,
    attempt_no: round.learning_session.attempt_no,
  }
  record.status = "waiting_for_user"
  record.current_stage = "assessment"
  // 每轮直接等待正式测评作答；下一轮走补救/巩固/推进由正式测评分数决策（C 动态反馈）。
  record.waiting_for = {
    type: "assessment_answers",
    items: assessmentItems(round.assessment),
  }
}

function publicAssessmentHistory(
  assessment: unknown,
  pathNode: unknown,
): PriorAssessmentItem[] {
  if (!isRecord(assessment) || !isRecord(assessment.payload)) return []
  const payload = assessment.payload
  const formId = typeof payload.form_id === "string" ? payload.form_id : ""
  const items = Array.isArray(payload.items) ? payload.items : []
  const taskId = isRecord(pathNode) && typeof pathNode.node_id === "string"
    ? pathNode.node_id
    : undefined
  const objectives = isRecord(pathNode) && Array.isArray(pathNode.objectives)
    ? pathNode.objectives.filter(isRecord)
    : []
  if (!formId) return []
  return items.flatMap((value) => {
    if (!isRecord(value)
      || typeof value.item_id !== "string"
      || typeof value.objective_id !== "string"
      || typeof value.modality !== "string"
      || !["mcq", "true_false", "trace", "short_answer", "code"].includes(value.modality)
      || typeof value.prompt !== "string") return []
    const options = Array.isArray(value.options)
      ? value.options.flatMap((option) => isRecord(option) && typeof option.text === "string" ? [option.text] : [])
      : []
    const objective = objectives.find((entry) => entry.objective_id === value.objective_id)
    const sourceId = typeof objective?.source_id === "string" ? objective.source_id : undefined
    return [{
      form_id: formId,
      item_id: value.item_id,
      objective_id: value.objective_id,
      purpose: "formal_assessment" as const,
      ...(taskId ? { task_id: taskId } : {}),
      ...(sourceId ? { source_id: sourceId } : {}),
      observation_key: typeof value.observation_key === "string"
        ? value.observation_key
        : value.objective_id,
      modality: value.modality as PriorAssessmentItem["modality"],
      prompt: value.prompt,
      options,
      ...(typeof value.starter_code === "string" ? { starter_code: value.starter_code } : {}),
      ...(isRecord(value.structure_meta)
        ? { structure_meta: value.structure_meta as unknown as PriorAssessmentItem["structure_meta"] }
        : {}),
    }]
  })
}

async function authorDiagnosisForm(
  author: DiagnosticQuestionAuthorPort,
  sessionId: string,
  learnerGoal: string,
  targets: DiagnosticEvidenceTarget[],
  priorPublicItems: PriorAssessmentItem[],
): Promise<{
  items: PublicDiagnosisItem[]
  answerKey: Record<string, string>
  history: PriorAssessmentItem[]
}> {
  const authored = await author.author({
    session_id: sessionId,
    learner_goal: learnerGoal,
    targets,
    prior_public_items: priorPublicItems,
  })
  const formId = `DIAGFORM-${safeId(sessionId)}`
  const items = authored.map((item, index) => {
    const digest = createHash("sha256")
      .update(JSON.stringify({ source_id: item.source_id, fact_id: item.fact_id, question: item.question, options: item.options }))
      .digest("hex")
      .slice(0, 10)
    return {
      item_id: `DIAG-${index + 1}-${item.source_id}-${digest}`,
      source_id: item.source_id,
      fact_id: item.fact_id,
      concept: item.concept,
      difficulty: item.difficulty,
      question: item.question,
      options: [...item.options],
    }
  })
  return {
    items,
    answerKey: Object.fromEntries(authored.map((item, index) => [items[index]!.item_id, item.answer])),
    history: authored.map((item, index) => ({
      form_id: formId,
      item_id: items[index]!.item_id,
      objective_id: `DIAG-${item.source_id}`,
      purpose: "diagnosis" as const,
      task_id: formId,
      source_id: item.source_id,
      modality: "mcq" as const,
      prompt: item.question,
      options: [...item.options],
    })),
  }
}

function mergeAssessmentHistory(
  existing: PriorAssessmentItem[],
  incoming: PriorAssessmentItem[],
): PriorAssessmentItem[] {
  return [...new Map([...existing, ...incoming].map((item) => [
    `${item.form_id}:${item.item_id}`,
    structuredClone(item),
  ])).values()]
}

export async function resolveRoleCKnowledgeBaseVersion(): Promise<string> {
  return (await loadKnowledgeBase()).version
}

export function canonicalizePathNodeTopic(
  node: LearningPathNode | null,
  ragResult: Pick<RagResult, "results">,
): LearningPathNode | null {
  return node ? bindPathNodeFactsForRoleC(node, ragResult) : null
}

export function canonicalizeFormalPathNodeTopics(
  path: FormalLearningPath,
  ragResult: Pick<RagResult, "results">,
): FormalLearningPath {
  return {
    ...path,
    nodes: path.nodes.map((node) => ({
      ...node,
      ...bindPathNodeFactsForRoleC(node, ragResult),
    })),
  }
}

export function bindPathNodeFactsForRoleC(
  node: LearningPathNode,
  ragResult: Pick<RagResult, "results">,
): LearningPathNode {
  const targetTitle = node.target_source_ids
    .map((sourceId) => ragResult.results.find((item) => (item.source_id ?? item.sourceId) === sourceId)?.title)
    .find((title): title is string => typeof title === "string" && title.trim().length > 0)
  return {
    ...node,
    // B 当前节点 source_id + A 知识标题共同定义本轮主题；总体学习目标只用于规划，
    // 不能作为 C 本轮讲义/测评标题，否则 K003 会被“学习for循环”污染。
    goal: targetTitle ?? node.goal,
    objectives: node.objectives.map((objective) => {
      const bundle = bindObjectiveEvidence(objective, ragResult.results)
      return {
        ...objective,
        required_fact_ids: bundle.required_fact_ids,
      }
    }),
    assessment_blueprint: {
      ...node.assessment_blueprint,
      // B owns the measurement requirement. C may fill flexible slots according
      // to observable behavior, but must not replace B's requested modalities.
      required_modalities: [...node.assessment_blueprint.required_modalities],
    },
  }
}

function assessmentItems(assessment: unknown): unknown[] {
  if (!assessment || typeof assessment !== "object") return []
  const record = assessment as Record<string, unknown>
  if (Array.isArray(record.items)) return record.items
  const payload = record.payload
  if (payload && typeof payload === "object") {
    const items = (payload as Record<string, unknown>).items
    if (Array.isArray(items)) return items
  }
  return []
}

function assessmentHasShortAnswer(assessment: unknown): boolean {
  return assessmentItems(assessment).some((item) =>
    typeof item === "object" && item !== null && (item as { modality?: unknown }).modality === "short_answer")
}

function learningResourcesTargetOtherNode(record: InteractiveSessionRecord): boolean {
  const node = record.current_path_node as LearningPathNode | null
  const lesson = (record.learning_resources?.concept_lesson as { payload?: { objective_ids?: string[]; objective_coverage?: Array<{ objective_id: string }> } } | null)?.payload
  const covered = [...(lesson?.objective_ids ?? []), ...(lesson?.objective_coverage?.map((entry) => entry.objective_id) ?? [])]
  if (covered.length === 0) return false
  const nodeObjectiveIds = new Set((node?.objectives ?? []).map((objective) => objective.objective_id))
  return !covered.some((objectiveId) => nodeObjectiveIds.has(objectiveId))
}

/** 校验提交答案数组的元素形状（item_id 必须存在且安全）。 */
function assertSubmissionAnswers(answers: unknown, commandType: string): answers is SubmissionAnswer[] {
  if (!Array.isArray(answers) || answers.some((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return true
    const itemId = (entry as { item_id?: unknown }).item_id
    return typeof itemId !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(itemId)
  })) {
    throw new InteractiveSessionError("INVALID_COMMAND", `${commandType} requires answers array with valid item_id entries`, 400)
  }
  return true
}

/**
 * 画像漂移（reprofile）后重置会话到诊断阶段：重新出诊断题、清空画像/
 * 路径/内容，学习者重答后走完整首轮流程（新画像 → 新路径 → 新内容）。
 */
async function resetToDiagnosisPhase(
  record: InteractiveSessionRecord,
  dataRoot: string,
  diagnosticQuestionAuthor: DiagnosticQuestionAuthorPort,
): Promise<InteractiveSessionRecord> {
  const now = new Date().toISOString()
  const knowledgeBase = await loadKnowledgeBase()
  const goalSpec = resolveLearningGoalSpec(record.learner_request.learning_goal_spec ?? {
    mode: "custom_goal",
    custom_goal: record.learner_request.goal,
  })
  const learnerId = record.learner_request.learner_id ?? record.session_id
  const learnerMemory = await loadLearnerMemory(dataRoot, learnerId)
  const targetItems = knowledgeBase.items.filter((item) => goalSpec.mapped_source_ids.includes(item.sourceId))
  const targets = selectDiagnosticEvidenceTargets({
    knowledgeBase,
    target_source_ids: goalSpec.mapped_source_ids,
    prerequisite_source_ids: [...new Set(targetItems.flatMap((item) => item.prerequisites))],
    learner_memory: learnerMemory,
    max_items: 5,
  })
  const priorHistory = mergeAssessmentHistory(
    record.private.assessment_history,
    learnerMemory.recent_assessment_items ?? [],
  )
  const diagnosis = await authorDiagnosisForm(
    diagnosticQuestionAuthor,
    `${record.session_id}-PROFILE-${(record.private.profile_epoch ?? 0) + 1}`,
    record.learner_request.goal,
    targets,
    priorHistory,
  )
  const diagnosisItems = diagnosis.items
  const answerKey = diagnosis.answerKey
  const diagnosisAttemptNo = nextWorkerAttemptNo(record, "objective-diagnostician", 1)
  await saveLearnerMemory(dataRoot, {
    ...learnerMemory,
    recent_assessment_items: mergeAssessmentHistory(priorHistory, diagnosis.history),
    updated_at: now,
  })
  return {
    ...structuredClone(record),
    status: "waiting_for_user",
    current_stage: "objective_diagnosis",
    round_no: 1,
    waiting_for: { type: "diagnosis_answers", items: diagnosisItems },
    profile: null,
    formal_path: null,
    current_path_node: null,
    rag_result: null,
    learning_resources: { concept_lesson: null, code_lab: null },
    assessment: null,
    adaptation: null,
    resource_fit: null,
    feedback: null,
    blocked_reason: null,
    terminal_outcome: null,
    code_execution: null,
    // 新画像生命周期：清空旧画像阶段的 worker 账本，避免 D 看到上一轮画像的 worker。
    worker_ledger: [],
    worker_ledger_history: [
      ...(record.worker_ledger_history ?? []),
      createWorkerLedgerHistoryEntry(record.session_id, record.run_id, 1, 3, diagnosisAttemptNo, "objective-diagnostician", "waiting_for_user", "等待重新诊断作答", "objective_diagnosis", now, null, "session_logic", true),
    ],
    // 清空命令账本：新画像阶段的 command_id 从零开始，旧键复用不再重放旧响应。
    processed_commands: {},
    private: {
      ...record.private,
      assessment_history: mergeAssessmentHistory(
        priorHistory,
        diagnosis.history,
      ),
      diagnosis_items: diagnosisItems,
      diagnosis_answer_key: answerKey,
      diagnosis_answers: null,
      upstream_artifacts: {},
      next_round_context: null,
      // 递增而非归零：reprofile 后新 run 的 runId 不与首轮冲突（C 侧 run 幂等）。
      role_c_generation_attempt: (record.private.role_c_generation_attempt ?? 0) + 1,
      role_c_failed_generations: 0,
      role_c_generation_recovery: null,
      // 新画像纪元：新画像的 mastery 状态从零开始，不与旧画像累积串扰。
      profile_epoch: (record.private.profile_epoch ?? 0) + 1,
      // 回到诊断阶段：当前节点轮次计数清零。
      node_remediate_rounds: 0,
      node_reinforce_rounds: 0,
      role_c: null,
    },
    events: [
      ...record.events,
      event(record.session_id, "session_updated", "objective_diagnosis", "画像漂移，重新诊断以重建学习者画像", now),
    ],
    updated_at: now,
  }
}

async function continueAfterDiagnosis(
  original: InteractiveSessionRecord,
  command: InteractiveSessionCommand,
  dataRoot: string,
): Promise<InteractiveSessionRecord> {
  const answers = command.payload?.answers
  if (!answers || Array.isArray(answers) || typeof answers !== "object") {
    throw new InteractiveSessionError("INVALID_COMMAND", "submit_diagnosis_answers requires payload.answers object", 400)
  }
  const requiredIds = original.private.diagnosis_items.map((item) => item.item_id)
  const answerIds = Object.keys(answers)
  const issues = [
    ...requiredIds.filter((id) => typeof answers[id] !== "string").map((id) => `missing diagnosis answer ${id}`),
    ...answerIds.filter((id) => !requiredIds.includes(id)).map((id) => `unknown diagnosis item ${id}`),
  ]
  if (issues.length > 0) throw new InteractiveSessionError("INVALID_DIAGNOSIS_ANSWERS", "Diagnosis answers do not match the requested items", 400, issues)

  const record = structuredClone(original)
  const now = new Date().toISOString()
  record.status = "running"
  record.terminal_outcome = null
  record.waiting_for = null
  upsertLedger(record, "objective-diagnostician", "completed", "已接收并判定诊断答案", {
    attemptNo: latestWorkerAttemptNo(record, "objective-diagnostician", 1),
    inputRefs: ["objective-diagnostician:diagnosis-form"],
    outputRefs: ["objective-diagnostician:interactive-result"],
  })
  record.events.push(event(record.session_id, "worker_completed", "objective_diagnosis", "objective-diagnostician completed grounded diagnosis", now, "objective-diagnostician"))
  record.events.push(event(record.session_id, "command_received", "objective_diagnosis", "received diagnosis answers", now, "objective-diagnostician"))

  const knowledgeBase = await loadKnowledgeBase()
  const profileIntake = record.learner_request.profile_intake
  const educationContext = profileIntake
    ? [
        profileIntake.background_summary,
        profileIntake.education_stage,
        ...(profileIntake.discipline_background ?? []),
        profileIntake.role_context,
      ].filter((value): value is string => Boolean(value?.trim())).join("；") || null
    : record.learner_request.background ?? null
  const background: BackgroundEvidence = {
    evidence_type: "background",
    learner_id: record.learner_request.learner_id ?? record.session_id,
    education_context: educationContext,
    prior_languages: [...(profileIntake?.prior_languages ?? [])],
    prior_topics: [...(profileIntake?.prior_topics ?? [])],
    goal_raw: record.learner_request.goal,
    time_budget: profileIntake?.weekly_time_budget_minutes
      ? `${profileIntake.weekly_time_budget_minutes} 分钟/周`
      : null,
    quotes: educationContext
      ? [{ field: "education_context", text: educationContext }]
      : [],
  }
  const selfAssessment: SelfAssessmentEvidence = {
    evidence_type: "self_assessment",
    self_rating: profileIntake?.self_rating ?? normalizeDifficulty(record.learner_request.self_rating),
    claimed_known: [],
    claimed_weak: [],
    quotes: (profileIntake?.self_rating ?? record.learner_request.self_rating)
      ? [{ field: "self_rating", text: profileIntake?.self_rating ?? record.learner_request.self_rating! }]
      : [],
  }
  const diagnosisItems: DiagnosisItem[] = record.private.diagnosis_items.map((item) => {
    const learnerAnswer = answers[item.item_id]!
    const correct = normalizeAnswer(learnerAnswer) === normalizeAnswer(record.private.diagnosis_answer_key[item.item_id] ?? "")
    return {
      source_id: item.source_id,
      fact_id: item.fact_id,
      question: item.question,
      learner_answer: learnerAnswer,
      verdict: correct ? "correct" : "incorrect",
      concept: item.concept,
      difficulty: normalizeDifficulty(item.difficulty) ?? "beginner",
    }
  })
  const objectiveDiagnosis: ObjectiveDiagnosisEvidence = {
    evidence_type: "objective_diagnosis",
    items: diagnosisItems,
    quotes: diagnosisItems.map((item) => ({ field: item.source_id, text: item.learner_answer ?? "" })),
  }

  let upstreamArtifacts: Record<string, unknown> = {
    "background-collector": { mode: "interactive", evidence: background },
    "self-assessor": { mode: "interactive", evidence: selfAssessment },
    "objective-diagnostician": {
      mode: "interactive",
      evidence: objectiveDiagnosis,
      dynamic_selection: { items: record.private.diagnosis_items },
    },
  }
  let inputRefs = ["objective-diagnostician:interactive-result"]
  const learnerId = record.learner_request.learner_id ?? record.session_id
  const memory = await loadLearnerMemory(dataRoot, learnerId)
  upstreamArtifacts["learner-memory"] = memory

  record.private.diagnosis_answers = structuredClone(answers as Record<string, string>)
  for (const step of ORCHESTRATION_WORKER_SEQUENCE.slice(3, 5)) {
    const startedAt = new Date().toISOString()
    const workerAttemptNo = nextWorkerAttemptNo(record, step.worker, record.round_no)
    record.events.push(event(record.session_id, "worker_invoked", stageForWorker(step.worker), `invoke ${step.worker}`, startedAt, step.worker))
    upsertLedger(record, step.worker, "running", `invoke ${step.worker}`, { startedAt, attemptNo: workerAttemptNo, inputRefs, stepIndex: ORCHESTRATION_WORKER_SEQUENCE.findIndex((entry) => entry.worker === step.worker) + 1 })
    const invocation = {
      ...createScaffoldWorkerInvocation({
        session_id: record.session_id,
        run_id: record.run_id,
        step_index: ORCHESTRATION_WORKER_SEQUENCE.findIndex((entry) => entry.worker === step.worker) + 1,
        stage: step.from,
        worker: step.worker,
        learner_request: record.learner_request,
        upstream_artifacts: upstreamArtifacts,
        input_refs: inputRefs,
        evidence_refs: [],
      }),
      mode: record.mode,
    }
    const result = await runWorkerAdapter(invocation)
    const validation = validateWorkerResult(invocation, result)
    if (!validation.ok || result.status !== "completed") {
      record.status = result.status === "blocked" ? "blocked" : "failed"
      record.current_stage = result.status === "blocked" ? "blocked" : "failed"
      const failureMessage = validation.ok
        ? result.errors[0]?.message ?? result.summary
        : validation.errors[0]?.message ?? "worker contract invalid"
      record.blocked_reason = failureMessage
      record.terminal_outcome = validation.ok
        ? terminalOutcomeForWorkerFailure(result.errors[0]?.code, failureMessage)
        : null
      const endedAt = new Date().toISOString()
      record.events.push(event(record.session_id, "session_blocked", record.current_stage, record.blocked_reason, endedAt, step.worker))
      upsertLedger(record, step.worker, record.status, failureMessage, { startedAt, finishedAt: endedAt, attemptNo: workerAttemptNo, inputRefs, error: { message: failureMessage }, stepIndex: ORCHESTRATION_WORKER_SEQUENCE.findIndex((entry) => entry.worker === step.worker) + 1 })
      record.updated_at = new Date().toISOString()
      return record
    }
    upstreamArtifacts[step.worker] = result.artifacts
    const workerInputRefs = inputRefs
    inputRefs = result.output_refs
    const endedAt = new Date().toISOString()
    record.events.push(event(record.session_id, "worker_completed", stageForWorker(step.worker), result.summary, endedAt, step.worker))
    upsertLedger(record, step.worker, "completed", result.summary, { startedAt, finishedAt: endedAt, attemptNo: workerAttemptNo, inputRefs: workerInputRefs, outputRefs: result.output_refs, evidenceRefs: result.evidence_refs.map((ref) => ref.ref_id), stepIndex: ORCHESTRATION_WORKER_SEQUENCE.findIndex((entry) => entry.worker === step.worker) + 1 })
  }

  const profileArtifacts = upstreamArtifacts["profile-builder"] as { profile: unknown }
  const pathArtifacts = upstreamArtifacts["path-planner"] as {
    formal_path: FormalLearningPath
    next_path_node: LearningPathNode | null
    a_rag_result: unknown
  }
  // 校验上游 worker 产物形状：completed 结果若缺关键字段，直接进入
  // blocked 并给出原因，避免后续解构得到 undefined 使会话停在 running
  // 且 retry 无法恢复（永久卡死）。
  const missingArtifacts = [
    ...(isRecord(profileArtifacts) && profileArtifacts.profile ? [] : ["profile-builder.profile"]),
    ...(isRecord(pathArtifacts) && isRecord(pathArtifacts.formal_path) ? [] : ["path-planner.formal_path"]),
    ...(isRecord(pathArtifacts) && isRecord(pathArtifacts.a_rag_result) ? [] : ["path-planner.a_rag_result"]),
  ]
  if (missingArtifacts.length > 0) {
    record.status = "blocked"
    record.current_stage = "blocked"
    record.waiting_for = null
    record.blocked_reason = `上游 Worker 产物缺少必要字段：${missingArtifacts.join("、")}`
    record.events.push(event(record.session_id, "session_blocked", "blocked", record.blocked_reason, new Date().toISOString(), "path-planner"))
    record.updated_at = new Date().toISOString()
    return record
  }
  record.profile = profileArtifacts.profile
  const canonicalPath = canonicalizeFormalPathNodeTopics(pathArtifacts.formal_path, pathArtifacts.a_rag_result as RagResult)
  const canonicalNextNode = canonicalizePathNodeTopic(pathArtifacts.next_path_node, pathArtifacts.a_rag_result as RagResult)
  record.formal_path = canonicalPath
  record.current_path_node = canonicalNextNode
  record.rag_result = pathArtifacts.a_rag_result
  record.private.upstream_artifacts = publicUpstreamArtifacts(upstreamArtifacts)
  if (!canonicalNextNode) {
    record.status = "blocked"
    record.current_stage = "blocked"
    record.waiting_for = null
    record.blocked_reason = "PATH_PLANNING_FAILED: B 未形成可执行节点"
    record.terminal_outcome = {
      kind: "planning_failed",
      code: "PATH_PLANNING_FAILED",
      message: "B 未形成可执行节点",
      recommended_actions: ["retry_planning", "change_goal"],
      evidence_refs: [canonicalPath.path_id],
    }
    record.events.push(event(record.session_id, "session_blocked", "blocked", record.blocked_reason, new Date().toISOString(), "path-planner"))
    record.updated_at = new Date().toISOString()
    return record
  }
  record.status = "running"
  record.current_stage = "assessment"
  record.waiting_for = null
  record.blocked_reason = null
  record.terminal_outcome = null
  const generationStartedAt = new Date().toISOString()
  markContentReviewStarted(record)
  upsertLedger(record, "concept-tutor", "running", "正在生成概念讲解", { startedAt: generationStartedAt, attemptNo: latestWorkerAttemptNo(record, "concept-tutor", record.round_no) })
  upsertLedger(record, "code-lab", "pending", "等待生成代码实验", { attemptNo: latestWorkerAttemptNo(record, "code-lab", record.round_no) })
  upsertLedger(record, "tiered-evaluator", "pending", "等待生成正式测评", { attemptNo: latestWorkerAttemptNo(record, "tiered-evaluator", record.round_no) })
  record.events.push(event(record.session_id, "worker_invoked", "assessment", "Role C content generation started", generationStartedAt, "concept-tutor"))
  record.updated_at = new Date().toISOString()
  return record
}

function markReviewedRoleCWorkers(record: InteractiveSessionRecord): void {
  const workers = interactiveSessionProductionBoundary().reviewed_role_c_workers
  for (const [index, worker] of workers.entries()) {
    const inputRefs = index === 0
      ? ["profile-builder:deterministic-result", "path-planner:deterministic-result"]
      : [`${workers[index - 1]}:reviewed-result`]
    upsertLedger(record, worker, "completed", `Role C reviewed ${worker} output`, {
      inputRefs,
      outputRefs: [`${worker}:reviewed-result`],
      evidenceRefs: ["path-planner:a-rag-result"],
      attemptNo: latestWorkerAttemptNo(record, worker, record.round_no),
    })
    record.events.push(event(record.session_id, "worker_completed", stageForWorker(worker), `Role C reviewed ${worker} output`, new Date().toISOString(), worker))
  }
}

function reviewState(
  roundNo: number,
  overallStatus: ContentReviewWorkerStatus,
  workerStatuses: Partial<Record<"concept-tutor" | "code-lab" | "tiered-evaluator", ContentReviewWorkerStatus>>,
  options: { error?: string | null; published?: boolean; repairAttemptNo?: number; reviewAttemptNo?: number } = {},
): ContentReviewState {
  const now = new Date().toISOString()
  const workers = Object.fromEntries(interactiveSessionProductionBoundary().reviewed_role_c_workers.map((worker) => {
    const status = workerStatuses[worker] ?? "pending"
    return [worker, {
      status,
      published: options.published === true && status === "passed",
      review_attempt_no: options.reviewAttemptNo ?? (status === "pending" ? 0 : 1),
      repair_attempt_no: options.repairAttemptNo ?? 0,
      last_error: status === "failed" || status === "blocked" || status === "degraded" ? options.error ?? null : null,
      updated_at: now,
    }]
  })) as ContentReviewState["workers"]
  return {
    overall_status: overallStatus,
    publish_allowed: overallStatus === "passed",
    blocked_or_degraded: overallStatus === "blocked" || overallStatus === "degraded",
    round_no: roundNo,
    policy: "local-ab-content-review",
    workers,
  }
}

function markContentReviewStarted(record: InteractiveSessionRecord): void {
  record.content_review = reviewState(record.round_no, "reviewing", {
    "concept-tutor": "reviewing",
    "code-lab": "pending",
    "tiered-evaluator": "pending",
  })
  for (const [worker, status, summary] of [
    ["concept-tutor", "running", "Role C 内容进入审核阶段：concept-tutor reviewing"],
    ["code-lab", "pending", "等待前序审核通过后进入代码实验审核"],
    ["tiered-evaluator", "pending", "等待前序审核通过后进入测评审核"],
  ] as const) {
    upsertLedger(record, worker, status, summary, {
      attemptNo: nextWorkerAttemptNo(record, worker, record.round_no),
      executionType: "reviewed_pipeline",
    })
  }
}

function markContentReviewPassed(record: InteractiveSessionRecord): void {
  record.content_review = reviewState(record.round_no, "passed", {
    "concept-tutor": "passed",
    "code-lab": "passed",
    "tiered-evaluator": "passed",
  }, { published: true })
  upsertLedger(record, "concept-tutor", "completed", "审核通过，概念讲解已发布", { attemptNo: latestWorkerAttemptNo(record, "concept-tutor", record.round_no), outputRefs: ["concept-tutor:reviewed-result"], evidenceRefs: ["content-review:audit"], executionType: "reviewed_pipeline" })
  upsertLedger(record, "code-lab", "completed", "审核通过，代码实验已发布", { attemptNo: latestWorkerAttemptNo(record, "code-lab", record.round_no), outputRefs: ["code-lab:reviewed-result"], evidenceRefs: ["content-review:audit"], executionType: "reviewed_pipeline" })
  upsertLedger(record, "tiered-evaluator", "completed", "审核通过，正式测评已发布", { attemptNo: latestWorkerAttemptNo(record, "tiered-evaluator", record.round_no), outputRefs: ["tiered-evaluator:reviewed-result"], evidenceRefs: ["content-review:audit"], executionType: "reviewed_pipeline" })
}

function markContentReviewFailed(record: InteractiveSessionRecord, result: Extract<FormalRoleCRoundResult, { ok: false }>): void {
  const failedWorker = workerForRoleCFailure(result.failure)
  const exhausted = Boolean(result.failure && result.failure.repairScope === "artifact" && (record.private.role_c_failed_generations ?? 0) >= 2)
  record.content_review = reviewState(record.round_no, exhausted ? "blocked" : "failed", {
    "concept-tutor": failedWorker === "concept-tutor" ? (exhausted ? "blocked" : "failed") : "pending",
    "code-lab": failedWorker === "code-lab" ? (exhausted ? "blocked" : "failed") : "pending",
    "tiered-evaluator": failedWorker === "tiered-evaluator" ? (exhausted ? "blocked" : "failed") : "pending",
  }, {
    error: result.reason,
    repairAttemptNo: record.private.role_c_failed_generations ?? 0,
  })
  upsertLedger(record, failedWorker, exhausted ? "blocked" : "failed", exhausted ? `审核/修复多次失败，进入 blocked：${result.reason}` : `审核失败，等待修复后重审：${result.reason}`, {
    attemptNo: latestWorkerAttemptNo(record, failedWorker, record.round_no),
    executionType: "reviewed_pipeline",
    error: {
      code: result.failure?.code,
      message: result.reason,
      severity: result.failure?.canRetry === true && !exhausted ? "recoverable" : "fatal",
    },
    retry: result.failure?.canRetry === true && !exhausted
      ? {
          eligible: true,
          scheduled: true,
          reason: result.failure.nextAction,
          next_attempt_no: latestWorkerAttemptNo(record, failedWorker, record.round_no) + 1,
        }
      : { eligible: false, scheduled: false, reason: result.failure?.nextAction ?? null, next_attempt_no: null },
  })
}

function workerForRoleCFailure(failure?: RoleCGenerationFailure): WorkerName {
  if (failure?.stage === "concept") return "concept-tutor"
  if (failure?.stage === "code_lab") return "code-lab"
  return "tiered-evaluator"
}

function latestWorkerAttemptNo(record: InteractiveSessionRecord, worker: WorkerName, roundNo: number): number {
  const attempts = (record.worker_ledger_history ?? [])
    .filter((entry) => entry.round_no === roundNo && entry.unit_name === worker)
    .map((entry) => entry.attempt_no)
  return Math.max(1, ...attempts)
}

function nextWorkerAttemptNo(record: InteractiveSessionRecord, worker: WorkerName, roundNo: number): number {
  const attempts = (record.worker_ledger_history ?? [])
    .filter((entry) => entry.round_no === roundNo && entry.unit_name === worker)
    .map((entry) => entry.attempt_no)
  return attempts.length === 0 ? 1 : Math.max(...attempts) + 1
}

function applyDiagnosticGenerationFailure(record: InteractiveSessionRecord, error: unknown): void {
  const blockedAt = new Date().toISOString()
  record.status = "blocked"
  record.current_stage = "blocked"
  record.waiting_for = null
  record.blocked_reason = `DIAGNOSTIC_GENERATION_FAILED: ${error instanceof Error ? error.message : "AI 诊断题生成失败"}`
  upsertLedger(record, "objective-diagnostician", "blocked", record.blocked_reason, {
    startedAt: blockedAt,
    finishedAt: blockedAt,
    attemptNo: nextWorkerAttemptNo(record, "objective-diagnostician", 1),
    executionType: "session_logic",
    error: { code: "DIAGNOSTIC_GENERATION_FAILED", message: record.blocked_reason },
  })
  record.events.push(event(record.session_id, "session_blocked", "blocked", record.blocked_reason, blockedAt, "objective-diagnostician"))
  record.updated_at = blockedAt
}

function publicUpstreamArtifacts(artifacts: Record<string, unknown>): Record<string, unknown> {
  const copy = structuredClone(artifacts)
  const codeLab = copy["code-lab"]
  if (codeLab && typeof codeLab === "object") delete (codeLab as Record<string, unknown>).code_lab_secure
  const assessment = copy["tiered-evaluator"]
  if (assessment && typeof assessment === "object") delete (assessment as Record<string, unknown>).assessment_secure
  return copy
}

function feedbackDecisionAction(feedback: unknown): string | undefined {
  if (!feedback || typeof feedback !== "object" || !("final_decision" in feedback)) return undefined
  const decision = (feedback as { final_decision?: unknown }).final_decision
  if (!decision || typeof decision !== "object" || !("action" in decision)) return undefined
  return typeof (decision as { action?: unknown }).action === "string" ? (decision as { action: string }).action : undefined
}

function terminalOutcomeForWorkerFailure(code: string | undefined, message: string): LearningTerminalOutcome | null {
  if (code === "A_RAG_NO_MATCH" || code === "A_RAG_WEAK_MATCH") {
    return {
      kind: "insufficient_evidence",
      code: "INSUFFICIENT_EVIDENCE",
      message,
      recommended_actions: ["retry_retrieval", "expand_knowledge_base", "change_goal"],
      evidence_refs: [],
    }
  }
  if (code === "UNSUPPORTED_GOAL") {
    return {
      kind: "unsupported_goal",
      code: "UNSUPPORTED_GOAL",
      message,
      recommended_actions: ["change_goal", "expand_knowledge_base"],
      evidence_refs: [],
    }
  }
  if (code === "PATH_PLANNING_FAILED") {
    return {
      kind: "planning_failed",
      code: "PATH_PLANNING_FAILED",
      message,
      recommended_actions: ["retry_planning", "change_goal"],
      evidence_refs: [],
    }
  }
  return null
}

function validateCommand(command: InteractiveSessionCommand): void {
  if (!command || typeof command !== "object" || !/^[A-Za-z0-9_-]{1,120}$/.test(command.command_id ?? "")) {
    throw new InteractiveSessionError("INVALID_COMMAND", "command_id is required and must be safe", 400)
  }
  if (!INTERACTIVE_SESSION_COMMAND_TYPES.some((type) => type === command.type)) {
    throw new InteractiveSessionError("INVALID_COMMAND", "Unsupported command type", 400)
  }
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

function normalizeAnswer(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase().replace(/\s+/g, " ")
}

function normalizeDifficulty(value: string | undefined): "beginner" | "basic" | "intermediate" | "integrated" | null {
  if (value === "beginner" || value === "basic" || value === "intermediate" || value === "integrated") return value
  // 前端学习者自评枚举（new/advanced）映射到 B 画像难度词表。
  if (value === "new") return "beginner"
  if (value === "advanced") return "integrated"
  return null
}

function stageForWorker(worker: WorkerName): InteractiveStage {
  return worker === "tiered-evaluator" ? "assessment" : "objective_diagnosis"
}

function upsertLedger(
  record: InteractiveSessionRecord,
  worker: WorkerName,
  status: PublicWorkerLedgerEntry["status"],
  summary: string,
  options: {
    startedAt?: string
    finishedAt?: string | null
    stepIndex?: number
    attemptNo?: number
    inputRefs?: string[]
    outputRefs?: string[]
    evidenceRefs?: string[]
    executionType?: WorkerLedgerHistoryEntry["execution_type"]
    manualIntervention?: boolean
    error?: { code?: string; message: string; severity?: "warning" | "recoverable" | "fatal" } | null
    retry?: WorkerLedgerHistoryEntry["retry"]
  } = {},
): void {
  const updatedAt = options.finishedAt ?? options.startedAt ?? new Date().toISOString()
  const next = { worker, status, summary, updated_at: updatedAt }
  const index = record.worker_ledger.findIndex((entry) => entry.worker === worker)
  if (index >= 0) record.worker_ledger[index] = next
  else record.worker_ledger.push(next)
  record.worker_ledger_history ??= []
  record.worker_ledger_history.push(createWorkerLedgerHistoryEntry(
    record.session_id,
    record.run_id,
    record.round_no,
    options.stepIndex ?? ORCHESTRATION_WORKER_SEQUENCE.findIndex((entry) => entry.worker === worker) + 1,
    options.attemptNo ?? 1,
    worker,
    status,
    summary,
    stageForWorker(worker),
    options.startedAt ?? updatedAt,
    options.finishedAt === undefined
      ? (status === "running" || status === "waiting_for_user" ? null : updatedAt)
      : options.finishedAt,
    options.executionType ?? executionTypeForWorker(worker),
    options.manualIntervention ?? status === "waiting_for_user",
    options.inputRefs ?? [],
    options.outputRefs ?? [],
    options.evidenceRefs ?? [],
    options.error ?? null,
    options.retry ?? null,
  ))
}

function createWorkerLedgerHistoryEntry(
  sessionId: string,
  runId: string,
  roundNo: number,
  stepIndex: number,
  attemptNo: number,
  worker: WorkerName,
  status: PublicWorkerLedgerEntry["status"],
  summary: string,
  stage: InteractiveStage,
  startedAt: string,
  finishedAt: string | null,
  executionType: WorkerLedgerHistoryEntry["execution_type"],
  manualIntervention: boolean,
  inputRefs: string[] = [],
  outputRefs: string[] = [],
  evidenceRefs: string[] = [],
  error: { code?: string; message: string; severity?: "warning" | "recoverable" | "fatal" } | null = null,
  retry: WorkerLedgerHistoryEntry["retry"] = null,
): WorkerLedgerHistoryEntry {
  const durationMs = finishedAt ? Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime()) : null
  const entryId = `${sessionId}-${recordSafeWorker(worker)}-${startedAt}-${Math.random().toString(36).slice(2, 8)}`
  return {
    schema_version: "1.0",
    entry_id: entryId,
    run_id: runId,
    session_id: sessionId,
    round_no: roundNo,
    step_index: stepIndex,
    attempt_no: attemptNo,
    parent_entry_id: null,
    orchestrator: "learning-orchestrator",
    unit_name: worker,
    execution_type: executionType,
    status: ledgerStatus(status),
    summary,
    stage,
    started_at: startedAt,
    finished_at: finishedAt,
    duration_ms: durationMs,
    input_refs: inputRefs.map((ref) => ledgerRef(ref, "evidence", sourceForRef(ref), artifactLocatorForRef(sessionId, ref), true)),
    output_refs: outputRefs.map((ref) => ledgerRef(ref, "artifact", sourceForWorker(worker), artifactLocatorForWorker(sessionId, worker), true)),
    evidence_refs: evidenceRefs.map((ref) => ledgerRef(ref, "evidence", sourceForRef(ref), artifactLocatorForRef(sessionId, ref), true)),
    execution_ref: ledgerRef(`${entryId}:execution`, "trace", "orchestrator", `sessions/${sessionId}.json#/worker_ledger_history`, true),
    next_action: nextActionForWorker(worker, status),
    decision_source: status === "waiting_for_user" ? "user" : status === "running" ? "orchestrator" : "worker_output",
    errors: error ? [{ code: error.code, message: error.message, severity: error.severity ?? (status === "failed" ? "fatal" : "recoverable"), source: worker }] : [],
    retry,
    manual_intervention: manualIntervention
      ? { occurred: true, kind: "user_input", reason: "normal product interaction", occurred_at: finishedAt ?? startedAt, evidence_ref: null }
      : { occurred: false, kind: null, reason: null, occurred_at: null, evidence_ref: null },
    observability: {
      execution_observed: true,
      input_observed: inputRefs.length > 0,
      output_observed: outputRefs.length > 0,
      artifact_verified: outputRefs.length > 0,
      evidence_level: "E3",
      source_event_ids: [],
      limitations: [],
    },
  }
}

function ledgerRef(
  refId: string,
  kind: LedgerRef["kind"],
  source: LedgerRef["source"],
  locator: string | null,
  verifiedExists = false,
): LedgerRef {
  return { ref_id: refId, kind, source, locator, visibility: "internal", verified_exists: verifiedExists }
}

function ledgerStatus(status: PublicWorkerLedgerEntry["status"]): WorkerLedgerHistoryEntry["status"] {
  return status === "pending" ? "skipped" : status
}

function executionTypeForWorker(worker: WorkerName): WorkerLedgerHistoryEntry["execution_type"] {
  if (worker === "profile-builder" || worker === "path-planner") return "deterministic_adapter"
  if (worker === "concept-tutor" || worker === "code-lab" || worker === "tiered-evaluator") return "reviewed_pipeline"
  return "session_logic"
}

function sourceForWorker(worker: WorkerName): LedgerRef["source"] {
  if (worker === "concept-tutor" || worker === "code-lab" || worker === "tiered-evaluator") return "C"
  return "B"
}

function sourceForRef(ref: string): LedgerRef["source"] {
  if (ref.includes("a-rag")) return "A"
  const worker = ORCHESTRATION_WORKER_SEQUENCE.find((entry) => ref.startsWith(`${entry.worker}:`))?.worker
  return worker ? sourceForWorker(worker) : "orchestrator"
}

function artifactLocatorForRef(sessionId: string, ref: string): string | null {
  if (ref.includes("a-rag")) return `sessions/${sessionId}.json#/rag_result`
  const worker = ORCHESTRATION_WORKER_SEQUENCE.find((entry) => ref.startsWith(`${entry.worker}:`))?.worker
  return worker ? artifactLocatorForWorker(sessionId, worker) : null
}

function artifactLocatorForWorker(sessionId: string, worker: WorkerName): string {
  const pointers: Record<WorkerName, string> = {
    "background-collector": "/learner_request/background",
    "self-assessor": "/learner_request/self_rating",
    "objective-diagnostician": "/private/diagnosis_items",
    "profile-builder": "/profile",
    "path-planner": "/formal_path",
    "concept-tutor": "/learning_resources/concept_lesson",
    "code-lab": "/learning_resources/code_lab",
    "tiered-evaluator": "/assessment",
  }
  const pointer = pointers[worker]
  return `sessions/${sessionId}.json#${pointer}`
}

function nextActionForWorker(worker: WorkerName, status: PublicWorkerLedgerEntry["status"]): string | null {
  if (status === "blocked" || status === "failed") return `retry-or-replan:${worker}`
  if (status === "waiting_for_user") {
    if (worker === "background-collector" || worker === "self-assessor") return "submit_profile_answers"
    return worker === "objective-diagnostician" ? "submit_diagnosis_answers" : "submit_assessment_answers"
  }
  const index = ORCHESTRATION_WORKER_SEQUENCE.findIndex((entry) => entry.worker === worker)
  return ORCHESTRATION_WORKER_SEQUENCE[index + 1]?.worker ?? null
}

function recordSafeWorker(worker: WorkerName): string {
  return worker.replace(/[^A-Za-z0-9_-]/g, "_")
}

export const __test_applyRoleCGenerationFailure = applyRoleCGenerationFailure
export const __test_applyDiagnosticGenerationFailure = applyDiagnosticGenerationFailure

function safeId(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(value)) {
    throw new InteractiveSessionError("INVALID_ID", "session_id and run_id may only contain letters, numbers, _ and -", 400)
  }
  return value
}

function event(
  sessionId: string,
  eventType: InteractiveEvent["event_type"],
  stage: InteractiveStage,
  message: string,
  timestamp: string,
  worker?: WorkerName,
): InteractiveEvent {
  return {
    event_id: `${sessionId}-${eventType}-${Math.random().toString(36).slice(2, 10)}`,
    event_type: eventType,
    stage,
    worker,
    message,
    timestamp,
  }
}
