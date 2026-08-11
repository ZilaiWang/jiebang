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
import { join } from "node:path"
import { contentHash } from "../contracts/common"
import type {
  MasteryStateStore,
  MasteryStateWrite,
  ObjectiveMasteryState,
} from "../mastery/beta-mastery"

export class MasteryFileStoreError extends Error {
  constructor(
    readonly code:
      | "REVISION_CONFLICT"
      | "INVALID_STATE"
      | "INTEGRITY_ERROR"
      | "STORAGE_ERROR"
      | "LOCK_TIMEOUT",
    message: string,
  ) {
    super(message)
    this.name = "MasteryFileStoreError"
  }
}

export interface AtomicFileMasteryStateStoreOptions {
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

interface StoredMasteryEntry {
  identity: {
    learner_id_hash: string
    profile_version: string
    objective_id: string
  }
  state: ObjectiveMasteryState
}

interface MasterySnapshot {
  entries: Record<string, StoredMasteryEntry>
}

interface StoredMasteryEnvelope {
  storage_version: "1.0"
  payload_hash: string
  payload: MasterySnapshot
}

/**
 * Persists the complete mastery map as one integrity-checked snapshot. A batch checks
 * every expected revision before replacing the file, so objectives cannot be partly
 * committed.
 */
export class AtomicFileMasteryStateStore implements MasteryStateStore {
  private readonly snapshotPath: string
  private readonly lockPath: string

  constructor(private readonly options: AtomicFileMasteryStateStoreOptions) {
    if (!options.root_directory.trim()) {
      throw new MasteryFileStoreError("INVALID_STATE", "root_directory 不能为空")
    }
    if (options.lock_timeout_ms !== undefined
      && (!Number.isSafeInteger(options.lock_timeout_ms) || options.lock_timeout_ms < 0)) {
      throw new MasteryFileStoreError("INVALID_STATE", "lock_timeout_ms 必须为非负整数")
    }
    if (options.stale_lock_lease_ms !== undefined
      && (!Number.isSafeInteger(options.stale_lock_lease_ms)
        || options.stale_lock_lease_ms < 1)) {
      throw new MasteryFileStoreError(
        "INVALID_STATE",
        "stale_lock_lease_ms 必须为正整数",
      )
    }
    this.snapshotPath = join(options.root_directory, "mastery-state.json")
    this.lockPath = join(options.root_directory, ".mastery-state.lock")
  }

  async load(
    learnerIdHash: string,
    profileVersion: string,
    objectiveId: string,
  ): Promise<ObjectiveMasteryState | undefined> {
    assertIdentifier(learnerIdHash, "learner_id_hash")
    assertIdentifier(profileVersion, "profile_version")
    assertIdentifier(objectiveId, "objective_id")
    const snapshot = await this.readSnapshot()
    const digest = masteryKey(learnerIdHash, profileVersion, objectiveId)
    const entry = snapshot.entries[digest]
    if (!entry) return undefined
    if (!sameIdentity(entry.identity, { learner_id_hash: learnerIdHash, profile_version: profileVersion, objective_id: objectiveId })) {
      throw new MasteryFileStoreError("INTEGRITY_ERROR", "mastery key 与 identity 不一致")
    }
    assertMasteryState(entry.state)
    return jsonClone(entry.state)
  }

  async save(state: ObjectiveMasteryState, expectedRevision: number): Promise<void> {
    await this.saveBatch([{ state, expected_revision: expectedRevision }])
  }

  async saveBatch(writes: MasteryStateWrite[]): Promise<void> {
    if (writes.length === 0) return
    assertUniqueWrites(writes)
    for (const write of writes) {
      assertExpectedRevision(write.expected_revision)
      assertMasteryState(write.state)
      if (write.state.revision !== write.expected_revision + 1) {
        throw new MasteryFileStoreError(
          "INVALID_STATE",
          "mastery state revision 必须等于 expected revision + 1",
        )
      }
    }

    await this.withLock(async () => {
      const snapshot = await this.readSnapshot()
      for (const write of writes) {
        const identity = identityOf(write.state)
        const current = snapshot.entries[masteryKey(
          identity.learner_id_hash,
          identity.profile_version,
          identity.objective_id,
        )]
        if ((current?.state.revision ?? 0) !== write.expected_revision) {
          throw new MasteryFileStoreError(
            "REVISION_CONFLICT",
            `mastery revision 冲突：${identity.objective_id}`,
          )
        }
      }

      const next = jsonClone(snapshot)
      for (const write of writes) {
        const identity = identityOf(write.state)
        next.entries[masteryKey(
          identity.learner_id_hash,
          identity.profile_version,
          identity.objective_id,
        )] = {
          identity,
          state: jsonClone(write.state),
        }
      }
      await this.writeSnapshot(next)
    })
  }

