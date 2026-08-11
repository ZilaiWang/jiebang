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

export interface CreateSessionInput {
  learnerId: string
  goal: string
  background?: string
  selfRating?: string
  learningGoalSpec?: LearningGoalSpecInput
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

export class OrchestratorClientError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message)
  }
}

export async function createOrchestratorSession(
  input: CreateSessionInput,
  fetcher: Fetcher = fetch,
): Promise<any> {
  return requestJson("/orchestrator/sessions", input.learnerId, fetcher, {
    method: "POST",
    body: JSON.stringify({
      mode: "deterministic",
      learner_request: {
        learner_id: input.learnerId,
        goal: input.goal,
        background: input.background,
        self_rating: input.selfRating,
        learning_goal_spec: input.learningGoalSpec,
      },
    }),
  })
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

export async function getOrchestratorSession(sessionId: string, learnerId: string, fetcher: Fetcher = fetch): Promise<any> {
  return requestJson(`/orchestrator/sessions/${encodeURIComponent(sessionId)}`, learnerId, fetcher)
}

export async function getOrchestratorEvents(sessionId: string, learnerId: string, fetcher: Fetcher = fetch): Promise<any> {
  return requestJson(`/orchestrator/sessions/${encodeURIComponent(sessionId)}/events`, learnerId, fetcher)
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

export async function waitForOrchestratorSession(
  sessionId: string,
  learnerId: string,
  fetcher: Fetcher = fetch,
  options: { timeoutMs?: number; intervalMs?: number; onRunning?: (session: any) => void } = {},
): Promise<any> {
  // 与主 Agent 后端生成预算对齐：C 每轮最多 6 次生成尝试、单次模型超时最长 120s，
  // 最坏情况可超 10 分钟；默认 600s 避免多轮重试时前端提前误报超时。
  const timeoutMs = options.timeoutMs ?? 600_000
  const intervalMs = options.intervalMs ?? 800
  const deadline = Date.now() + timeoutMs
  let latest = await getOrchestratorSession(sessionId, learnerId, fetcher)
  while (latest.status === "running" && Date.now() < deadline) {
    options.onRunning?.(latest)
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
    latest = await getOrchestratorSession(sessionId, learnerId, fetcher)
  }
  if (latest.status === "running") {
    throw new OrchestratorClientError("SESSION_GENERATION_TIMEOUT", "主 Agent生成下一轮资源超时，请稍后刷新会话", 504)
  }
  return latest
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
