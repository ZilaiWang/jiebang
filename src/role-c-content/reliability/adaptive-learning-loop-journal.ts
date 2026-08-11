import { randomUUID } from "node:crypto"
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import { hostname as machineHostname } from "node:os"
import { dirname, join } from "node:path"
import { contentHash } from "../contracts/common"

export interface AdaptiveLearningLoopJournalEntry {
  journal_version: "1.0"
  execution_key: string
  source_key: string
  request_hash: string
  revision: number
  state_hash: string
  /**
   * Backend-only orchestration state. It may contain a full evidence pack,
   * including answer-bearing quiz seeds, and must never be exposed publicly.
   */
  state: unknown
}

export interface AdaptiveLearningLoopJournalTransaction {
  load(): Promise<AdaptiveLearningLoopJournalEntry | undefined>
  /**
   * expectedRevision is undefined only when creating revision 0. Every later
   * checkpoint advances exactly one revision.
   */
  save(
    entry: AdaptiveLearningLoopJournalEntry,
    expectedRevision: number | undefined,
  ): Promise<void>
}

/**
 * Holds one execution key exclusively while its callback reads and advances
 * durable checkpoints. The file implementation keeps this lock across remote
 * A/B, generation, lifecycle and D calls.
 */
export interface AdaptiveLearningLoopJournal {
  withExclusive<T>(
    executionKey: string,
    operation: (
      transaction: AdaptiveLearningLoopJournalTransaction,
    ) => Promise<T>,
  ): Promise<T>
}

export class AdaptiveLearningLoopJournalError extends Error {
  constructor(
    readonly code:
      | "INVALID_ENTRY"
      | "INTEGRITY_ERROR"
      | "REVISION_CONFLICT"
      | "LOCK_TIMEOUT"
      | "STORAGE_ERROR",
    message: string,
  ) {
    super(message)
    this.name = "AdaptiveLearningLoopJournalError"
  }
}

/** Process-local adapter with the same serialized checkpoint contract. */
export class InMemoryAdaptiveLearningLoopJournal
implements AdaptiveLearningLoopJournal {
  private readonly entries = new Map<
    string,
    AdaptiveLearningLoopJournalEntry
  >()
  private readonly tails = new Map<string, Promise<void>>()

  async withExclusive<T>(
    executionKey: string,
    operation: (
      transaction: AdaptiveLearningLoopJournalTransaction,
    ) => Promise<T>,
  ): Promise<T> {
    assertExecutionKey(executionKey)
    const prior = this.tails.get(executionKey) ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = prior.then(() => gate)
    this.tails.set(executionKey, tail)
    await prior
    try {
      return await operation({
        load: async () => {
          const entry = this.entries.get(executionKey)
          return entry ? cloneAndValidateEntry(entry, executionKey) : undefined
        },
        save: async (entry, expectedRevision) => {
          const normalized = cloneAndValidateEntry(entry, executionKey)
          const current = this.entries.get(executionKey)
          assertRevision(current, normalized, expectedRevision)
          this.entries.set(executionKey, deepFreeze(normalized))
        },
      })
    } finally {
      release()
      void tail.then(() => {
        if (this.tails.get(executionKey) === tail) {
          this.tails.delete(executionKey)
        }
      })
    }
  }

  get size(): number {
    return this.entries.size
  }
}

export interface AtomicFileAdaptiveLearningLoopJournalOptions {
  root_directory: string
  /** Time spent waiting for another active execution of the same key. */
  lock_timeout_ms?: number
  /** Used for abandoned locks owned by another host. */
  stale_lock_lease_ms?: number
}

interface StoredJournalEnvelope {
  storage_version: "1.0"
  execution_key: string
  entry_hash: string
  entry: AdaptiveLearningLoopJournalEntry
}

interface FileLockOwner {
  lock_version: "1.0"
  owner_token: string
  hostname: string
  pid: number
  created_at_ms: number
}

const LOCK_OWNER_FILE = "owner.json"
const DEFAULT_LOCK_TIMEOUT_MS = 300_000
const DEFAULT_STALE_LOCK_LEASE_MS = 1_800_000

/**
 * Private atomic JSON implementation suitable for restart-safe local/backend
 * deployments. Files are mode 0600 and directories are mode 0700.
 */
