import { contentHash } from "./common"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

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

/** Vendor-neutral boundary. Prompt/model work can replace this without changing C contracts. */
export interface ModelGateway {
  readonly model_id: string
  readonly model_config_hash: string
  generateStructured<T>(request: {
    task: string
    system_prompt: string
    input: unknown
    output_schema_id: string
    output_schema: Record<string, unknown>
    temperature: number
    max_tokens: number
    idempotency_key: string
  }): Promise<T>
}

export interface ModelUsageEvent {
  task: string
  model_id: string
  idempotency_key: string
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
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
    const timeoutMs = options.timeout_ms ?? 30_000
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
      auth_header: this.options.auth_header.toLowerCase(),
      auth_scheme: this.options.auth_scheme,
      protocol: "openai-compatible-chat-json-schema-v1",
    }).slice("sha256:".length)}`
  }

  async generateStructured<T>(request: {
    task: string
    system_prompt: string
    input: unknown
    output_schema_id: string
    output_schema: Record<string, unknown>
    temperature: number
    max_tokens: number
    idempotency_key: string
  }): Promise<T> {
    let lastError: unknown
    for (let attempt = 0; attempt <= this.options.max_transport_retries; attempt += 1) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), this.options.timeout_ms)
      try {
        const response = await (this.options.fetch_impl ?? fetch)(this.options.endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(this.options.api_key ? {
              [this.options.auth_header]: this.options.auth_scheme
                ? `${this.options.auth_scheme} ${this.options.api_key}`
                : this.options.api_key,
            } : {}),
            "idempotency-key": request.idempotency_key,
          },
          body: JSON.stringify({
            model: this.options.model,
            messages: [
              { role: "system", content: systemPromptWithSchema(this.options, request) },
              { role: "user", content: JSON.stringify(request.input) },
            ],
            temperature: request.temperature,
            max_tokens: request.max_tokens,
            ...(this.options.thinking ? { thinking: { type: this.options.thinking } } : {}),
            ...responseFormatBody(this.options, request),
          }),
          signal: controller.signal,
        })
        if (!response.ok) {
          let detail = ""
          try { const errBody = await response.json() as any; detail = errBody?.error?.message || errBody?.message || "" } catch { /* ignore */ }
          const isAuth = response.status === 401 || response.status === 403
          const error = new ModelGatewayError(
            response.status === 429 || response.status >= 500 ? "RETRIABLE_HTTP_ERROR" : isAuth ? "AUTH_ERROR" : "HTTP_ERROR",
            isAuth ? `API Key 认证失败（HTTP ${response.status}）${detail ? "：" + detail : "——请检查 API Key 是否正确、未过期"}` : `模型服务返回 HTTP ${response.status}${detail ? "：" + detail : ""}`,
          )
          if (error.code === "RETRIABLE_HTTP_ERROR" && attempt < this.options.max_transport_retries) {
            lastError = error
            continue
          }
          throw error
        }
        let body: Record<string, unknown>
        try {
          body = await response.json() as Record<string, unknown>
        } catch {
          throw new ModelGatewayError("INVALID_RESPONSE", "模型服务响应体不是合法 JSON")
        }
        const output = extractChatCompletionContent(body)
        const finishReason = extractFinishReason(body)
        const usage = isRecord(body.usage) ? body.usage : undefined
        try {
          this.options.on_usage?.({
            task: request.task,
            model_id: this.model_id,
            idempotency_key: request.idempotency_key,
            prompt_tokens: numberOrUndefined(usage?.prompt_tokens),
            completion_tokens: numberOrUndefined(usage?.completion_tokens),
            total_tokens: numberOrUndefined(usage?.total_tokens),
          })
        } catch { /* telemetry must not repeat or fail a successful model call */ }
        if (finishReason === "length") {
          throw new ModelGatewayError("OUTPUT_TRUNCATED", "模型输出达到 token 上限，结构化 JSON 被截断")
        }
        return (typeof output === "string" ? parseJson(output) : output) as T
      } catch (error) {
        const normalized = isAbortError(error)
          ? new ModelGatewayError("TIMEOUT", `模型请求超过 ${this.options.timeout_ms}ms`)
          : error instanceof ModelGatewayError
            ? error
            : error instanceof Error
            ? new ModelGatewayError("NETWORK_ERROR", `模型服务网络请求失败：${error.name}: ${error.message}`)
            : new ModelGatewayError("NETWORK_ERROR", "模型服务网络请求失败")
        if (attempt < this.options.max_transport_retries && isRetriable(normalized)) {
          lastError = normalized
          continue
        }
        throw normalized
      } finally {
        clearTimeout(timeout)
      }
    }
    throw lastError ?? new ModelGatewayError("INVALID_RESPONSE", "模型请求未返回结果")
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
      | "INVALID_JSON",
    message: string,
  ) {
    super(message)
    this.name = "ModelGatewayError"
  }
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
    super(`${stage} 未通过分阶段输出校验`)
    this.name = "ModelOutputValidationError"
  }
}

export function createRoleCModelGatewayFromEnv(
  env: Record<string, string | undefined> = process.env,
  overrides: Pick<OpenAICompatibleGatewayOptions, "fetch_impl" | "on_usage"> = {},
): OpenAICompatibleModelGateway {
  const resolvedEnv = ensureModelEnv(env)
  const endpoint = resolvedEnv.ROLE_C_MODEL_ENDPOINT
  const model = resolvedEnv.ROLE_C_MODEL_ID
  if (!endpoint || !model) {
    throw new ModelProviderUnavailableError(
      "模型配置缺失：需要 ROLE_C_MODEL_ENDPOINT 和 ROLE_C_MODEL_ID。请复制 .env.role-c.example 为 .env.role-c.local 并填入模型参数。",
    )
  }
  return new OpenAICompatibleModelGateway({
    endpoint,
    model,
    api_key: resolvedEnv.ROLE_C_MODEL_API_KEY,
    response_format: responseFormatFromEnv(resolvedEnv.ROLE_C_MODEL_RESPONSE_FORMAT),
    schema_strict: optionalBoolean(resolvedEnv.ROLE_C_MODEL_SCHEMA_STRICT, true),
    thinking: thinkingFromEnv(resolvedEnv.ROLE_C_MODEL_THINKING),
    auth_header: resolvedEnv.ROLE_C_MODEL_AUTH_HEADER || "authorization",
    auth_scheme: resolvedEnv.ROLE_C_MODEL_AUTH_SCHEME ?? "Bearer",
    timeout_ms: optionalPositiveInteger(resolvedEnv.ROLE_C_MODEL_TIMEOUT_MS, 30_000),
    max_transport_retries: optionalNonNegativeInteger(resolvedEnv.ROLE_C_MODEL_MAX_RETRIES, 2),
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
      return JSON.parse(normalizePythonLiterals(extracted))
    }
    try {
      const normalized = normalizePythonLiterals(candidate)
      const normalizedFenced = normalized.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
      return JSON.parse(normalizedFenced ? normalizedFenced[1] : normalized.trim())
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
  if (value === undefined || value === "") return undefined
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

function optionalPositiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 100 || parsed > 600_000) {
    throw new ModelProviderUnavailableError("ROLE_C_MODEL_TIMEOUT_MS 必须为 100..600000 的整数")
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
