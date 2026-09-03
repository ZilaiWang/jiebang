import { contentHash } from "./common"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  fastModelPolicy,
  GLM52_MODEL_POLICY_VERSION,
  modelCallPolicy,
  ModelExecutionBudget,
  ModelExecutionBudgetExceededError,
  ROLE_C_CONTENT_MODEL_CALL_BUDGET,
  ROLE_C_REVIEWED_WORKFLOW_HARD_DEADLINE_MS,
  ROLE_C_REVIEWED_WORKFLOW_SOFT_DEADLINE_MS,
  classifyProviderFailure,
  retryDelayMs,
  sharedModelCircuitBreaker,
  sharedModelScheduler,
  sharedModelSchedulerFor,
  type ModelCallPolicy,
  type ModelCallTrace,
  type ModelCircuitBreaker,
  type ModelScheduler,
  type ModelTraceSink,
} from "../../model-runtime"
import { recoverStructuredJson } from "./structured-output"

/** 在缺少模型配置时尝试加载 .env.role-c.local。显式传入的 env 值优先。 */
function ensureModelEnv(env: Record<string, string | undefined>): Record<string, string | undefined> {
  if (env.ROLE_C_MODEL_ENDPOINT && env.ROLE_C_MODEL_ID) return env
  try {
    const envPath = resolve(process.cwd(), ".env.role-c.local")
    const content = readFileSync(envPath, "utf-8")
    const merged: Record<string, string> = {}
    for (const line of content.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) continue
      const eqIndex = trimmed.indexOf("=")
      if (eqIndex <= 0) continue
      const key = trimmed.slice(0, eqIndex).trim()
      merged[key] = trimmed.slice(eqIndex + 1).trim()
    }
    // 显式传入的 env 值覆盖文件中的值
    return { ...merged, ...env as Record<string, string> }
  } catch {
    return env
  }
}

export interface StructuredModelRequest {
  task: string
  system_prompt: string
  input: unknown
  output_schema_id: string
  output_schema: Record<string, unknown>
  temperature: number
  max_tokens: number
  idempotency_key: string
  /** Versioned per-call runtime policy. Production callers should always set this. */
  policy?: ModelCallPolicy
  /** Absolute business deadline shared by the surrounding workflow. */
  deadline_at_ms?: number
  /** Compatibility seam; policy.thinking takes precedence. */
  thinking?: "enabled" | "disabled"
}

/** Vendor-neutral boundary. Prompt/model work can replace this without changing C contracts. */
export interface ModelGateway {
  readonly model_id: string
  readonly model_config_hash: string
  generateStructured<T>(request: StructuredModelRequest): Promise<T>
}

export interface ModelUsageEvent {
  task: string
  model_id: string
  idempotency_key: string
  prompt_tokens?: number
  cached_prompt_tokens?: number
  completion_tokens?: number
  reasoning_tokens?: number
  total_tokens?: number
  duration_ms?: number
  queued_ms?: number
  policy_profile?: ModelCallPolicy["profile"]
}

export type ModelGatewayFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

export interface OpenAICompatibleGatewayOptions {
  endpoint: string
  api_key?: string
  model: string
  response_format?: "json_schema" | "json_object" | "text_json"
  schema_strict?: boolean
  /** Optional hybrid-model switch; omitted for providers that do not implement it. */
  thinking?: "enabled" | "disabled"
  auth_header?: string
  auth_scheme?: string
  timeout_ms?: number
  max_transport_retries?: number
  fetch_impl?: ModelGatewayFetch
  on_usage?: (event: ModelUsageEvent) => void
  on_trace?: ModelTraceSink
  scheduler?: ModelScheduler
  execution_budget?: ModelExecutionBudget
  circuit_breaker?: ModelCircuitBreaker
  force_fast?: boolean
  trace_context?: { job_id?: string; session_id?: string; run_id?: string }
}

/**
 * HTTP adapter for servers implementing the chat-completions JSON-schema contract.
 * Secrets are only placed in the Authorization header and are excluded from hashes/errors.
 */
export class OpenAICompatibleModelGateway implements ModelGateway {
  readonly model_id: string
  readonly model_config_hash: string
  private readonly options: Required<Pick<OpenAICompatibleGatewayOptions,
    "timeout_ms" | "max_transport_retries" | "response_format" | "schema_strict" | "auth_header" | "auth_scheme">> &
    OpenAICompatibleGatewayOptions