export class AtomicFileAdaptiveLearningLoopJournal
implements AdaptiveLearningLoopJournal {
  constructor(
    private readonly options: AtomicFileAdaptiveLearningLoopJournalOptions,
  ) {
    if (!options.root_directory.trim()) {
      throw new AdaptiveLearningLoopJournalError(
        "INVALID_ENTRY",
        "adaptive journal root_directory 不能为空",
      )
    }
    assertOptionalNonNegativeInteger(
      options.lock_timeout_ms,
      "lock_timeout_ms",
    )
    if (options.stale_lock_lease_ms !== undefined
      && (!Number.isSafeInteger(options.stale_lock_lease_ms)
        || options.stale_lock_lease_ms < 1)) {
      throw new AdaptiveLearningLoopJournalError(
        "INVALID_ENTRY",
        "stale_lock_lease_ms 必须为正整数",
      )
    }
  }

  async withExclusive<T>(
    executionKey: string,
    operation: (
      transaction: AdaptiveLearningLoopJournalTransaction,
    ) => Promise<T>,
  ): Promise<T> {
    assertExecutionKey(executionKey)
    const recordPath = this.recordPath(executionKey)
    return this.withFileLock(recordPath, async () =>
      operation({
        load: () => this.readEntry(recordPath, executionKey),
        save: async (entry, expectedRevision) => {
          const normalized = cloneAndValidateEntry(entry, executionKey)
          const current = await this.readEntry(recordPath, executionKey)
          assertRevision(current, normalized, expectedRevision)
          await this.writeEntry(recordPath, normalized)
        },
      }))
  }

  private async readEntry(
    recordPath: string,
    executionKey: string,
  ): Promise<AdaptiveLearningLoopJournalEntry | undefined> {
    let parsed: unknown
    try {
      parsed = JSON.parse(await readFile(recordPath, "utf8"))
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return undefined
      if (error instanceof SyntaxError) {
        throw new AdaptiveLearningLoopJournalError(
          "INTEGRITY_ERROR",
          "adaptive journal JSON 损坏",
        )
      }
      throw storageError(error, "adaptive journal 读取失败")
    }
    if (!isStoredEnvelope(parsed)
      || parsed.execution_key !== executionKey
      || parsed.entry_hash !== contentHash(parsed.entry)) {
      throw new AdaptiveLearningLoopJournalError(
        "INTEGRITY_ERROR",
        "adaptive journal 完整性校验失败",
      )
    }
    return cloneAndValidateEntry(parsed.entry, executionKey)
  }

  private async writeEntry(
    recordPath: string,
    entry: AdaptiveLearningLoopJournalEntry,
  ): Promise<void> {
    await ensurePrivateDirectory(this.options.root_directory)
    await ensurePrivateDirectory(dirname(recordPath))
    const temporaryPath = `${recordPath}.${randomUUID()}.tmp`
    const envelope: StoredJournalEnvelope = {
      storage_version: "1.0",
      execution_key: entry.execution_key,
      entry_hash: contentHash(entry),
      entry: structuredClone(entry),
    }
    try {
      await writeFile(temporaryPath, JSON.stringify(envelope), {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      })
      await rename(temporaryPath, recordPath)
      await chmod(recordPath, 0o600)
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined)
      if (error instanceof AdaptiveLearningLoopJournalError) throw error
      throw storageError(error, "adaptive journal 写入失败")
    }
  }

  private recordPath(executionKey: string): string {
    const digest = contentHash({
      contract: "role-c-adaptive-journal-path-v1",
      execution_key: executionKey,
    }).slice("sha256:".length)
    return join(this.options.root_directory, "executions", `${digest}.json`)
  }

  private async withFileLock<T>(
    recordPath: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    await ensurePrivateDirectory(this.options.root_directory)
    await ensurePrivateDirectory(dirname(recordPath))
    const lockPath = `${recordPath}.lock`
    const timeoutMs = this.options.lock_timeout_ms
      ?? DEFAULT_LOCK_TIMEOUT_MS
    const staleLeaseMs = this.options.stale_lock_lease_ms
      ?? DEFAULT_STALE_LOCK_LEASE_MS
    const owner: FileLockOwner = {
      lock_version: "1.0",
      owner_token: randomUUID(),
      hostname: machineHostname(),
      pid: process.pid,
      created_at_ms: Date.now(),
    }
    const startedAt = Date.now()
    while (true) {
      try {
        await mkdir(lockPath, { mode: 0o700 })
        try {
          await writeFile(
            join(lockPath, LOCK_OWNER_FILE),
            JSON.stringify(owner),
            { encoding: "utf8", flag: "wx", mode: 0o600 },
          )
        } catch (error) {
          await rm(lockPath, { recursive: true, force: true })
            .catch(() => undefined)
          throw storageError(error, "adaptive journal lock 元数据写入失败")
        }
        break
      } catch (error) {
        if (!isNodeError(error, "EEXIST")) {
          if (error instanceof AdaptiveLearningLoopJournalError) throw error
          throw storageError(error, "adaptive journal lock 创建失败")
        }
        if (await this.tryReclaimLock(lockPath, staleLeaseMs)) continue
        if (Date.now() - startedAt >= timeoutMs) {
          throw new AdaptiveLearningLoopJournalError(
            "LOCK_TIMEOUT",
            "adaptive journal lock 超时",
          )
        }
        await delay(10)
      }
    }
    try {
      return await operation()
    } finally {
      await releaseOwnedLock(lockPath, owner.owner_token)
    }
  }

  private async tryReclaimLock(
    lockPath: string,
    staleLeaseMs: number,
  ): Promise<boolean> {
    const snapshot = await readLockSnapshot(lockPath)
    if (!snapshot) return true
    const stale = snapshot.owner?.hostname === machineHostname()
      ? !isProcessAlive(snapshot.owner.pid)
      : Date.now() - snapshot.modified_at_ms >= staleLeaseMs
    if (!stale) return false

    const quarantine = `${lockPath}.stale.${randomUUID()}`
    try {
      await rename(lockPath, quarantine)
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return true
      return false
    }
    const moved = await readLockSnapshot(quarantine)
    if (moved?.owner?.owner_token !== snapshot.owner?.owner_token) {
      try {
        await rename(quarantine, lockPath)
      } catch {
        // Another worker already established the current lock. The quarantined
        // directory is retained rather than deleting an unverified owner.
      }
      return false
    }
    await rm(quarantine, { recursive: true, force: true })
    return true
  }
}

