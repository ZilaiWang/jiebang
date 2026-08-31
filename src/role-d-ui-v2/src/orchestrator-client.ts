export type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

/**
 * 生成客户端侧唯一 ID。优先使用 crypto.randomUUID(secure context 可用);
 * 非 HTTPS/http 环境或旧内核(如 360 浏览器)不可用时回退到 Math.random 方案,
 * 避免 onClick/默认参数抛 TypeError 导致"点击无效"。
 */
export function newClientId(prefix = "id"): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export interface LearningGoalSpecInput {
  mode: "curriculum_node" | "custom_goal"
  selected_node_ids?: string[]
  custom_goal?: string
}

export interface ProfileIntakeInput {
  learner_id: string
  goal: string
  background_summary?: string
  education_stage?: string
  discipline_background?: string[]
  role_context?: string
  prior_languages?: string[]
  prior_topics?: string[]
  self_rating?: "beginner" | "basic" | "intermediate" | "integrated"
  goal_use_case?: "coursework" | "competition" | "job" | "project" | "certification" | "interest" | "other"
  desired_outcome?: string
  deadline?: string
  weekly_time_budget_minutes?: number
  session_time_budget_minutes?: number
  explanation_preference?: "analogy_first" | "principle_first" | "example_first" | "step_by_step" | "balanced"
  practice_preference?: "quiz" | "coding" | "project" | "mixed"
  pace_preference?: "slow" | "steady" | "fast"
  preferred_contexts?: string[]
  tool_constraints?: string[]
  accommodations?: string[]
  privacy?: {
    personalization_enabled?: boolean
    retention?: "session_only" | "cross_session"
    allow_profile_display?: boolean
  }
}

export interface CreateSessionInput {
  learnerId: string
  goal: string
  goalProfile?: "coursework" | "algorithm_competition" | "job_interview" | "general_learning"
  background?: string
  selfRating?: string
  learningGoalSpec?: LearningGoalSpecInput
  profileIntake?: ProfileIntakeInput
}
export interface GoalPathChangeInput {
  pathId: string
  goal: string
  goalProfile: "coursework" | "algorithm_competition" | "job_interview" | "general_learning"
}

export interface ProviderConfigurationView {
  configured: boolean
  provider_mode: "model"
  endpoint: string
  model_id: string
}

export type SubmissionAnswer =
  | { item_id: string; selected_option_id: string; hint_level_used: number }
  | { item_id: string; text_response: string; hint_level_used: number }
  | { item_id: string; code_response: string; hint_level_used: number }

export interface ProfileClarificationAnswerInput {
  question_id: string
  value: string | string[] | number
}

export class OrchestratorClientError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message)
  }
}

export async function createOrchestratorSession(
  input: CreateSessionInput,
  fetcher: Fetcher = fetch,
): Promise<any> {
  const created = await requestJson("/orchestrator/sessions", input.learnerId, fetcher, {
    method: "POST",
    body: JSON.stringify({
      mode: "deterministic",
      learner_request: {
        learner_id: input.learnerId,
        goal: input.goal,
        background: input.background,
        self_rating: input.selfRating,
        goal_profile: input.goalProfile,
        learning_goal_spec: input.learningGoalSpec,
        profile_intake: input.profileIntake,
      },
    }),
  })
  return created.status === "running"
    ? waitForOrchestratorSession(created.session_id, input.learnerId, fetcher)
    : created
}

export async function getProviderConfiguration(fetcher: Fetcher = fetch): Promise<ProviderConfigurationView> {
  return publicRequestJson("/orchestrator/provider-config", fetcher)
}

export async function saveProviderConfiguration(
  input: { endpoint: string; modelId: string; apiKey: string },
  fetcher: Fetcher = fetch,
): Promise<ProviderConfigurationView> {
  return publicRequestJson("/orchestrator/provider-config", fetcher, {
    method: "PUT",
    body: JSON.stringify({ endpoint: input.endpoint, model_id: input.modelId, api_key: input.apiKey }),
  })
}

export async function deleteMyLearnerData(
  learnerId: string,
  fetcher: Fetcher = fetch,
): Promise<{ status: "deleted"; deleted_files: number; rewritten_files: number; deleted_paths: string[] }> {
  return requestJson("/orchestrator/privacy/learner-data", learnerId, fetcher, { method: "DELETE" })
}

export async function getOrchestratorSession(sessionId: string, learnerId: string, fetcher: Fetcher = fetch): Promise<any> {
  return requestJson(`/orchestrator/sessions/${encodeURIComponent(sessionId)}`, learnerId, fetcher)
}

export async function getOrchestratorEvents(sessionId: string, learnerId: string, fetcher: Fetcher = fetch): Promise<any> {
  return requestJson(`/orchestrator/sessions/${encodeURIComponent(sessionId)}/events`, learnerId, fetcher)
}

