export type ModelPolicyProfile = "fast" | "quality" | "offline_max"
export type ModelPriority = "interactive" | "review" | "background" | "offline"
export type ModelConcurrencyGroup = "fast" | "quality" | "audit" | "offline"

export interface ModelCallPolicy {
  policy_version: string
  profile: ModelPolicyProfile
  reason_codes: string[]
  thinking: "enabled" | "disabled"
  reasoning_effort?: "high" | "max"
  max_tokens: number
  timeout_ms: number
  max_transport_retries: 0 | 1
  do_sample: boolean
  response_format: "json_schema" | "json_object" | "text_json"
  stream: boolean
  priority: ModelPriority
  concurrency_group: ModelConcurrencyGroup
}

export interface ModelCallTrace {
  trace_id: string
  job_id?: string
  session_id?: string
  run_id?: string
  task: string
  stage: string
  attempt: number
  model_id: string
  policy_profile: ModelPolicyProfile
  policy_version: string
  policy_reason_codes: string[]
  queued_ms: number
  total_ms: number
  prompt_tokens?: number
  cached_prompt_tokens?: number
  completion_tokens?: number
  reasoning_tokens?: number
  total_tokens?: number
  finish_reason?: string
  response_format: ModelCallPolicy["response_format"]
  json_parse_ok: boolean
  schema_ok?: boolean
  business_validation_ok?: boolean
  provider_error_code?: string
  provider_request_id?: string
  retry_kind?: "transport"
}

export type ModelTraceSink = (trace: ModelCallTrace) => void | Promise<void>
