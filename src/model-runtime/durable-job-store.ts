import { randomUUID } from "node:crypto"
import { chmod, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { protectSensitivePath } from "../security/windows-secure-acl"

export type ModelWorkflowJobKind =
  | "diagnostic"
  | "initial_content_round"
  | "next_content_round"
  | "artifact_revision"
  | "offline_evaluation"

export type ModelWorkflowJobStatus =
  | "queued"
  | "running"
  | "retry_wait"
  | "completed"
  | "failed"
  | "cancelled"

export interface ModelWorkflowJob {
  schema_version: "1.0"
  revision: number
  job_id: string
  session_id: string
  run_id: string
  kind: ModelWorkflowJobKind
  status: ModelWorkflowJobStatus
  current_stage: string
  attempt: number
  max_attempts: number
  lease_owner?: string
  lease_expires_at?: string
  deadline_at: string
  retry_after?: string
  policy_snapshot: Record<string, unknown>
  budget_snapshot: Record<string, unknown>
  checkpoint_refs: string[]
  last_error_code?: string
  last_error_message?: string
  created_at: string
  updated_at: string
}

export interface DurableJobStore {
  create(job: ModelWorkflowJob): Promise<void>
  load(jobId: string): Promise<ModelWorkflowJob | undefined>
  listRecoverable(now?: Date): Promise<ModelWorkflowJob[]>
  claim(jobId: string, owner: string, leaseMs: number, now?: Date): Promise<ModelWorkflowJob | undefined>
  heartbeat(jobId: string, owner: string, leaseMs: number, now?: Date): Promise<void>
  complete(jobId: string, owner: string, now?: Date): Promise<void>
  fail(jobId: string, owner: string, error: unknown, retryDelayMs?: number, now?: Date): Promise<ModelWorkflowJob>
}

/** Single-host atomic job store. Job data contains references and policy metadata, never model reasoning. */
export class AtomicFileDurableJobStore implements DurableJobStore {
  private readonly updates = new Map<string, Promise<unknown>>()

  constructor(private readonly rootDirectory: string) {
    if (!rootDirectory.trim()) throw new Error("job rootDirectory 不能为空")
  }

  async create(job: ModelWorkflowJob): Promise<void> {
    validateJob(job)
    await this.ensureDirectory()
    const path = this.pathFor(job.job_id)
    try {
      await writeFile(path, `${JSON.stringify(job, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      })
      await protectSensitivePath(path, "file")
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        const existing = await this.load(job.job_id)
        if (existing && sameJobIdentity(existing, job)) return
      }
      throw error
    }
  }

  async load(jobId: string): Promise<ModelWorkflowJob | undefined> {
    try {
      const parsed = JSON.parse(await readFile(this.pathFor(jobId), "utf8")) as ModelWorkflowJob
      validateJob(parsed)
      return parsed
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
      throw error
    }
  }

  async listRecoverable(now = new Date()): Promise<ModelWorkflowJob[]> {
    await this.ensureDirectory()
    const names = await readdir(this.rootDirectory)
    const jobs = await Promise.all(names
      .filter((name) => name.endsWith(".json"))
      .map((name) => this.load(name.slice(0, -5))))
    return jobs.filter((job): job is ModelWorkflowJob => Boolean(job)).filter((job) =>
      job.status === "queued"
      || job.status === "retry_wait"
      || (job.status === "running" && Date.parse(job.lease_expires_at ?? "") <= now.getTime()))
  }

  async claim(jobId: string, owner: string, leaseMs: number, now = new Date()): Promise<ModelWorkflowJob | undefined> {
    return this.update(jobId, (job) => {
      const timestamp = now.getTime()
      const claimable = job.status === "queued"
        || (job.status === "retry_wait" && Date.parse(job.retry_after ?? job.updated_at) <= timestamp)
        || (job.status === "running" && Date.parse(job.lease_expires_at ?? "") <= timestamp)
      if (!claimable || Date.parse(job.deadline_at) <= timestamp) return undefined
      return {
        ...job,
        status: "running",
        attempt: job.attempt + 1,
        lease_owner: owner,
        lease_expires_at: new Date(timestamp + leaseMs).toISOString(),
        retry_after: undefined,
        updated_at: now.toISOString(),
      }
    })
  }

  async heartbeat(jobId: string, owner: string, leaseMs: number, now = new Date()): Promise<void> {
    await this.update(jobId, (job) => job.status === "running" && job.lease_owner === owner
      ? { ...job, lease_expires_at: new Date(now.getTime() + leaseMs).toISOString(), updated_at: now.toISOString() }
      : undefined)
  }

  async complete(jobId: string, owner: string, now = new Date()): Promise<void> {
    await this.update(jobId, (job) => {
      if (job.status !== "running" || job.lease_owner !== owner) return undefined
      return {
        ...job,
        status: "completed",
        current_stage: "completed",
        lease_owner: undefined,
        lease_expires_at: undefined,
        updated_at: now.toISOString(),
      }
    })
  }

  async fail(
    jobId: string,
    owner: string,
    error: unknown,
    retryDelayMs = 1_000,
    now = new Date(),
  ): Promise<ModelWorkflowJob> {
    const updated = await this.update(jobId, (job) => {
      if (job.status !== "running" || job.lease_owner !== owner) return undefined
      const retry = job.attempt < job.max_attempts && Date.parse(job.deadline_at) > now.getTime() + retryDelayMs
      return {
        ...job,
        status: retry ? "retry_wait" : "failed",
        current_stage: retry ? job.current_stage : "failed",
        lease_owner: undefined,
        lease_expires_at: undefined,
        retry_after: retry ? new Date(now.getTime() + retryDelayMs).toISOString() : undefined,
        last_error_code: jobErrorCode(error),
        last_error_message: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
        updated_at: now.toISOString(),
      }
    })
    if (!updated) throw new Error(`JOB_LEASE_LOST:${jobId}`)
    return updated
  }

  private async update(
    jobId: string,
    mutator: (job: ModelWorkflowJob) => Omit<ModelWorkflowJob, "revision"> | ModelWorkflowJob | undefined,
  ): Promise<ModelWorkflowJob | undefined> {
    const safeJobId = safeId(jobId)
    const previous = this.updates.get(safeJobId) ?? Promise.resolve()
    let resolveResult!: (value: ModelWorkflowJob | undefined) => void
    let rejectResult!: (reason: unknown) => void
    const result = new Promise<ModelWorkflowJob | undefined>((resolve, reject) => {
      resolveResult = resolve
      rejectResult = reject
    })
    const operation = previous.catch(() => undefined).then(async () => {
      try {
        const current = await this.load(safeJobId)
        if (!current) return resolveResult(undefined)
        const changed = mutator(current)
        if (!changed) return resolveResult(undefined)
        const next = { ...changed, revision: current.revision + 1 } as ModelWorkflowJob
        validateJob(next)
        await this.atomicWrite(next)
        resolveResult(next)
      } catch (error) {
        rejectResult(error)
      }
    })
    this.updates.set(safeJobId, operation)
    operation.finally(() => {
      if (this.updates.get(safeJobId) === operation) this.updates.delete(safeJobId)
    }).catch(() => undefined)
    return result
  }

  private async atomicWrite(job: ModelWorkflowJob): Promise<void> {
    await this.ensureDirectory()
    const path = this.pathFor(job.job_id)
    const temporary = `${path}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, `${JSON.stringify(job, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
      await protectSensitivePath(temporary, "file")
      await rename(temporary, path)
      await chmod(path, 0o600).catch(() => undefined)
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined)
      throw error
    }
  }

  private async ensureDirectory(): Promise<void> {
    await mkdir(this.rootDirectory, { recursive: true, mode: 0o700 })
    await chmod(this.rootDirectory, 0o700).catch(() => undefined)
    await protectSensitivePath(this.rootDirectory, "directory")
  }

  private pathFor(jobId: string): string {
    return join(this.rootDirectory, `${safeId(jobId)}.json`)
  }
}

export type ModelWorkflowJobHandler = (job: ModelWorkflowJob) => Promise<void>

/** Retains every background promise, leases jobs, and resumes queued/expired work after restart. */
export class DurableJobRunner {
  private readonly handlers = new Map<ModelWorkflowJobKind, ModelWorkflowJobHandler>()
  private readonly pending = new Set<string>()
  private readonly active = new Map<string, Promise<void>>()
  private startPromise?: Promise<void>

  constructor(
    private readonly store: DurableJobStore,
    private readonly options: {
      owner?: string
      lease_ms?: number
      max_in_flight?: number
      heartbeat_ms?: number
    } = {},
  ) {}

  register(kind: ModelWorkflowJobKind, handler: ModelWorkflowJobHandler): void {
    this.handlers.set(kind, handler)
  }

  start(): Promise<void> {
    if (!this.startPromise) {
      this.startPromise = this.store.listRecoverable().then((jobs) => {
        jobs.forEach((job) => this.schedule(job))
        this.pump()
      })
    }
    return this.startPromise
  }

  async enqueue(job: ModelWorkflowJob): Promise<void> {
    await this.start()
    await this.store.create(job)
    this.pending.add(job.job_id)
    this.pump()
  }

  isRunning(): boolean {
    return Boolean(this.startPromise)
  }

  private pump(): void {
    const max = this.options.max_in_flight ?? 2
    while (this.active.size < max && this.pending.size > 0) {
      const jobId = this.pending.values().next().value as string
      this.pending.delete(jobId)
      const task = this.run(jobId)
        .catch(() => undefined)
        .finally(() => {
          this.active.delete(jobId)
          this.pump()
        })
      this.active.set(jobId, task)
    }
  }

  private async run(jobId: string): Promise<void> {
    const owner = this.options.owner ?? `job-worker-${process.pid}`
    const leaseMs = this.options.lease_ms ?? 30_000
    const job = await this.store.claim(jobId, owner, leaseMs)
    if (!job) return
    const handler = this.handlers.get(job.kind)
    if (!handler) {
      await this.store.fail(job.job_id, owner, new Error(`JOB_HANDLER_MISSING:${job.kind}`), 0)
      return
    }
    const heartbeat = setInterval(() => {
      this.store.heartbeat(job.job_id, owner, leaseMs).catch(() => undefined)
    }, this.options.heartbeat_ms ?? Math.max(1_000, Math.floor(leaseMs / 3)))
    try {
      await handler(job)
      await this.store.complete(job.job_id, owner)
    } catch (error) {
      const failed = await this.store.fail(job.job_id, owner, error)
      if (failed.status === "retry_wait") {
        this.schedule(failed)
      }
    } finally {
      clearInterval(heartbeat)
    }
  }

  private schedule(job: ModelWorkflowJob): void {
    const readyAt = job.status === "retry_wait"
      ? Date.parse(job.retry_after ?? job.updated_at)
      : Date.now()
    const delay = Math.max(0, readyAt - Date.now())
    if (delay === 0) {
      this.pending.add(job.job_id)
      return
    }
    const timer = setTimeout(() => {
      this.pending.add(job.job_id)
      this.pump()
    }, delay)
    timer.unref?.()
  }
}

export function createModelWorkflowJob(input: {
  job_id?: string
  session_id: string
  run_id: string
  kind: ModelWorkflowJobKind
  current_stage: string
  deadline_ms: number
  max_attempts?: number
  policy_snapshot?: Record<string, unknown>
  budget_snapshot?: Record<string, unknown>
  checkpoint_refs?: string[]
}): ModelWorkflowJob {
  const now = new Date()
  return {
    schema_version: "1.0",
    revision: 0,
    job_id: safeId(input.job_id ?? `JOB-${randomUUID()}`),
    session_id: safeId(input.session_id),
    run_id: safeId(input.run_id),
    kind: input.kind,
    status: "queued",
    current_stage: input.current_stage,
    attempt: 0,
    max_attempts: input.max_attempts ?? 2,
    deadline_at: new Date(now.getTime() + input.deadline_ms).toISOString(),
    policy_snapshot: structuredClone(input.policy_snapshot ?? {}),
    budget_snapshot: structuredClone(input.budget_snapshot ?? {}),
    checkpoint_refs: [...(input.checkpoint_refs ?? [])],
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  }
}

function validateJob(job: ModelWorkflowJob): void {
  safeId(job.job_id)
  safeId(job.session_id)
  safeId(job.run_id)
  if (job.schema_version !== "1.0" || !Number.isSafeInteger(job.revision) || job.revision < 0) {
    throw new Error("MODEL_WORKFLOW_JOB_INVALID")
  }
  if (!Number.isSafeInteger(job.attempt) || !Number.isSafeInteger(job.max_attempts) || job.max_attempts < 1) {
    throw new Error("MODEL_WORKFLOW_JOB_ATTEMPT_INVALID")
  }
  if (!Number.isFinite(Date.parse(job.deadline_at))) throw new Error("MODEL_WORKFLOW_JOB_DEADLINE_INVALID")
}

function sameJobIdentity(left: ModelWorkflowJob, right: ModelWorkflowJob): boolean {
  return left.job_id === right.job_id
    && left.session_id === right.session_id
    && left.run_id === right.run_id
    && left.kind === right.kind
}

function safeId(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,180}$/.test(value)) throw new Error("MODEL_WORKFLOW_JOB_ID_INVALID")
  return value
}

function jobErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code.slice(0, 100)
  }
  return error instanceof Error ? error.name.slice(0, 100) : "UNKNOWN_JOB_ERROR"
}
