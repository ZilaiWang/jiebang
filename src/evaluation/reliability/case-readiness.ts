import type {
  ArtifactValidationResult,
  CaseReadinessResult,
  JudgeCompletenessResult,
  ReliabilityStatus,
} from "./types"

export function evaluateCaseReadiness(input: {
  result_status?: string
  artifacts?: unknown[]
  artifact_validations?: ArtifactValidationResult[]
  judge?: JudgeCompletenessResult
  docker_passed?: boolean
  coverage_rate?: number
  grounding_passed?: boolean
  operational_error?: boolean
  eligibility_error?: boolean
  has_errors?: boolean
  quality_error?: boolean
}): CaseReadinessResult {
  const reasons: string[] = []
  const artifacts = input.artifacts ?? []
  if (artifacts.length !== 3) reasons.push(`expected 3 public artifacts, got ${artifacts.length}`)
  if ((input.artifact_validations ?? []).some((result) => !result.hard_pass)) reasons.push("artifact contract hard gate failed")
  if (!input.judge?.complete) reasons.push("judge evidence incomplete")
  if (input.docker_passed !== true) reasons.push("Docker execution evidence incomplete")
  if (input.grounding_passed !== true) reasons.push("grounding evidence not passed")
  if ((input.coverage_rate ?? 0) < 0.9) reasons.push("core fact coverage below 90%")
  if (input.operational_error) reasons.push("operational failure present")
  if (input.eligibility_error) reasons.push("frozen evaluation identity is invalid")
  if (input.has_errors) reasons.push("case has unresolved issues")

  const metricEligible = Boolean(
    input.judge?.complete
    && artifacts.length === 3
    && !input.operational_error
    && !input.eligibility_error,
  )
  const publicationReady = Boolean(
    metricEligible
    && artifacts.length === 3
    && input.docker_passed === true
    && input.grounding_passed === true
    && (input.coverage_rate ?? 0) >= 0.9
    && !(input.artifact_validations ?? []).some((result) => !result.hard_pass)
    && input.has_errors !== true
    && (input.result_status === undefined || input.result_status === "ready"),
  )
  const operationalStatus: ReliabilityStatus = input.operational_error
    ? "retryable_error"
    : input.quality_error
      ? "quality_fail"
    : !metricEligible
      ? "incomplete"
      : publicationReady
        ? "pass"
        : "quality_fail"
  return {
    metric_eligible: metricEligible,
    publication_ready: publicationReady,
    operational_status: operationalStatus,
    reasons,
  }
}
