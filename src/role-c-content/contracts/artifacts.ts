import type { ArtifactEnvelope, CitationRef } from "./common"

export interface HeadingBlock {
  block_id: string
  block_type: "heading"
  level: 1 | 2 | 3
  text: string
}

export interface ParagraphBlock {
  block_id: string
  block_type: "paragraph"
  text: string
  claims: Claim[]
}

export interface CodeBlock {
  block_id: string
  block_type: "code"
  language: string
  code: string
  caption?: string
  claims: Claim[]
}

export interface CalloutBlock {
  block_id: string
  block_type: "callout"
  tone: "info" | "warning" | "tip"
  title: string
  text: string
  claims: Claim[]
}

export interface ComparisonBlock {
  block_id: string
  block_type: "comparison"
  title: string
  columns: Array<{ heading: string; content: string }>
  claims: Claim[]
}

export interface QuizBlock {
  block_id: string
  block_type: "quiz"
  item_id: string
  prompt: string
  options?: PublicOption[]
  citations: CitationRef[]
  /**
   * 课件内理解检查的即时反馈答案（公开学习内容，不计入正式评分）。
   * 键名避开 secure 边界保留字段；正式测评答案仍走 secure + 反馈揭示。
   */
  answer_option_id?: string
  answer_explanation?: string
}

export interface HintBlock {
  block_id: string
  block_type: "hint"
  hint_level: 1 | 2 | 3
  text: string
  citations: CitationRef[]
}

export interface CitationBlock {
  block_id: string
  block_type: "citation"
  citations: CitationRef[]
}

export type RenderBlock =
  | HeadingBlock
  | ParagraphBlock
  | CodeBlock
  | CalloutBlock
  | ComparisonBlock
  | QuizBlock
  | HintBlock
  | CitationBlock

export interface Claim {
  claim_id: string
  text: string
  citations: CitationRef[]
}

export interface ObjectiveCoverageRef {
  objective_id: string
  block_ids: string[]
}

export interface HintLadder {
  objective_id: string
  hints: Array<{ hint_level: 1 | 2 | 3; text: string; citations: CitationRef[] }>
}

export interface ConceptLessonPayload {
  title: string
  objective_ids: string[]
  prerequisite_bridge: RenderBlock[]
  explanation_blocks: RenderBlock[]
  worked_examples: RenderBlock[]
  misconceptions: Array<{
    misconception_tag: string
    explanation: string
    objective_id: string
    citations: CitationRef[]
  }>
  micro_checks: QuizBlock[]
  hint_ladders: HintLadder[]
  summary: RenderBlock[]
  objective_coverage: ObjectiveCoverageRef[]
  used_evidence: CitationRef[]
}

export interface ExecutionContract {
  language: "python"
  execution_mode: "function" | "stdin_stdout"
  entry_point?: string
  allowed_imports: string[]
  input_contract: { type: string; constraints: string[] }
  output_contract: {
    /** Canonical semantic classifier; type is retained only as display/backward-compatible prose. */
    kind?: "string" | "number" | "array" | "object" | "boolean"
    type: string
    constraints?: string[]
  }
  resource_limits: {
    timeout_ms: number
    memory_mb: number
    max_output_bytes: number
  }
}

export interface PublicTest {
  test_id: string
  objective_id: string
  description: string
  input: unknown
  expected_behavior: string
  citations: CitationRef[]
}

export interface CodeLabPublicObjectiveCoverage {
  objective_id: string
  instruction_block_ids: string[]
  public_test_ids: string[]
}

export interface CodeLabPublicPayload {
  lab_id: string
  title: string
  objective_ids: string[]
  instructions: RenderBlock[]
  execution_contract: ExecutionContract
  starter_code: string
  public_tests: PublicTest[]
  hint_ladders: HintLadder[]
  reflection_questions: string[]
  objective_coverage: CodeLabPublicObjectiveCoverage[]
  used_evidence: CitationRef[]
}

