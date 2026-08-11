import {
  C_SCHEMA_VERSION,
  stableId,
  type ArtifactEnvelope,
  type ArtifactQuality,
  type BlockedReason,
  type CitationRef,
  type RoleCArtifactType,
} from "../contracts/common"
import type { GenerationSpec } from "../contracts/generation-spec"
import type { RagEvidencePack } from "../contracts/evidence-pack"
import { validateCitations } from "../validators/citation-validator"
import { validatePublicArtifactNoSecrets } from "../validators/public-secure-leak-validator"
import {
  validateArtifactStatusSemantics,
  validateRoleCSchema,
  type RoleCSchemaFile,
} from "../validators/runtime-schema-validator"
import type { ArtifactDraft } from "./types"

type AgentForArtifact<TArtifactType extends RoleCArtifactType> =
  TArtifactType extends "concept_lesson"
    ? "concept-tutor"
    : TArtifactType extends "code_lab_public" | "code_lab_secure"
      ? "code-lab"
      : "tiered-evaluator"

const ARTIFACT_SCHEMAS: Record<RoleCArtifactType, RoleCSchemaFile> = {
  concept_lesson: "concept_artifact.schema.json",
  code_lab_public: "code_lab_public.schema.json",
  code_lab_secure: "code_lab_secure.schema.json",
  assessment_public: "assessment_public.schema.json",
  assessment_secure: "assessment_secure.schema.json",
  grade_result: "grade_result.schema.json",
}

/**
 * Finalizes a Provider Draft inside C's trust boundary. Provider metadata is never
 * accepted: citations, claim counts, coverage, schema status, and verification flags
 * are derived here or supplied by an independent verifier.
 */
export function finalizeDraft<
  TPayload,
  TArtifactType extends RoleCArtifactType,
>(input: {
  spec: GenerationSpec
  evidence: RagEvidencePack
  agent: AgentForArtifact<TArtifactType>
  artifact_type: TArtifactType
  draft: ArtifactDraft<TPayload>
  input_refs: string[]
  public_payload: boolean
  objective_ids: string[]
  trusted_citations?: CitationRef[]
  trusted_objective_coverage?: number
  execution_verified?: boolean
  answer_key_verified?: boolean
  runner_image_digest?: string
  mutation_kill_rate?: number
  verified_test_count?: number
  verified_item_count?: number
  verification_issues?: string[]
  /**
   * Trusted event identity for artifacts whose public wording may be regenerated
   * after a score is frozen. Other artifacts remain payload-addressed.
   */
  stable_identity?: unknown
}): ArtifactEnvelope<TPayload, TArtifactType, AgentForArtifact<TArtifactType>> {
  // Provider output is untrusted and may retain mutable references. Take one
  // private snapshot before validation and never publish the provider object.
  const payload = structuredClone(input.draft.payload)
  const derived = derivePayloadMetadata(payload)
  const citations = deduplicateCitations(input.trusted_citations ?? derived.citations)
  const citationReport = validateCitations(citations, input.evidence)
  if (!citationReport.ok) {
    return blockedEnvelope(input, {
      code: "BLOCKED_INVALID_CITATION",
      message: "产物包含本次 evidence_pack 中不存在的引用",
      details: citationReport.issues.map((issue) => issue.message),
    })
  }

  if (input.public_payload) {
    const leakReport = validatePublicArtifactNoSecrets(payload)
    if (!leakReport.ok) {
      return blockedEnvelope(input, {
        code: "BLOCKED_PUBLIC_SECURE_LEAK",
        message: "公开产物包含答案、隐藏测试或其他私有字段",
        details: leakReport.issues.map((issue) => `${issue.path}: ${issue.message}`),
      })
    }
  }

  if (input.execution_verified === false) {
    return blockedEnvelope(input, {
      code: "BLOCKED_EXECUTION_UNVERIFIED",
      message: "代码实验尚未由可信执行器验证，当前保持 blocked",
      details: input.verification_issues,
    })
  }

  if (input.answer_key_verified === false) {
    return blockedEnvelope(input, {
      code: "BLOCKED_ANSWER_KEY_UNVERIFIED",
      message: "测评答案规范尚未由独立验证器验证，当前保持 blocked",
      details: input.verification_issues,
    })
  }

  const quality = qualityFromPayload(input.spec, input.objective_ids, derived, {
    objective_coverage: input.trusted_objective_coverage,
    execution_verified: input.execution_verified,
    answer_key_verified: input.answer_key_verified,
    mutation_kill_rate: input.mutation_kill_rate,
    verified_test_count: input.verified_test_count,
    verified_item_count: input.verified_item_count,
  })
  const artifactId = stableId("ART", {
    spec_id: input.spec.spec_id,
    artifact_type: input.artifact_type,
    seed: input.spec.policies.seed,
    ...(input.stable_identity === undefined
      ? { payload }
      : { stable_identity: input.stable_identity }),
  })
  const artifact: ArtifactEnvelope<
    TPayload,
    TArtifactType,
    AgentForArtifact<TArtifactType>
  > = {
    schema_version: C_SCHEMA_VERSION,
    run_id: input.spec.run_id,
    artifact_id: artifactId,
    artifact_type: input.artifact_type,
    agent: input.agent,
    status: "ready",
    versions: input.runner_image_digest
      ? { ...input.spec.versions, runner_image_digest: input.runner_image_digest }
      : input.spec.versions,
    seed: input.spec.policies.seed,
    input_refs: [...input.input_refs],
    citations,
    quality,
    payload,
    trace_ref: stableId("TRACE", { artifact_id: artifactId }),
  }

  const schemaReport = validateRoleCSchema(ARTIFACT_SCHEMAS[input.artifact_type], artifact)
  const stateReport = validateArtifactStatusSemantics(artifact)
  if (!schemaReport.ok || !stateReport.ok) {
    return blockedEnvelope(input, {
      code: "BLOCKED_INVALID_OUTPUT",
      message: "产物未通过完整运行时 Schema 或状态语义校验",
      details: [...schemaReport.issues, ...stateReport.issues].map(
        (issue) => `${issue.path}: ${issue.message}`,
      ),
    })
  }
  return artifact
}