  constructor(options: OpenAICompatibleGatewayOptions) {
    if (!options.endpoint.trim()) throw new Error("ModelGateway endpoint 不能为空")
    if (!options.model.trim()) throw new Error("ModelGateway model 不能为空")
    const timeoutMs = options.timeout_ms ?? 120_000
    const maxTransportRetries = options.max_transport_retries ?? 2
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 600_000) {
      throw new Error("ModelGateway timeout_ms 必须是 100..600000 的整数")
    }
    if (!Number.isSafeInteger(maxTransportRetries) || maxTransportRetries < 0 || maxTransportRetries > 5) {
      throw new Error("ModelGateway max_transport_retries 必须是 0..5 的整数")
    }
    const authHeader = options.auth_header ?? "authorization"
    if (!/^[A-Za-z0-9-]+$/.test(authHeader)) throw new Error("ModelGateway auth_header 不是合法 HTTP header 名")
    this.model_id = options.model
    this.options = {
      ...options,
      timeout_ms: timeoutMs,
      max_transport_retries: maxTransportRetries,
      response_format: options.response_format ?? "json_object",
      schema_strict: options.schema_strict ?? true,
      auth_header: authHeader,
      auth_scheme: options.auth_scheme ?? "Bearer",
    }
    this.model_config_hash = `MODEL-${contentHash({
      endpoint: options.endpoint,
      model: options.model,
      timeout_ms: this.options.timeout_ms,
      max_transport_retries: this.options.max_transport_retries,
      response_format: this.options.response_format,
      schema_strict: this.options.schema_strict,
      thinking: this.options.thinking,
      policy_version: GLM52_MODEL_POLICY_VERSION,
      force_fast: Boolean(this.options.force_fast),
      auth_header: this.options.auth_header.toLowerCase(),
      auth_scheme: this.options.auth_scheme,
      protocol: "openai-compatible-chat-json-schema-v1",
    }).slice("sha256:".length)}`
  }

  async generateStructured<T>(request: StructuredModelRequest): Promise<T> {
    const policy = this.resolvePolicy(request)
    const effectiveIdempotencyKey = contentHash({
      caller_key: request.idempotency_key,
      model_id: this.model_id,
      policy_version: policy.policy_version,
      policy_profile: policy.profile,
      reasoning_effort: policy.reasoning_effort ?? null,
      max_tokens: Math.min(request.max_tokens, policy.max_tokens),
      response_format: policy.response_format,
      output_schema_id: request.output_schema_id,
    })
    const budget = this.options.execution_budget
    const deadlineAt = Math.min(
      request.deadline_at_ms ?? Number.POSITIVE_INFINITY,
      budget ? Date.now() + budget.remainingMs() : Number.POSITIVE_INFINITY,
    )
    let lastError: unknown
    for (let attempt = 0; attempt <= policy.max_transport_retries; attempt += 1) {
      const traceStarted = performance.now()
      let queuedMs = 0
      let providerRequestId: string | undefined
      let usage: Record<string, unknown> | undefined
      let finishReason: string | undefined
      let jsonParseOk = false
      try {
        budget?.consumeModelCall()
        ;(this.options.circuit_breaker ?? sharedModelCircuitBreaker).beforeRequest()
        const scheduled = await (this.options.scheduler ?? sharedModelScheduler).run(
          policy,
          deadlineAt,
          () => this.performRequest(request, policy, effectiveIdempotencyKey, deadlineAt),
        )
        queuedMs = scheduled.queued_ms
        const { body, response } = scheduled.value
        providerRequestId = response.headers.get("x-request-id")
          ?? response.headers.get("request-id")
          ?? stringOrUndefined(body.id)
        const output = extractChatCompletionContent(body)
        finishReason = extractFinishReason(body)
        usage = isRecord(body.usage) ? body.usage : undefined
        const durationMs = performance.now() - traceStarted
        try {
          this.options.on_usage?.({
            task: request.task,
            model_id: this.model_id,
            idempotency_key: effectiveIdempotencyKey,
            prompt_tokens: numberOrUndefined(usage?.prompt_tokens),
            cached_prompt_tokens: nestedNumber(usage, "prompt_tokens_details", "cached_tokens"),
            completion_tokens: numberOrUndefined(usage?.completion_tokens),
            reasoning_tokens: nestedNumber(usage, "completion_tokens_details", "reasoning_tokens"),
            total_tokens: numberOrUndefined(usage?.total_tokens),
            duration_ms: durationMs,
            queued_ms: queuedMs,
            policy_profile: policy.profile,
          })
        } catch { /* telemetry must not repeat or fail a successful model call */ }
        if (finishReason === "length") {
          throw new ModelGatewayError("OUTPUT_TRUNCATED", "模型输出达到 token 上限，结构化 JSON 被截断")
        }
        const parsed = (typeof output === "string" ? parseJson(output) : output) as T
        jsonParseOk = true
        ;(this.options.circuit_breaker ?? sharedModelCircuitBreaker).recordSuccess()
        await this.emitTrace(request, policy, attempt, queuedMs, traceStarted, {
          usage,
          finishReason,
          jsonParseOk,
          providerRequestId,
        })
        return parsed
      } catch (error) {
        const normalized = isAbortError(error)
          ? new ModelGatewayError("TIMEOUT", `模型请求超过 ${policy.timeout_ms}ms`)
          : error instanceof ModelExecutionBudgetExceededError
            ? new ModelGatewayError("BUDGET_EXCEEDED", error.message)
          : error instanceof ModelGatewayError
            ? error
            : error instanceof Error
            ? new ModelGatewayError("NETWORK_ERROR", `模型服务网络请求失败：${error.name}: ${error.message}`)
            : new ModelGatewayError("NETWORK_ERROR", "模型服务网络请求失败")
        await this.emitTrace(request, policy, attempt, queuedMs, traceStarted, {
          usage,
          finishReason,
          jsonParseOk,
          providerRequestId,
          error: normalized,
        })
        if (attempt < policy.max_transport_retries && isRetriable(normalized)) {
          ;(this.options.circuit_breaker ?? sharedModelCircuitBreaker).recordRetriableFailure()
          budget?.consumeTransportRetry()
          lastError = normalized
          await delay(retryDelayMs(attempt, normalized.retry_after))
          continue
        }
        throw normalized
      }
    }
    throw lastError ?? new ModelGatewayError("INVALID_RESPONSE", "模型请求未返回结果")
  }

  private resolvePolicy(request: StructuredModelRequest): ModelCallPolicy {
    if (request.policy) {
      if (!this.options.force_fast || request.policy.profile === "fast") return request.policy
      return fastModelPolicy("FORCED_FAST_RUNTIME", request.policy.max_tokens, {
        timeout_ms: Math.min(request.policy.timeout_ms, 120_000),
        max_transport_retries: request.policy.max_transport_retries,
        response_format: request.policy.response_format,
        priority: request.policy.priority === "offline" ? "background" : request.policy.priority,
        do_sample: request.policy.do_sample,
      })
    }
    const thinking = request.thinking ?? this.options.thinking ?? "disabled"
    if (thinking === "enabled") {
      return modelCallPolicy("quality", {
        reason_codes: ["LEGACY_THINKING_ENABLED_MAPPED_TO_QUALITY"],
        max_tokens: request.max_tokens,
        timeout_ms: this.options.timeout_ms,
        max_transport_retries: Math.min(1, this.options.max_transport_retries) as 0 | 1,
        response_format: this.options.response_format,
      })
    }
    return fastModelPolicy("LEGACY_CALL_POLICY", request.max_tokens, {
      timeout_ms: this.options.timeout_ms,
      max_transport_retries: Math.min(1, this.options.max_transport_retries) as 0 | 1,
      response_format: this.options.response_format,
      do_sample: false,
    })
  }

  private async performRequest(
    request: StructuredModelRequest,
    policy: ModelCallPolicy,
    idempotencyKey: string,
    deadlineAt: number,
  ): Promise<{ response: Response; body: Record<string, unknown> }> {
    const remaining = deadlineAt - Date.now()
    if (remaining <= 0) throw new ModelExecutionBudgetExceededError("DEADLINE")
    const controller = new AbortController()
    const timeoutMs = Math.max(1, Math.min(policy.timeout_ms, remaining))
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const responseFormatOptions = { ...this.options, response_format: policy.response_format }
      const isGlm52 = this.options.model.toLocaleLowerCase().startsWith("glm-5.2")
      const response = await (this.options.fetch_impl ?? fetch)(this.options.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.options.api_key ? {
            [this.options.auth_header]: this.options.auth_scheme
              ? `${this.options.auth_scheme} ${this.options.api_key}`
              : this.options.api_key,
          } : {}),
          "idempotency-key": idempotencyKey,
        },
        body: JSON.stringify({
          model: this.options.model,
          messages: [
            { role: "system", content: systemPromptWithSchema(responseFormatOptions, request) },
            { role: "user", content: JSON.stringify(request.input) },
          ],
          temperature: request.temperature,
          max_tokens: Math.min(request.max_tokens, policy.max_tokens),
          thinking: { type: policy.thinking },
          ...(isGlm52 && policy.thinking === "enabled" && policy.reasoning_effort
            ? { reasoning_effort: policy.reasoning_effort }
            : {}),
          ...(isGlm52 ? { do_sample: policy.do_sample } : {}),
          ...responseFormatBody(responseFormatOptions, request),
        }),
        signal: controller.signal,
      })
      let body: Record<string, unknown>
      try {
        body = await response.json() as Record<string, unknown>
      } catch {
        throw new ModelGatewayError("INVALID_RESPONSE", "模型服务响应体不是合法 JSON", { http_status: response.status })
      }
      if (!response.ok) {
        const classification = classifyProviderFailure(response.status, body)
        const detail = providerErrorMessage(body)
        const code = classification.retriable
          ? "RETRIABLE_HTTP_ERROR"
          : classification.category === "auth"
            ? "AUTH_ERROR"
            : "HTTP_ERROR"
        throw new ModelGatewayError(
          code,
          code === "AUTH_ERROR"
            ? `API Key 认证失败（HTTP ${response.status}）${detail ? `：${detail}` : ""}`
            : `模型服务返回 HTTP ${response.status}${detail ? `：${detail}` : ""}`,
          {
            provider_code: classification.provider_code,
            http_status: response.status,
            retry_after: response.headers.get("retry-after") ?? undefined,
          },
        )
      }
      return { response, body }
    } finally {
      clearTimeout(timeout)
    }
  }

  private async emitTrace(
    request: StructuredModelRequest,
    policy: ModelCallPolicy,
    attempt: number,
    queuedMs: number,
    started: number,
    detail: {
      usage?: Record<string, unknown>
      finishReason?: string
      jsonParseOk: boolean
      providerRequestId?: string
      error?: ModelGatewayError
    },
  ): Promise<void> {
    if (!this.options.on_trace) return
    const trace: ModelCallTrace = {
      trace_id: contentHash({ task: request.task, idempotency_key: request.idempotency_key, attempt, started }),
      ...this.options.trace_context,
      task: request.task,
      stage: request.task,
      attempt: attempt + 1,
      model_id: this.model_id,
      policy_profile: policy.profile,
      policy_version: policy.policy_version,
      policy_reason_codes: [...policy.reason_codes],
      queued_ms: Math.round(queuedMs),
      total_ms: Math.round(performance.now() - started),
      prompt_tokens: numberOrUndefined(detail.usage?.prompt_tokens),
      cached_prompt_tokens: nestedNumber(detail.usage, "prompt_tokens_details", "cached_tokens"),
      completion_tokens: numberOrUndefined(detail.usage?.completion_tokens),
      reasoning_tokens: nestedNumber(detail.usage, "completion_tokens_details", "reasoning_tokens"),
      total_tokens: numberOrUndefined(detail.usage?.total_tokens),
      finish_reason: detail.finishReason,
      response_format: policy.response_format,
      json_parse_ok: detail.jsonParseOk,
      provider_error_code: detail.error?.provider_code ?? detail.error?.code,
      provider_request_id: detail.providerRequestId,
      ...(attempt > 0 ? { retry_kind: "transport" as const } : {}),
    }
    try { await this.options.on_trace(trace) } catch { /* telemetry cannot fail generation */ }
  }
}