export type TestComparison =
  | { kind: "exact" }
  | { kind: "numeric"; abs_tolerance: number; rel_tolerance: number }

export interface HiddenTest {
  test_id: string
  input: unknown
  expected: unknown
  objective_id: string
  weight: number
  comparison: TestComparison
}

export interface CodeLabScoringGroup {
  group_id: string
  objective_id: string
  test_ids: string[]
  weight: number
}

export interface CodeMutationVariant {
  mutation_id: string
  code: string
  objective_ids: string[]
  misconception_tag: string
  must_fail_test_ids: string[]
}

export interface CodeLabSecureObjectiveCoverage {
  objective_id: string
  hidden_test_ids: string[]
  scoring_group_ids: string[]
  mutation_ids: string[]
}

export interface CodeLabSecurePayload {
  lab_id: string
  test_suite_id: string
  execution_contract: ExecutionContract
  reference_solution: string
  hidden_tests: HiddenTest[]
  scoring_groups: CodeLabScoringGroup[]
  misconception_map: Array<{ failed_test_id: string; misconception_tag: string }>
  mutation_variants: CodeMutationVariant[]
  objective_coverage: CodeLabSecureObjectiveCoverage[]
}

export interface PublicOption {
  option_id: string
  label: string
  text: string
}

export interface AssessmentItemPublic {
  item_id: string
  family_id: string
  variant_id: string
  display_no: number
  objective_id: string
  tier: 1 | 2 | 3
  modality: "mcq" | "true_false" | "trace" | "short_answer" | "code"
  prompt: string
  options?: PublicOption[]
  starter_code?: string
  max_score: number
  citations: CitationRef[]
}

export interface AssessmentObjectiveCoverage {
  objective_id: string
  item_ids: string[]
  modalities: AssessmentItemPublic["modality"][]
}

export interface AssessmentRoutingRule {
  route_id: string
  min_anchor_score_ratio: number
  max_anchor_score_ratio: number
  action: "remediate" | "reinforce" | "advance"
  reveal_tiers: Array<1 | 2 | 3>
}

export interface AssessmentPublicPayload {
  form_id: string
  title: string
  objective_ids: string[]
  items: AssessmentItemPublic[]
  submission_policy: {
    max_attempts: number
    formative: boolean
  }
  routing: {
    anchor_item_ids: string[]
    rules: AssessmentRoutingRule[]
  }
  objective_coverage: AssessmentObjectiveCoverage[]
  used_evidence: CitationRef[]
}

export interface RubricCriterion {
  criterion_id: string
  description: string
  weight: number
  required_evidence: string[]
}

export type AnswerSpec =
  | {
      kind: "exact_set"
      accepted: string[]
      normalization: Array<"trim" | "casefold" | "unicode" | "collapse_whitespace">
    }
  | {
      kind: "numeric"
      target: number
      abs_tolerance: number
      rel_tolerance: number
      unit?: string
    }
  | {
      kind: "concept_rubric"
      criteria: RubricCriterion[]
      contradictions: string[]
    }
  | {
      kind: "code"
      test_suite_id: string
    }

export interface AssessmentItemSecure {
  item_id: string
  objective_id: string
  tier: 1 | 2 | 3
  modality: "mcq" | "true_false" | "trace" | "short_answer" | "code"
  max_score: number
  answer_spec: AnswerSpec
  correct_option_id?: string
  misconception_by_option: Record<string, string>
  evidence_weight: number
}

export interface AssessmentCodeTestSuite {
  test_suite_id: string
  execution_contract: ExecutionContract
  reference_solution: string
  hidden_tests: HiddenTest[]
}

export interface AssessmentSecureObjectiveCoverage {
  objective_id: string
  item_ids: string[]
  answer_kinds: AnswerSpec["kind"][]
}

