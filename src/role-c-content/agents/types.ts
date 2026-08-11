import type {
  AssessmentArtifactPair,
  AssessmentPublicPayload,
  AssessmentSecurePayload,
  CodeLabArtifactPair,
  CodeLabPublicPayload,
  CodeLabSecurePayload,
  ConceptLessonArtifact,
  ConceptLessonPayload,
} from "../contracts/artifacts"
import type { RagEvidencePack } from "../contracts/evidence-pack"
import type { GenerationSpec } from "../contracts/generation-spec"
import type { CodeLabVerificationFailureDiagnostic } from "../validators/code-lab-validator"
import type { AlignmentObjection } from "../validators/alignment-validator"

export interface NextRoundGenerationContext {
  request_id: string
  parent_spec_id: string
  prior_feedback_ref: string
  trigger_grade_artifact_id: string
  action: "remediate" | "reinforce" | "advance"
  focus_objective_ids: string[]
  reason_codes: string[]
  /** 上一轮反馈指出的具体误区标签；主 Agent 传入后用于定向补救与 adaptation 回传。 */
  misconception_tags?: string[]
}

export interface ConceptTutorRequest {
  generation_spec: GenerationSpec
  evidence_pack: RagEvidencePack
  next_round_context?: NextRoundGenerationContext
  revision_objections?: AlignmentObjection[]
  /** External A/B review regeneration round; distinct from an in-stage schema repair. */
  external_revision_round?: 0 | 1 | 2
}

export interface CodeLabRequest {
  generation_spec: GenerationSpec
  evidence_pack: RagEvidencePack
  concept_artifact: ConceptLessonArtifact
  next_round_context?: NextRoundGenerationContext
  revision_objections?: AlignmentObjection[]
  external_revision_round?: 0 | 1 | 2
}

export interface TieredEvaluatorRequest {
  generation_spec: GenerationSpec
  evidence_pack: RagEvidencePack
  concept_artifact: ConceptLessonArtifact
  code_lab_summary?: {
    lab_id: string
    objective_ids: string[]
    execution_verified: boolean
  }
  next_round_context?: NextRoundGenerationContext
  revision_objections?: AlignmentObjection[]
  external_revision_round?: 0 | 1 | 2
}

export interface ArtifactDraft<TPayload> {
  payload: TPayload
}

export interface CodeLabDraft {
  public_draft: ArtifactDraft<CodeLabPublicPayload>
  secure_draft: ArtifactDraft<CodeLabSecurePayload>
}

export interface CodeLabVerificationFeedback {
  revision_round: number
  /** Trusted-runner diagnostics; never copied into a public artifact verbatim. */
  issues: string[]
  /** Machine-readable trust-plane result; prose remains diagnostic only. */
  reference_failed?: boolean
  reference_failure_codes?: string[]
  starter_status?: "passed" | "failed" | "timeout" | "runner_error"
  failed_mutations?: Array<{
    mutation_id: string
    status: "passed" | "failed" | "timeout" | "runner_error"
    failure_codes: string[]
    must_fail_test_ids: string[]
  }>
  /** Stable classification for private targeted repair; public surfaces use safe_message only. */
  failure_diagnostic?: CodeLabVerificationFailureDiagnostic
}

export interface AssessmentDraft {
  public_draft: ArtifactDraft<AssessmentPublicPayload>
  secure_draft: ArtifactDraft<AssessmentSecurePayload>
}

export interface AssessmentVerificationFeedback {
  revision_round: number
  /** Trusted-verifier diagnostics; never copied into public assessment data. */
  issues: string[]
}

export interface CodeLabDraftVerifier {
  verifyCodeLab(request: CodeLabRequest, draft: CodeLabDraft): Promise<{
    execution_verified: boolean
    issues: string[]
    reference_failed?: boolean
    reference_failure_codes?: string[]
    starter_status?: "passed" | "failed" | "timeout" | "runner_error"
    failed_mutations?: Array<{
      mutation_id: string
      status: "passed" | "failed" | "timeout" | "runner_error"
      failure_codes: string[]
      must_fail_test_ids: string[]
    }>
    runner_image_digest?: string
    mutation_kill_rate?: number
    verified_test_count?: number
    objective_coverage?: number
  }>
}

export interface AssessmentDraftVerifier {
  verifyAssessment(request: TieredEvaluatorRequest, draft: AssessmentDraft): Promise<{
    answer_key_verified: boolean
    issues: string[]
    runner_image_digest?: string
    verified_item_count?: number
    verified_test_count?: number
    objective_coverage?: number
  }>
}

export interface GeneratedContentVerifiers {
  code_lab?: CodeLabDraftVerifier
  assessment?: AssessmentDraftVerifier
}

/** Prompt/model implementation boundary owned independently from contracts and validators. */
export interface RoleCContentProvider {
  generateConceptLesson(request: ConceptTutorRequest): Promise<ArtifactDraft<ConceptLessonPayload>>
  generateCodeLab(request: CodeLabRequest): Promise<CodeLabDraft>
  /** Optional trusted-execution repair. Public payload must remain frozen. */
  repairCodeLabAfterVerification?(
    request: CodeLabRequest,
    draft: CodeLabDraft,
    feedback: CodeLabVerificationFeedback,
  ): Promise<CodeLabDraft>
  generateAssessment(request: TieredEvaluatorRequest): Promise<AssessmentDraft>
  /** Optional trusted-verification repair. Public payload must remain frozen. */
  repairAssessmentAfterVerification?(
    request: TieredEvaluatorRequest,
    draft: AssessmentDraft,
    feedback: AssessmentVerificationFeedback,
  ): Promise<AssessmentDraft>
}

export interface ConceptTutorAgent {
  generate(request: ConceptTutorRequest): Promise<ConceptLessonArtifact>
}

export interface CodeLabAgent {
  generate(request: CodeLabRequest): Promise<CodeLabArtifactPair>
}

export interface TieredEvaluatorAgent {
  generate(request: TieredEvaluatorRequest): Promise<AssessmentArtifactPair>
}

export interface RoleCAgents {
  concept_tutor: ConceptTutorAgent
  code_lab: CodeLabAgent
  tiered_evaluator: TieredEvaluatorAgent
}
