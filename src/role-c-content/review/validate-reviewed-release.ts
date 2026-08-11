import type {
  AssessmentPublicArtifact,
  CodeLabPublicArtifact,
  ConceptLessonArtifact,
} from "../contracts/artifacts"
import { contentHash } from "../contracts/common"
import type { RagEvidencePack } from "../contracts/evidence-pack"
import type { CPipelineInput } from "../orchestrator/content-pipeline"
import { validatePublicArtifactNoSecrets } from "../validators/public-secure-leak-validator"
import { validateRoleCSchema } from "../validators/runtime-schema-validator"
import type {
  ContentReviewResult,
  ReviewedCPipelineResult,
  ReviewArtifactKind,
} from "./types"

export interface ReviewedReleaseValidationContext {
  pipeline_input?: CPipelineInput
  evidence_pack?: RagEvidencePack
  expected_spec_id?: string
  error_prefix?: string
  /** Internal persistence stores may skip duplicate artifact Schema validation. */
  validate_artifact_contracts?: boolean
}

export interface ReviewedPublicBundle {
  run_id: string
  artifacts: [
    ConceptLessonArtifact,
    CodeLabPublicArtifact,
    AssessmentPublicArtifact,
  ]
}

/**
 * One runtime gate shared by learning-cycle registration and D publication.
 * It binds the final A/B review to the exact public artifact contents.
 */