export class ModelGatewayError extends Error {
  constructor(
    readonly code:
      | "HTTP_ERROR"
      | "RETRIABLE_HTTP_ERROR"
      | "AUTH_ERROR"
      | "TIMEOUT"
      | "NETWORK_ERROR"
      | "INVALID_RESPONSE"
      | "OUTPUT_TRUNCATED"
      | "INVALID_JSON"
      | "BUDGET_EXCEEDED",
    message: string,
    detail: {
      provider_code?: string
      http_status?: number
      retry_after?: string
    } = {},
  ) {
    super(message)
    this.name = "ModelGatewayError"
    this.provider_code = detail.provider_code
    this.http_status = detail.http_status
    this.retry_after = detail.retry_after
  }

  readonly provider_code?: string
  readonly http_status?: number
  readonly retry_after?: string
}

/** No production default is provided: an absent provider returns a clear blocked state. */
export class ModelProviderUnavailableError extends Error {
  constructor(message = "未配置 ModelGateway，C 生成阶段不能开始") {
    super(message)
    this.name = "ModelProviderUnavailableError"
  }
}

/** The selected provider has a declared, deterministic target capability boundary. */
export class UnsupportedTargetError extends ModelProviderUnavailableError {
  readonly code = "UNSUPPORTED_TARGET" as const

