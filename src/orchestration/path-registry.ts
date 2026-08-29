export type PathGoalProfile = "coursework" | "algorithm_competition" | "job_interview" | "general_learning"
export type PathLevel = "beginner" | "basic" | "intermediate" | "integrated"
export type GoalPathStatus = "active" | "paused" | "completed"

export interface GoalPath {
  path_id: string
  goal_profile: PathGoalProfile
  goal: string
  level: PathLevel
  current_node_id: string | null
  status: GoalPathStatus
  mastery: Record<string, number>
  objective_source_ids?: string[]
  pause_reason?: "goal_changed" | "manual"
}

export interface GoalPathRegistry {
  learner_id: string
  active_path: GoalPath
  paths: GoalPath[]
  pending_resume?: {
    path_id: string
    items?: Array<{ item_id: string; objective_id: string; source_id: string; question: string; options: string[] }>
    answer_key?: Record<string, string>
  }
}

export interface PublicGoalPathRegistry {
  learner_id: string
  active_path: GoalPath
  paths: GoalPath[]
  pending_resume?: {
    path_id: string
    items?: Array<{ item_id: string; objective_id: string; source_id: string; question: string; options: string[] }>
  }
}

export function publicPathRegistry(registry: GoalPathRegistry): PublicGoalPathRegistry {
  return {
    learner_id: registry.learner_id,
    active_path: clonePath(registry.active_path),
    paths: registry.paths.map(clonePath),
    ...(registry.pending_resume
      ? { pending_resume: { path_id: registry.pending_resume.path_id, items: registry.pending_resume.items?.map((item) => ({ ...item, options: [...item.options] })) } }
      : {}),
  }
}

export function createPathRegistry(input: {
  learner_id: string
  active_path: GoalPath
  paths?: GoalPath[]
}): GoalPathRegistry {
  const active = clonePath(input.active_path)
  return {
    learner_id: input.learner_id,
    active_path: active,
    paths: [active, ...(input.paths ?? []).filter((path) => path.path_id !== active.path_id).map(clonePath)],
  }
}

export function changeLearnerGoal(
  registry: GoalPathRegistry,
  next: Pick<GoalPath, "path_id" | "goal_profile" | "goal">,
): GoalPathRegistry {
  if (!next.path_id || !next.goal.trim()) throw new Error("new path id and goal are required")
  if (registry.paths.some((path) => path.path_id === next.path_id)) throw new Error("path id already exists")
  const paused = {
    ...clonePath(registry.active_path),
    status: "paused" as const,
    pause_reason: "goal_changed" as const,
  }
  const active: GoalPath = {
    path_id: next.path_id,
    goal_profile: next.goal_profile,
    goal: next.goal.trim(),
    level: "beginner",
    current_node_id: null,
    status: "active",
    mastery: {},
  }
  return {
    learner_id: registry.learner_id,
    active_path: active,
    paths: [active, paused, ...registry.paths.filter((path) => path.path_id !== registry.active_path.path_id).map(clonePath)],
  }
}

export function resumePathAfterDiagnosis(
  registry: GoalPathRegistry,
  pathId: string,
  diagnosis?: { level: PathLevel },
): GoalPathRegistry {
  const path = registry.paths.find((candidate) => candidate.path_id === pathId)
  if (!path) throw new Error("path does not exist")
  if (path.status !== "paused") throw new Error("only paused paths can be resumed")
  if (!diagnosis) {
    return { ...registry, active_path: clonePath(path), pending_resume: { path_id: pathId } }
  }
  const resumed: GoalPath = {
    ...clonePath(path),
    status: "active",
    level: diagnosis.level,
    pause_reason: undefined,
  }
  return {
    learner_id: registry.learner_id,
    active_path: resumed,
    paths: [resumed, ...registry.paths.filter((candidate) => candidate.path_id !== pathId).map(clonePath)],
  }
}

function clonePath(path: GoalPath): GoalPath {
  return { ...path, mastery: { ...path.mastery } }
}