export function assertReviewedReadyPipeline(
  pipeline: ReviewedCPipelineResult,
  context: ReviewedReleaseValidationContext = {},
): ReviewedPublicBundle {
  const failure = (code: string): Error =>
    new Error(`${context.error_prefix ?? "ROLE_C_REVIEWED_RELEASE"}_${code}`)
  const runId = pipeline.generation_spec.run_id
  if (!validateRoleCSchema("generation_spec.schema.json", pipeline.generation_spec).ok
    || !/^sha256:[a-f0-9]{64}$/.test(pipeline.pipeline_input_hash)
    || pipeline.generation_spec_hash !== contentHash(pipeline.generation_spec)) {
    throw failure("PIPELINE_IDENTITY_INVALID")
  }
  if (context.evidence_pack
    && pipeline.generation_spec.evidence_content_hash !== contentHash(context.evidence_pack)) {
    throw failure("EVIDENCE_CONTENT_MISMATCH")
  }
  if (context.pipeline_input
    && (pipeline.pipeline_input_hash !== contentHash(context.pipeline_input)
      || pipeline.generation_spec_hash !== contentHash(context.pipeline_input.generation_spec))) {
    throw failure("PIPELINE_INPUT_MISMATCH")
  }
  if (pipeline.status !== "ready" || pipeline.state !== "READY") {
    throw failure("PIPELINE_NOT_READY")
  }
  if (pipeline.alignment_report?.ok !== true) {
    throw failure("ALIGNMENT_NOT_VERIFIED")
  }
  if (context.expected_spec_id !== undefined
    && pipeline.generation_spec.spec_id !== context.expected_spec_id) {
    throw failure("SPEC_MISMATCH")
  }
  if (pipeline.secure_refs.length !== 2 || new Set(pipeline.secure_refs).size !== 2) {
    throw failure("SECURE_REFS_INVALID")
  }

  const concept = pipeline.public_artifacts.concept_lesson
  const codeLab = pipeline.public_artifacts.code_lab
  const assessment = pipeline.public_artifacts.assessment
  if (!concept
    || concept.status !== "ready"
    || concept.payload === null
    || concept.run_id !== runId) {
    throw failure("PUBLIC_BUNDLE_NOT_READY")
  }
  if (!codeLab
    || codeLab.status !== "ready"
    || codeLab.payload === null
    || codeLab.run_id !== runId) {
    throw failure("PUBLIC_BUNDLE_NOT_READY")
  }
  if (!assessment
    || assessment.status !== "ready"
    || assessment.payload === null
    || assessment.run_id !== runId) {
    throw failure("PUBLIC_BUNDLE_NOT_READY")
  }
  const expectedArtifacts = new Map<ReviewArtifactKind, { id: string; hash: string }>([
    ["concept", { id: concept.artifact_id, hash: contentHash(concept) }],
    ["code_lab", { id: codeLab.artifact_id, hash: contentHash(codeLab) }],
    ["assessment", { id: assessment.artifact_id, hash: contentHash(assessment) }],
  ])
  if (context.validate_artifact_contracts !== false) {
    const artifactContracts = [
      [concept, "concept_lesson", "concept-tutor", "concept_artifact.schema.json"],
      [codeLab, "code_lab_public", "code-lab", "code_lab_public.schema.json"],
      [assessment, "assessment_public", "tiered-evaluator", "assessment_public.schema.json"],
    ] as const
    for (const [artifact, artifactType, agent, schema] of artifactContracts) {
      if (artifact.artifact_type !== artifactType
        || artifact.agent !== agent
        || artifact.quality.schema_ok !== true
        || artifact.seed !== pipeline.generation_spec.policies.seed
        || contentHash(artifact.versions) !== contentHash(pipeline.generation_spec.versions)
        || !artifact.input_refs.includes(pipeline.generation_spec.spec_id)
        || !validateRoleCSchema(schema, artifact).ok
        || !validatePublicArtifactNoSecrets(artifact).ok) {
        throw failure("PUBLIC_ARTIFACT_CONTRACT_INVALID")
      }
    }
    if (codeLab.quality.execution_verified !== true
      || assessment.quality.answer_key_verified !== true) {
      throw failure("TRUSTED_VERIFICATION_MISSING")
    }
  }

  const reports = pipeline.review_reports
  if (!pipeline.review_policy_version.trim()
    || !Array.isArray(reports)
    || reports.length < 1
    || reports.length > 3) {
    throw failure("REVIEW_MISSING")
  }
  assertReviewSequence(
    reports,
    runId,
    pipeline.review_policy_version,
    pipeline.generation_spec.evidence_content_hash,
    pipeline.pipeline_input_hash,
    pipeline.generation_spec_hash,
    failure,
  )

  const lastReview = reports.at(-1)!
  if (lastReview.decision !== "pass"
    || lastReview.revision_instructions.length !== 0) {
    throw failure("REVIEW_NOT_PASS")
  }

  if (lastReview.artifact_results.length !== expectedArtifacts.size) {
    throw failure("REVIEW_ARTIFACT_COUNT")
  }
  const seenKinds = new Set<ReviewArtifactKind>()
  for (const result of lastReview.artifact_results) {
    const expected = expectedArtifacts.get(result.artifact_kind)
    if (seenKinds.has(result.artifact_kind)
      || expected?.id !== result.artifact_id
      || expected.hash !== result.artifact_hash) {
      throw failure("REVIEW_ARTIFACT_MISMATCH")
    }
    seenKinds.add(result.artifact_kind)
    if (result.decision !== "pass"
      || result.fact_status !== "pass"
      || result.teaching_status !== "pass"
      || result.can_revise
      || result.findings.length !== 0
      || result.revision_instructions.length !== 0) {
      throw failure("REVIEW_ARTIFACT_NOT_PASS")
    }
  }

  // Trace is operational telemetry. Release only enforces its identity and
  // public-data boundary; ordering or event loss cannot invalidate ready content.
  for (const event of pipeline.trace_events) {
    if (event.run_id !== runId) throw failure("TRACE_RUN_MISMATCH")
    if (event.input_refs.some(isSecureReference)
      || (event.output_ref !== undefined && isSecureReference(event.output_ref))) {
      throw failure("TRACE_SECURE_REF_LEAK")
    }
  }

  return {
    run_id: runId,
    artifacts: [concept, codeLab, assessment],
  }
}

function isSecureReference(value: string): boolean {
  return value.toLowerCase().startsWith("secure://role-c/")
}

function assertReviewSequence(
  reports: ContentReviewResult[],
  runId: string,
  policyVersion: string,
  expectedEvidenceHash: string,
  pipelineInputHash: string,
  generationSpecHash: string,
  failure: (code: string) => Error,
): void {
  const maxRounds = reports[0]!.max_revision_rounds
  if (![0, 1, 2].includes(maxRounds)
    || reports.length > maxRounds + 1) {
    throw failure("REVIEW_ROUNDS_INVALID")
  }
  for (const [index, report] of reports.entries()) {
    if (report.run_id !== runId
      || report.pipeline_input_hash !== pipelineInputHash
      || report.generation_spec_hash !== generationSpecHash
      || report.policy_version !== policyVersion
      || report.revision_round !== index
      || report.max_revision_rounds !== maxRounds
      || report.evidence_hash !== expectedEvidenceHash
      || (index < reports.length - 1 && report.decision !== "revise")) {
      throw failure("REVIEW_CONTEXT_MISMATCH")
    }
  }
}