  constructor(
    readonly agent: "concept-tutor" | "code-lab" | "tiered-evaluator",
    readonly target_source_ids: string[],
    message: string,
  ) {
    super(message)
    this.name = "UnsupportedTargetError"
  }
}

/** A model stage exhausted its bounded repair budget without satisfying its internal contract. */
export class ModelOutputValidationError extends Error {
  constructor(
    readonly stage: string,
    readonly issues: string[],
  ) {
    const detail = issues.slice(0, 6).join("；")
    super(`${stage} 未通过分阶段输出校验${detail ? `：${detail}` : ""}`)
    this.name = "ModelOutputValidationError"
  }
}

export function createRoleCModelGatewayFromEnv(
  env: Record<string, string | undefined> = process.env,
  overrides: Pick<OpenAICompatibleGatewayOptions, "fetch_impl" | "on_usage" | "on_trace" | "scheduler" | "execution_budget" | "circuit_breaker" | "trace_context"> = {},
): OpenAICompatibleModelGateway {
  const resolvedEnv = ensureModelEnv(env)
  const endpoint = resolvedEnv.MODEL_RUNTIME_ENDPOINT ?? resolvedEnv.ROLE_C_MODEL_ENDPOINT
  const model = resolvedEnv.MODEL_RUNTIME_MODEL_ID ?? resolvedEnv.ROLE_C_MODEL_ID
  if (!endpoint || !model) {
    throw new ModelProviderUnavailableError(
      "模型配置缺失：需要 ROLE_C_MODEL_ENDPOINT 和 ROLE_C_MODEL_ID。请复制 .env.role-c.example 为 .env.role-c.local 并填入模型参数。",
    )
  }
  return new OpenAICompatibleModelGateway({
    endpoint,
    model,
    api_key: resolvedEnv.MODEL_RUNTIME_API_KEY ?? resolvedEnv.ROLE_C_MODEL_API_KEY,
    response_format: responseFormatFromEnv(
      resolvedEnv.MODEL_RUNTIME_RESPONSE_FORMAT ?? resolvedEnv.ROLE_C_MODEL_RESPONSE_FORMAT,
    ),
    schema_strict: optionalBoolean(resolvedEnv.ROLE_C_MODEL_SCHEMA_STRICT, true),
    thinking: thinkingFromEnv(resolvedEnv.ROLE_C_MODEL_THINKING),
    auth_header: resolvedEnv.ROLE_C_MODEL_AUTH_HEADER || "authorization",
    auth_scheme: resolvedEnv.ROLE_C_MODEL_AUTH_SCHEME ?? "Bearer",
    timeout_ms: optionalPositiveInteger(resolvedEnv.ROLE_C_MODEL_TIMEOUT_MS, 120_000, "ROLE_C_MODEL_TIMEOUT_MS"),
    max_transport_retries: optionalNonNegativeInteger(resolvedEnv.ROLE_C_MODEL_MAX_RETRIES, 1),
    force_fast: optionalBoolean(resolvedEnv.MODEL_RUNTIME_FORCE_FAST, false),
    scheduler: overrides.scheduler ?? sharedModelSchedulerFor({
      global: optionalPositiveCount(resolvedEnv.MODEL_RUNTIME_MAX_IN_FLIGHT, 3),
      quality: optionalPositiveCount(resolvedEnv.MODEL_RUNTIME_QUALITY_MAX_IN_FLIGHT, 1),
      offline: optionalPositiveCount(resolvedEnv.MODEL_RUNTIME_OFFLINE_MAX_IN_FLIGHT, 1),
    }),
    execution_budget: overrides.execution_budget ?? new ModelExecutionBudget({
      soft_deadline_ms: optionalPositiveInteger(
        resolvedEnv.MODEL_RUNTIME_JOB_SOFT_DEADLINE_MS,
        ROLE_C_REVIEWED_WORKFLOW_SOFT_DEADLINE_MS,
        "MODEL_RUNTIME_JOB_SOFT_DEADLINE_MS",
      ),
      hard_deadline_ms: optionalPositiveInteger(
        resolvedEnv.MODEL_RUNTIME_JOB_HARD_DEADLINE_MS,
        ROLE_C_REVIEWED_WORKFLOW_HARD_DEADLINE_MS,
        "MODEL_RUNTIME_JOB_HARD_DEADLINE_MS",
      ),
      max_model_calls: optionalPositiveCount(
        resolvedEnv.MODEL_RUNTIME_MAX_MODEL_CALLS,
        ROLE_C_CONTENT_MODEL_CALL_BUDGET,
      ),
      max_transport_retries_total: optionalNonNegativeInteger(resolvedEnv.MODEL_RUNTIME_TRANSPORT_RETRY_BUDGET, 3),
    }),
    ...overrides,
  })
}

