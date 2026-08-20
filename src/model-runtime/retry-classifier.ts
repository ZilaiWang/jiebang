export interface ProviderFailureClassification {
  provider_code?: string
  retriable: boolean
  category: "auth" | "quota" | "configuration" | "rate_limit" | "overloaded" | "server" | "unknown"
}
const RETRIABLE_CODES = new Set(["1200", "1230", "1234", "1302", "1305"])
const AUTH_CODES = new Set(["1000", "1001", "1002", "1003", "1004", "1100", "1101", "1311"])
const QUOTA_CODES = new Set(["1113", "1308", "1310"])
const CONFIG_CODES = new Set(["1210", "1211", "1212", "1213", "1214", "1215", "1261"])

export function classifyProviderFailure(
  httpStatus: number,
  body: unknown,
): ProviderFailureClassification {
  const providerCode = extractProviderCode(body)
  if (providerCode && AUTH_CODES.has(providerCode)) return { provider_code: providerCode, retriable: false, category: "auth" }
  if (providerCode && QUOTA_CODES.has(providerCode)) return { provider_code: providerCode, retriable: false, category: "quota" }
  if (providerCode && CONFIG_CODES.has(providerCode)) return { provider_code: providerCode, retriable: false, category: "configuration" }
  if (providerCode === "1302") return { provider_code: providerCode, retriable: true, category: "rate_limit" }
  if (providerCode === "1305") return { provider_code: providerCode, retriable: true, category: "overloaded" }
  if (providerCode && RETRIABLE_CODES.has(providerCode)) return { provider_code: providerCode, retriable: true, category: "server" }
  if (httpStatus === 401 || httpStatus === 403) return { provider_code: providerCode, retriable: false, category: "auth" }
  if (httpStatus === 429) return { provider_code: providerCode, retriable: providerCode === undefined, category: "rate_limit" }
  if (httpStatus >= 500) return { provider_code: providerCode, retriable: true, category: "server" }
  return { provider_code: providerCode, retriable: false, category: "unknown" }
}

export function retryDelayMs(attempt: number, retryAfterHeader?: string | null): number {
  const retryAfter = retryAfterHeader ? Number(retryAfterHeader) : Number.NaN
  if (Number.isFinite(retryAfter) && retryAfter >= 0) return Math.min(30_000, retryAfter * 1000)
  const floor = attempt === 0 ? 500 : 1_500
  const ceiling = attempt === 0 ? 1_000 : 3_000
  return Math.round(floor + Math.random() * (ceiling - floor))
}

function extractProviderCode(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined
  const record = body as Record<string, unknown>
  const error = record.error && typeof record.error === "object"
    ? record.error as Record<string, unknown>
    : undefined
  const value = error?.code ?? record.code
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined
}
