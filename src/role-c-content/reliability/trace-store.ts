import { randomUUID } from "node:crypto"
import {
  appendFile,
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import { hostname } from "node:os"
import { dirname } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import type { AgentTraceEvent } from "../contracts/learning-evidence-event"
import { validateRoleCSchema } from "../validators/runtime-schema-validator"

export interface AgentTraceStore {
  append(events: AgentTraceEvent[]): Promise<void>
  read(runId: string): Promise<AgentTraceEvent[]>
}

export class InMemoryAgentTraceStore implements AgentTraceStore {
  private readonly byRun = new Map<string, AgentTraceEvent[]>()
  async append(events: AgentTraceEvent[]): Promise<void> {
    const lastByRun = new Map<string, number>()
    for (const [runId, prior] of this.byRun) {
      lastByRun.set(runId, prior.at(-1)?.seq ?? 0)
    }
    for (const event of events) {
      assertTraceSafe(event)
      if (event.seq <= (lastByRun.get(event.run_id) ?? 0)) {
        throw new Error("TRACE_SEQUENCE_NOT_APPEND_ONLY")
      }
      lastByRun.set(event.run_id, event.seq)
    }
    for (const event of events) {
      const prior = this.byRun.get(event.run_id) ?? []
      prior.push(structuredClone(event))
      this.byRun.set(event.run_id, prior)
    }
  }
  async read(runId: string): Promise<AgentTraceEvent[]> { return structuredClone(this.byRun.get(runId) ?? []) }
}

export interface JsonlAgentTraceStoreOptions {
  lock_timeout_ms?: number
  stale_lock_lease_ms?: number
}

interface TraceLockOwner {
  token: string
  pid: number
  hostname: string
  acquired_at_ms: number
}

/**
 * One JSONL file per backend deployment. A filesystem lock serializes readers and
 * writers so the per-run sequence check and append form one atomic operation.
 */
export class JsonlAgentTraceStore implements AgentTraceStore {
  private readonly lockTimeoutMs: number
  private readonly staleLockLeaseMs: number

  constructor(
    private readonly filePath: string,
    options: JsonlAgentTraceStoreOptions = {},
  ) {
    this.lockTimeoutMs = options.lock_timeout_ms ?? 5_000
    this.staleLockLeaseMs = options.stale_lock_lease_ms ?? 30_000
    if (!Number.isFinite(this.lockTimeoutMs) || this.lockTimeoutMs < 1) {
      throw new Error("TRACE_LOCK_TIMEOUT_INVALID")
    }
    if (!Number.isFinite(this.staleLockLeaseMs) || this.staleLockLeaseMs < 1) {
      throw new Error("TRACE_STALE_LOCK_LEASE_INVALID")
    }
  }

  async append(events: AgentTraceEvent[]): Promise<void> {
    if (events.length === 0) return
    await this.withLock(async () => {
      const existing = await this.readAllValidated()
      const lastByRun = new Map<string, number>()
      existing.forEach((event) => lastByRun.set(event.run_id, event.seq))
      for (const event of events) {
        assertTraceSafe(event)
        if (event.seq <= (lastByRun.get(event.run_id) ?? 0)) {
          throw new Error("TRACE_SEQUENCE_NOT_APPEND_ONLY")
        }
        lastByRun.set(event.run_id, event.seq)
      }
      await appendFile(
        this.filePath,
        events.map((event) => JSON.stringify(event)).join("\n") + "\n",
        { encoding: "utf8", mode: 0o600 },
      )
      await chmod(this.filePath, 0o600)
    })
  }

  async read(runId: string): Promise<AgentTraceEvent[]> {
    return this.withLock(async () =>
      structuredClone((await this.readAllValidated()).filter((event) => event.run_id === runId)))
  }

  private async readAllValidated(): Promise<AgentTraceEvent[]> {
    let serialized: string
    try {
      serialized = await readFile(this.filePath, "utf8")
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
      throw error
    }

    const events: AgentTraceEvent[] = []
    const lastByRun = new Map<string, number>()
    for (const [index, line] of serialized.split("\n").entries()) {
      if (!line.trim()) continue
      let event: AgentTraceEvent
      try {
        event = JSON.parse(line) as AgentTraceEvent
      } catch {
        throw new Error(`INVALID_TRACE_JSON_LINE:${index + 1}`)
      }
      assertTraceSafe(event)
      if (event.seq <= (lastByRun.get(event.run_id) ?? 0)) {
        throw new Error("TRACE_SEQUENCE_NOT_APPEND_ONLY")
      }
      lastByRun.set(event.run_id, event.seq)
      events.push(event)
    }
    return events
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 })
    const owner = await this.acquireLock()
    try {
      return await operation()
    } finally {
      await this.releaseLock(owner)
    }
  }

  private async acquireLock(): Promise<TraceLockOwner> {
    const lockPath = this.lockPath()
    const deadline = Date.now() + this.lockTimeoutMs
    const owner: TraceLockOwner = {
      token: randomUUID(),
      pid: process.pid,
      hostname: hostname(),
      acquired_at_ms: Date.now(),
    }
    while (Date.now() <= deadline) {
      try {
        await mkdir(lockPath, { mode: 0o700 })
        await writeFile(
          this.ownerPath(),
          JSON.stringify(owner),
          { encoding: "utf8", flag: "wx", mode: 0o600 },
        )
        return owner
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== "EEXIST" && code !== "ENOENT") throw error
        if (await this.lockIsStale()) {
          await this.reclaimStaleLock(owner.token)
          continue
        }
        await delay(Math.min(10, Math.max(1, deadline - Date.now())))
      }
    }
    throw new Error("TRACE_LOCK_TIMEOUT")
  }

  private async lockIsStale(): Promise<boolean> {
    try {
      const owner = JSON.parse(await readFile(this.ownerPath(), "utf8")) as TraceLockOwner
      if (owner.hostname === hostname()) {
        return !processIsAlive(owner.pid)
      }
      return Date.now() - owner.acquired_at_ms > this.staleLockLeaseMs
    } catch {
      try {
        const metadata = await stat(this.lockPath())
        return Date.now() - metadata.mtimeMs > this.staleLockLeaseMs
      } catch {
        return false
      }
    }
  }

  private async reclaimStaleLock(token: string): Promise<void> {
    const stalePath = `${this.lockPath()}.stale-${token}`
    try {
      await rename(this.lockPath(), stalePath)
      await rm(stalePath, { recursive: true, force: true })
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== "ENOENT" && code !== "EEXIST") throw error
    }
  }

  private async releaseLock(owner: TraceLockOwner): Promise<void> {
    try {
      const current = JSON.parse(await readFile(this.ownerPath(), "utf8")) as TraceLockOwner
      if (current.token === owner.token) {
        await rm(this.lockPath(), { recursive: true, force: true })
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
  }

  private lockPath(): string {
    return `${this.filePath}.lock`
  }

  private ownerPath(): string {
    return `${this.lockPath()}/owner.json`
  }
}

function processIsAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}

function assertTraceSafe(event: AgentTraceEvent): void {
  const schema = validateRoleCSchema("agent_trace_event.schema.json", event)
  if (!schema.ok) throw new Error(`INVALID_TRACE_EVENT:${schema.issues.map((entry) => entry.path).join(",")}`)
  const serialized = JSON.stringify(event).toLowerCase()
  for (const forbidden of ["answer_spec", "correct_option_id", "hidden_tests", "reference_solution"]) {
    if (serialized.includes(forbidden)) throw new Error(`TRACE_SECRET_LEAK:${forbidden}`)
  }
}