function extractChatCompletionContent(body: Record<string, unknown>): unknown {
  const choices = body.choices
  if (!Array.isArray(choices) || choices.length === 0 || !isRecord(choices[0])) {
    throw new ModelGatewayError("INVALID_RESPONSE", "模型响应缺少 choices[0]")
  }
  const message = choices[0].message
  if (!isRecord(message) || !("content" in message)) {
    throw new ModelGatewayError("INVALID_RESPONSE", "模型响应缺少 message.content")
  }
  if (message.content === null || message.content === undefined) {
    throw new ModelGatewayError("INVALID_RESPONSE", "模型响应 content 为空")
  }
  if (Array.isArray(message.content)) {
    const text = message.content.flatMap((part) => {
      if (!isRecord(part)) return []
      if (typeof part.text === "string") return [part.text]
      if (typeof part.output_text === "string") return [part.output_text]
      return []
    }).join("")
    if (!text) throw new ModelGatewayError("INVALID_RESPONSE", "模型响应 content 数组不含文本")
    return text
  }
  return message.content
}

function extractFinishReason(body: Record<string, unknown>): string | undefined {
  const choices = body.choices
  if (!Array.isArray(choices) || !isRecord(choices[0])) return undefined
  return typeof choices[0].finish_reason === "string" ? choices[0].finish_reason : undefined
}