  private async readSnapshot(): Promise<MasterySnapshot> {
    let value: unknown
    try {
      value = JSON.parse(await readFile(this.snapshotPath, "utf8"))
    } catch (error) {
      if (isMissing(error)) return { entries: {} }
      if (error instanceof SyntaxError) {
        throw new MasteryFileStoreError("INTEGRITY_ERROR", "mastery snapshot JSON 损坏")
      }
      throw storageError(error, "mastery snapshot 读取失败")
    }
    if (!isMasteryEnvelope(value)
      || contentHash(value.payload) !== value.payload_hash) {
      throw new MasteryFileStoreError("INTEGRITY_ERROR", "mastery snapshot 完整性校验失败")
    }
    for (const [digest, entry] of Object.entries(value.payload.entries)) {
      assertMasteryState(entry.state)
      const expectedDigest = masteryKey(
        entry.identity.learner_id_hash,
        entry.identity.profile_version,
        entry.identity.objective_id,
      )
      if (digest !== expectedDigest || !sameIdentity(entry.identity, identityOf(entry.state))) {
        throw new MasteryFileStoreError("INTEGRITY_ERROR", "mastery snapshot 索引与状态身份不一致")
      }
    }
    return jsonClone(value.payload)
  }

  private async writeSnapshot(snapshot: MasterySnapshot): Promise<void> {
    await ensurePrivateDirectory(this.options.root_directory)
    const payload = jsonClone(snapshot)
    const envelope: StoredMasteryEnvelope = {
      storage_version: "1.0",
      payload_hash: contentHash(payload),
      payload,
    }
    const temporary = `${this.snapshotPath}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, JSON.stringify(envelope), {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      })
      await rename(temporary, this.snapshotPath)
      await chmod(this.snapshotPath, 0o600)
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined)
      if (error instanceof MasteryFileStoreError) throw error
      throw storageError(error, "mastery snapshot 写入失败")
    }
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    await ensurePrivateDirectory(this.options.root_directory)
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
        await mkdir(this.lockPath, { mode: 0o700 })
        try {
          await writeFile(join(this.lockPath, LOCK_METADATA_FILE), JSON.stringify(owner), {
            encoding: "utf8",
            flag: "wx",
            mode: 0o600,
          })
        } catch (error) {
          // mkdir made this directory exclusively ours; avoid stranding it if
          // metadata initialization itself fails.
          await rm(this.lockPath, { recursive: true, force: true }).catch(() => undefined)
          throw storageError(error, "mastery lock 元数据写入失败")
        }
        break
      } catch (error) {
        if (!isExists(error)) throw storageError(error, "mastery lock 创建失败")
        let reclaimed: boolean
        try {
          reclaimed = await tryReclaimStaleLock(this.lockPath, staleLeaseMs)
        } catch (reclaimError) {
          throw storageError(reclaimError, "mastery stale lock 回收失败")
        }
        if (reclaimed) continue
        if (Date.now() - started >= timeoutMs) {
          throw new MasteryFileStoreError("LOCK_TIMEOUT", "mastery store lock 超时")
        }
        await delay(5)
      }
    }
    try {
      return await operation()
    } finally {
      await releaseOwnedLock(this.lockPath, owner.owner_token, staleLeaseMs)
    }
  }
}

/** Operational helper used by tests and deployment checks without reading content. */
export async function masteryStorePathMode(path: string): Promise<number> {
  return (await stat(path)).mode & 0o777
}

function assertMasteryState(state: ObjectiveMasteryState): void {
  if (!state || typeof state !== "object" || state.schema_version !== "1.0") {
    throw new MasteryFileStoreError("INVALID_STATE", "mastery state schema_version 无效")
  }
  assertIdentifier(state.learner_id_hash, "learner_id_hash")
  assertIdentifier(state.profile_version, "profile_version")
  assertIdentifier(state.objective_id, "objective_id")
  if (!Number.isFinite(state.alpha) || state.alpha <= 0
    || !Number.isFinite(state.beta) || state.beta <= 0
    || !Number.isFinite(state.mastery) || state.mastery < 0 || state.mastery > 1) {
    throw new MasteryFileStoreError("INVALID_STATE", "mastery Beta 参数或 mastery 越界")
  }
  const calculated = state.alpha / (state.alpha + state.beta)
  if (Math.abs(calculated - state.mastery) > 0.000002) {
    throw new MasteryFileStoreError("INVALID_STATE", "mastery 与 Beta 参数不一致")
  }
  if (!Number.isSafeInteger(state.evidence_batches) || state.evidence_batches < 0
    || !Number.isSafeInteger(state.revision) || state.revision < 0) {
    throw new MasteryFileStoreError("INVALID_STATE", "mastery 计数或 revision 无效")
  }
  const modalities = new Set(["mcq", "true_false", "trace", "short_answer", "code"])
  if (new Set(state.observed_modalities).size !== state.observed_modalities.length
    || state.observed_modalities.some((modality) => !modalities.has(modality))) {
    throw new MasteryFileStoreError("INVALID_STATE", "observed_modalities 无效或重复")
  }
  if (new Set(state.processed_artifact_ids).size !== state.processed_artifact_ids.length
    || state.processed_artifact_ids.some((artifactId) => !artifactId.trim())) {
    throw new MasteryFileStoreError("INVALID_STATE", "processed_artifact_ids 无效或重复")
  }
  if (!["remediate", "reinforce", "advance", "reprofile"].includes(state.last_action)) {
    throw new MasteryFileStoreError("INVALID_STATE", "last_action 无效")
  }
}

function assertUniqueWrites(writes: MasteryStateWrite[]): void {
  const keys = writes.map((write) => masteryKey(
    write.state.learner_id_hash,
    write.state.profile_version,
    write.state.objective_id,
  ))
  if (new Set(keys).size !== keys.length) {
    throw new MasteryFileStoreError("INVALID_STATE", "同一 batch 不得重复写 objective")
  }
}

function assertExpectedRevision(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new MasteryFileStoreError("INVALID_STATE", "expected revision 必须为非负整数")
  }
}

function assertIdentifier(value: string, label: string): void {
  if (typeof value !== "string" || !value.trim()) {
    throw new MasteryFileStoreError("INVALID_STATE", `${label} 不能为空`)
  }
}

function identityOf(state: ObjectiveMasteryState): StoredMasteryEntry["identity"] {
  return {
    learner_id_hash: state.learner_id_hash,
    profile_version: state.profile_version,
    objective_id: state.objective_id,
  }
}

function sameIdentity(
  left: StoredMasteryEntry["identity"],
  right: StoredMasteryEntry["identity"],
): boolean {
  return left.learner_id_hash === right.learner_id_hash
    && left.profile_version === right.profile_version
    && left.objective_id === right.objective_id
}

function masteryKey(
  learnerIdHash: string,
  profileVersion: string,
  objectiveId: string,
): string {
  return contentHash({
    contract: "role-c-mastery-key-v1",
    learner_id_hash: learnerIdHash,
    profile_version: profileVersion,
    objective_id: objectiveId,
  }).slice("sha256:".length)
}

function isMasteryEnvelope(value: unknown): value is StoredMasteryEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const envelope = value as Record<string, unknown>
  const payload = envelope.payload
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false
  const entries = (payload as Record<string, unknown>).entries
  return envelope.storage_version === "1.0"
    && typeof envelope.payload_hash === "string"
    && Boolean(entries && typeof entries === "object" && !Array.isArray(entries))
}

async function ensurePrivateDirectory(path: string): Promise<void> {
  try {
    await mkdir(path, { recursive: true, mode: 0o700 })
    await chmod(path, 0o700)
  } catch (error) {
    throw storageError(error, "mastery store directory 创建失败")
  }
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
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
  if (await pathExists(reclaimPath).catch(() => true)) {
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

function pathExists(path: string): Promise<boolean> {
  return stat(path).then(() => true, (error) => {
    if (isMissing(error)) return false
    throw error
  })
}

function hasErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code)
}

function errorCode(error: unknown): string {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : "unknown"
}

function storageError(error: unknown, message: string): MasteryFileStoreError {
  if (error instanceof MasteryFileStoreError) return error
  const suffix = error instanceof Error ? `：${error.name}` : ""
  return new MasteryFileStoreError("STORAGE_ERROR", `${message}${suffix}`)
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
