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

/**
 * 审核表面类型（改进方案4 第八节 Typed Semantic Audit）。
 * 不同表面使用不同审核方法：exact_claim 走确定性事实审核；narrative_explanation
 * 只审扣除锚定事实后的新命题；normative_task 只查是否要求 evidence 外的能力；
 * choice_assessment 走选项可证性（exactly-one-entailed）。
 */
export type ReviewSurfaceKind =
  | "exact_claim"
  | "narrative_explanation"
  | "direct_instance"
  | "normative_task"
  | "choice_assessment"
  | "open_assessment"
  | "code_contract"
  | "starter_skeleton"
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
  /** 审核表面类型（Typed Semantic Audit）。缺省由 fact_audit_mode + locator 推断。 */
  surface_kind?: ReviewSurfaceKind
}

export type SemanticReviewVerdict =
  | "supported"
  | "non_factual"
  | "unsupported"
  | "uncertain"

export interface SemanticReviewBlockResult {
  review_block_id: string
  verdict: SemanticReviewVerdict
  reason: string
  unsupported_text: string[]
  /**
   * 语义不支持的原因分类（改进方案4 第九节）。用于把 semantic finding 正确路由到
   * owner/scope，而不是一律归为 C 的 artifact 修订：
   *  - optional_overreach：多写了一个无依据用途/额外 API → C 局部改写
   *  - essential_fact_missing：正确作答需要证据缺失的规则 → A 补证据
   *  - objective_evidence_mismatch：冻结 objective 要求的行为证据只能支撑更低级行为 → A/B
   */
  support_gap?: "none" | "optional_overreach" | "essential_fact_missing" | "objective_evidence_mismatch"
  /** 模型建议的修复范围。仅作建议，最终 scope 由确定性 resolver 裁决。 */
  suggested_scope?: "artifact" | "new_evidence" | "new_spec"
}

/**
 * Reviews the meaning of one complete public artifact against only the facts
 * referenced by each block. Implementations must return one result per block.
 */
export interface ContentSemanticAuditPort {
  readonly policy_version: string
  auditArtifact(input: {
    run_id: string
    artifact_kind: ReviewArtifactKind
    artifact_id: string
    evidence_hash: string
    blocks: Array<ReviewContentBlock & {
      cited_facts: Array<{
        source_id: string
        fact_id: string
        content: string
      }>
    }>
  }): Promise<SemanticReviewBlockResult[]>
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
  /** 审核方的原始裁决强度；与 C 内部 publication-blocking severity 分开。 */
  source_decision?: "revise" | "reject"
}

export interface ContentRevisionInstruction extends ContentReviewFinding {
  instruction_id: string
  target_agent: RoleCAgentName
  target_artifact_id: string
  objective_id: string
}

/**
 * 外审修订控制数据（修订身份）。放在 CPipelineOptions 的内部执行上下文，
 * 不进入公开 GenerationSpec：它必须改变"某一阶段产物是否可恢复"的判断，
 * 但不改变教学合同身份。
 *
 * 核心作用：外审修订轮（revision_round > 0）通过 instruction_hash +
 * instructions_by_agent 参与 stage fingerprint，保证"审核说要改就一定会改"；
 * 缺失该上下文的旧检查点不得在外审轮恢复目标阶段（fail-closed）。
 */
export interface ReviewRevisionContext {
  revision_round: 0 | 1 | 2
  review_policy_version: string
  instruction_hash: string
  instructions_by_agent: {
    concept_tutor: ContentRevisionInstruction[]
    code_lab: ContentRevisionInstruction[]
    tiered_evaluator: ContentRevisionInstruction[]
  }
  affected_agents: Array<"concept-tutor" | "code-lab" | "tiered-evaluator">
  parent_candidate_hashes: {
    concept: string
    code_lab_public: string
    code_lab_secure: string
    assessment_public: string
    assessment_secure: string
  }
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
  "critic" | "fact_audit_port" | "trace_seq_start" | "checkpoint_store" | "semantic_planner"
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