function extractFirstJsonValue(text: string): string | undefined {
  for (let start = 0; start < text.length; start += 1) {
    const opening = text[start]
    if (opening !== "{" && opening !== "[") continue
    const closing = opening === "{" ? "}" : "]"
    let depth = 0
    let inString = false
    let escaped = false
    for (let i = start; i < text.length; i += 1) {
      const ch = text[i]
      if (inString) {
        if (escaped) {
          escaped = false
        } else if (ch === "\\") {
          escaped = true
        } else if (ch === '"') {
          inString = false
        }
        continue
      }
      if (ch === '"') {
        inString = true
        continue
      }
      if (ch === opening) depth += 1
      if (ch === closing) {
        depth -= 1
        if (depth === 0) return text.slice(start, i + 1)
      }
    }
  }
  return undefined
}

function parseJson(value: string): unknown {
  const trimmed = value.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  const candidate = fenced ? fenced[1].trim() : trimmed
  try {
    return JSON.parse(candidate)
  } catch {
    const extracted = extractFirstJsonValue(candidate)
    if (extracted !== undefined) {
      try {
        return JSON.parse(normalizePythonLiterals(extracted))
      } catch {
        // A balanced outer object can still contain a malformed nested array.
        // Continue to the final normalization path so the caller receives the
        // correct INVALID_JSON classification instead of a misleading network
        // error from a leaked SyntaxError.
      }
    }
    try {
      const normalized = normalizePythonLiterals(candidate)
      const normalizedFenced = normalized.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
      const recovered = recoverStructuredJson(normalizedFenced ? normalizedFenced[1] : normalized.trim())
      if (recovered.ok) return recovered.value
      throw new Error("JSON_RECOVERY_FAILED")
    } catch {
      throw new ModelGatewayError("INVALID_JSON", "模型响应不是合法 JSON")
    }
  }
}

/**
 * 将 JSON 文本中字符串字面量之外的 Python 风格字面量（True/False/None）
 * 替换为 JSON 标准小写形式（true/false/null）。字符串内部的内容不受影响。
 */