export async function changeGoalPath(
  sessionId: string,
  learnerId: string,
  input: GoalPathChangeInput,
  fetcher: Fetcher = fetch,
): Promise<any> {
  return requestJson(`/orchestrator/sessions/${encodeURIComponent(sessionId)}/path/change-goal`, learnerId, fetcher, {
    method: "POST",
    body: JSON.stringify({ path_id: input.pathId, goal: input.goal, goal_profile: input.goalProfile }),
  })
}

export async function requestResumePath(
  sessionId: string,
  learnerId: string,
  pathId: string,
  fetcher: Fetcher = fetch,
): Promise<any> {
  return requestJson(`/orchestrator/sessions/${encodeURIComponent(sessionId)}/path/resume`, learnerId, fetcher, {
    method: "POST",
    body: JSON.stringify({ path_id: pathId }),
  })
}

export async function submitResumeDiagnosisAnswers(
  sessionId: string,
  learnerId: string,
  pathId: string,
  answers: Record<string, string>,
  fetcher: Fetcher = fetch,
): Promise<any> {
  return requestJson(`/orchestrator/sessions/${encodeURIComponent(sessionId)}/path/resume/diagnosis`, learnerId, fetcher, {
    method: "POST",
    body: JSON.stringify({ path_id: pathId, answers }),
  })
}

export async function submitDiagnosisAnswers(
  sessionId: string,
  learnerId: string,
  answers: Record<string, string>,
  fetcher: Fetcher = fetch,
  commandId: string = newClientId("cmd"),
): Promise<any> {
  return command(sessionId, learnerId, {
    command_id: commandId,
    type: "submit_diagnosis_answers",
    payload: { answers },
  }, fetcher)
}

export async function submitProfileAnswers(
  sessionId: string,
  learnerId: string,
  answers: ProfileClarificationAnswerInput[],
  fetcher: Fetcher = fetch,
  commandId: string = newClientId("cmd"),
): Promise<any> {
  return command(sessionId, learnerId, {
    command_id: commandId,
    type: "submit_profile_answers",
    payload: { answers },
  }, fetcher)
}

export async function submitAssessmentAnswers(
  sessionId: string,
  learnerId: string,
  answers: SubmissionAnswer[],
  fetcher: Fetcher = fetch,
  commandId: string = newClientId("cmd"),
): Promise<any> {
  return command(sessionId, learnerId, {
    command_id: commandId,
    type: "submit_assessment_answers",
    payload: { answers },
  }, fetcher)
}

export async function submitProfileGapAnswer(
  sessionId: string,
  learnerId: string,
  questionId: string,
  sourceId: string,
  answer: string,
  fetcher: Fetcher = fetch,
  commandId: string = newClientId("cmd"),
): Promise<any> {
  return command(sessionId, learnerId, {
    command_id: commandId,
    type: "submit_profile_gap_answer",
    payload: { question_id: questionId, source_id: sourceId, answer },
  }, fetcher)
}

export async function runAssessmentCode(
  sessionId: string,
  learnerId: string,
  itemId: string,
  code: string,
  fetcher: Fetcher = fetch,
  commandId: string = newClientId("cmd"),
): Promise<any> {
  return command(sessionId, learnerId, {
    command_id: commandId,
    type: "run_assessment_code",
    payload: { item_id: itemId, code },
  }, fetcher)
}

export async function runCodeLab(
  sessionId: string,
  learnerId: string,
  labId: string,
  submission: string | { gap_answers: Record<string, string> },
  fetcher: Fetcher = fetch,
  commandId: string = newClientId("cmd"),
): Promise<any> {
  return command(sessionId, learnerId, {
    command_id: commandId,
    type: "run_code_lab",
    payload: typeof submission === "string"
      ? { lab_id: labId, code: submission }
      : { lab_id: labId, gap_answers: submission.gap_answers },
  }, fetcher)
}

export async function submitCodeLab(
  sessionId: string,
  learnerId: string,
  labId: string,
  submission: string | { gap_answers: Record<string, string> },
  fetcher: Fetcher = fetch,
  commandId: string = newClientId("cmd"),
): Promise<any> {
  return command(sessionId, learnerId, {
    command_id: commandId,
    type: "submit_code_lab",
    payload: typeof submission === "string" ? { lab_id: labId, code: submission } : { lab_id: labId, gap_answers: submission.gap_answers },
  }, fetcher)
}

export async function debugCodeLab(
  sessionId: string,
  learnerId: string,
  labId: string,
  submission: string | { gap_answers: Record<string, string> },
  target: { public_case_id: string } | { custom_input: unknown },
  fetcher: Fetcher = fetch,
  commandId: string = newClientId("cmd"),
): Promise<any> {
  return command(sessionId, learnerId, {
    command_id: commandId,
    type: "debug_code_lab",
    payload: {
      lab_id: labId,
      ...(typeof submission === "string" ? { code: submission } : { gap_answers: submission.gap_answers }),
      ...target,
    },
  }, fetcher)
}

