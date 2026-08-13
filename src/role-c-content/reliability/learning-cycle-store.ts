import { randomUUID } from "node:crypto"
import {
  chmod,
  link,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import { hostname as machineHostname } from "node:os"
import { dirname, join } from "node:path"
import {
  buildDynamicFeedbackResult,
  type DynamicFeedbackResult,
} from "../contracts/dynamic-feedback"
import type { LearningEvidenceEvent } from "../contracts/learning-evidence-event"
import type { SessionState, SubmissionEnvelope } from "../contracts/artifacts"
import { contentHash } from "../contracts/common"
import type { SubmissionGrade } from "../grading/grade-submission"
import type {
  MasteryStateWrite,
  ObjectiveMasteryState,
} from "../mastery/beta-mastery"
import type {
  CPipelineInput,
} from "../orchestrator/content-pipeline"
import type { LearnerProfileSnapshot } from "../contracts/profile-adapter"
import type { ReviewedCPipelineResult } from "../review/types"
import { assertReviewedReadyPipeline } from "../review/validate-reviewed-release"
import { validatePublicArtifactNoSecrets } from "../validators/public-secure-leak-validator"
import { validateRoleCSchema } from "../validators/runtime-schema-validator"

export type LearningSubmissionStatus =
  | "RECEIVED"
  | "SCORED"
  | "DECIDED"
  | "MASTERY_APPLIED"
  | "COMPLETED"
  | "BLOCKED"
  | "NEEDS_REVIEW"

export interface LearningRunRecord {
  schema_version: "1.0"
  run_id: string
  /** Backend-only learner subject bound when the reviewed run is registered. */
  learner_id_hash: string
  /** Exact backend-owned snapshot used for continuation; absent on legacy runs. */
  profile_snapshot?: LearnerProfileSnapshot
  pipeline_input: CPipelineInput
  pipeline_result: ReviewedCPipelineResult
  /** Named opaque references remove the positional coupling of CPipelineResult.secure_refs. */
  secure_artifact_refs: {
    code_lab: string
    assessment: string
  }
  revision: number
}

export interface LearningSessionRecord {
  schema_version: "1.0"
  session_id: string
  run_id: string
  session_state: SessionState
  profile_expectations_by_objective: Record<string, "known" | "weak">
  repeat_exposure_by_item: Record<string, number>
  /**
   * Present only for score-routed assessments. Legacy sessions omit it and
   * keep their pre-routed required item set.
   */
  assessment_routing_state?: AssessmentRoutingState
  active_submission_id?: string
  latest_feedback_id?: string
  revision: number
}

export type AssessmentRoutingState =
  | {
      mode: "anchor_first"
      phase: "ANCHOR_PENDING"
      routing_request_id: string
      assessment_policy_hash: string
      anchor_item_ids: string[]
    }
  | {
      mode: "anchor_first"
      phase: "ROUTE_LOCKED"
      routing_request_id: string
      assessment_policy_hash: string
      anchor_item_ids: string[]
      anchor_submission_id: string
      anchor_input_hash: string
      anchor_answers_hash: string
      anchor_grade_hash: string
      route_lock_id: string
      anchor_score_ratio: number
      route_id: string
      action: "remediate" | "reinforce" | "advance"
      reveal_tiers: Array<1 | 2 | 3>
      required_item_ids: string[]
    }

export interface LearningSubmissionRecord {
  schema_version: "1.0"
  session_id: string
  submission_id: string
  run_id: string
  submission: SubmissionEnvelope
  /** Canonical hash used to distinguish an idempotent replay from ID reuse. */
  input_hash: string
  status: LearningSubmissionStatus
  grade?: SubmissionGrade
  feedback?: DynamicFeedbackResult
  /** Frozen backend handoff; replay never regenerates it with a newer grader. */
  evidence_events?: LearningEvidenceEvent[]
  /** Frozen backend state produced by this submission, including private Beta fields. */
  mastery_states?: ObjectiveMasteryState[]
  /** Exact CAS writes form the durable mastery outbox for DECIDED recovery. */
  mastery_writes?: MasteryStateWrite[]
  processing_owner_id?: string
  processing_lease_expires_at?: number
  issues?: string[]
  revision: number
}

export interface LearningRunStore {
  createRun(record: LearningRunRecord): Promise<void>
  loadRun(runId: string): Promise<LearningRunRecord | undefined>
  saveRun(record: LearningRunRecord, expectedRevision: number): Promise<void>
}

export interface LearningSessionStore {
  createSession(record: LearningSessionRecord): Promise<void>
  loadSession(sessionId: string): Promise<LearningSessionRecord | undefined>
  saveSession(record: LearningSessionRecord, expectedRevision: number): Promise<void>
}

export interface LearningSubmissionStore {
  createSubmission(record: LearningSubmissionRecord): Promise<void>
  loadSubmission(sessionId: string, submissionId: string): Promise<LearningSubmissionRecord | undefined>
  saveSubmission(record: LearningSubmissionRecord, expectedRevision: number): Promise<void>
}

export interface LearningCycleStore
  extends LearningRunStore, LearningSessionStore, LearningSubmissionStore {}

export type LearningCycleRecordKind = "run" | "session" | "submission"

export class LearningCycleStoreError extends Error {
  constructor(
    readonly code:
      | "ALREADY_EXISTS"
      | "NOT_FOUND"
      | "REVISION_CONFLICT"
      | "INVALID_RECORD"
      | "INTEGRITY_ERROR"
      | "STORAGE_ERROR"
      | "LOCK_TIMEOUT",
    message: string,
  ) {
    super(message)
    this.name = "LearningCycleStoreError"
  }
}

export function learningSubmissionInputHash(submission: SubmissionEnvelope): string {
  const normalized = jsonClone(submission)
  normalized.answers.sort((left, right) =>
    left.item_id.localeCompare(right.item_id))
  return contentHash({
    contract: "role-c-learning-submission-v1",
    submission: normalized,
  })
}

export class InMemoryLearningCycleStore implements LearningCycleStore {
  private readonly runs = new Map<string, LearningRunRecord>()
  private readonly sessions = new Map<string, LearningSessionRecord>()
  private readonly submissions = new Map<string, LearningSubmissionRecord>()

  async createRun(record: LearningRunRecord): Promise<void> {
    const normalized = normalizeRun(record, true)
    createMemory(this.runs, normalized.run_id, normalized)
  }

  async loadRun(runId: string): Promise<LearningRunRecord | undefined> {
    return cloneOptional(this.runs.get(assertIdentifier(runId, "run_id")))
  }

  async saveRun(record: LearningRunRecord, expectedRevision: number): Promise<void> {
    const normalized = normalizeRun(record, false)
    saveMemory(this.runs, normalized.run_id, normalized, expectedRevision)
  }

  async createSession(record: LearningSessionRecord): Promise<void> {
    const normalized = normalizeSession(record, true)
    createMemory(this.sessions, normalized.session_id, normalized)
  }

  async loadSession(sessionId: string): Promise<LearningSessionRecord | undefined> {
    return cloneOptional(this.sessions.get(assertIdentifier(sessionId, "session_id")))
  }

  async saveSession(record: LearningSessionRecord, expectedRevision: number): Promise<void> {
    const normalized = normalizeSession(record, false)
    saveMemory(this.sessions, normalized.session_id, normalized, expectedRevision)
  }

  async createSubmission(record: LearningSubmissionRecord): Promise<void> {
    const normalized = normalizeSubmission(record, true)
    createMemory(this.submissions, submissionKey(normalized.session_id, normalized.submission_id), normalized)
  }

  async loadSubmission(
    sessionId: string,
    submissionId: string,
  ): Promise<LearningSubmissionRecord | undefined> {
    return cloneOptional(this.submissions.get(submissionKey(
      assertIdentifier(sessionId, "session_id"),
      assertIdentifier(submissionId, "submission_id"),
    )))
  }

  async saveSubmission(record: LearningSubmissionRecord, expectedRevision: number): Promise<void> {
    const normalized = normalizeSubmission(record, false)
    const current = this.submissions.get(submissionKey(normalized.session_id, normalized.submission_id))
    if (current) assertSubmissionTransition(current.status, normalized.status)
    saveMemory(
      this.submissions,
      submissionKey(normalized.session_id, normalized.submission_id),
      normalized,
      expectedRevision,
    )
  }
}

export interface AtomicFileLearningCycleStoreOptions {
  root_directory: string
  lock_timeout_ms?: number
  /** Lease used only when lock ownership cannot be verified. */
  stale_lock_lease_ms?: number
}

interface FileLockMetadata {
  lock_version: "1.0"
  owner_token: string
  pid: number
  hostname: string
  created_at_ms: number
}

interface ReclaimClaimMetadata extends FileLockMetadata {
  target_device: number
  target_inode: number
  target_owner_token?: string
}

interface FileLockSnapshot {
  metadata?: FileLockMetadata
  directory_mtime_ms: number
  device: number
  inode: number
}

const LOCK_METADATA_FILE = "owner.json"
const LOCK_RECLAIM_FILE = ".reclaim"
const DEFAULT_STALE_LOCK_LEASE_MS = 60_000

interface StoredRecordEnvelope<T> {
  storage_version: "1.0"
  record_kind: LearningCycleRecordKind
  record_key: string
  revision: number
  payload_hash: string
  payload: T
}

/**
 * Backend JSON store for the Role C learning cycle. Each record is protected by an
 * atomic lock directory; committed files are replaced by same-directory rename.
 */
export class AtomicFileLearningCycleStore implements LearningCycleStore {
  constructor(private readonly options: AtomicFileLearningCycleStoreOptions) {
    if (!options.root_directory.trim()) {
      throw new LearningCycleStoreError("INVALID_RECORD", "root_directory 不能为空")
    }
    if (options.lock_timeout_ms !== undefined
      && (!Number.isSafeInteger(options.lock_timeout_ms) || options.lock_timeout_ms < 0)) {
      throw new LearningCycleStoreError("INVALID_RECORD", "lock_timeout_ms 必须为非负整数")
    }
    if (options.stale_lock_lease_ms !== undefined
      && (!Number.isSafeInteger(options.stale_lock_lease_ms)
        || options.stale_lock_lease_ms < 1)) {
      throw new LearningCycleStoreError(
        "INVALID_RECORD",
        "stale_lock_lease_ms 必须为正整数",
      )
    }
  }

  async createRun(record: LearningRunRecord): Promise<void> {
    const normalized = normalizeRun(record, true)
    await this.createRecord("run", normalized.run_id, normalized)
  }

  async loadRun(runId: string): Promise<LearningRunRecord | undefined> {
    const key = assertIdentifier(runId, "run_id")
    return this.loadRecord("run", key, (value) => normalizeRun(value as LearningRunRecord, false))
  }

  async saveRun(record: LearningRunRecord, expectedRevision: number): Promise<void> {
    const normalized = normalizeRun(record, false)
    await this.saveRecord("run", normalized.run_id, normalized, expectedRevision)
  }

  async createSession(record: LearningSessionRecord): Promise<void> {
    const normalized = normalizeSession(record, true)
    await this.createRecord("session", normalized.session_id, normalized)
  }

  async loadSession(sessionId: string): Promise<LearningSessionRecord | undefined> {
    const key = assertIdentifier(sessionId, "session_id")
    return this.loadRecord(
      "session",
      key,
      (value) => normalizeSession(value as LearningSessionRecord, false),
    )
  }

  async saveSession(record: LearningSessionRecord, expectedRevision: number): Promise<void> {
    const normalized = normalizeSession(record, false)
    await this.saveRecord("session", normalized.session_id, normalized, expectedRevision)
  }

  async createSubmission(record: LearningSubmissionRecord): Promise<void> {
    const normalized = normalizeSubmission(record, true)
    const key = submissionKey(normalized.session_id, normalized.submission_id)
    await this.createRecord("submission", key, normalized)
  }

  async loadSubmission(
    sessionId: string,
    submissionId: string,
  ): Promise<LearningSubmissionRecord | undefined> {
    const key = submissionKey(
      assertIdentifier(sessionId, "session_id"),
      assertIdentifier(submissionId, "submission_id"),
    )
    return this.loadRecord(
      "submission",
      key,
      (value) => normalizeSubmission(value as LearningSubmissionRecord, false),
    )
  }

  async saveSubmission(record: LearningSubmissionRecord, expectedRevision: number): Promise<void> {
    const normalized = normalizeSubmission(record, false)
    const key = submissionKey(normalized.session_id, normalized.submission_id)
    await this.saveRecord(
      "submission",
      key,
      normalized,
      expectedRevision,
      (current, next) => assertSubmissionTransition(
        (current as LearningSubmissionRecord).status,
        (next as LearningSubmissionRecord).status,
      ),
    )
  }

  private async createRecord<T>(
    kind: LearningCycleRecordKind,
    key: string,
    record: T & { revision: number },
  ): Promise<void> {
    const path = this.recordPath(kind, key)
    await this.withLock(path, async () => {
      if (await exists(path)) {
        throw new LearningCycleStoreError("ALREADY_EXISTS", `${kind} record 已存在`)
      }
      await this.writeEnvelope(path, envelopeFor(kind, key, record))
    })
  }

  private async loadRecord<T>(
    kind: LearningCycleRecordKind,
    key: string,
    normalize: (value: unknown) => T,
  ): Promise<T | undefined> {
    const path = this.recordPath(kind, key)
    const envelope = await this.readEnvelope<T>(path, kind, key, true)
    if (!envelope) return undefined
    const normalized = normalize(envelope.payload)
    if (contentHash(normalized) !== envelope.payload_hash) {
      throw new LearningCycleStoreError("INTEGRITY_ERROR", `${kind} record 规范化后 hash 不一致`)
    }
    return jsonClone(normalized)
  }

  private async saveRecord<T>(
    kind: LearningCycleRecordKind,
    key: string,
    record: T & { revision: number },
    expectedRevision: number,
    validateTransition?: (current: T, next: T) => void,
  ): Promise<void> {
    assertRevisionTransition(record.revision, expectedRevision)
    const path = this.recordPath(kind, key)
    await this.withLock(path, async () => {
      const current = await this.readEnvelope<T>(path, kind, key, false)
      if (!current) throw new LearningCycleStoreError("NOT_FOUND", `${kind} record 不存在`)
      if (current.revision !== expectedRevision) {
        throw new LearningCycleStoreError("REVISION_CONFLICT", `${kind} record revision 冲突`)
      }
      validateTransition?.(current.payload, record)
      await this.writeEnvelope(path, envelopeFor(kind, key, record))
    })
  }

  private async readEnvelope<T>(
    path: string,
    kind: LearningCycleRecordKind,
    key: string,
    missingIsEmpty: boolean,
  ): Promise<StoredRecordEnvelope<T> | undefined> {
    let value: unknown
    try {
      value = JSON.parse(await readFile(path, "utf8"))
    } catch (error) {
      if (isMissing(error) && missingIsEmpty) return undefined
      if (isMissing(error)) return undefined
      if (error instanceof SyntaxError) {
        throw new LearningCycleStoreError("INTEGRITY_ERROR", `${kind} record JSON 损坏`)
      }
      throw storageError(error, `${kind} record 读取失败`)
    }
    if (!isStoredEnvelope<T>(value)
      || value.record_kind !== kind
      || value.record_key !== key
      || value.payload.revision !== value.revision
      || contentHash(value.payload) !== value.payload_hash) {
      throw new LearningCycleStoreError("INTEGRITY_ERROR", `${kind} record 完整性校验失败`)
    }
    return value
  }

  private async writeEnvelope<T>(path: string, envelope: StoredRecordEnvelope<T>): Promise<void> {
    await ensurePrivateDirectory(this.options.root_directory)
    await ensurePrivateDirectory(dirname(path))
    const temporary = `${path}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, JSON.stringify(envelope), {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      })
      await rename(temporary, path)
      await chmod(path, 0o600)
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined)
      if (error instanceof LearningCycleStoreError) throw error
      throw storageError(error, "learning cycle record 写入失败")
    }
  }

  private recordPath(kind: LearningCycleRecordKind, key: string): string {
    const digest = contentHash({ kind, key }).slice("sha256:".length)
    return join(this.options.root_directory, `${kind}s`, `${digest}.json`)
  }

  private async withLock<T>(recordPath: string, operation: () => Promise<T>): Promise<T> {
    await ensurePrivateDirectory(this.options.root_directory)
    await ensurePrivateDirectory(dirname(recordPath))
    const lockPath = `${recordPath}.lock`
    const timeoutMs = this.options.lock_timeout_ms ?? 2_000
    const staleLeaseMs = this.options.stale_lock_lease_ms ?? DEFAULT_STALE_LOCK_LEASE_MS
    const owner: FileLockMetadata = {
      lock_version: "1.0",
      owner_token: randomUUID(),
      pid: process.pid,
      hostname: machineHostname(),
      created_at_ms: Date.now(),
    }
    const started = Date.now()
    while (true) {
      try {
        await mkdir(lockPath, { mode: 0o700 })
        try {
          await writeFile(join(lockPath, LOCK_METADATA_FILE), JSON.stringify(owner), {
            encoding: "utf8",
            flag: "wx",
            mode: 0o600,
          })
        } catch (error) {
          // mkdir made this directory exclusively ours; avoid stranding it if
          // metadata initialization itself fails.
          await rm(lockPath, { recursive: true, force: true }).catch(() => undefined)
          throw storageError(error, "learning cycle lock 元数据写入失败")
        }
        break
      } catch (error) {
        if (!isExists(error)) throw storageError(error, "learning cycle lock 创建失败")
        let reclaimed: boolean
        try {
          reclaimed = await tryReclaimStaleLock(lockPath, staleLeaseMs)
        } catch (reclaimError) {
          throw storageError(reclaimError, "learning cycle stale lock 回收失败")
        }
        if (reclaimed) continue
        if (Date.now() - started >= timeoutMs) {
          throw new LearningCycleStoreError("LOCK_TIMEOUT", "learning cycle record lock 超时")
        }
        await delay(5)
      }
    }
    try {
      return await operation()
    } finally {
      await releaseOwnedLock(lockPath, owner.owner_token, staleLeaseMs)
    }
  }
}

/** Operational helper used by tests and deployment checks without reading content. */
export async function learningCyclePathMode(path: string): Promise<number> {
  return (await stat(path)).mode & 0o777
}

function normalizeRun(record: LearningRunRecord, creating: boolean): LearningRunRecord {
  const normalized = jsonClone(record)
  assertBaseRecord(normalized, creating)
  assertIdentifier(normalized.run_id, "run_id")
  assertIdentifier(normalized.learner_id_hash, "learner_id_hash")
  if (normalized.profile_snapshot
    && (normalized.profile_snapshot.profile_id
      !== normalized.pipeline_input.generation_spec.profile_ref.profile_id
    || normalized.profile_snapshot.profile_version
      !== normalized.pipeline_input.generation_spec.profile_ref.profile_version
    || contentHash(normalized.profile_snapshot)
      !== normalized.pipeline_input.generation_spec.profile_ref.profile_content_hash)) {
    throw new LearningCycleStoreError(
      "INVALID_RECORD",
      "run record 的画像快照与 GenerationSpec 不一致",
    )
  }
  if (normalized.pipeline_input.generation_spec.run_id !== normalized.run_id
    || normalized.pipeline_result.generation_spec.run_id !== normalized.run_id) {
    throw new LearningCycleStoreError("INVALID_RECORD", "run record 的 pipeline run_id 不一致")
  }
  if (normalized.pipeline_result.status !== "ready" || normalized.pipeline_result.state !== "READY") {
    throw new LearningCycleStoreError("INVALID_RECORD", "run record 只能保存 ready pipeline")
  }
  try {
    assertReviewedReadyPipeline(normalized.pipeline_result, {
      pipeline_input: normalized.pipeline_input,
      evidence_pack: normalized.pipeline_input.evidence_pack,
      expected_spec_id: normalized.pipeline_input.generation_spec.spec_id,
      error_prefix: "ROLE_C_STORED_RUN",
      validate_artifact_contracts: false,
    })
  } catch {
    throw new LearningCycleStoreError("INVALID_RECORD", "run record 的审核发布门禁无效")
  }
  const refs = normalized.secure_artifact_refs
  assertSecureRef(refs.code_lab, "code_lab secure ref")
  assertSecureRef(refs.assessment, "assessment secure ref")
  if (refs.code_lab === refs.assessment) {
    throw new LearningCycleStoreError("INVALID_RECORD", "两份 secure ref 必须不同")
  }
  const pipelineRefs = normalized.pipeline_result.secure_refs
  if (pipelineRefs.length !== 2
    || !pipelineRefs.includes(refs.code_lab)
    || !pipelineRefs.includes(refs.assessment)) {
    throw new LearningCycleStoreError("INVALID_RECORD", "named secure refs 与 pipeline result 不一致")
  }
  return normalized
}

function normalizeSession(
  record: LearningSessionRecord,
  creating: boolean,
): LearningSessionRecord {
  const normalized = jsonClone(record)
  assertBaseRecord(normalized, creating)
  assertIdentifier(normalized.session_id, "session_id")
  assertIdentifier(normalized.run_id, "run_id")
  if (normalized.session_state.session_id !== normalized.session_id
    || normalized.session_state.run_id !== normalized.run_id) {
    throw new LearningCycleStoreError("INVALID_RECORD", "session record 身份与 SessionState 不一致")
  }
  if (new Set(normalized.session_state.secure_artifact_refs).size
    !== normalized.session_state.secure_artifact_refs.length) {
    throw new LearningCycleStoreError("INVALID_RECORD", "SessionState secure refs 不得重复")
  }
  normalized.session_state.secure_artifact_refs.forEach((ref) =>
    assertSecureRef(ref, "SessionState secure ref"))
  for (const [objectiveId, expectation] of Object.entries(normalized.profile_expectations_by_objective)) {
    assertIdentifier(objectiveId, "objective_id")
    if (expectation !== "known" && expectation !== "weak") {
      throw new LearningCycleStoreError("INVALID_RECORD", "profile expectation 必须为 known 或 weak")
    }
  }
  for (const [itemId, count] of Object.entries(normalized.repeat_exposure_by_item)) {
    assertIdentifier(itemId, "item_id")
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new LearningCycleStoreError("INVALID_RECORD", "repeat exposure 必须为非负整数")
    }
  }
  if (normalized.assessment_routing_state) {
    assertAssessmentRoutingState(normalized)
  }
  if (normalized.active_submission_id !== undefined) {
    assertIdentifier(normalized.active_submission_id, "active_submission_id")
  }
  if (normalized.latest_feedback_id !== undefined) {
    assertIdentifier(normalized.latest_feedback_id, "latest_feedback_id")
  }
  return normalized
}

function assertAssessmentRoutingState(record: LearningSessionRecord): void {
  const state = record.assessment_routing_state!
  if (state.mode !== "anchor_first"
    || !["ANCHOR_PENDING", "ROUTE_LOCKED"].includes(state.phase)) {
    throw new LearningCycleStoreError(
      "INVALID_RECORD",
      "assessment routing state 无效",
    )
  }
  assertIdentifier(state.routing_request_id, "routing_request_id")
  if (!/^sha256:[a-f0-9]{64}$/.test(state.assessment_policy_hash)
    || state.anchor_item_ids.length === 0
    || new Set(state.anchor_item_ids).size !== state.anchor_item_ids.length) {
    throw new LearningCycleStoreError(
      "INVALID_RECORD",
      "assessment routing policy 或 anchor 集合无效",
    )
  }
  const required = record.session_state.required_item_ids
  if (state.phase === "ANCHOR_PENDING") {
    if (!sameStringSet(required, state.anchor_item_ids)
      || record.active_submission_id
      || record.latest_feedback_id) {
      throw new LearningCycleStoreError(
        "INVALID_RECORD",
        "ANCHOR_PENDING 会话状态不一致",
      )
    }
    return
  }
  for (const hash of [
    state.anchor_input_hash,
    state.anchor_answers_hash,
    state.anchor_grade_hash,
  ]) {
    if (!/^sha256:[a-f0-9]{64}$/.test(hash)) {
      throw new LearningCycleStoreError(
        "INVALID_RECORD",
        "route lock hash 无效",
      )
    }
  }
  if (!state.anchor_submission_id.trim() || !state.route_lock_id.trim()
    || !state.route_id.trim()
    || !["remediate", "reinforce", "advance"].includes(state.action)
    || !Number.isFinite(state.anchor_score_ratio)
    || state.anchor_score_ratio < 0 || state.anchor_score_ratio > 1
    || state.required_item_ids.length === 0
    || new Set(state.required_item_ids).size
      !== state.required_item_ids.length
    || state.anchor_item_ids.some((itemId) =>
      !state.required_item_ids.includes(itemId))
    || new Set(state.reveal_tiers).size !== state.reveal_tiers.length
    || state.reveal_tiers.some((tier) => ![1, 2, 3].includes(tier))
    || !sameStringSet(required, state.required_item_ids)) {
    throw new LearningCycleStoreError(
      "INVALID_RECORD",
      "ROUTE_LOCKED 会话状态不一致",
    )
  }
}

function normalizeSubmission(
  record: LearningSubmissionRecord,
  creating: boolean,
): LearningSubmissionRecord {
  const normalized = jsonClone(record)
  assertBaseRecord(normalized, creating)
  assertIdentifier(normalized.session_id, "session_id")
  assertIdentifier(normalized.submission_id, "submission_id")
  assertIdentifier(normalized.run_id, "run_id")
  if (normalized.submission.submission_id !== normalized.submission_id
    || normalized.submission.run_id !== normalized.run_id) {
    throw new LearningCycleStoreError("INVALID_RECORD", "submission record 身份与提交信封不一致")
  }
  if (normalized.input_hash !== learningSubmissionInputHash(normalized.submission)) {
    throw new LearningCycleStoreError("INVALID_RECORD", "submission input_hash 不匹配")
  }
  assertSubmissionState(normalized)
  if (normalized.feedback) {
    if (normalized.feedback.session_id !== normalized.session_id
      || normalized.feedback.submission_id !== normalized.submission_id
      || normalized.feedback.run_id !== normalized.run_id
      || normalized.feedback.learner_id_hash !== normalized.submission.learner_id_hash
      || normalized.feedback.form_id !== normalized.submission.form_id
      || normalized.feedback.attempt_no !== normalized.submission.attempt_no
      || normalized.feedback.grade_result.run_id !== normalized.run_id
      || normalized.feedback.grade_result.payload?.submission_id !== normalized.submission_id
      || normalized.feedback.grade_result.payload?.form_id !== normalized.submission.form_id) {
      throw new LearningCycleStoreError("INVALID_RECORD", "feedback 身份与 submission record 不一致")
    }
    const feedbackSchema = validateRoleCSchema(
      "dynamic_feedback_result.schema.json",
      normalized.feedback,
    )
    if (!feedbackSchema.ok || !validatePublicArtifactNoSecrets(normalized.feedback).ok) {
      throw new LearningCycleStoreError("INVALID_RECORD", "公开 feedback Schema 或隔离校验失败")
    }
  }
  if (normalized.processing_owner_id !== undefined) {
    assertIdentifier(normalized.processing_owner_id, "processing_owner_id")
    if (!Number.isSafeInteger(normalized.processing_lease_expires_at)
      || normalized.processing_lease_expires_at! <= 0) {
      throw new LearningCycleStoreError("INVALID_RECORD", "processing lease 无效")
    }
  } else if (normalized.processing_lease_expires_at !== undefined) {
    throw new LearningCycleStoreError("INVALID_RECORD", "processing lease 缺少 owner")
  }
  if (normalized.evidence_events) {
    const gradeItems = new Map(normalized.feedback?.grade_result.payload?.item_results.map(
      (item) => [item.item_id, item],
    ) ?? [])
    if (new Set(normalized.evidence_events.map((event) => event.event_id)).size
      !== normalized.evidence_events.length
      || normalized.evidence_events.some((event) =>
        !validateRoleCSchema("learning_evidence_event.schema.json", event).ok
          || event.learner_id_hash !== normalized.submission.learner_id_hash
          || event.profile_version !== normalized.feedback?.profile_version
          || event.path_node_id !== normalized.feedback?.path_node_id
          || event.evidence.attempt_no !== normalized.submission.attempt_no
          || event.provenance.artifact_id !== normalized.feedback?.grade_result.artifact_id
          || !/^sha256:[a-f0-9]{64}$/.test(event.provenance.idempotency_key)
          || !gradeItemMatchesEvent(
            gradeItems.get(event.provenance.item_id),
            event,
          ))) {
      throw new LearningCycleStoreError("INVALID_RECORD", "evidence events 身份无效或重复")
    }
  }
  if (normalized.mastery_states) {
    const objectiveIds = normalized.mastery_states.map((state) => state.objective_id)
    if (new Set(objectiveIds).size !== objectiveIds.length
      || normalized.mastery_states.some((state) =>
        state.learner_id_hash !== normalized.submission.learner_id_hash
          || state.profile_version !== normalized.feedback?.profile_version)) {
      throw new LearningCycleStoreError("INVALID_RECORD", "mastery states 身份无效或重复")
    }
  }
  if (normalized.mastery_writes) {
    const statesByObjective = new Map(normalized.mastery_states?.map((state) => [
      state.objective_id,
      state,
    ]) ?? [])
    const writeObjectives = normalized.mastery_writes.map((write) =>
      write.state.objective_id)
    if (new Set(writeObjectives).size !== writeObjectives.length
      || normalized.mastery_writes.some((write) =>
        write.state.learner_id_hash !== normalized.submission.learner_id_hash
          || write.state.profile_version !== normalized.feedback?.profile_version
          || write.expected_revision < 0
          || write.state.revision !== write.expected_revision + 1
          || contentHash(write.state) !== contentHash(
            statesByObjective.get(write.state.objective_id),
          ))) {
      throw new LearningCycleStoreError("INVALID_RECORD", "mastery writes 无效或重复")
    }
  }
  if (normalized.evidence_events && normalized.mastery_states && normalized.feedback) {
    const eventObjectives = [...new Set(normalized.evidence_events.map((event) =>
      event.objective_id))].sort()
    const stateObjectives = normalized.mastery_states.map((state) =>
      state.objective_id).sort()
    const snapshotsByObjective = new Map(normalized.feedback.mastery_snapshot.map((snapshot) => [
      snapshot.objective_id,
      snapshot,
    ]))
    const statesMatchFeedback = normalized.mastery_states.every((state) => {
      const snapshot = snapshotsByObjective.get(state.objective_id)
      return snapshot
        && snapshot.mastery === state.mastery
        && snapshot.evidence_batches === state.evidence_batches
        && snapshot.revision === state.revision
        && contentHash(snapshot.observed_modalities) === contentHash(state.observed_modalities)
    })
    if (contentHash(eventObjectives) !== contentHash(stateObjectives)
      || snapshotsByObjective.size !== normalized.mastery_states.length
      || !statesMatchFeedback) {
      throw new LearningCycleStoreError(
        "INVALID_RECORD",
        "学习证据、掌握度状态与公开快照不一致",
      )
    }
    try {
      const rebuilt = buildDynamicFeedbackResult({
        session_id: normalized.session_id,
        learner_id_hash: normalized.submission.learner_id_hash,
        profile_version: normalized.feedback.profile_version,
        path_node_id: normalized.feedback.path_node_id,
        attempt_no: normalized.submission.attempt_no,
        grade_result: normalized.feedback.grade_result,
        mastery_states: normalized.mastery_states,
        final_decision: normalized.feedback.final_decision,
        ...(normalized.feedback.profile_drift_suggestion
          ? { profile_drift_suggestion: normalized.feedback.profile_drift_suggestion }
          : {}),
      })
      if (contentHash(rebuilt) !== contentHash(normalized.feedback)) {
        throw new Error("feedback mismatch")
      }
    } catch {
      throw new LearningCycleStoreError("INVALID_RECORD", "公开 feedback 无法由冻结状态重建")
    }
  }
  return normalized
}

function gradeItemMatchesEvent(
  item: NonNullable<DynamicFeedbackResult["grade_result"]["payload"]>["item_results"][number]
    | undefined,
  event: LearningEvidenceEvent,
): boolean {
  return Boolean(item
    && item.item_id === event.provenance.item_id
    && item.objective_id === event.objective_id
    && item.raw_score === event.evidence.raw_score
    && item.evidence_score === event.evidence.evidence_score
    && item.grader_confidence === event.evidence.grader_confidence
    && contentHash(item.misconception_tags) === contentHash(event.misconceptions))
}

function assertSubmissionState(record: LearningSubmissionRecord): void {
  const valid = new Set<LearningSubmissionStatus>([
    "RECEIVED",
    "SCORED",
    "DECIDED",
    "MASTERY_APPLIED",
    "COMPLETED",
    "BLOCKED",
    "NEEDS_REVIEW",
  ])
  if (!valid.has(record.status)) {
    throw new LearningCycleStoreError("INVALID_RECORD", "未知 submission 状态")
  }
  if (record.grade) {
    if (record.grade.submission_id !== record.submission_id
      || record.grade.form_id !== record.submission.form_id) {
      throw new LearningCycleStoreError("INVALID_RECORD", "grade 身份与 submission 不一致")
    }
  }
  if (record.status === "RECEIVED" && (record.grade || record.feedback)) {
    throw new LearningCycleStoreError("INVALID_RECORD", "RECEIVED 不得提前保存评分或反馈")
  }
  if (record.status === "SCORED" && record.grade?.status !== "graded") {
    throw new LearningCycleStoreError("INVALID_RECORD", "SCORED 必须包含 graded 结果")
  }
  if (["DECIDED", "MASTERY_APPLIED", "COMPLETED"].includes(record.status)
    && (record.grade?.status !== "graded" || !record.feedback
      || !record.evidence_events || !record.mastery_states)) {
    throw new LearningCycleStoreError(
      "INVALID_RECORD",
      `${record.status} 必须包含评分、动态反馈和冻结的学习证据/掌握度状态`,
    )
  }
  if (["DECIDED", "MASTERY_APPLIED", "COMPLETED"].includes(record.status)
    && !record.mastery_writes) {
    throw new LearningCycleStoreError("INVALID_RECORD", `${record.status} 缺少 mastery outbox`)
  }
  if (["SCORED", "DECIDED", "MASTERY_APPLIED", "COMPLETED"].includes(record.status)
    && record.grade?.boundary_verified !== true) {
    throw new LearningCycleStoreError("INVALID_RECORD", `${record.status} 必须通过可信提交边界`)
  }
  if (record.status === "BLOCKED"
    && record.grade?.status !== "blocked"
    && (record.issues?.length ?? 0) === 0) {
    throw new LearningCycleStoreError("INVALID_RECORD", "BLOCKED 必须包含阻塞评分或问题")
  }
  if (record.status === "NEEDS_REVIEW" && record.grade?.status !== "needs_review") {
    throw new LearningCycleStoreError("INVALID_RECORD", "NEEDS_REVIEW 必须包含待复核评分")
  }
  if (["COMPLETED", "BLOCKED", "NEEDS_REVIEW"].includes(record.status)
    && (record.processing_owner_id || record.processing_lease_expires_at)) {
    throw new LearningCycleStoreError("INVALID_RECORD", `${record.status} 不得保留 processing lease`)
  }
}

function assertSubmissionTransition(
  current: LearningSubmissionStatus,
  next: LearningSubmissionStatus,
): void {
  const transitions: Record<LearningSubmissionStatus, readonly LearningSubmissionStatus[]> = {
    RECEIVED: ["SCORED", "BLOCKED", "NEEDS_REVIEW"],
    SCORED: ["DECIDED", "BLOCKED"],
    DECIDED: ["MASTERY_APPLIED", "BLOCKED"],
    MASTERY_APPLIED: ["COMPLETED", "BLOCKED"],
    COMPLETED: [],
    BLOCKED: [],
    NEEDS_REVIEW: [],
  }
  if (current !== next && !transitions[current].includes(next)) {
    throw new LearningCycleStoreError(
      "INVALID_RECORD",
      `非法 submission 状态转换：${current} -> ${next}`,
    )
  }
}

function assertBaseRecord(record: { schema_version: string; revision: number }, creating: boolean): void {
  if (record.schema_version !== "1.0") {
    throw new LearningCycleStoreError("INVALID_RECORD", "record schema_version 必须为 1.0")
  }
  if (!Number.isSafeInteger(record.revision) || record.revision < 0) {
    throw new LearningCycleStoreError("INVALID_RECORD", "record revision 必须为非负整数")
  }
  if (creating && record.revision !== 0) {
    throw new LearningCycleStoreError("INVALID_RECORD", "新 record revision 必须为 0")
  }
}

function assertRevisionTransition(revision: number, expectedRevision: number): void {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new LearningCycleStoreError("INVALID_RECORD", "expectedRevision 必须为非负整数")
  }
  if (revision !== expectedRevision + 1) {
    throw new LearningCycleStoreError("INVALID_RECORD", "保存后的 revision 必须恰好增加 1")
  }
}

function assertIdentifier(value: string, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new LearningCycleStoreError("INVALID_RECORD", `${label} 不能为空`)
  }
  return value
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  const leftSet = new Set(left)
  const rightSet = new Set(right)
  return leftSet.size === left.length
    && rightSet.size === right.length
    && leftSet.size === rightSet.size
    && [...leftSet].every((value) => rightSet.has(value))
}

function assertSecureRef(value: string, label: string): void {
  if (!/^secure:\/\/role-c\/v1\/[a-f0-9]{48}\/[a-f0-9]{48}$/.test(value)) {
    throw new LearningCycleStoreError("INVALID_RECORD", `${label} 格式无效`)
  }
}

function createMemory<T extends { revision: number }>(
  values: Map<string, T>,
  key: string,
  value: T,
): void {
  if (values.has(key)) throw new LearningCycleStoreError("ALREADY_EXISTS", "record 已存在")
  values.set(key, jsonClone(value))
}

function saveMemory<T extends { revision: number }>(
  values: Map<string, T>,
  key: string,
  value: T,
  expectedRevision: number,
): void {
  assertRevisionTransition(value.revision, expectedRevision)
  const current = values.get(key)
  if (!current) throw new LearningCycleStoreError("NOT_FOUND", "record 不存在")
  if (current.revision !== expectedRevision) {
    throw new LearningCycleStoreError("REVISION_CONFLICT", "record revision 冲突")
  }
  values.set(key, jsonClone(value))
}

function submissionKey(sessionId: string, submissionId: string): string {
  return `${sessionId}\u0000${submissionId}`
}

function envelopeFor<T extends { revision: number }>(
  kind: LearningCycleRecordKind,
  key: string,
  record: T,
): StoredRecordEnvelope<T> {
  const payload = jsonClone(record)
  return {
    storage_version: "1.0",
    record_kind: kind,
    record_key: key,
    revision: payload.revision,
    payload_hash: contentHash(payload),
    payload,
  }
}

function isStoredEnvelope<T>(
  value: unknown,
): value is StoredRecordEnvelope<T & { revision: number }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const envelope = value as Record<string, unknown>
  const payload = envelope.payload
  return envelope.storage_version === "1.0"
    && ["run", "session", "submission"].includes(String(envelope.record_kind))
    && typeof envelope.record_key === "string"
    && Number.isSafeInteger(envelope.revision)
    && typeof envelope.payload_hash === "string"
    && Boolean(payload && typeof payload === "object" && !Array.isArray(payload))
    && Number.isSafeInteger((payload as Record<string, unknown>).revision)
}

async function ensurePrivateDirectory(path: string): Promise<void> {
  try {
    await mkdir(path, { recursive: true, mode: 0o700 })
    await chmod(path, 0o700)
  } catch (error) {
    throw storageError(error, "private store directory 创建失败")
  }
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function cloneOptional<T>(value: T | undefined): T | undefined {
  return value === undefined ? undefined : jsonClone(value)
}

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT")
}

function isExists(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "EEXIST")
}

async function tryReclaimStaleLock(
  lockPath: string,
  staleLeaseMs: number,
): Promise<boolean> {
  const observed = await inspectLock(lockPath)
  if (!observed || !lockIsStale(observed, staleLeaseMs)) return false

  const reclaimOwner: ReclaimClaimMetadata = {
    lock_version: "1.0",
    owner_token: randomUUID(),
    pid: process.pid,
    hostname: machineHostname(),
    created_at_ms: Date.now(),
    target_device: observed.device,
    target_inode: observed.inode,
    target_owner_token: observed.metadata?.owner_token,
  }
  const reclaimPath = join(lockPath, LOCK_RECLAIM_FILE)
  if (!await acquireReclaimClaim(reclaimPath, reclaimOwner, staleLeaseMs)) return false

  try {
    const confirmed = await inspectLock(lockPath)
    if (!confirmed
      || confirmed.device !== observed.device
      || confirmed.inode !== observed.inode
      || !lockIsStale(confirmed, staleLeaseMs, observed.directory_mtime_ms)) {
      return false
    }
    if ((await readLockMetadataFile(reclaimPath))?.owner_token !== reclaimOwner.owner_token) {
      return false
    }

    const quarantinePath = `${lockPath}.stale-${reclaimOwner.owner_token}`
    try {
      await rename(lockPath, quarantinePath)
    } catch (error) {
      if (isMissing(error)) return false
      throw error
    }
    await rm(quarantinePath, { recursive: true, force: true })
    return true
  } finally {
    await removeFileIfTokenMatches(reclaimPath, reclaimOwner.owner_token)
  }
}

async function releaseOwnedLock(
  lockPath: string,
  ownerToken: string,
  staleLeaseMs: number,
): Promise<void> {
  const snapshot = await inspectLock(lockPath).catch(() => undefined)
  if (snapshot?.metadata?.owner_token !== ownerToken) return
  const reclaimPath = join(lockPath, LOCK_RECLAIM_FILE)
  if (await exists(reclaimPath).catch(() => true)) {
    const claim = await readReclaimClaim(reclaimPath).catch(() => undefined)
    const targetsThisLock = claim
      && claim.target_device === snapshot.device
      && claim.target_inode === snapshot.inode
      && claim.target_owner_token === ownerToken
    if (!targetsThisLock && claim) {
      await removeFileIfTokenMatches(reclaimPath, claim.owner_token)
    } else if (!await removeStaleMetadataFile(reclaimPath, staleLeaseMs).catch(() => false)) {
      return
    }
  }
  const confirmed = await inspectLock(lockPath).catch(() => undefined)
  if (confirmed?.metadata?.owner_token !== ownerToken) return
  const quarantinePath = `${lockPath}.released-${ownerToken}`
  try {
    await rename(lockPath, quarantinePath)
  } catch (error) {
    if (isMissing(error)) return
    throw error
  }
  await rm(quarantinePath, { recursive: true, force: true }).catch(() => undefined)
}

async function acquireReclaimClaim(
  reclaimPath: string,
  owner: ReclaimClaimMetadata,
  staleLeaseMs: number,
): Promise<boolean> {
  const candidatePath = `${reclaimPath}.${owner.owner_token}.tmp`
  try {
    await writeFile(candidatePath, JSON.stringify(owner), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    })
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        // link publishes a fully written claim and preserves exclusive-create
        // semantics without exposing a partially written metadata file.
        await link(candidatePath, reclaimPath)
        return true
      } catch (error) {
        if (isMissing(error)) return false
        if (!isExists(error)) throw error
        if (!await removeStaleMetadataFile(reclaimPath, staleLeaseMs)) return false
      }
    }
    return false
  } catch (error) {
    if (isMissing(error)) return false
    throw error
  } finally {
    await rm(candidatePath, { force: true }).catch(() => undefined)
  }
}

async function removeStaleMetadataFile(path: string, staleLeaseMs: number): Promise<boolean> {
  const observed = await inspectMetadataFile(path)
  if (!observed || !metadataIsStale(observed.metadata, observed.mtime_ms, staleLeaseMs)) {
    return false
  }
  const confirmed = await inspectMetadataFile(path)
  if (!confirmed
    || confirmed.device !== observed.device
    || confirmed.inode !== observed.inode
    || confirmed.raw !== observed.raw
    || !metadataIsStale(confirmed.metadata, observed.mtime_ms, staleLeaseMs)) {
    return false
  }
  await rm(path, { force: true })
  return true
}

async function inspectLock(lockPath: string): Promise<FileLockSnapshot | undefined> {
  let directory
  try {
    directory = await stat(lockPath)
  } catch (error) {
    if (isMissing(error)) return undefined
    throw error
  }

  let metadata: FileLockMetadata | undefined
  try {
    const parsed = JSON.parse(await readFile(join(lockPath, LOCK_METADATA_FILE), "utf8"))
    if (isFileLockMetadata(parsed)) metadata = parsed
  } catch {
    // Missing, malformed, or unreadable ownership is unknown rather than dead.
    // The fallback directory lease must expire before it can be reclaimed.
  }
  return {
    metadata,
    directory_mtime_ms: directory.mtimeMs,
    device: directory.dev,
    inode: directory.ino,
  }
}

function lockIsStale(
  snapshot: FileLockSnapshot,
  staleLeaseMs: number,
  fallbackCreatedAtMs = snapshot.directory_mtime_ms,
): boolean {
  return metadataIsStale(snapshot.metadata, fallbackCreatedAtMs, staleLeaseMs)
}

function metadataIsStale(
  metadata: FileLockMetadata | undefined,
  fallbackCreatedAtMs: number,
  staleLeaseMs: number,
): boolean {
  if (metadata?.hostname === machineHostname()) {
    const status = localPidStatus(metadata.pid)
    if (status === "alive") return false
    if (status === "dead") return true
  }
  const createdAt = metadata?.created_at_ms ?? fallbackCreatedAtMs
  return Date.now() - createdAt >= staleLeaseMs
}

function localPidStatus(pid: number): "alive" | "dead" | "unknown" {
  try {
    process.kill(pid, 0)
    return "alive"
  } catch (error) {
    if (hasErrorCode(error, "ESRCH")) return "dead"
    if (hasErrorCode(error, "EPERM")) return "alive"
    return "unknown"
  }
}

function isFileLockMetadata(value: unknown): value is FileLockMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const metadata = value as Record<string, unknown>
  return metadata.lock_version === "1.0"
    && typeof metadata.owner_token === "string"
    && metadata.owner_token.length > 0
    && Number.isSafeInteger(metadata.pid)
    && Number(metadata.pid) > 0
    && typeof metadata.hostname === "string"
    && metadata.hostname.length > 0
    && Number.isSafeInteger(metadata.created_at_ms)
    && Number(metadata.created_at_ms) >= 0
}

async function removeFileIfTokenMatches(path: string, token: string): Promise<void> {
  if ((await readLockMetadataFile(path))?.owner_token !== token) return
  await rm(path, { force: true }).catch(() => undefined)
}

async function readLockMetadataFile(path: string): Promise<FileLockMetadata | undefined> {
  const inspected = await inspectMetadataFile(path)
  return inspected?.metadata
}

async function readReclaimClaim(path: string): Promise<ReclaimClaimMetadata | undefined> {
  const inspected = await inspectMetadataFile(path)
  if (!inspected?.metadata) return undefined
  const parsed = JSON.parse(inspected.raw) as unknown
  return isReclaimClaimMetadata(parsed) ? parsed : undefined
}

function isReclaimClaimMetadata(value: unknown): value is ReclaimClaimMetadata {
  if (!isFileLockMetadata(value)) return false
  const claim = value as unknown as Record<string, unknown>
  return Number.isSafeInteger(claim.target_device)
    && Number.isSafeInteger(claim.target_inode)
    && (claim.target_owner_token === undefined
      || (typeof claim.target_owner_token === "string" && claim.target_owner_token.length > 0))
}

async function inspectMetadataFile(path: string): Promise<{
  metadata?: FileLockMetadata
  raw: string
  mtime_ms: number
  device: number
  inode: number
} | undefined> {
  let file
  try {
    file = await stat(path)
  } catch (error) {
    if (isMissing(error)) return undefined
    throw error
  }
  let raw: string
  try {
    raw = await readFile(path, "utf8")
  } catch (error) {
    if (isMissing(error)) return undefined
    raw = `<unreadable:${errorCode(error)}>`
  }
  let metadata: FileLockMetadata | undefined
  try {
    const parsed = JSON.parse(raw)
    if (isFileLockMetadata(parsed)) metadata = parsed
  } catch {
    // Unknown metadata is reclaimed only after the conservative fallback lease.
  }
  return {
    metadata,
    raw,
    mtime_ms: file.mtimeMs,
    device: file.dev,
    inode: file.ino,
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code)
}

function errorCode(error: unknown): string {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : "unknown"
}

function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true, (error) => {
    if (isMissing(error)) return false
    throw storageError(error, "record stat 失败")
  })
}

function storageError(error: unknown, message: string): LearningCycleStoreError {
  if (error instanceof LearningCycleStoreError) return error
  const suffix = error instanceof Error ? `：${error.name}` : ""
  return new LearningCycleStoreError("STORAGE_ERROR", `${message}${suffix}`)
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
