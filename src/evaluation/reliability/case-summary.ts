import type { ClaimAuditRecord, DifficultyAuditRecord } from "../competition-metrics"
import type { ArtifactTaskContractsV2 } from "../../role-c-content/contracts/artifact-task"
import type { RoleCReviewedReleaseDelivery } from "../../role-c-content/contracts/external-api"
import type { RoleCGenerationFailure, RoleDWorkflowEvent } from "../../role-d-integration/contracts"
import { extractCompetitionClaimCandidates } from "../competition-claim-auditor"
import { validateArtifactContract } from "./artifact-contract-validator"
import { evaluateJudgeCompleteness } from "./judge-completeness"
import { evaluateCaseReadiness } from "./case-readiness"
import { classifyEvaluationFailure, classifyManyErrors } from "./failure-taxonomy"
import type { ReliabilityCaseSummary, StageEvidence } from "./types"

export interface ReliabilityRecordInput {
  case_id: string
  status: string
  errors: string[]
  claims: ClaimAuditRecord[]
  difficulty: DifficultyAuditRecord[]
  code_execution: "passed" | "not_reached"
  public_release?: RoleCReviewedReleaseDelivery
  generation_failure?: RoleCGenerationFailure
  workflow?: RoleDWorkflowEvent[]
}

export function summarizeCaseReliability(input: {
  record: ReliabilityRecordInput
  artifact_tasks: ArtifactTaskContractsV2
  required_facts: Array<{ source_id: string; fact_id: string }>
  required_objective_ids?: string[]
}): ReliabilityCaseSummary {
  const { record } = input
  const failures = classifyManyErrors(record.errors)
  const artifactByKind = new Map((record.public_release?.artifacts ?? []).map((artifact) => [
    artifact.artifact_type === "concept_lesson" ? "lesson"
      : artifact.artifact_type === "code_lab_public" ? "lab" : "assessment",
    artifact,
  ] as const))
  const artifactValidations = [
    validateArtifactContract({ artifact_kind: "lesson", contract: input.artifact_tasks.concept_lesson, artifact: artifactByKind.get("lesson") }),
    validateArtifactContract({ artifact_kind: "lab", contract: input.artifact_tasks.code_lab, artifact: artifactByKind.get("lab") }),
    validateArtifactContract({ artifact_kind: "assessment", contract: input.artifact_tasks.assessment, artifact: artifactByKind.get("assessment"), required_objective_ids: input.required_objective_ids }),
  ]
  const expectedClaims = record.public_release ? extractCompetitionClaimCandidates(record.public_release) : []
  // A published artifact may fail the independent review without a runtime
  // exception. Keep those findings visible in the same failure ledger.
  for (const validation of artifactValidations) {
    if (!artifactByKind.has(validation.artifact_kind)) continue
    for (const issue of validation.issues.filter((issue) => issue.severity === "hard")) {
      failures.push(classifyEvaluationFailure({ code: "artifact_contract", stage: "artifact_contract",
        issue_codes: [issue.code], message: `${validation.artifact_kind}: ${issue.message}` }))
    }
  }
  for (const claim of record.claims.filter((claim) => claim.audited && claim.factual && claim.verdict !== "supported")) {
    failures.push(classifyEvaluationFailure({ code: "grounding", stage: "grounding_audit",
      issue_codes: [claim.verdict], message: `${claim.claim_id}: ${claim.reason ?? claim.verdict}` }))
  }
  const judge = evaluateJudgeCompleteness({
    claim_audits: record.claims,
    difficulty_audits: record.difficulty,
    expected_claims: Math.max(1, expectedClaims.length),
    expected_claim_ids: expectedClaims.map((claim) => claim.claim_id),
    expected_difficulty_resources: 3,
  })
  const supportedFacts = new Set(record.claims
    .filter((claim) => claim.audited && claim.verdict === "supported")
    .flatMap((claim) => claim.supported_fact_ids))
  const missing = input.required_facts.filter((fact) =>
    !supportedFacts.has(`${fact.source_id}:${fact.fact_id}`))
  const expected = input.required_facts.length
  const factCoverage = {
    expected_fact_units: expected,
    covered_fact_units: expected - missing.length,
    coverage_rate: expected === 0 ? 0 : (expected - missing.length) / expected,
    missing,
  }
  const operationalCategories = new Set(["infrastructure", "model_transport", "publication", "persistence"])
  const operationalError = failures.some((failure) => operationalCategories.has(failure.category))
  const eligibilityError = failures.some((failure) => failure.category === "input_contract")
  const qualityError = failures.some((failure) => failure.status === "quality_fail")
  const groundingPassed = judge.claim_audit_complete
    && record.claims.filter((claim) => claim.factual).every((claim) => claim.verdict === "supported")
  const readiness = evaluateCaseReadiness({
    result_status: record.status,
    artifacts: [...artifactByKind.values()],
    artifact_validations: artifactValidations,
    judge,
    docker_passed: record.code_execution === "passed",
    coverage_rate: factCoverage.coverage_rate,
    grounding_passed: groundingPassed,
    operational_error: operationalError,
    eligibility_error: eligibilityError,
    has_errors: record.errors.length > 0,
    quality_error: qualityError,
  })
  const generated = artifactByKind.size === 3
  const generationStages: StageEvidence[] = ([
    ["concept", "concept-tutor", "lesson"], ["code_lab", "code-lab", "lab"], ["assessment", "tiered-evaluator", "assessment"],
  ] as const).map(([name, agent, kind]) => {
    const events = record.workflow?.filter((event) => event.agent === agent && event.status !== "pending") ?? []
    const last = events.at(-1)
    return { stage: `generation:${name}`, reached: events.length > 0 || artifactByKind.has(kind)
      || record.generation_failure?.stage === name,
    passed: artifactByKind.has(kind) || last?.status === "completed",
    reason: record.generation_failure?.stage === name ? record.generation_failure.code : undefined }
  })
  const stages: StageEvidence[] = [
    { stage: "input_contract", reached: true, passed: !failures.some((failure) => failure.category === "input_contract") },
    { stage: "knowledge_profile_path", reached: true, passed: !failures.some((failure) => failure.category === "input_contract") },
    ...generationStages,
    { stage: "artifact_generation", reached: generationStages.some((stage) => stage.reached) || record.errors.length > 0, passed: generated || generationStages.every((stage) => stage.passed) },
    { stage: "artifact_contract", reached: generated, passed: generated && artifactValidations.every((result) => result.hard_pass) },
    { stage: "grounding_audit", reached: record.claims.length > 0, passed: groundingPassed, reason: judge.claim_audit_complete ? undefined : "claim audit incomplete" },
    { stage: "difficulty_audit", reached: record.difficulty.some((entry) => entry.audited), passed: judge.difficulty_audit_complete, reason: judge.difficulty_audit_complete ? undefined : "difficulty audit incomplete" },
    { stage: "docker_execution", reached: generated, passed: record.code_execution === "passed" },
    { stage: "metric_eligibility", reached: true, passed: readiness.metric_eligible },
    { stage: "publication", reached: true, passed: readiness.publication_ready },
  ]
  return {
    version: "evaluation-reliability.v3",
    failures,
    funnel: {
      case_id: record.case_id,
      stages,
      earliest_failure_stage: record.generation_failure?.stage && record.generation_failure.stage !== "unknown"
        ? `generation:${record.generation_failure.stage}` : stages.find((stage) => stage.reached && !stage.passed)?.stage,
      metric_eligible: readiness.metric_eligible,
      publication_ready: readiness.publication_ready,
    },
    artifact_validations: artifactValidations,
    judge,
    fact_coverage: factCoverage,
    metric_eligible: readiness.metric_eligible,
    publication_ready: readiness.publication_ready,
    operational_status: readiness.operational_status,
    reasons: readiness.reasons,
  }
}

export function isRetryableOperationalRecord(record: ReliabilityRecordInput): boolean {
  const categories = new Set(["infrastructure", "model_transport", "publication", "persistence"])
  return record.errors.length > 0
    && classifyManyErrors(record.errors).every((failure) => categories.has(failure.category))
}
