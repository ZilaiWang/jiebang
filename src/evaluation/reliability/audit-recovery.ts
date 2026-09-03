import type { CompetitionClaimAuditor, CompetitionClaimCandidate, CompetitionEvidenceFact } from "../competition-claim-auditor"
import type { CompetitionArtifactView } from "../competition-artifact-view"
import type { ResourceDifficultyJudge } from "../resource-difficulty-judge"
import { MODEL_DIFFICULTY_JUDGE_VERSION } from "../resource-difficulty-judge"
import type { ClaimAuditRecord, DifficultyAuditRecord } from "../competition-metrics"

const CLAIM_BATCH_SIZE = 12
const CLAIM_BATCH_CONCURRENCY = 2

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
    const batches = Array.from(
      { length: Math.ceil(missing.length / CLAIM_BATCH_SIZE) },
      (_, index) => missing.slice(index * CLAIM_BATCH_SIZE, (index + 1) * CLAIM_BATCH_SIZE),
    )
    for (let offset = 0; offset < batches.length; offset += CLAIM_BATCH_CONCURRENCY) {
      const group = batches.slice(offset, offset + CLAIM_BATCH_CONCURRENCY)
      const settled = await Promise.allSettled(group.map(async (batch) => {
        const audited = await input.claimAuditor.audit({
          case_id: record.case_id,
          repeat_index: record.repeat_index,
          candidates: batch,
          evidence: input.evidence,
        })
        const fresh = new Map(audited.map((claim) => [claim.claim_id, claim]))
        if (audited.length !== batch.length || fresh.size !== batch.length || batch.some((candidate) =>
          fresh.get(candidate.claim_id)?.artifact_kind !== candidate.artifact_kind)) {
          throw new Error("CLAIM_RECOVERY_IDENTITY_MISMATCH")
        }
        return audited
      }))
      let failed = false
      for (const result of settled) {
        if (result.status === "fulfilled") {
          for (const claim of result.value) prior.set(claim.claim_id, claim)
        } else {
          record.errors.push(`claim audit:${message(result.reason)}`)
          failed = true
        }
        record.claims = input.candidates.map((candidate) => prior.get(candidate.claim_id) ?? ({
          case_id: record.case_id, repeat_index: record.repeat_index,
          claim_id: candidate.claim_id, artifact_kind: candidate.artifact_kind,
          factual: true, audited: false, verdict: "uncertain", supported_fact_ids: [],
        }))
        // Each paid batch is persisted independently even when its sibling
        // fails, so --retry-audits only pays for the unfinished evidence.
        await input.checkpoint()
      }
      if (failed) break
    }
  }
  const missingDifficulty = input.views.filter((view) =>
    !record.difficulty.find((entry) => entry.artifact_kind === view.artifact_kind)?.audited)
  const difficultyResults = await Promise.allSettled(missingDifficulty.map((view) =>
    input.difficultyJudge.classify({
        case_id: record.case_id, artifact_kind: view.artifact_kind, title: view.title,
        content: view.content, rubric_version: "difficulty-rubric-v1",
      })))
  for (const [index, view] of missingDifficulty.entries()) {
    let audit = record.difficulty.find((entry) => entry.artifact_kind === view.artifact_kind)
    if (!audit) {
      audit = { case_id: record.case_id, repeat_index: record.repeat_index, artifact_kind: view.artifact_kind, audited: false, reasons: [] }
      record.difficulty.push(audit)
    }
    record.errors = record.errors.filter((error) => !error.startsWith(`difficulty:${view.artifact_kind}:`))
    const result = difficultyResults[index]!
    if (result.status === "fulfilled") {
      const value = result.value
      Object.assign(audit, { ...value, audited: true, judge_version: MODEL_DIFFICULTY_JUDGE_VERSION })
    } else {
      record.errors.push(`difficulty:${view.artifact_kind}:${message(result.reason)}`)
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