export interface AssessmentSecurePayload {
  form_id: string
  items: AssessmentItemSecure[]
  option_order_seed: number
  code_test_suites: AssessmentCodeTestSuite[]
  objective_coverage: AssessmentSecureObjectiveCoverage[]
}

export interface SubmissionAnswer {
  item_id: string
  selected_option_id?: string
  text_response?: string
  code_response?: string
  hint_level_used: 0 | 1 | 2 | 3
}

export interface SubmissionEnvelope {
  schema_version: "1.0"
  submission_id: string
  run_id: string
  learner_id_hash: string
  form_id: string
  attempt_no: number
  answers: SubmissionAnswer[]
}

export interface SessionState {
  schema_version: "1.0"
  session_id: string
  run_id: string
  learner_id_hash: string
  current_path_node_id: string
  current_form_id: string
  attempt_no: number
  /** Trusted D/backend snapshot of the items required after anchor routing. */
  required_item_ids: string[]
  revealed_hint_levels: Record<string, 0 | 1 | 2 | 3>
  public_artifact_refs: string[]
  secure_artifact_refs: string[]
}

export interface GradeItemResult {
  item_id: string
  objective_id: string
  raw_score: number
  max_score: number
  evidence_score: number
  grader_confidence: number
  hint_factor: number
  repeat_factor: number
  misconception_tags: string[]
  feedback_code: string
  rubric_results?: RubricCriterionResult[]
}

export interface RubricCriterionResult {
  criterion_id: string
  status: "met" | "unmet" | "uncertain"
  awarded_score: number
  confidence: number
  evidence_excerpt?: string
}

/**
 * Correct-answer disclosure attached to post-submission feedback only. The
 * static public assessment artifact never carries answers; learners see them
 * only after a trusted score exists for their own submission.
 */
export type RevealedAnswer =
  | { kind: "choice"; option_id: string }
  | { kind: "text"; accepted: string[] }
  | { kind: "numeric"; target: number; unit?: string }
  | {
      kind: "rubric"
      criteria: Array<{
        description: string
        required_evidence: string[]
      }>
    }
  | { kind: "code"; code: string }

export interface GradeFeedbackItem {
  item_id: string
  feedback_code: string
  message: string
  next_step: string
  revealed_answer?: RevealedAnswer
}

export interface GradeFeedback {
  generated_after_score_freeze: true
  mode: "formative" | "summative"
  summary: string
  item_feedback: GradeFeedbackItem[]
}

export interface GradeResultPayload {
  submission_id: string
  form_id: string
  score_frozen: true
  raw_score: number
  max_score: number
  evidence_score: number
  item_results: GradeItemResult[]
  recommendation: {
    action: "remediate" | "reinforce" | "advance" | "reprofile"
    confidence: number
    reason_codes: string[]
  }
  feedback: GradeFeedback
}

export type ConceptLessonArtifact =
  ArtifactEnvelope<ConceptLessonPayload, "concept_lesson", "concept-tutor">
export type CodeLabPublicArtifact =
  ArtifactEnvelope<CodeLabPublicPayload, "code_lab_public", "code-lab">
export type CodeLabSecureArtifact =
  ArtifactEnvelope<CodeLabSecurePayload, "code_lab_secure", "code-lab">
export type AssessmentPublicArtifact =
  ArtifactEnvelope<AssessmentPublicPayload, "assessment_public", "tiered-evaluator">
export type AssessmentSecureArtifact =
  ArtifactEnvelope<AssessmentSecurePayload, "assessment_secure", "tiered-evaluator">
export type GradeResultArtifact =
  ArtifactEnvelope<GradeResultPayload, "grade_result", "tiered-evaluator">

export interface CodeLabArtifactPair {
  public_artifact: CodeLabPublicArtifact
  secure_artifact: CodeLabSecureArtifact
}

export interface AssessmentArtifactPair {
  public_artifact: AssessmentPublicArtifact
  secure_artifact: AssessmentSecureArtifact
}