/** 分步示例/讲义示例独立运行：Docker 真实执行，返回 stdout。 */
export async function runExampleCode(
  sessionId: string,
  learnerId: string,
  code: string,
  fetcher: Fetcher = fetch,
  commandId: string = newClientId("cmd"),
): Promise<any> {
  return command(sessionId, learnerId, {
    command_id: commandId,
    type: "run_example_code",
    payload: { code },
  }, fetcher)
}

export async function waitForOrchestratorSession(
  sessionId: string,
  learnerId: string,
  fetcher: Fetcher = fetch,
  options: { timeoutMs?: number; intervalMs?: number; onRunning?: (session: any) => void } = {},
): Promise<any> {
  const timeoutMs = options.timeoutMs ?? 600_000
  const deadline = Date.now() + timeoutMs
  let latest = await getOrchestratorSession(sessionId, learnerId, fetcher)
  while (latest.status === "running" && Date.now() < deadline) {
    options.onRunning?.(latest)
    try {
      latest = await waitForSessionStateEvent(sessionId, learnerId, latest, deadline, fetcher, options.onRunning)
    } catch {
      // SSE is the primary path. Older proxies and test fetchers fall back to
      // bounded polling without changing server-side job ownership.
      await new Promise((resolve) => setTimeout(resolve, options.intervalMs ?? 800))
      latest = await getOrchestratorSession(sessionId, learnerId, fetcher)
    }
  }
  if (latest.status === "running") {
    throw new OrchestratorClientError("SESSION_GENERATION_TIMEOUT", "主 Agent生成下一轮资源超时，请稍后刷新会话", 504)
  }
  return latest
}

async function waitForSessionStateEvent(
  sessionId: string,
  learnerId: string,
  current: any,
  deadline: number,
  fetcher: Fetcher,
  onRunning?: (session: any) => void,
): Promise<any> {
  const headers = new Headers()
  headers.set("authorization", `Bearer ${learnerId}`)
  const response = await fetcher(
    `/orchestrator/sessions/${encodeURIComponent(sessionId)}/events/stream`,
    { headers },
  )
  if (!response.ok || !response.body) throw new Error("SSE_UNAVAILABLE")
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let latest = current
  try {
    while (Date.now() < deadline) {
      const chunk = await reader.read()
      if (chunk.done) return latest
      buffer += decoder.decode(chunk.value, { stream: true })
      let boundary = buffer.indexOf("\n\n")
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const eventName = frame.split("\n").find((line) => line.startsWith("event:"))?.slice(6).trim()
        if (eventName === "session_state") {
          latest = await getOrchestratorSession(sessionId, learnerId, fetcher)
          if (latest.status !== "running") return latest
          onRunning?.(latest)
        }
        boundary = buffer.indexOf("\n\n")
      }
    }
    return latest
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}

export async function retryOrchestratorSession(
  sessionId: string,
  learnerId: string,
  fetcher: Fetcher = fetch,
  commandId: string = newClientId("cmd"),
): Promise<any> {
  return command(sessionId, learnerId, { command_id: commandId, type: "retry" }, fetcher)
}

async function command(sessionId: string, learnerId: string, body: unknown, fetcher: Fetcher): Promise<any> {
  return requestJson(`/orchestrator/sessions/${encodeURIComponent(sessionId)}/commands`, learnerId, fetcher, {
    method: "POST",
    body: JSON.stringify(body),
  })
}

async function requestJson(path: string, learnerId: string, fetcher: Fetcher, init: RequestInit = {}): Promise<any> {
  const headers = new Headers(init.headers)
  headers.set("authorization", `Bearer ${learnerId}`)
  if (init.body !== undefined) headers.set("content-type", "application/json")
  return executeJson(path, fetcher, { ...init, headers })
}

async function publicRequestJson(path: string, fetcher: Fetcher, init: RequestInit = {}): Promise<any> {
  const headers = new Headers(init.headers)
  if (init.body !== undefined) headers.set("content-type", "application/json")
  return executeJson(path, fetcher, { ...init, headers })
}

async function executeJson(path: string, fetcher: Fetcher, init: RequestInit): Promise<any> {
  let response: Response
  try {
    response = await fetcher(path, init)
  } catch {
    throw new OrchestratorClientError(
      "BACKEND_UNREACHABLE",
      "无法连接到主 Agent。请确认已双击运行「启动KnowBalance.bat」或主 Agent 正在 http://127.0.0.1:8787 运行。",
      503,
    )
  }
  const payload: any = await response.json().catch(() => ({ error: { code: "INVALID_RESPONSE", message: "主 Agent返回了无效响应，可能是服务刚启动还未就绪，请稍后重试。" } }))
  if (!response.ok) {
    throw new OrchestratorClientError(
      payload?.error?.code ?? "ORCHESTRATOR_REQUEST_FAILED",
      payload?.error?.message ?? `主 Agent请求失败（${response.status}）`,
      response.status,
    )
  }
  return payload
}
