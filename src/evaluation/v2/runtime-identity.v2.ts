import { modelBackedProviderOptionsFromEnv } from "../../role-c-content/providers/model-backed-provider-env"

/**
 * Safe, canonical runtime identity for a competition run. Secrets and host-only
 * Docker connection details are intentionally excluded; every value that can
 * change generated content, recovery breadth or sandbox outcomes is included.
 */
export function competitionRuntimeIdentityV2(
  env: Record<string, string | undefined>,
) {
  return {
    provider_options: modelBackedProviderOptionsFromEnv(env),
    execution_budget_overrides: {
      soft_deadline_ms: optionalInteger(env.MODEL_RUNTIME_JOB_SOFT_DEADLINE_MS, 1),
      hard_deadline_ms: optionalInteger(env.MODEL_RUNTIME_JOB_HARD_DEADLINE_MS, 1),
      max_model_calls: optionalInteger(env.MODEL_RUNTIME_MAX_MODEL_CALLS, 1),
      max_transport_retries_total: optionalInteger(env.MODEL_RUNTIME_TRANSPORT_RETRY_BUDGET, 0),
    },
    docker_policy: {
      cpu_limit: optionalNumber(env.ROLE_C_DOCKER_CPUS, 0.5),
      pids_limit: optionalInteger(env.ROLE_C_DOCKER_PIDS, 8) ?? 32,
      tmpfs_mb: optionalInteger(env.ROLE_C_DOCKER_TMPFS_MB, 4) ?? 16,
    },
  }
}

function optionalInteger(value: string | undefined, minimum: number): number | null {
  if (value === undefined || value.trim() === "") return null
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new Error("COMPETITION_RUNTIME_INTEGER_INVALID")
  }
  return parsed
}

function optionalNumber(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("COMPETITION_RUNTIME_NUMBER_INVALID")
  }
  return parsed
}
