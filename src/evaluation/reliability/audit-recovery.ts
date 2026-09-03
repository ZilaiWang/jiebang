import type { CompetitionClaimAuditor, CompetitionClaimCandidate, CompetitionEvidenceFact } from "../competition-claim-auditor"
import type { CompetitionArtifactView } from "../competition-artifact-view"
import type { ResourceDifficultyJudge } from "../resource-difficulty-judge"
import { MODEL_DIFFICULTY_JUDGE_VERSION } from "../resource-difficulty-judge"
import type { ClaimAuditRecord, DifficultyAuditRecord } from "../competition-metrics"

export interface RecoverableAuditRecord {
  case_id: string
  repeat_index: number
  claims: ClaimAuditRecord[]
  difficulty: DifficultyAuditRecord[]
  errors: string[]
}

/** Reuses every completed verdict, including negative verdicts. Only missing evidence is retried. */
export async function resumeEvaluationAudits(input: {
  record: RecoverableAuditRecord
  candidates: CompetitionClaimCandidate[]
  evidence: CompetitionEvidenceFact[]
  views: CompetitionArtifactView[]
  claimAuditor: CompetitionClaimAuditor
  difficultyJudge: ResourceDifficultyJudge
  checkpoint: () => Promise<void>
}) {
  const { record } = input
  const prior = new Map(record.claims.map((claim) => [claim.claim_id, claim]))
  const missing = input.candidates.filter((candidate) => !prior.get(candidate.claim_id)?.audited)
  if (missing.length > 0) {
    record.errors = record.errors.filter((error) => !error.startsWith("claim audit:"))
    for (let offset = 0; offset < missing.length; offset += 12) {
      const batch = missing.slice(offset, offset + 12)
      let failed = false
      try {
        const audited = await input.claimAuditor.audit({
        case_id: record.case_id, repeat_index: record.repeat_index,
          candidates: batch, evidence: input.evidence,
        })
        const fresh = new Map(audited.map((claim) => [claim.claim_id, claim]))
        if (audited.length !== batch.length || fresh.size !== batch.length || batch.some((candidate) =>
          fresh.get(candidate.claim_id)?.artifact_kind !== candidate.artifact_kind)) throw new Error("CLAIM_RECOVERY_IDENTITY_MISMATCH")
        for (const claim of audited) prior.set(claim.claim_id, claim)
      } catch (error) {
        record.errors.push(`claim audit:${message(error)}`)
        failed = true
      }
      record.claims = input.candidates.map((candidate) => prior.get(candidate.claim_id) ?? ({
        case_id: record.case_id, repeat_index: record.repeat_index,
        claim_id: candidate.claim_id, artifact_kind: candidate.artifact_kind,
        factual: true, audited: false, verdict: "uncertain", supported_fact_ids: [],
      }))
      await input.checkpoint()
      if (failed) break
    }
  }
  for (const view of input.views) {
    let audit = record.difficulty.find((entry) => entry.artifact_kind === view.artifact_kind)
    if (audit?.audited) continue
    if (!audit) {
      audit = { case_id: record.case_id, repeat_index: record.repeat_index, artifact_kind: view.artifact_kind, audited: false, reasons: [] }
      record.difficulty.push(audit)
    }
    record.errors = record.errors.filter((error) => !error.startsWith(`difficulty:${view.artifact_kind}:`))
    try {
      const value = await input.difficultyJudge.classify({
        case_id: record.case_id, artifact_kind: view.artifact_kind, title: view.title,
        content: view.content, rubric_version: "difficulty-rubric-v1",
      })
      Object.assign(audit, { ...value, audited: true, judge_version: MODEL_DIFFICULTY_JUDGE_VERSION })
    } catch (error) {
      record.errors.push(`difficulty:${view.artifact_kind}:${message(error)}`)
    }
    await input.checkpoint()
  }
  if (record.difficulty.length === 3 && record.difficulty.every((entry) => entry.audited)) {
    record.errors = record.errors.filter((error) => !error.startsWith("difficulty:"))
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
