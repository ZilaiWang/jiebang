export type PythonLevel = "new" | "beginner" | "intermediate" | "advanced"
export type LearningStyle = "practice" | "concept" | "project" | "balanced"

export interface LearnerProfileDraft {
  id: string
  name: string
  weeklyHours: number
  pythonLevel: PythonLevel
  learningStyle: LearningStyle
  background: string
  priorLanguages: string[]
}

export interface LearningPlanDraft {
  id: string
  name: string
  sessionId?: string
  status?: string
  stage?: string
  knownConcepts?: string[]
  masteredConcepts?: string[]
  createdAt: string
  updatedAt: string
}

export interface WorkspaceUser extends LearnerProfileDraft {
  plans: LearningPlanDraft[]
  activePlanId?: string
}

export interface WorkspaceState {
  version: 1
  activeUserId?: string
  users: WorkspaceUser[]
}

export function createEmptyWorkspace(): WorkspaceState {
  return { version: 1, users: [] }
}

export function loadWorkspace(raw: string | null): WorkspaceState {
  if (!raw) return createEmptyWorkspace()
  try {
    const value = JSON.parse(raw) as unknown
    return isWorkspace(value) ? value : createEmptyWorkspace()
  } catch {
    return createEmptyWorkspace()
  }
}

export function addUser(workspace: WorkspaceState, profile: LearnerProfileDraft): WorkspaceState {
  if (workspace.users.some((user) => user.id === profile.id)) throw new Error("learner id already exists")
  return {
    ...workspace,
    activeUserId: profile.id,
    users: [...workspace.users, { ...profile, priorLanguages: [...profile.priorLanguages], plans: [] }],
  }
}

export function selectUser(workspace: WorkspaceState, userId: string): WorkspaceState {
  if (!workspace.users.some((user) => user.id === userId)) throw new Error("learner does not exist")
  return { ...workspace, activeUserId: userId }
}

export function addPlan(
  workspace: WorkspaceState,
  userId: string,
  input: Pick<LearningPlanDraft, "id" | "name">,
  now = new Date().toISOString(),
): WorkspaceState {
  return updateUser(workspace, userId, (user) => {
    if (user.plans.some((plan) => plan.id === input.id)) throw new Error("plan id already exists")
    const plan: LearningPlanDraft = { ...input, createdAt: now, updatedAt: now }
    return { ...user, activePlanId: plan.id, plans: [...user.plans, plan] }
  })
}

export function renamePlan(workspace: WorkspaceState, userId: string, planId: string, name: string): WorkspaceState {
  const normalized = name.trim()
  if (!normalized) return workspace
  return updateUser(workspace, userId, (user) => ({
    ...user,
    plans: user.plans.map((plan) => plan.id === planId ? { ...plan, name: normalized, updatedAt: new Date().toISOString() } : plan),
  }))
}

export function recordPlanPublicState(
  workspace: WorkspaceState,
  userId: string,
  planId: string,
  state: { sessionId: string; status?: string; stage?: string; knownConcepts?: string[] },
): WorkspaceState {
  return updateUser(workspace, userId, (user) => ({
    ...user,
    plans: user.plans.map((plan) => plan.id === planId ? {
      ...plan,
      sessionId: state.sessionId,
      status: state.status,
      stage: state.stage,
      knownConcepts: state.knownConcepts === undefined
        ? plan.knownConcepts
        : [...new Set(state.knownConcepts)],
      masteredConcepts: plan.masteredConcepts,
      updatedAt: new Date().toISOString(),
    } : plan),
  }))
}

export function deletePlan(workspace: WorkspaceState, userId: string, planId: string): WorkspaceState {
  return updateUser(workspace, userId, (user) => {
    const plans = user.plans.filter((plan) => plan.id !== planId)
    return {
      ...user,
      plans,
      activePlanId: user.activePlanId === planId ? plans[0]?.id : user.activePlanId,
    }
  })
}

