import { chmod, mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { createHash, randomUUID } from "node:crypto"
import { join } from "node:path"
import { loadKnowledgeBase } from "../knowledge/loader"
import { resolveLearningGoalSpec } from "../knowledge/curriculum"
import { selectDiagnosticItems } from "../knowledge/diagnostic-selector"
import { loadLearnerMemory, saveLearnerMemory, appendPersistenceEvents, type PersistenceEvent } from "./learner-memory"
import { createScaffoldWorkerInvocation, runWorkerAdapter } from "./worker-adapters"
import { ORCHESTRATION_WORKER_SEQUENCE } from "./state-machine"
import { validateWorkerResult } from "./worker-contract"
import type { LearnerRequest, OrchestrationMode, WorkerName } from "./types"
import type { BackgroundEvidence, DiagnosisItem, ObjectiveDiagnosisEvidence, SelfAssessmentEvidence } from "../role-b-profile/types"
import type { SubmissionAnswer } from "../role-c-content/contracts/artifacts"
import type { NextRoundGenerationContext } from "../role-c-content/agents/types"
import type { RoleCAdaptationInfo } from "../role-c-content/contracts/external-api"
import type { DynamicFeedbackResult, ObjectiveRoundResult } from "../role-c-content/contracts/dynamic-feedback"
import { DEFAULT_ROUND_ACTION_POLICY } from "../role-c-content/contracts/dynamic-feedback"
import type { RagResult } from "../rag/retriever"
import { retrieveStructuredEvidenceFromKnowledgeBase } from "../rag/structured-evidence"
import {
  createAtomicRoleCLearningPersistence,
  generateRoleCForRoleDWithRuntime,
  runRoleCAssessmentCode,
  submitRoleCAssessment,
  createRoleCRecoveryEvidenceRefreshPort,
  type RoleCForRoleDRuntimeOptions,
} from "../role-d-integration/role-c-service"
import { roleCGenerationBudgets, shouldRetryWholeGenerationReason } from "../role-d-integration/generation-budget"
import type { LearnerProfile } from "../role-b-profile/types"
import type { LearningPathNode } from "../role-c-content/contracts/profile-adapter"
import { buildFormalPath, advanceToNextNode, type FormalLearningPath } from "../role-b-profile/teaching-audit/formal-path"
import { RoleBLearningProgressAdapter } from "../role-b-profile/teaching-audit/learning-progress-adapter"
import { createLocalBPathPlanningPort } from "../role-c-content/review/local-b-path-planning-port"
import type { KnowledgeBase } from "../knowledge/types"
import type { LearnerProfileSnapshot } from "../role-c-content/contracts/profile-adapter"

export type InteractiveSessionStatus = "waiting_for_user" | "running" | "completed" | "blocked" | "failed"
export type InteractiveStage = "objective_diagnosis" | "assessment" | "completed" | "blocked" | "failed"

/** 会话锁超过该时长（毫秒）视为陈旧：持有进程可能已崩溃，允许接管。 */
const STALE_LOCK_MS = 60_000

export interface PublicWorkerLedgerEntry {
  worker: WorkerName
  status: "completed" | "waiting_for_user" | "running" | "blocked" | "failed" | "pending"
  summary: string
  updated_at: string
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
    type: "diagnosis_answers" | "assessment_answers" | "clarification_answer"
    items: unknown[]
  }
  worker_ledger: PublicWorkerLedgerEntry[]
  profile: unknown | null
  formal_path: unknown | null
  current_path_node: unknown | null
  rag_result: unknown | null
  learning_resources: { concept_lesson: unknown | null; code_lab: unknown | null }
  assessment: unknown | null
  /** 本轮生成相对上一轮的适配信息（remediate/reinforce 时存在）。 */
  adaptation: unknown | null
  /** 最近一次正式测评代码运行的公开摘要；不含隐藏测试、参考答案或私有套件。 */
  code_execution: unknown | null
  feedback: unknown | null
  blocked_reason: string | null
  events: InteractiveEvent[]
  processed_commands: Record<string, { request_hash: string; response: InteractiveSessionPublicView }>
  private: {
    diagnosis_answer_key: Record<string, string>
    diagnosis_answers: Record<string, string> | null
    diagnosis_items: PublicDiagnosisItem[]
    upstream_artifacts: Record<string, unknown>
    /** 评分后暂存给后台生成的下一轮上下文；生成完成即清空。 */
    next_round_context: NextRoundGenerationContext | null
    role_c_generation_attempt: number
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

export interface InteractiveSessionCommand {
  command_id: string
  type: "submit_diagnosis_answers" | "submit_assessment_answers" | "run_assessment_code" | "retry"
  payload?: {
    answers?: Record<string, string> | SubmissionAnswer[]
    item_id?: string
    code?: string
  }
}

export class InteractiveSessionStore {
  private readonly commandQueues = new Map<string, Promise<unknown>>()
  private readonly createQueues = new Map<string, Promise<InteractiveSessionRecord>>()

  constructor(readonly data_root: string) {}

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

  private async createUnlocked(input: CreateInteractiveSessionInput): Promise<InteractiveSessionRecord> {
    const sessionId = safeId(input.session_id!)
    const existing = await this.loadOptional(sessionId)
    if (existing) throw new InteractiveSessionError("SESSION_ALREADY_EXISTS", `Session ${sessionId} already exists`, 409)

    const now = new Date().toISOString()
    const knowledgeBase = await loadKnowledgeBase()
    const goalSpec = resolveLearningGoalSpec(input.learner_request.learning_goal_spec ?? {
      mode: "custom_goal",
      custom_goal: input.learner_request.goal,
    })
    const learnerId = input.learner_request.learner_id ?? sessionId
    const learnerMemory = await loadLearnerMemory(this.data_root, learnerId)
    const targetItems = knowledgeBase.items.filter((item) => goalSpec.mapped_source_ids.includes(item.sourceId))
    const selection = selectDiagnosticItems({
      knowledgeBase,
      target_source_ids: goalSpec.mapped_source_ids,
      prerequisite_source_ids: [...new Set(targetItems.flatMap((item) => item.prerequisites))],
      learner_memory: learnerMemory,
      max_items: 5,
    })
    const diagnosisItems: PublicDiagnosisItem[] = selection.items.map((item, index) => ({
      item_id: `DIAG-${index + 1}-${item.source_id}`,
      source_id: item.source_id,
      fact_id: item.fact_id,
      concept: item.concept,
      difficulty: item.difficulty,
      question: item.question,
      options: item.options ? [...item.options] : undefined,
    }))
    const answerKey = Object.fromEntries(selection.items.map((item, index) => [diagnosisItems[index]!.item_id, item.answer]))
    const events: InteractiveEvent[] = [
      event(sessionId, "session_created", "objective_diagnosis", "learning-orchestrator created a persistent session", now),
      event(sessionId, "worker_completed", "objective_diagnosis", "background-collector accepted learner background", now, "background-collector"),
      event(sessionId, "worker_completed", "objective_diagnosis", "self-assessor accepted learner self assessment", now, "self-assessor"),
      event(sessionId, "worker_invoked", "objective_diagnosis", "objective-diagnostician prepared grounded questions", now, "objective-diagnostician"),
      event(sessionId, "waiting_for_user", "objective_diagnosis", "waiting for diagnosis answers", now, "objective-diagnostician"),
    ]
    const record: InteractiveSessionRecord = {
      schema_version: "1.0",
      revision: 0,
      session_id: sessionId,
      run_id: safeId(input.run_id ?? `RUN-${randomUUID()}`),
      owner_id: input.owner_id,
      mode: input.mode,
      learner_request: structuredClone(input.learner_request),
      status: "waiting_for_user",
      current_stage: "objective_diagnosis",
      round_no: 1,
      waiting_for: { type: "diagnosis_answers", items: diagnosisItems },
      worker_ledger: [
        { worker: "background-collector", status: "completed", summary: "已收集学习背景", updated_at: now },
        { worker: "self-assessor", status: "completed", summary: "已收集学习者自评", updated_at: now },
        { worker: "objective-diagnostician", status: "waiting_for_user", summary: "等待诊断作答", updated_at: now },
      ],
      profile: null,
      formal_path: null,
      current_path_node: null,
      rag_result: null,
      learning_resources: { concept_lesson: null, code_lab: null },
      assessment: null,
      adaptation: null,
      feedback: null,
      blocked_reason: null,
      events,
      processed_commands: {},
      private: { diagnosis_answer_key: answerKey, diagnosis_answers: null, diagnosis_items: diagnosisItems, upstream_artifacts: {}, next_round_context: null, role_c_generation_attempt: 0, profile_epoch: 0, node_remediate_rounds: 0, node_reinforce_rounds: 0, role_c: null },
      code_execution: null,
      created_at: now,
      updated_at: now,
    }
    await this.save(record, null)
    return record
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
      void this.repairLegacyAssessmentInBackground(safeSessionId)
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
        current.status = "blocked"
        current.current_stage = "blocked"
        current.blocked_reason = next.reason
        current.updated_at = new Date().toISOString()
        await this.save(current)
        return
      }
      applyFormalRoleCRound(current, next)
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
    if (command.type === "submit_diagnosis_answers") {
      if (record.status !== "waiting_for_user" || record.waiting_for?.type !== "diagnosis_answers") {
        throw new InteractiveSessionError("COMMAND_NOT_ALLOWED", "This session is not waiting for diagnosis answers", 409)
      }
      updated = await continueAfterDiagnosis(record, command, this.data_root)
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
    } else if (command.type === "submit_assessment_answers") {
      if (record.status !== "waiting_for_user" || record.waiting_for?.type !== "assessment_answers") {
        throw new InteractiveSessionError("COMMAND_NOT_ALLOWED", "This session is not waiting for assessment answers", 409)
      }
      updated = await continueAfterAssessment(record, command, this.data_root)
      // 评分已返回；下一轮内容后台生成，完成后写回会话（前端轮询状态）。
      if (updated.status === "running" && updated.private.next_round_context) {
        // 先由本方法保存 running 检查点，再启动后台任务，避免后台读取到旧快照。
        const response = publicSessionView(updated)
        updated.processed_commands[command.command_id] = { request_hash: requestHash, response }
        await this.save(updated)
        void this.generateNextRoundInBackground(sessionId, updated.private.next_round_context)
        return response
      }
    } else {
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
        void this.generateNextRoundInBackground(sessionId, retryContext)
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
      )
      // 乐观检查：保存前确认会话仍是"生成中"且轮次未被推进，避免覆盖并发写入。
      const currentBeforeSave = await this.load(sessionId)
      if (currentBeforeSave.status !== "running"
        || currentBeforeSave.round_no !== record.round_no) {
        return
      }
      if (!next.ok) {
        record.status = "blocked"
        record.current_stage = "blocked"
        record.blocked_reason = next.reason
        record.events.push(event(record.session_id, "session_blocked", "blocked", next.reason, new Date().toISOString()))
        record.updated_at = new Date().toISOString()
        await this.save(record)
        return
      }
      applyFormalRoleCRound(record, next)
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
        current.status = "failed"
        current.current_stage = "failed"
        current.blocked_reason = error instanceof Error
          ? error.message
          : "next round generation failed"
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
    let heartbeatRunning = false
    const heartbeat = setInterval(() => {
      if (heartbeatRunning) return
      heartbeatRunning = true
      void refreshOwnedLock(lockPath, ownerToken)
        .catch(() => undefined)
        .finally(() => { heartbeatRunning = false })
    }, Math.min(500, Math.max(100, Math.floor(STALE_LOCK_MS / 3))))
    try {
      return await action()
    } finally {
      clearInterval(heartbeat)
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
    private: {
      diagnosis_answer_key: record.private?.diagnosis_answer_key ?? {},
      diagnosis_answers: record.private?.diagnosis_answers ?? null,
      diagnosis_items: record.private?.diagnosis_items ?? [],
      upstream_artifacts: record.private?.upstream_artifacts ?? {},
      next_round_context: record.private?.next_round_context ?? null,
      role_c_generation_attempt: record.private?.role_c_generation_attempt ?? 0,
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
  record.blocked_reason = null
  if (feedbackDecisionAction(record.feedback) === "advance") {
    const path = record.formal_path as FormalLearningPath | null
    const node = record.current_path_node as LearningPathNode | null
    if (!path || !node) {
      record.status = "completed"
      record.current_stage = "completed"
      record.waiting_for = null
      record.updated_at = new Date().toISOString()
      return record
    }
    // 重试生成：递增尝试序号避免 run_id 碰撞，并携带暂存的下一轮上下文。
    record.private.role_c_generation_attempt = (record.private.role_c_generation_attempt ?? 0) + 1
    const retryContext = record.private.next_round_context ?? undefined
    const currentNode = record.rag_result ? bindPathNodeFactsForRoleC(node, record.rag_result as RagResult) : node
    const next = await generateFormalRoleCRound(record, path, currentNode, dataRoot, retryContext)
    if (!next.ok) {
      record.status = "blocked"
      record.current_stage = "blocked"
      record.waiting_for = null
      record.blocked_reason = next.reason
      record.events.push(event(record.session_id, "session_blocked", "blocked", next.reason, new Date().toISOString()))
      record.updated_at = new Date().toISOString()
      return record
    }
    applyFormalRoleCRound(record, next)
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
      record.status = "blocked"
      record.current_stage = "blocked"
      record.waiting_for = null
      record.blocked_reason = next.reason
      record.events.push(event(record.session_id, "session_blocked", "blocked", next.reason, new Date().toISOString()))
      record.updated_at = new Date().toISOString()
      return record
    }
    applyFormalRoleCRound(record, next)
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
      record.status = "blocked"
      record.current_stage = "blocked"
      record.waiting_for = null
      record.blocked_reason = next.reason
      record.events.push(event(record.session_id, "session_blocked", "blocked", next.reason, new Date().toISOString()))
      record.updated_at = new Date().toISOString()
      return record
    }
    applyFormalRoleCRound(record, next)
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
    }, roleCRuntime(dataRoot))
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
  // 评分证据写回 learner-memory：跨会话学习记忆必须随真实作答更新，
  // 否则同一 learner 新会话诊断永远读不到历史掌握情况（此前交互流程只读不写）。
  await persistMasteryToLearnerMemory(record, outcome.feedback, dataRoot)
  // 通知 B 本轮评分结果：B 侧画像随 formal assessment 更新，
  // 确保 reprofile 决策和下一会话诊断基于最新学习进展。
  await reportProgressToBAfterGrading(record, outcome.feedback, dataRoot)
  record.events.push(event(record.session_id, "command_received", "assessment", "Role C accepted and graded assessment answers", new Date().toISOString(), "tiered-evaluator"))
  // 画像漂移：不推进路径、不生成下一轮，回到诊断阶段重建学习者画像。
  if (outcome.feedback.final_decision.action === "reprofile") {
    return resetToDiagnosisPhase(record, dataRoot)
  }

  // 轮次上限保护：同一节点内 remediate/reinforce 各有一个上限，超过后
  // 强制 advance（即使准确率未达标），避免学习者无限循环在同一节点。
  let decisionAction = outcome.feedback.final_decision.action
  if (decisionAction === "remediate") {
    record.private.node_remediate_rounds = (record.private.node_remediate_rounds ?? 0) + 1
    if (record.private.node_remediate_rounds > MAX_REMEDIATE_ROUNDS_PER_NODE) {
      decisionAction = "advance"
      record.events.push(event(record.session_id, "session_updated", "assessment", `remediate 轮次达到上限(${MAX_REMEDIATE_ROUNDS_PER_NODE})，强制推进下一节点`, new Date().toISOString(), "tiered-evaluator"))
    }
  } else if (decisionAction === "reinforce") {
    record.private.node_reinforce_rounds = (record.private.node_reinforce_rounds ?? 0) + 1
    if (record.private.node_reinforce_rounds > MAX_REINFORCE_ROUNDS_PER_NODE) {
      decisionAction = "advance"
      record.events.push(event(record.session_id, "session_updated", "assessment", `reinforce 轮次达到上限(${MAX_REINFORCE_ROUNDS_PER_NODE})，强制推进下一节点`, new Date().toISOString(), "tiered-evaluator"))
    }
  }
  const advance = advanceToNextNode({
    path,
    updatedProfileSnapshot: path.profile_snapshot,
    decisionAction,
  })
  record.formal_path = advance.path
  if (advance.pathCompleted || !advance.nextPathNode) {
    record.current_path_node = null
    record.status = "completed"
    record.current_stage = "completed"
    record.waiting_for = null
    record.events.push(event(record.session_id, "session_completed", "completed", "formal learning path completed", new Date().toISOString()))
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
    roleC.run_id,
    `NRC-${record.session_id}-R${record.round_no}`,
    nextNodeObjectives,
  )
  // 提交响应先返回评分反馈：下一轮内容在后台生成，前端轮询会话状态。
  record.status = "running"
  record.current_stage = "assessment"
  record.waiting_for = null
  record.private.next_round_context = nextRoundContext ?? null
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

// 通知 B 本轮评分结果：B 侧画像随 formal assessment 更新，
// 确保 reprofile 决策和下一会话诊断基于最新学习进展。
async function reportProgressToBAfterGrading(
  record: InteractiveSessionRecord,
  feedback: DynamicFeedbackResult,
  dataRoot: string,
): Promise<void> {
  try {
    const learnerId = record.learner_request.learner_id ?? record.session_id
    const node = record.current_path_node as LearningPathNode | null
    if (!node) return
    const knowledgeBase = await loadKnowledgeBase()
    const progressPort = new RoleBLearningProgressAdapter({
      knowledgeBase,
      learners: [{
        learnerIdHash: learnerId,
        currentProfile: record.profile as LearnerProfile,
        profileVersion: `${record.run_id}-profile-E${record.private.profile_epoch ?? 0}`,
        profileRevision: record.round_no,
      }],
    })
    const events: Array<import("../role-c-content/contracts/learning-evidence-event").LearningEvidenceEvent> = []
    for (const result of feedback.objective_results) {
      const objective = node.objectives.find((obj) => obj.objective_id === result.objective_id)
      if (!objective) continue
      events.push({
        schema_version: "1.0" as const,
        event_id: `EVID-${record.session_id}-R${record.round_no}-${result.objective_id}`,
        learner_id_hash: learnerId,
        profile_version: `${record.run_id}-profile-E${record.private.profile_epoch ?? 0}`,
        path_node_id: node.node_id,
        objective_id: result.objective_id,
        source_id: objective.source_id,
        evidence: {
          modality: "mcq" as const,
          raw_score: result.raw_score,
          evidence_score: result.evidence_score,
          grader_confidence: 1,
          hint_level: 0,
          attempt_no: record.round_no,
        },
        misconceptions: result.misconception_tags ?? [],
        recommendation: {
          action: feedback.final_decision.action,
          confidence: 1,
          reason_codes: [...feedback.final_decision.reason_codes],
        },
        provenance: {
          artifact_id: feedback.grade_result.artifact_id,
          idempotency_key: `sha256:${createHash("sha256").update(`INTERACTIVE-${record.session_id}-R${record.round_no}-${result.objective_id}`).digest("hex")}`,
          item_id: result.objective_id,
          grader_version: "interactive-v1",
        },
      })
    }
    if (events.length === 0) return
    const { deliverRoleCToB } = await import("../role-c-content/contracts/external-api")
    await deliverRoleCToB(progressPort, events)
  } catch (error) {
    // B 进度投递失败不阻断用户交互：D 侧 learner-memory 已写入，
    // 且下一次生成/评估时可补偿。
    console.warn(`[orchestrator] B 进度投递非致命失败：${error instanceof Error ? error.message : String(error)}`)
  }
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
  if (events.length === 0) return
  const memory = await loadLearnerMemory(dataRoot, learnerId)
  const updated = appendPersistenceEvents(memory, events)
  await saveLearnerMemory(dataRoot, updated)
}

interface FormalRoleCRound {
  ok: true
  run_id: string
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
}

type FormalRoleCRoundResult = FormalRoleCRound | { ok: false; reason: string }

export function roleCRoundRunId(baseRunId: string, roundNo: number, generationAttempt: number): string {
  return `${baseRunId}-R${roundNo}-C${generationAttempt + 1}`
}

/** 轮次决策阈值单点来源：与 C 侧 `DEFAULT_ROUND_ACTION_POLICY` 对齐，
 *  <40% 针对性补救，≥80% 推进；避免主 Agent 与 C 各自维护一份导致调优漂移。 */
export const REMEDIATE_ACCURACY_THRESHOLD = DEFAULT_ROUND_ACTION_POLICY.remediate_below
export const REINFORCE_ACCURACY_THRESHOLD = DEFAULT_ROUND_ACTION_POLICY.advance_at_least

/**
 * 单节点内补救/巩固的最大轮次。超过后即使分数未达标也强制 advance，
 * 避免学习者在同一节点无限循环「补救→再测评→强化→再测评」。
 * 上限防止：连续低分永不 advance 导致会话永不结束、round_no/events 无限膨胀。
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
): NextRoundGenerationContext | undefined {
  const action = feedback.final_decision.action
  if (action === "reprofile") return undefined
  const focus = focusObjectivesForNextRound(feedback.objective_results, action)
  // C 合同要求 focus_objective_ids 非空、不重复且属于当前 GenerationSpec。
  // advance 表示已掌握本节点、进入下一节点：focus 必须是下一（当前）节点目标，
  // 上一轮 feedback.objective_results 里的旧节点目标不能透传给 C；
  // remediate/reinforce 时 focus 是当前节点子集，空则回落到当前节点目标。
  const effectiveFocus = action === "advance"
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
    reason_codes: [...feedback.final_decision.reason_codes],
    ...(misconceptionTags.length > 0 ? { misconception_tags: misconceptionTags } : {}),
  }
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
): Promise<FormalRoleCRoundResult> {
  const ragResult = record.rag_result as RagResult | null
  if (!ragResult) return { ok: false, reason: "A RAG result is missing for Role C generation" }
  // 每轮必须以B当前节点为唯一目标来源。旧会话/恢复流程可能把上一轮的RAG结果带入，
  // 且路径推进到后续节点时首轮快照可能不含新节点证据（advance 后从未刷新）。
  // 这里先按当前节点 target + prerequisite 补全缺失的 A 证据（按 source_id 从知识库
  // 结构化读取，非文本检索），再过滤绑定，避免 C 依据旧 K001 讲义生成 K002 轮次，
  // 也避免 advance 到新节点时因证据缺失而阻塞。
  const ensured = await ensureCurrentNodeEvidence(ragResult, node)
  if (!ensured.ok) {
    return { ok: false, reason: `A 证据刷新失败：${ensured.missingSources.join("、")}` }
  }
  const currentRagResult = filterRagToCurrentNode(ensured.ragResult, node)
  const requiredSources = [...new Set([...node.target_source_ids, ...(node.prerequisite_source_ids ?? [])])]
  const missingSources = requiredSources.filter((sourceId) => !currentRagResult.results.some((item) => (item.source_id ?? item.sourceId) === sourceId))
  if (missingSources.length > 0) {
    return { ok: false, reason: `A 知识库缺少当前节点或先修证据：${missingSources.join("、")}` }
  }
  const boundPathNode = bindPathNodeFactsForRoleC(node, currentRagResult)
  // C 的 GenerationSpec 必须使用绑定了 A 真实事实 ID 的节点；原始 B 节点可能只有 source_id，
  // 缺少 required_fact_ids 会让 code-lab secure 目标覆盖门禁拒绝整套互动资源。
  // 模型生成 code-lab secure 内容时有可见的间歇性失败率（public/secure 值重复、参考实现不匹配），
  // 模型阶段已有定向修复与 reviewed recovery；外层只做有限的完整重建，避免 6×5 级联等待。
  const MAX_GENERATION_ATTEMPTS = roleCGenerationBudgets().outer_attempts
  // 每次使用全新的 C 生成身份（runId 含 generation attempt），全部失败才返回 blocked。
  const baseAttempt = record.private.role_c_generation_attempt ?? 0
  let lastReason = ""
  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
    const runId = roleCRoundRunId(record.run_id, record.round_no, baseAttempt + attempt)
    const result = await generateRoleCForRoleDWithRuntime({
      profile: record.profile as LearnerProfile,
      ragResult: currentRagResult,
      kbVersion: await resolveRoleCKnowledgeBaseVersion(),
      runId,
      // 跨轮稳定的画像版本：mastery 状态按 learner+profile_version+objective
      // 建 key。同一画像纪元（profile_epoch）内多轮 evidence 跨轮累积，
      // reprofile（连续高分/低分与画像冲突）才可触发；reprofile 后 epoch+1
      // 进入新纪元，新画像不与旧画像累积串扰。若改为每轮派生则退化为每轮独立评估。
      profile_version: `${record.run_id}-profile-E${record.private.profile_epoch ?? 0}`,
      pathNode: boundPathNode,
      ...(nextRoundContext ? { next_round_context: nextRoundContext } : {}),
    }, roleCRuntime(dataRoot))
    if (result.status === "ready") {
      if (!result.reviewedRelease) return { ok: false, reason: "Role C ready result omitted reviewed public release" }
      const [conceptLesson, codeLab, assessment] = result.reviewedRelease.artifacts
      record.private.role_c_generation_attempt = baseAttempt + attempt
      return {
        ok: true,
        run_id: result.runId,
        learning_session: {
          session_id: result.learningSession.sessionId,
          form_id: result.learningSession.formId,
          attempt_no: result.learningSession.attemptNo,
        },
        concept_lesson: conceptLesson,
        code_lab: codeLab,
        assessment,
        // 持久化完整刷新结果（含按需补全的节点证据），供后续轮次复用，
        // 而非仅当前节点过滤后的子集。
        rag_result: ensured.ragResult,
        adaptation: result.reviewedRelease.adaptation,
      }
    }
    lastReason = result.reason ?? `Role C generation failed (attempt ${attempt + 1})`
    console.warn(`[orchestrator] Role C round ${record.round_no} attempt ${attempt + 1}/${MAX_GENERATION_ATTEMPTS} blocked: ${lastReason}`)
    if (!shouldRetryWholeGenerationReason(lastReason)) break
  }
  return { ok: false, reason: lastReason }
}

function applyFormalRoleCRound(record: InteractiveSessionRecord, round: FormalRoleCRound): void {
  record.blocked_reason = null
  record.rag_result = round.rag_result
  record.learning_resources = { concept_lesson: round.concept_lesson, code_lab: round.code_lab }
  record.assessment = round.assessment
  record.adaptation = round.adaptation ?? null
  record.private.role_c = {
    data_directory: "role-c",
    session_id: round.learning_session.session_id,
    run_id: round.run_id,
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

export async function resolveRoleCKnowledgeBaseVersion(): Promise<string> {
  return (await loadKnowledgeBase()).version
}

export function filterRagToCurrentNode(ragResult: RagResult, node: Pick<LearningPathNode, "target_source_ids" | "prerequisite_source_ids">): RagResult {
  const targetIds = new Set(node.target_source_ids)
  const sourceIds = new Set([
    ...node.target_source_ids,
    ...(node.prerequisite_source_ids ?? []),
  ])
  return {
    ...ragResult,
    results: ragResult.results
      .filter((item) => sourceIds.has(item.source_id ?? item.sourceId))
      .map((item) => {
        const sourceId = item.source_id ?? item.sourceId
        const facts = Array.isArray(item.facts) ? item.facts : []
        if (!targetIds.has(sourceId) || facts.length === 0) return item
        const matchedFields = new Set(item.retrievalTrace.matchedFields)
        matchedFields.add("facts")
        matchedFields.add("taskIntent")
        return {
          ...item,
          reason: `B 当前正式节点精确绑定 ${sourceId}，并使用 A 结构化事实`,
          retrievalTrace: {
            ...item.retrievalTrace,
            matchedFields: [...matchedFields],
            scoreBreakdown: {
              ...item.retrievalTrace.scoreBreakdown,
              facts: Math.max(item.retrievalTrace.scoreBreakdown.facts, facts.length),
            },
          },
        }
      }),
  }
}

/**
 * 确保当前节点所需的 A 证据就绪：路径推进到新节点后，首轮 RAG 快照可能缺少新节点的
 * target / prerequisite 证据（advance 后从未刷新）。此处按 source_id 从知识库结构化
 * 读取缺失来源并合并，返回刷新后的完整 RAG 结果；知识库本身缺失的来源才视为不可恢复。
 */
export async function ensureCurrentNodeEvidence(
  ragResult: RagResult,
  node: Pick<LearningPathNode, "target_source_ids" | "prerequisite_source_ids">,
): Promise<{ ok: true; ragResult: RagResult } | { ok: false; missingSources: string[] }> {
  const requiredSourceIds = [...new Set([
    ...node.target_source_ids,
    ...(node.prerequisite_source_ids ?? []),
  ])]
  const present = new Set(ragResult.results.map((item) => item.source_id ?? item.sourceId))
  const missing = requiredSourceIds.filter((sourceId) => !present.has(sourceId))
  if (missing.length === 0) return { ok: true, ragResult }

  const knowledgeBase = await loadKnowledgeBase()
  const structured = retrieveStructuredEvidenceFromKnowledgeBase(
    { source_ids: missing },
    knowledgeBase,
  )
  const stillMissing = structured.missing_source_ids
  if (stillMissing.length > 0) {
    return { ok: false, missingSources: stillMissing }
  }
  const knownIds = new Set(ragResult.results.map((item) => item.source_id ?? item.sourceId))
  const merged = [...ragResult.results]
  for (const item of structured.results) {
    const sourceId = item.source_id ?? item.sourceId
    if (!knownIds.has(sourceId)) {
      knownIds.add(sourceId)
      merged.push(item)
    }
  }
  return {
    ok: true,
    ragResult: { ...ragResult, results: merged },
  }
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
  const behaviors = new Set(node.objectives.map((objective) => objective.observable_behavior))
  const permitsCode = [...behaviors].some((behavior) =>
    behavior === "trace" || behavior === "apply" || behavior === "debug" || behavior === "create")
  const requiredModalities = permitsCode ? ["mcq", "code"] as const : ["mcq", "trace"] as const
  const targetTitle = node.target_source_ids
    .map((sourceId) => ragResult.results.find((item) => (item.source_id ?? item.sourceId) === sourceId)?.title)
    .find((title): title is string => typeof title === "string" && title.trim().length > 0)
  return {
    ...node,
    // B 当前节点 source_id + A 知识标题共同定义本轮主题；总体学习目标只用于规划，
    // 不能作为 C 本轮讲义/测评标题，否则 K003 会被“学习for循环”污染。
    goal: targetTitle ?? node.goal,
    objectives: node.objectives.map((objective) => {
      const source = ragResult.results.find((item) => item.source_id === objective.source_id)
      const availableFactIds = (source?.facts ?? [])
        .map((fact) => fact.fact_id)
        .filter((factId): factId is string => typeof factId === "string" && factId.length > 0)
      const requiredFactIds = objective.required_fact_ids.length > 0
        ? objective.required_fact_ids.filter((factId) => availableFactIds.includes(factId))
        : availableFactIds
      return {
        ...objective,
        // B节点可能只给source_id；这里从A当前RAG结果绑定全部真实事实，
        // 不能把空required_fact_ids继续传给C可信门禁。
        required_fact_ids: requiredFactIds,
      }
    }),
    assessment_blueprint: {
      ...node.assessment_blueprint,
      required_modalities: [...requiredModalities],
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
  const selection = selectDiagnosticItems({
    knowledgeBase,
    target_source_ids: goalSpec.mapped_source_ids,
    prerequisite_source_ids: [...new Set(targetItems.flatMap((item) => item.prerequisites))],
    learner_memory: learnerMemory,
    max_items: 5,
  })
  const diagnosisItems: PublicDiagnosisItem[] = selection.items.map((item, index) => ({
    item_id: `DIAG-${index + 1}-${item.source_id}`,
    source_id: item.source_id,
    fact_id: item.fact_id,
    concept: item.concept,
    difficulty: item.difficulty,
    question: item.question,
    options: item.options ? [...item.options] : undefined,
  }))
  const answerKey = Object.fromEntries(selection.items.map((item, index) => [diagnosisItems[index]!.item_id, item.answer]))
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
    feedback: null,
    blocked_reason: null,
    code_execution: null,
    // 新画像生命周期：清空旧画像阶段的 worker 账本，避免 D 看到上一轮画像的 worker。
    worker_ledger: [],
    // 清空命令账本：新画像阶段的 command_id 从零开始，旧键复用不再重放旧响应。
    processed_commands: {},
    private: {
      ...record.private,
      diagnosis_items: diagnosisItems,
      diagnosis_answer_key: answerKey,
      diagnosis_answers: null,
      upstream_artifacts: {},
      next_round_context: null,
      // 递增而非归零：reprofile 后新 run 的 runId 不与首轮冲突（C 侧 run 幂等）。
      role_c_generation_attempt: (record.private.role_c_generation_attempt ?? 0) + 1,
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
  record.waiting_for = null
  upsertLedger(record, "objective-diagnostician", "completed", "已接收并判定诊断答案")
  record.events.push(event(record.session_id, "worker_completed", "objective_diagnosis", "objective-diagnostician completed grounded diagnosis", now, "objective-diagnostician"))
  record.events.push(event(record.session_id, "command_received", "objective_diagnosis", "received diagnosis answers", now, "objective-diagnostician"))

  const knowledgeBase = await loadKnowledgeBase()
  const background: BackgroundEvidence = {
    evidence_type: "background",
    learner_id: record.learner_request.learner_id ?? record.session_id,
    education_context: record.learner_request.background ?? null,
    prior_languages: [],
    prior_topics: [],
    goal_raw: record.learner_request.goal,
    time_budget: null,
    quotes: record.learner_request.background
      ? [{ field: "education_context", text: record.learner_request.background }]
      : [],
  }
  const selfAssessment: SelfAssessmentEvidence = {
    evidence_type: "self_assessment",
    self_rating: normalizeDifficulty(record.learner_request.self_rating),
    claimed_known: [],
    claimed_weak: [],
    quotes: record.learner_request.self_rating
      ? [{ field: "self_rating", text: record.learner_request.self_rating }]
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
    record.events.push(event(record.session_id, "worker_invoked", stageForWorker(step.worker), `invoke ${step.worker}`, new Date().toISOString(), step.worker))
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
      record.events.push(event(record.session_id, "session_blocked", record.current_stage, record.blocked_reason, new Date().toISOString(), step.worker))
      record.updated_at = new Date().toISOString()
      return record
    }
    upstreamArtifacts[step.worker] = result.artifacts
    inputRefs = result.output_refs
    record.events.push(event(record.session_id, "worker_completed", stageForWorker(step.worker), result.summary, new Date().toISOString(), step.worker))
    upsertLedger(record, step.worker, "completed", result.summary)
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
    record.status = "completed"
    record.current_stage = "completed"
    record.waiting_for = null
    record.updated_at = new Date().toISOString()
    return record
  }
  const formalRound = await generateFormalRoleCRound(record, canonicalPath, canonicalNextNode, dataRoot)
  if (!formalRound.ok) {
    record.status = "blocked"
    record.current_stage = "blocked"
    record.waiting_for = null
    record.blocked_reason = formalRound.reason
    record.events.push(event(record.session_id, "session_blocked", "blocked", formalRound.reason, new Date().toISOString(), "tiered-evaluator"))
    record.updated_at = new Date().toISOString()
    return record
  }
  applyFormalRoleCRound(record, formalRound)
  markReviewedRoleCWorkers(record)
  record.updated_at = new Date().toISOString()
  record.events.push(event(record.session_id, "waiting_for_user", "assessment", "waiting for assessment answers", record.updated_at, "tiered-evaluator"))
  return record
}

function markReviewedRoleCWorkers(record: InteractiveSessionRecord): void {
  for (const worker of interactiveSessionProductionBoundary().reviewed_role_c_workers) {
    upsertLedger(record, worker, "completed", `Role C reviewed ${worker} output`)
    record.events.push(event(record.session_id, "worker_completed", stageForWorker(worker), `Role C reviewed ${worker} output`, new Date().toISOString(), worker))
  }
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

function validateCommand(command: InteractiveSessionCommand): void {
  if (!command || typeof command !== "object" || !/^[A-Za-z0-9_-]{1,120}$/.test(command.command_id ?? "")) {
    throw new InteractiveSessionError("INVALID_COMMAND", "command_id is required and must be safe", 400)
  }
  if (!["submit_diagnosis_answers", "submit_assessment_answers", "run_assessment_code", "retry"].includes(command.type)) {
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
): void {
  const next = { worker, status, summary, updated_at: new Date().toISOString() }
  const index = record.worker_ledger.findIndex((entry) => entry.worker === worker)
  if (index >= 0) record.worker_ledger[index] = next
  else record.worker_ledger.push(next)
}

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
