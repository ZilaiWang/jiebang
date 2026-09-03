import type { JudgeCompletenessResult } from "./types"

export function evaluateJudgeCompleteness(input: {
  claim_audits?: Array<{ audited?: boolean; verdict?: string; claim_id?: string }>
  difficulty_audits?: Array<{ audited?: boolean; predicted_difficulty?: string; artifact_kind?: string }>
  expected_claims?: number
  expected_claim_ids?: string[]
  expected_difficulty_resources?: number
}): JudgeCompletenessResult {
  const claims = input.claim_audits ?? []
  const difficulty = input.difficulty_audits ?? []
  const expectedClaims = input.expected_claims ?? claims.length
  const expectedDifficulty = input.expected_difficulty_resources ?? 3
  const claimComplete = expectedClaims > 0
    && claims.length === expectedClaims
    && (claims.every((entry) => !entry.claim_id) || new Set(claims.map((entry) => entry.claim_id)).size === claims.length)
    && (!input.expected_claim_ids || input.expected_claim_ids.every((id) => claims.some((entry) => entry.claim_id === id)))
    && claims.slice(0, expectedClaims).every((entry) => entry.audited === true && Boolean(entry.verdict))
  const difficultyComplete = expectedDifficulty > 0
    && difficulty.length === expectedDifficulty
    && (difficulty.every((entry) => !entry.artifact_kind) || new Set(difficulty.map((entry) => entry.artifact_kind)).size === expectedDifficulty)
    && difficulty.slice(0, expectedDifficulty).every((entry) => entry.audited === true && Boolean(entry.predicted_difficulty))
  const missing = [
    ...(claimComplete ? [] : ["claim_audit"]),
    ...(difficultyComplete ? [] : ["difficulty_audit"]),
  ]
  return {
    complete: missing.length === 0,
    claim_audit_complete: claimComplete,
    difficulty_audit_complete: difficultyComplete,
    missing,
  }
}
