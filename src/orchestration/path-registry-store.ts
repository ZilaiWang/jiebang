import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { join } from "node:path"
import {
  changeLearnerGoal,
  createPathRegistry,
  resumePathAfterDiagnosis,
  type GoalPath,
  type GoalPathRegistry,
  type PathGoalProfile,
} from "./path-registry"

export interface GoalChangeInput {
  path_id: string
  goal_profile: PathGoalProfile
  goal: string
}

export interface SessionPathSnapshot {
  path_id: string
  goal_profile: PathGoalProfile
  goal: string
  level: GoalPath["level"]
  current_node_id: string | null
  objective_source_ids?: string[]
}

export class PathRegistryStore {
  private readonly queues = new Map<string, Promise<GoalPathRegistry>>()

  constructor(private readonly root: string) {}

  async load(learnerId: string): Promise<GoalPathRegistry> {
    const path = this.filePath(learnerId)
    try {
      return JSON.parse(await readFile(path, "utf8")) as GoalPathRegistry
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      throw new Error("PATH_REGISTRY_NOT_FOUND")
    }
  }

  async save(registry: GoalPathRegistry): Promise<void> {
    await mkdir(this.root, { recursive: true })
    const path = this.filePath(registry.learner_id)
    const temp = `${path}.tmp-${process.pid}-${Date.now()}`
    await writeFile(temp, JSON.stringify(registry, null, 2), "utf8")
    await rename(temp, path)
  }

  async ensureFromSession(learnerId: string, snapshot: SessionPathSnapshot): Promise<GoalPathRegistry> {
    return this.serialized(learnerId, async () => {
      const existing = await this.loadOptional(learnerId)
      if (existing) return existing
      const registry = createPathRegistry({
        learner_id: learnerId,
        active_path: { ...snapshot, status: "active", mastery: {} },
      })
      await this.save(registry)
      return registry
    })
  }

  async changeGoal(learnerId: string, next: GoalChangeInput): Promise<GoalPathRegistry> {
    return this.serialized(learnerId, async () => {
      const current = await this.load(learnerId)
      const changed = changeLearnerGoal(current, next)
      await this.save(changed)
      return changed
    })
  }

  async requestResume(learnerId: string, pathId: string): Promise<GoalPathRegistry> {
    return this.serialized(learnerId, async () => {
      const current = await this.load(learnerId)
      const pending = resumePathAfterDiagnosis(current, pathId)
      await this.save(pending)
      return pending
    })
  }

  async savePendingResume(
    learnerId: string,
    pathId: string,
    items: NonNullable<GoalPathRegistry["pending_resume"]>["items"],
    answerKey: Record<string, string>,
  ): Promise<GoalPathRegistry> {
    return this.serialized(learnerId, async () => {
      const current = await this.load(learnerId)
      const pending = resumePathAfterDiagnosis(current, pathId)
      pending.pending_resume = { path_id: pathId, items, answer_key: { ...answerKey } }
      await this.save(pending)
      return pending
    })
  }

  async saveResumeDiagnosis(
    learnerId: string,
    pathId: string,
    items: NonNullable<GoalPathRegistry["pending_resume"]>["items"],
    answerKey: Record<string, string>,
  ): Promise<GoalPathRegistry> {
    return this.serialized(learnerId, async () => {
      const current = await this.load(learnerId)
      const paused = current.paths.find((path) => path.path_id === pathId)
      if (!paused || paused.status !== "paused") throw new Error("only paused paths can receive resume diagnosis")
      const pending = { ...current, pending_resume: { path_id: pathId, items, answer_key: { ...answerKey } } }
      await this.save(pending)
      return pending
    })
  }

  async completeResume(learnerId: string, pathId: string, level: GoalPathRegistry["paths"][number]["level"]): Promise<GoalPathRegistry> {
    return this.serialized(learnerId, async () => {
      const current = await this.load(learnerId)
      const resumed = resumePathAfterDiagnosis(current, pathId, { level })
      await this.save(resumed)
      return resumed
    })
  }

  async paths(learnerId: string): Promise<GoalPath[]> {
    return (await this.load(learnerId)).paths
  }

  private async serialized(learnerId: string, operation: () => Promise<GoalPathRegistry>): Promise<GoalPathRegistry> {
    const previous = this.queues.get(learnerId) ?? Promise.resolve(null as unknown as GoalPathRegistry)
    const current = previous.catch(() => undefined).then(operation)
    this.queues.set(learnerId, current)
    try {
      return await current
    } finally {
      if (this.queues.get(learnerId) === current) this.queues.delete(learnerId)
    }
  }

  private async loadOptional(learnerId: string): Promise<GoalPathRegistry | null> {
    try {
      return await this.load(learnerId)
    } catch (error) {
      if (error instanceof Error && error.message === "PATH_REGISTRY_NOT_FOUND") return null
      throw error
    }
  }

  private filePath(learnerId: string): string {
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(learnerId)) throw new Error("INVALID_LEARNER_ID")
    return join(this.root, `${learnerId}.json`)
  }
}
