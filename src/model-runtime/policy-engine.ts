import type { ModelCallPolicy, ModelPolicyProfile } from "./types"

export const GLM52_MODEL_POLICY_VERSION = "glm52-policy-v1"

export interface ModelPolicyOverrides {
  reason_codes?: string[]
  max_tokens?: number
  timeout_ms?: number
  max_transport_retries?: 0 | 1
  do_sample?: boolean
  response_format?: ModelCallPolicy["response_format"]
  priority?: ModelCallPolicy["priority"]
  concurrency_group?: ModelCallPolicy["concurrency_group"]
}
/**
 * The project deliberately exposes three semantic profiles rather than mirroring
 * every provider spelling. FAST is the production default for bounded JSON.
 */
export function modelCallPolicy(
  profile: ModelPolicyProfile,
  overrides: ModelPolicyOverrides = {},
): ModelCallPolicy {
  const base: ModelCallPolicy = profile === "fast"
    ? {
        policy_version: GLM52_MODEL_POLICY_VERSION,
        profile,
        reason_codes: ["BOUNDED_STRUCTURED_GENERATION"],
        thinking: "disabled",
        max_tokens: 16_000,
        timeout_ms: 120_000,
        max_transport_retries: 1,
        do_sample: false,
        response_format: "json_object",
        stream: false,
        priority: "interactive",
        concurrency_group: "fast",
      }
    : profile === "quality"
      ? {
          policy_version: GLM52_MODEL_POLICY_VERSION,
          profile,
          reason_codes: ["COMPLEX_SEMANTIC_PLANNING"],
          thinking: "enabled",
          reasoning_effort: "high",
          max_tokens: 16_000,
          timeout_ms: 180_000,
          max_transport_retries: 1,
          do_sample: false,
          response_format: "json_object",
          stream: false,
          priority: "background",
          concurrency_group: "quality",
        }
      : {
          policy_version: GLM52_MODEL_POLICY_VERSION,
          profile,
          reason_codes: ["OFFLINE_DEEP_EVALUATION"],
          thinking: "enabled",
          reasoning_effort: "max",
          max_tokens: 64_000,
          timeout_ms: 300_000,
          max_transport_retries: 1,
          do_sample: false,
          response_format: "json_object",
          stream: false,
          priority: "offline",
          concurrency_group: "offline",
        }
  return Object.freeze({
    ...base,
    ...overrides,
    reason_codes: [...(overrides.reason_codes ?? base.reason_codes)],
  })
}

export function fastModelPolicy(
  reasonCode: string,
  maxTokens: number,
  overrides: Omit<ModelPolicyOverrides, "reason_codes" | "max_tokens"> = {},
): ModelCallPolicy {
  return modelCallPolicy("fast", {
    ...overrides,
    reason_codes: [reasonCode],
    max_tokens: maxTokens,
  })
}
