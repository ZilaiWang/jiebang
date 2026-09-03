export type ArtifactKind = "lesson" | "lab" | "assessment"

export type EvaluationFailureCategory =
  | "infrastructure"
  | "model_transport"
  | "structured_output"
  | "artifact_contract"
  | "grounding"
  | "coverage"
  | "difficulty"
  | "docker_execution"
  | "audit_completeness"
  | "publication"
  | "persistence"
  | "input_contract"
  | "unknown"

export type RecoveryAction =
  | "retry_transport"
  | "repair_structured_output"
  | "repair_artifact"
  | "refresh_evidence"
  | "rerun_difficulty_judge"
  | "rerun_docker"
  | "rerun_audit"
  | "rerun_publication"
  | "operator_fix"
  | "no_retry"

export type ReliabilityStatus =
  | "pass"
  | "quality_fail"
  | "retryable_error"
  | "infrastructure_unavailable"
  | "incomplete"

export interface FailureClassification {
  category: EvaluationFailureCategory
  status: ReliabilityStatus
  action: RecoveryAction
  retryable: boolean
  stage?: string
  issue_codes: string[]
  summary: string
}

export interface StageEvidence {
  stage: string
  reached: boolean
  passed: boolean
  reason?: string
}

export interface FunnelReport {
  case_id: string
  stages: StageEvidence[]
  earliest_failure_stage?: string
  metric_eligible: boolean
  publication_ready: boolean
}

export interface ManifestObjectiveLike {
  objective_id?: string
  source_id: string
  observable_behavior?: string
  required_fact_ids?: string[]
  required_facts?: Array<{ fact_id?: string; id?: string }>
  importance?: string
}

export interface ManifestCaseLike {
  case_id: string
  profile_fixture_id?: string
  profile_archetype_id?: string
  target_source_ids?: string[]
  objectives?: ManifestObjectiveLike[]
  artifact_plan?: Record<string, unknown>
  artifact_tasks?: Record<string, unknown>
  expected_difficulty?: string
  tags?: string[]
}

export interface FrozenManifestLike {
  cases: ManifestCaseLike[]
  semantic_contract_hash?: string
}

export interface ArtifactTaskContractLike {
  kind?: ArtifactKind | string
  target_count?: number
  lesson?: {
    worked_example_count?: number
    max_new_terms_before_gloss?: number
    require_step_trace?: boolean
    require_debugging_clinic?: boolean
    require_design_tradeoff?: boolean
  }
  lab?: {
    learner_owned_dependent_steps?: number
    starter_completion_ratio_ceiling?: number
    minimum_public_tests?: number
    minimum_hidden_tests?: number
    minimum_boundary_tests?: number
    public_test_minimum?: number
    hidden_test_minimum?: number
    boundary_case_minimum?: number
    require_faulty_starter?: boolean
    require_open_acceptance_criteria?: boolean
  }
  assessment?: {
    item_count?: number
    tier_1_count?: number
    tier_2_count?: number
    tier_3_count?: number
    required_modalities?: string[]
    require_independent_code_item?: boolean
    require_boundary_or_counterexample_item?: boolean
  }
}

export interface ReliabilityCaseSummary {
  version: "evaluation-reliability.v3"
  failures: FailureClassification[]
  funnel: FunnelReport
  artifact_validations: ArtifactValidationResult[]
  judge: JudgeCompletenessResult
  fact_coverage: {
    expected_fact_units: number
    covered_fact_units: number
    coverage_rate: number
    missing: Array<{ source_id: string; fact_id: string }>
  }
  metric_eligible: boolean
  publication_ready: boolean
  operational_status: ReliabilityStatus
  reasons: string[]
}

export interface ArtifactTaskContractsLike {
  concept_lesson?: ArtifactTaskContractLike
  code_lab?: ArtifactTaskContractLike
  assessment?: ArtifactTaskContractLike
  lesson?: ArtifactTaskContractLike
  lab?: ArtifactTaskContractLike
}

export interface ContractIssue {
  code: string
  severity: "hard" | "soft"
  artifact_kind: ArtifactKind
  message: string
  evidence_refs?: string[]
}

export interface ArtifactValidationResult {
  artifact_kind: ArtifactKind
  hard_pass: boolean
  soft_score: number
  issues: ContractIssue[]
}

export interface JudgeCompletenessResult {
  complete: boolean
  claim_audit_complete: boolean
  difficulty_audit_complete: boolean
  missing: string[]
}

export interface CaseReadinessResult {
  metric_eligible: boolean
  publication_ready: boolean
  operational_status: ReliabilityStatus
  reasons: string[]
}