export async function adaptiveLearningLoopJournalPathMode(
  path: string,
): Promise<number> {
  return (await stat(path)).mode & 0o777
}

function assertRevision(
  current: AdaptiveLearningLoopJournalEntry | undefined,
  next: AdaptiveLearningLoopJournalEntry,
  expectedRevision: number | undefined,
): void {
  if (expectedRevision === undefined) {
    if (current || next.revision !== 0) {
      throw new AdaptiveLearningLoopJournalError(
        "REVISION_CONFLICT",
        "adaptive journal 创建 revision 冲突",
      )
    }
    return
  }
  if (!current
    || current.revision !== expectedRevision
    || next.revision !== expectedRevision + 1) {
    throw new AdaptiveLearningLoopJournalError(
      "REVISION_CONFLICT",
      "adaptive journal checkpoint revision 冲突",
    )
  }
}

function cloneAndValidateEntry(
  value: AdaptiveLearningLoopJournalEntry,
  executionKey: string,
): AdaptiveLearningLoopJournalEntry {
  const entry = structuredClone(value)
  if (entry.journal_version !== "1.0"
    || entry.execution_key !== executionKey
    || !entry.source_key?.trim()
    || !entry.request_hash?.trim()
    || !Number.isSafeInteger(entry.revision)
    || entry.revision < 0
    || entry.state_hash !== contentHash(entry.state)) {
    throw new AdaptiveLearningLoopJournalError(
      "INVALID_ENTRY",
      "adaptive journal entry 无效",
    )
  }
  return entry
}

function assertExecutionKey(executionKey: string): void {
  if (!executionKey.trim()) {
    throw new AdaptiveLearningLoopJournalError(
      "INVALID_ENTRY",
      "adaptive journal execution_key 不能为空",
    )
  }
}

function isStoredEnvelope(value: unknown): value is StoredJournalEnvelope {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<StoredJournalEnvelope>
  return candidate.storage_version === "1.0"
    && typeof candidate.execution_key === "string"
    && typeof candidate.entry_hash === "string"
    && Boolean(candidate.entry && typeof candidate.entry === "object")
}

async function ensurePrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 })
  await chmod(path, 0o700)
}

async function readLockSnapshot(
  lockPath: string,
): Promise<{ owner?: FileLockOwner; modified_at_ms: number } | undefined> {
  try {
    const directory = await stat(lockPath)
    let owner: FileLockOwner | undefined
    try {
      const parsed = JSON.parse(
        await readFile(join(lockPath, LOCK_OWNER_FILE), "utf8"),
      ) as Partial<FileLockOwner>
      if (parsed.lock_version === "1.0"
        && typeof parsed.owner_token === "string"
        && typeof parsed.hostname === "string"
        && Number.isSafeInteger(parsed.pid)
        && Number.isFinite(parsed.created_at_ms)) {
        owner = parsed as FileLockOwner
      }
    } catch {
      // A newly created lock may not have written its owner file yet.
    }
    return { ...(owner ? { owner } : {}), modified_at_ms: directory.mtimeMs }
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return undefined
    throw storageError(error, "adaptive journal lock 读取失败")
  }
}

async function releaseOwnedLock(
  lockPath: string,
  ownerToken: string,
): Promise<void> {
  const snapshot = await readLockSnapshot(lockPath).catch(() => undefined)
  if (snapshot?.owner?.owner_token !== ownerToken) return
  await rm(lockPath, { recursive: true, force: true }).catch(() => undefined)
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid < 1) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}

function assertOptionalNonNegativeInteger(
  value: number | undefined,
  name: string,
): void {
  if (value !== undefined
    && (!Number.isSafeInteger(value) || value < 0)) {
    throw new AdaptiveLearningLoopJournalError(
      "INVALID_ENTRY",
      `${name} 必须为非负整数`,
    )
  }
}

function isNodeError(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException)?.code === code
}

function storageError(
  error: unknown,
  message: string,
): AdaptiveLearningLoopJournalError {
  if (error instanceof AdaptiveLearningLoopJournalError) return error
  const detail = error instanceof Error ? `：${error.message}` : ""
  return new AdaptiveLearningLoopJournalError(
    "STORAGE_ERROR",
    `${message}${detail}`,
  )
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value
  Object.values(value as Record<string, unknown>).forEach(deepFreeze)
  return Object.freeze(value)
}
