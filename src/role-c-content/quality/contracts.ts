export type PublicArtifactKind = "concept_lesson" | "code_lab" | "assessment"

export interface QualityDimensionScore {
  dimension: string
  /** A non-applicable dimension is reported for auditability but never averaged or gated. */
  applicable?: boolean
  score: number
  weight: number
  confidence: number
  evidence_refs: string[]
  rationale: string
  core: boolean
}

export interface PublicCandidateEvaluation {
  candidate_id: string
  artifact_kind: PublicArtifactKind
  hard_gates: Array<{
    gate: string
    passed: boolean
    issue_codes: string[]
  }>
  dimensions: QualityDimensionScore[]
  overall_score: number
  release_eligible: boolean
  critical_findings: string[]
}

export interface CandidateSelectionResult<T> {
  winner: T
  winner_evaluation: PublicCandidateEvaluation
  evaluations: PublicCandidateEvaluation[]
  rejected_generation_count: number
}
