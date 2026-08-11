import type {
  AssessmentPublicArtifact,
  CodeLabPublicArtifact,
  ConceptLessonArtifact,
} from "../contracts/artifacts"
import type { CitationRef, RoleCAgentName } from "../contracts/common"
import type { PublicRagEvidencePack } from "../contracts/evidence-pack"
import type { GenerationSpec } from "../contracts/generation-spec"
import type {
  CPipelineInput,
  CPipelineOptions,
  CPipelineResult,
} from "../orchestrator/content-pipeline"
import type { LearnerLevel } from "../contracts/common"

export type ReviewArtifactKind = "concept" | "code_lab" | "assessment"
export type ContentReviewDecision = "pass" | "revise" | "reject"
export type ReviewFixScope = "artifact" | "new_evidence" | "new_spec"
/** B's requested operation; fix_scope separately identifies C's mutation boundary. */
export type ContentRecoveryAction =
  | "adjust_content"
  | "request_new_evidence"
  | "replan_path"
  | "reprofile_learner"

export interface ReviewBlockLocator {
  field:
    | "claim"
    | "misconception"
    | "quiz"
    | "hint"
    | "public_test"
    | "starter_code"
    | "render_content"
    | "reflection"
    | "option"
    | "assessment_item"
  ref_id: string
  parent_block_id?: string
  objective_id?: string
}

export interface ReviewContentBlock {
  review_block_id: string
  text: string
  citations: CitationRef[]
  /**
   * Claims are checked for proposition-level grounding. Rendered teaching text
   * is evidence-anchored and must visibly contain every cited frozen fact;
   * questions, code and scaffolding remain citation-bound.
   */
  fact_audit_mode: "claim" | "evidence_anchored" | "citation_only"
  locator: ReviewBlockLocator
}

export type ReviewablePublicArtifact =
  | { kind: "concept"; artifact: ConceptLessonArtifact }
  | { kind: "code_lab"; artifact: CodeLabPublicArtifact }
  | { kind: "assessment"; artifact: AssessmentPublicArtifact }

/** Review transport view. Answer-bearing quiz seeds remain inside C's trust boundary. */
export type ReviewEvidencePack = PublicRagEvidencePack

export interface ContentReviewRequest {
  run_id: string
  pipeline_input_hash: string
  generation_spec_hash: string
  revision_round: number
  max_revision_rounds: 0 | 1 | 2
  evidence_hash: string
  generation_spec: GenerationSpec
  next_round_context?: CPipelineInput["next_round_context"]
  evidence_pack: ReviewEvidencePack
  artifacts: [
    ReviewablePublicArtifact & { kind: "concept"; artifact_hash: string },
    ReviewablePublicArtifact & { kind: "code_lab"; artifact_hash: string },
    ReviewablePublicArtifact & { kind: "assessment"; artifact_hash: string },
  ]
}

export interface ContentReviewFinding {
  source: "fact_audit" | "teaching_audit" | "review_adapter"
  code: string
  artifact_kind: ReviewArtifactKind
  artifact_id: string
  message: string
  proposed_action: string
  fix_scope: ReviewFixScope
  locator?: ReviewBlockLocator
  evidence_refs: string[]
}

export interface ContentRevisionInstruction extends ContentReviewFinding {
  instruction_id: string
  target_agent: RoleCAgentName
  target_artifact_id: string
  objective_id: string
}

export interface ArtifactReviewResult {
  artifact_kind: ReviewArtifactKind
  artifact_id: string
  artifact_hash: string
  fact_status: "pass" | "revise" | "reject"
  teaching_status: "pass" | "revise" | "reject"
  decision: ContentReviewDecision
  can_revise: boolean
  findings: ContentReviewFinding[]
  revision_instructions: ContentRevisionInstruction[]
}

export interface ContentReviewResult {
  run_id: string
  pipeline_input_hash: string
  generation_spec_hash: string
  policy_version: string
  revision_round: number
  max_revision_rounds: 0 | 1 | 2
  evidence_hash: string
  decision: ContentReviewDecision
  artifact_results: ArtifactReviewResult[]
  revision_instructions: ContentRevisionInstruction[]
  /**
   * Optional structured recovery fields returned by the B review adapter.
   * Older adapters remain valid; the recovery orchestrator derives the same
   * decision from revision_instructions when these fields are absent.
   */
  failed_dimensions?: string[]
  missing_prerequisite_source_ids?: string[]
  /** Knowledge references that B could not resolve in the active knowledge base. */
  unknown_prerequisite_refs?: string[]
  required_action?: ContentRecoveryAction
  fix_scope?: ReviewFixScope
  recommended_level?: LearnerLevel
  can_recover?: boolean
}

/** Transport-neutral boundary. A local adapter, HTTP service, or MCP service can implement it. */
export interface ContentReviewPort {
  readonly policy_version: string
  review(request: ContentReviewRequest): Promise<ContentReviewResult>
}

export type ReviewedBasePipelineOptions = Pick<
  CPipelineOptions,
  "critic" | "fact_audit_port" | "trace_seq_start"
>

export interface RunReviewedCPipelineOptions extends ReviewedBasePipelineOptions {
  review_port: ContentReviewPort
  max_external_revisions?: 0 | 1 | 2
}

export interface ReviewedCPipelineResult extends CPipelineResult {
  pipeline_input_hash: string
  generation_spec_hash: string
  review_policy_version: string
  review_reports: ContentReviewResult[]
}