export function normalizePythonLiterals(text: string): string {
  const pythonLiterals: Record<string, string> = {
    True: "true",
    False: "false",
    None: "null",
  }
  let output = ""
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (inString) {
      output += ch
      if (escaped) {
        escaped = false
      } else if (ch === "\\") {
        escaped = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }
    if (ch === '"') {
      inString = true
      output += ch
      continue
    }
    const rest = text.slice(i)
    const literalKey = ["True", "False", "None"].find((key) => rest.startsWith(key))
    if (literalKey) {
      const before = i > 0 ? text[i - 1] : ""
      const after = i + literalKey.length < text.length ? text[i + literalKey.length] : ""
      if (!/[A-Za-z0-9_]/.test(before) && !/[A-Za-z0-9_]/.test(after)) {
        output += pythonLiterals[literalKey]
        i += literalKey.length - 1
        continue
      }
    }
    output += ch
  }
  return output
}

function responseFormatBody(
  options: OpenAICompatibleModelGateway["options"],
  request: Parameters<ModelGateway["generateStructured"]>[0],
): Record<string, unknown> {
  if (options.response_format === "text_json") return {}
  if (options.response_format === "json_object") {
    return { response_format: { type: "json_object" } }
  }
  return {
    response_format: {
      type: "json_schema",
      json_schema: {
        name: schemaName(request.output_schema_id),
        strict: options.schema_strict,
        schema: request.output_schema,
      },
    },
  }
}

function systemPromptWithSchema(
  options: OpenAICompatibleModelGateway["options"],
  request: Parameters<ModelGateway["generateStructured"]>[0],
): string {
  if (options.response_format === "json_schema") return request.system_prompt
  return `${request.system_prompt}\n\n必须严格遵守以下 JSON Schema（不得自创字段名或包装层）：\n${JSON.stringify(request.output_schema)}`
}

function responseFormatFromEnv(value: string | undefined): OpenAICompatibleGatewayOptions["response_format"] {
  if (value === undefined || value === "") return "json_object"
  if (["json_schema", "json_object", "text_json"].includes(value)) {
    return value as NonNullable<OpenAICompatibleGatewayOptions["response_format"]>
  }
  throw new ModelProviderUnavailableError(
    "ROLE_C_MODEL_RESPONSE_FORMAT 必须为 json_schema、json_object 或 text_json",
  )
}

function thinkingFromEnv(value: string | undefined): OpenAICompatibleGatewayOptions["thinking"] {
  if (value === undefined || value === "") return "disabled"
  if (value === "enabled" || value === "disabled") return value
  throw new ModelProviderUnavailableError("ROLE_C_MODEL_THINKING 必须为 enabled 或 disabled")
}

function optionalBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback
  if (value === "true") return true
  if (value === "false") return false
  throw new ModelProviderUnavailableError("ROLE_C_MODEL_SCHEMA_STRICT 必须为 true 或 false")
}

function schemaName(schemaId: string): string {
  const normalized = schemaId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64)
  return normalized || "role_c_output"
}

function isRetriable(error: unknown): boolean {
  return error instanceof ModelGatewayError &&
    ["RETRIABLE_HTTP_ERROR", "TIMEOUT", "NETWORK_ERROR"].includes(error.code)
}

function isAbortError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "name" in error && error.name === "AbortError")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined
}

function nestedNumber(
  record: Record<string, unknown> | undefined,
  parent: string,
  child: string,
): number | undefined {
  const nested = record?.[parent]
  return isRecord(nested) ? numberOrUndefined(nested[child]) : undefined
}

function providerErrorMessage(body: Record<string, unknown>): string {
  const error = isRecord(body.error) ? body.error : undefined
  const value = error?.message ?? body.message
  return typeof value === "string" ? value : ""
}

function delay(durationMs: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, durationMs))
}

function optionalPositiveInteger(value: string | undefined, fallback: number, label = "value"): number {
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 100 || parsed > 600_000) {
    throw new ModelProviderUnavailableError(`${label} 必须为 100..600000 的整数`)
  }
  return parsed
}

function optionalNonNegativeInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 5) {
    throw new ModelProviderUnavailableError("ROLE_C_MODEL_MAX_RETRIES 必须为 0..5 的整数")
  }
  return parsed
}

function optionalPositiveCount(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 1_000) {
    throw new ModelProviderUnavailableError("MODEL_RUNTIME_MAX_MODEL_CALLS 必须为 1..1000 的整数")
  }
  return parsed
}