export function providerBlockedEnvelope<
  TPayload,
  TArtifactType extends RoleCArtifactType,
>(input: {
  spec: GenerationSpec
  evidence: RagEvidencePack
  agent: AgentForArtifact<TArtifactType>
  artifact_type: TArtifactType
  input_refs: string[]
  message: string
}): ArtifactEnvelope<TPayload, TArtifactType, AgentForArtifact<TArtifactType>> {
  return blockedEnvelope(
    {
      ...input,
      draft: { payload: null as TPayload },
      public_payload: true,
      objective_ids: [],
    },
    { code: "BLOCKED_PROVIDER_UNAVAILABLE", message: input.message },
  )
}

export function unsupportedTargetEnvelope<
  TPayload,
  TArtifactType extends RoleCArtifactType,
>(input: {
  spec: GenerationSpec
  evidence: RagEvidencePack
  agent: AgentForArtifact<TArtifactType>
  artifact_type: TArtifactType
  input_refs: string[]
  message: string
  target_source_ids: string[]
}): ArtifactEnvelope<TPayload, TArtifactType, AgentForArtifact<TArtifactType>> {
  return blockedEnvelope(
    {
      ...input,
      draft: { payload: null as TPayload },
      public_payload: true,
      objective_ids: [],
    },
    {
      code: "UNSUPPORTED_TARGET",
      message: input.message,
      details: [`target_source_ids=${input.target_source_ids.join(",")}`],
    },
  )
}

export function invalidOutputEnvelope<
  TPayload,
  TArtifactType extends RoleCArtifactType,
>(input: {
  spec: GenerationSpec
  evidence: RagEvidencePack
  agent: AgentForArtifact<TArtifactType>
  artifact_type: TArtifactType
  input_refs: string[]
  message: string
  details?: string[]
}): ArtifactEnvelope<TPayload, TArtifactType, AgentForArtifact<TArtifactType>> {
  return blockedEnvelope(
    {
      ...input,
      draft: { payload: null as TPayload },
      public_payload: true,
      objective_ids: [],
    },
    { code: "BLOCKED_INVALID_OUTPUT", message: input.message, details: input.details },
  )
}

function blockedEnvelope<
  TPayload,
  TArtifactType extends RoleCArtifactType,
