import { C_SCHEMA_VERSION, type ArtifactVersions, type SchemaVersion } from "./common"

export interface LearningEvidenceEvent {
  schema_version: SchemaVersion
  event_id: string
  learner_id_hash: string
  profile_version: string
  path_node_id: string
  objective_id: string
  source_id: string
  evidence: {
    modality: "mcq" | "true_false" | "trace" | "short_answer" | "code"
    raw_score: number
    evidence_score: number
    grader_confidence: number
    hint_level: number
    attempt_no: number
  }
  misconceptions: string[]
  recommendation: {
    action: "remediate" | "reinforce" | "advance" | "reprofile"
    confidence: number
    reason_codes: string[]
  }
  provenance: {
    artifact_id: string
    /** Cryptographic identity used by the durable mastery idempotency ledger. */
    idempotency_key: string
    item_id: string
    grader_version: string
  }
}

export interface ProfileDriftSuggestion {
  schema_version: SchemaVersion
  suggestion_id: string
  learner_id_hash: string
  profile_version: string
  conflicting_objective_ids: string[]
  reason_codes: string[]
  confidence: number
  action: "reprofile"
}

export interface AgentTraceEvent {
  schema_version: SchemaVersion
  seq: number
  event_type:
    | "c.spec.ready"
    | "c.agent.started"
    | "c.agent.ready"
    | "c.validation.failed"
    | "c.review.revision_requested"
    | "c.review.passed"
    | "c.pipeline.blocked"
    | "c.pipeline.failed"
    | "c.pipeline.ready"
  run_id: string
  agent?: "concept-tutor" | "code-lab" | "tiered-evaluator"
  status: "started" | "success" | "blocked" | "failed"
  input_refs: string[]
  output_ref?: string
  summary: string
  occurred_at?: string
  duration_ms?: number
  attempt?: number
  retry_kind?: "transport" | "format_repair" | "tool" | "semantic_revision" | "resume"
  validator_results?: Array<{ validator: string; ok: boolean; issue_count: number }>
  versions?: ArtifactVersions
}

export function newTraceEvent(input: Omit<AgentTraceEvent, "schema_version">): AgentTraceEvent {
  return { schema_version: C_SCHEMA_VERSION, ...input }
}
