import type { ModelCallPolicy, ModelConcurrencyGroup, ModelPriority } from "./types"

interface Waiter {
  priority: number
  enqueued_at: number
  deadline_at: number
  resolve: (release: () => void) => void
  reject: (error: Error) => void
}

class Semaphore {
  private active = 0
  private readonly queue: Waiter[] = []

  constructor(private readonly limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("MODEL_SCHEDULER_LIMIT_INVALID")
  }

  acquire(priority: ModelPriority, deadlineAt: number): Promise<() => void> {
    if (Date.now() >= deadlineAt) return Promise.reject(new Error("MODEL_QUEUE_DEADLINE_EXCEEDED"))
    if (this.active < this.limit) {
      this.active += 1
      return Promise.resolve(this.releaseOnce())
    }
    return new Promise((resolve, reject) => {
      this.queue.push({
        priority: priorityValue(priority),
        enqueued_at: Date.now(),
        deadline_at: deadlineAt,
        resolve,
        reject,
      })
      this.queue.sort((a, b) => b.priority - a.priority || a.enqueued_at - b.enqueued_at)
    })
  }

  private releaseOnce(): () => void {
    let released = false
    return () => {
      if (released) return
      released = true
      this.active -= 1
      this.dispatch()
    }
  }

  private dispatch(): void {
    while (this.active < this.limit && this.queue.length > 0) {
      const waiter = this.queue.shift()!
      if (Date.now() >= waiter.deadline_at) {
        waiter.reject(new Error("MODEL_QUEUE_DEADLINE_EXCEEDED"))
        continue
      }
      this.active += 1
      waiter.resolve(this.releaseOnce())
    }
  }
}

export interface ModelSchedulerLimits {
  global: number
  quality: number
  offline: number
}

export class ModelScheduler {
  private readonly global: Semaphore
  private readonly groups: Record<ModelConcurrencyGroup, Semaphore | undefined>

  constructor(limits: ModelSchedulerLimits = { global: 3, quality: 1, offline: 1 }) {
    this.global = new Semaphore(limits.global)
    this.groups = {
      fast: undefined,
      audit: undefined,
      quality: new Semaphore(limits.quality),
      offline: new Semaphore(limits.offline),
    }
  }

  async run<T>(
    policy: ModelCallPolicy,
    deadlineAt: number,
    operation: () => Promise<T>,
  ): Promise<{ value: T; queued_ms: number }> {
    const queuedAt = performance.now()
    const releaseGlobal = await this.global.acquire(policy.priority, deadlineAt)
    let releaseGroup: (() => void) | undefined
    try {
      releaseGroup = await this.groups[policy.concurrency_group]?.acquire(policy.priority, deadlineAt)
      const queuedMs = Math.max(0, performance.now() - queuedAt)
      return { value: await operation(), queued_ms: queuedMs }
    } finally {
      releaseGroup?.()
      releaseGlobal()
    }
  }
}

export const sharedModelScheduler = new ModelScheduler()
const configuredSchedulers = new Map<string, ModelScheduler>()

/** Gateways created by different agents share the same limiter for one limit tuple. */
export function sharedModelSchedulerFor(limits: ModelSchedulerLimits): ModelScheduler {
  const key = `${limits.global}:${limits.quality}:${limits.offline}`
  const existing = configuredSchedulers.get(key)
  if (existing) return existing
  const created = new ModelScheduler(limits)
  configuredSchedulers.set(key, created)
  return created
}

function priorityValue(priority: ModelPriority): number {
  if (priority === "interactive") return 4
  if (priority === "review") return 3
  if (priority === "background") return 2
  return 1
}