>(
  input: {
    spec: GenerationSpec
    evidence: RagEvidencePack
    agent: AgentForArtifact<TArtifactType>
    artifact_type: TArtifactType
    draft: ArtifactDraft<TPayload>
    input_refs: string[]
    public_payload: boolean
    objective_ids: string[]
    execution_verified?: boolean
    answer_key_verified?: boolean
    runner_image_digest?: string
    mutation_kill_rate?: number
    verified_test_count?: number
    verified_item_count?: number
  },
  reason: BlockedReason,
): ArtifactEnvelope<TPayload, TArtifactType, AgentForArtifact<TArtifactType>> {
  const artifactId = stableId("ART", {
    spec_id: input.spec.spec_id,
    artifact_type: input.artifact_type,
    blocked: reason.code,
  })
  return {
    schema_version: C_SCHEMA_VERSION,
    run_id: input.spec.run_id,
    artifact_id: artifactId,
    artifact_type: input.artifact_type,
    agent: input.agent,
    status: "blocked",
    blocked_reason: reason,
    versions: input.spec.versions,
    seed: input.spec.policies.seed,
    input_refs: [...input.input_refs],
    citations: [],
    quality: {
      schema_ok: false,
      citation_coverage: 0,
      objective_coverage: 0,
      alignment_score: 0,
      execution_verified: input.execution_verified,
      answer_key_verified: input.answer_key_verified,
      mutation_kill_rate: input.mutation_kill_rate,
      verified_test_count: input.verified_test_count,
      verified_item_count: input.verified_item_count,
    },
    payload: null,
    trace_ref: stableId("TRACE", { artifact_id: artifactId }),
  }
}

interface DerivedPayloadMetadata {
  citations: CitationRef[]
  factual_claim_count: number
  cited_claim_count: number
}

function derivePayloadMetadata(payload: unknown): DerivedPayloadMetadata {
  const citations: CitationRef[] = []
  let factualClaimCount = 0
  let citedClaimCount = 0
  visit(payload)
  return {
    citations: deduplicateCitations(citations),
    factual_claim_count: factualClaimCount,
    cited_claim_count: citedClaimCount,
  }

  function visit(value: unknown): void {
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    if (!value || typeof value !== "object") return
    const record = value as Record<string, unknown>
    if (isCitation(record)) citations.push(record)
    if (typeof record.claim_id === "string" && typeof record.text === "string") {
      factualClaimCount += 1
      if (Array.isArray(record.citations) && record.citations.some(isCitation)) citedClaimCount += 1
    }
    Object.values(record).forEach(visit)
  }
}

function qualityFromPayload(
  spec: GenerationSpec,
  objectiveIds: string[],
  metadata: DerivedPayloadMetadata,
  verification: {
    objective_coverage?: number
    execution_verified?: boolean
    answer_key_verified?: boolean
    mutation_kill_rate?: number
    verified_test_count?: number
    verified_item_count?: number
  },
): ArtifactQuality {
  const requiredObjectives = new Set(spec.targets.map((target) => target.objective_id))
  const covered = new Set(objectiveIds.filter((objectiveId) => requiredObjectives.has(objectiveId)))
  const objectiveCoverage = verification.objective_coverage ??
    (requiredObjectives.size === 0 ? 1 : covered.size / requiredObjectives.size)
  const citationCoverage = metadata.factual_claim_count === 0
    ? 1
    : Math.min(1, metadata.cited_claim_count / metadata.factual_claim_count)
  return {
    schema_ok: true,
    citation_coverage: citationCoverage,
    objective_coverage: objectiveCoverage,
    alignment_score: objectiveCoverage,
    execution_verified: verification.execution_verified,
    answer_key_verified: verification.answer_key_verified,
    mutation_kill_rate: verification.mutation_kill_rate,
    verified_test_count: verification.verified_test_count,
    verified_item_count: verification.verified_item_count,
  }
}

function isCitation(value: unknown): value is CitationRef {
  if (!value || typeof value !== "object") return false
  const record = value as Record<string, unknown>
  return typeof record.source_id === "string" &&
    typeof record.fact_id === "string" &&
    ["supports", "derived_from", "prerequisite"].includes(String(record.relation))
}

function deduplicateCitations(citations: CitationRef[]): CitationRef[] {
  return [...new Map(citations.map((citation) => [
    `${citation.source_id}:${citation.fact_id}:${citation.relation}`,
    { ...citation },
  ])).values()]
}
