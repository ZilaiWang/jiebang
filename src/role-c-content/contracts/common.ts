import type { KnowledgeDifficulty } from "../../knowledge/types"
import { createHash } from "node:crypto"
import { C_SCHEMA_VERSION, stableStringify } from "./canonical"

export { C_SCHEMA_VERSION, stableId } from "./canonical"

export type SchemaVersion = typeof C_SCHEMA_VERSION
export type LearnerLevel = KnowledgeDifficulty
export type ArtifactStatus = "ready" | "blocked" | "failed"
export type CitationRelation = "supports" | "derived_from" | "prerequisite"
export type RoleCAgentName = "concept-tutor" | "code-lab" | "tiered-evaluator"
export type RoleCArtifactType =
  | "concept_lesson"
  | "code_lab_public"
  | "code_lab_secure"
  | "assessment_public"
  | "assessment_secure"
  | "grade_result"

export interface EvidenceRef {
  source_id: string
  fact_id: string
}

export interface CitationRef extends EvidenceRef {
  relation: CitationRelation
}

export interface ArtifactVersions {
  profile_version: string
  kb_version: string
  rag_version: string
  prompt_version: string
  model_config_hash: string
  schema_version: SchemaVersion
  runner_image_digest?: string
}

export interface ArtifactQuality {
  schema_ok: boolean
  citation_coverage: number
  objective_coverage: number
  alignment_score: number
  execution_verified?: boolean
  answer_key_verified?: boolean
  mutation_kill_rate?: number
  verified_test_count?: number
  verified_item_count?: number
}

export interface ArtifactEnvelope<
  TPayload,
  TArtifactType extends RoleCArtifactType = RoleCArtifactType,
  TAgent extends RoleCAgentName = RoleCAgentName,
> {
  schema_version: SchemaVersion
  run_id: string
  artifact_id: string
  artifact_type: TArtifactType
  agent: TAgent
  status: ArtifactStatus
  blocked_reason?: BlockedReason
  failure_reason?: FailureReason
  versions: ArtifactVersions
  seed: number
  input_refs: string[]
  citations: CitationRef[]
  quality: ArtifactQuality
  payload: TPayload | null
  trace_ref: string
}

export interface BlockedReason {
  code:
    | "BLOCKED_MISSING_EVIDENCE"
    | "BLOCKED_WEAK_EVIDENCE"
    | "BLOCKED_EVIDENCE_CONFLICT"
    | "BLOCKED_INVALID_CITATION"
    | "BLOCKED_PUBLIC_SECURE_LEAK"
    | "BLOCKED_ALIGNMENT_FAILURE"
    | "BLOCKED_CONTENT_REVIEW"
    | "BLOCKED_EXECUTION_UNVERIFIED"
    | "BLOCKED_ANSWER_KEY_UNVERIFIED"
    | "BLOCKED_PROVIDER_UNAVAILABLE"
    | "UNSUPPORTED_TARGET"
    | "BLOCKED_INVALID_OUTPUT"
  message: string
  details?: string[]
}

export interface FailureReason {
  code: "PROVIDER_ERROR" | "SECURE_STORE_ERROR"
  message: string
}

/** Cryptographic canonical content hash for cache, integrity, and idempotency decisions. */
export function contentHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableStringify(value)).digest("hex")}`
}
