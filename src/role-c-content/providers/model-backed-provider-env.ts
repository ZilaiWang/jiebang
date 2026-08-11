import type { ModelBackedProviderOptions } from "./model-backed-provider"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

function resolveEnv(env: Record<string, string | undefined>): Record<string, string | undefined> {
  try {
    const envPath = resolve(process.cwd(), ".env.role-c.local")
    const content = readFileSync(envPath, "utf-8")
    const merged: Record<string, string> = {}
    for (const line of content.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) continue
      const eqIndex = trimmed.indexOf("=")
      if (eqIndex <= 0) continue
      merged[trimmed.slice(0, eqIndex).trim()] = trimmed.slice(eqIndex + 1).trim()
    }
    return { ...merged, ...env as Record<string, string> }
  } catch {
    return env
  }
}

/** One parser shared by the HTTP service and diagnostics so both use identical generation limits. */
export function modelBackedProviderOptionsFromEnv(
  env: Record<string, string | undefined>,
): ModelBackedProviderOptions {
  env = resolveEnv(env)
  return {
    generation_strategy: generationStrategy(env.ROLE_C_MODEL_GENERATION_STRATEGY),
    max_repair_attempts: repairAttempts(env.ROLE_C_MODEL_MAX_REPAIR_ATTEMPTS),
    concept_temperature: temperature(env.ROLE_C_MODEL_CONCEPT_TEMPERATURE, "ROLE_C_MODEL_CONCEPT_TEMPERATURE"),
    code_lab_temperature: temperature(env.ROLE_C_MODEL_CODE_LAB_TEMPERATURE, "ROLE_C_MODEL_CODE_LAB_TEMPERATURE"),
    assessment_temperature: temperature(env.ROLE_C_MODEL_ASSESSMENT_TEMPERATURE, "ROLE_C_MODEL_ASSESSMENT_TEMPERATURE"),
    concept_max_tokens: tokenBudget(env.ROLE_C_MODEL_CONCEPT_MAX_TOKENS, 8_000, "ROLE_C_MODEL_CONCEPT_MAX_TOKENS"),
    code_lab_max_tokens: tokenBudget(env.ROLE_C_MODEL_CODE_LAB_MAX_TOKENS, 7_000, "ROLE_C_MODEL_CODE_LAB_MAX_TOKENS"),
    assessment_max_tokens: tokenBudget(env.ROLE_C_MODEL_ASSESSMENT_MAX_TOKENS, 8_000, "ROLE_C_MODEL_ASSESSMENT_MAX_TOKENS"),
    concept_group_size: positiveInteger(env.ROLE_C_MODEL_CONCEPT_GROUP_SIZE, 1, "ROLE_C_MODEL_CONCEPT_GROUP_SIZE"),
    concept_concurrency: positiveInteger(env.ROLE_C_MODEL_CONCEPT_CONCURRENCY, 1, "ROLE_C_MODEL_CONCEPT_CONCURRENCY"),
    concept_segment_max_tokens: tokenBudget(env.ROLE_C_MODEL_CONCEPT_SEGMENT_MAX_TOKENS, 3_500, "ROLE_C_MODEL_CONCEPT_SEGMENT_MAX_TOKENS"),
    code_lab_public_max_tokens: tokenBudget(env.ROLE_C_MODEL_CODE_LAB_PUBLIC_MAX_TOKENS, 3_500, "ROLE_C_MODEL_CODE_LAB_PUBLIC_MAX_TOKENS"),
    code_lab_secure_max_tokens: tokenBudget(env.ROLE_C_MODEL_CODE_LAB_SECURE_MAX_TOKENS, 5_000, "ROLE_C_MODEL_CODE_LAB_SECURE_MAX_TOKENS"),
    assessment_public_max_tokens: tokenBudget(env.ROLE_C_MODEL_ASSESSMENT_PUBLIC_MAX_TOKENS, 4_500, "ROLE_C_MODEL_ASSESSMENT_PUBLIC_MAX_TOKENS"),
    assessment_secure_max_tokens: tokenBudget(env.ROLE_C_MODEL_ASSESSMENT_SECURE_MAX_TOKENS, 5_500, "ROLE_C_MODEL_ASSESSMENT_SECURE_MAX_TOKENS"),
  }
}

function generationStrategy(value: string | undefined): "staged" | "monolithic" {
  if (!value || value === "staged") return "staged"
  if (value === "monolithic") return value
  throw new Error("ROLE_C_MODEL_GENERATION_STRATEGY 只允许 staged 或 monolithic")
}

function repairAttempts(value: string | undefined): 0 | 1 | 2 {
  if (value === undefined || value === "") return 1
  if (value === "2") return 2
  if (value === "1") return 1
  if (value === "0") return 0
  throw new Error("ROLE_C_MODEL_MAX_REPAIR_ATTEMPTS 只允许 0、1 或 2")
}

function temperature(value: string | undefined, name: string): number {
  if (value === undefined || value === "") return 0
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 2) {
    throw new Error(`${name} 必须为 0..2 的数字`)
  }
  return parsed
}

function tokenBudget(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === "") return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 500 || parsed > 100_000) {
    throw new Error(`${name} 必须为 500..100000 的整数`)
  }
  return parsed
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === "") return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 30) {
    throw new Error(`${name} 必须为 1..30 的整数`)
  }
  return parsed
}