export function selectPlan(workspace: WorkspaceState, userId: string, planId: string): WorkspaceState {
  return updateUser(workspace, userId, (user) => {
    if (!user.plans.some((plan) => plan.id === planId)) throw new Error("plan does not exist")
    return { ...user, activePlanId: planId }
  })
}

export function bindPlanSession(workspace: WorkspaceState, userId: string, planId: string, sessionId: string): WorkspaceState {
  return recordPlanPublicState(workspace, userId, planId, { sessionId })
}

export function activeUser(workspace: WorkspaceState): WorkspaceUser | undefined {
  return workspace.users.find((user) => user.id === workspace.activeUserId)
}

export function activePlan(workspace: WorkspaceState): LearningPlanDraft | undefined {
  const user = activeUser(workspace)
  return user?.plans.find((plan) => plan.id === user.activePlanId)
}

export function markPlanConceptMastered(workspace: WorkspaceState, userId: string, planId: string, concept: string): WorkspaceState {
  const normalized = concept.trim()
  if (!normalized) return workspace
  return updateUser(workspace, userId, (user) => ({
    ...user,
    plans: user.plans.map((plan) => plan.id === planId
      ? { ...plan, masteredConcepts: [...new Set([...(plan.masteredConcepts ?? []), normalized])], updatedAt: new Date().toISOString() }
      : plan),
  }))
}

export function masteredConceptsForUser(workspace: WorkspaceState, userId: string): string[] {
  const user = workspace.users.find((candidate) => candidate.id === userId)
  if (!user) return []
  return [...new Set(user.plans.flatMap((plan) => plan.masteredConcepts ?? []))]
}

export function planNameFromGoal(input: { mode: "catalog"; chapterTitle: string } | { mode: "custom"; customGoal: string }): string {
  return (input.mode === "catalog" ? input.chapterTitle : input.customGoal).trim()
}

export function learnerBackground(profile: LearnerProfileDraft): string {
  const languages = profile.priorLanguages.length ? profile.priorLanguages.join("、") : "无"
  return `姓名：${profile.name}；学习背景：${profile.background || "未填写"}；每周预计学习：${profile.weeklyHours}小时；Python基础：${profile.pythonLevel}；偏好：${profile.learningStyle}；其他编程语言：${languages}`
}

function updateUser(workspace: WorkspaceState, userId: string, update: (user: WorkspaceUser) => WorkspaceUser): WorkspaceState {
  if (!workspace.users.some((user) => user.id === userId)) throw new Error("learner does not exist")
  return { ...workspace, users: workspace.users.map((user) => user.id === userId ? update(user) : user) }
}

function isWorkspace(value: unknown): value is WorkspaceState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  if (candidate.version !== 1 || !Array.isArray(candidate.users)) return false
  return candidate.users.every((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false
    const user = entry as Record<string, unknown>
    return typeof user.id === "string"
      && typeof user.name === "string"
      && typeof user.weeklyHours === "number"
      && typeof user.pythonLevel === "string"
      && typeof user.learningStyle === "string"
      && typeof user.background === "string"
      && Array.isArray(user.priorLanguages)
      && user.priorLanguages.every((item) => typeof item === "string")
      && Array.isArray(user.plans)
      && user.plans.every((plan) => Boolean(plan)
        && typeof plan === "object"
        && typeof (plan as Record<string, unknown>).id === "string"
        && typeof (plan as Record<string, unknown>).name === "string"
        && ((plan as Record<string, unknown>).knownConcepts === undefined
          || (Array.isArray((plan as Record<string, unknown>).knownConcepts)
            && ((plan as Record<string, unknown>).knownConcepts as unknown[]).every((item) => typeof item === "string")))
        && ((plan as Record<string, unknown>).masteredConcepts === undefined
          || (Array.isArray((plan as Record<string, unknown>).masteredConcepts)
            && ((plan as Record<string, unknown>).masteredConcepts as unknown[]).every((item) => typeof item === "string"))))
  })
}
