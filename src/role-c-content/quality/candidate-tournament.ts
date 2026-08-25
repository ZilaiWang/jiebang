import type { CandidateSelectionResult, PublicCandidateEvaluation } from "./contracts"

export class PublicQualityGateError extends Error {
  readonly code = "PUBLIC_QUALITY_GATE_FAILED"
  constructor(readonly evaluations: PublicCandidateEvaluation[], readonly generation_failures: number) {
    const findings = [...new Set(evaluations.flatMap((evaluation) =>
      evaluation.critical_findings))].slice(0, 3)
    const detail = findings.length > 0
      ? findings.join("；")
      : generation_failures > 0
        ? `${generation_failures} 个候选生成失败`
        : "核心质量维度未达到发布最低值"
    super(`公开候选均未达到最低教学质量要求：${detail}`)
  }
}

/** Generates independent candidates, filters hard failures and deterministically selects the best. */
export async function runPublicCandidateTournament<T>(input: {
  candidate_count: number
  generate: (variantIndex: number) => Promise<T>
  evaluate: (candidate: T, variantIndex: number) => PublicCandidateEvaluation
  review?: (entries: Array<{
    candidate: T
    variant_index: number
    evaluation: PublicCandidateEvaluation
  }>) => Promise<PublicCandidateEvaluation[]>
  on_rejected?: (evaluations: PublicCandidateEvaluation[], generationFailures: number) => void | Promise<void>
}): Promise<CandidateSelectionResult<T>> {
  const count = Math.max(1, Math.min(3, Math.floor(input.candidate_count)))
  const settled = await Promise.allSettled(
    Array.from({ length: count }, (_, variantIndex) => input.generate(variantIndex)),
  )
  const successful = settled.flatMap((result, variantIndex) =>
    result.status === "fulfilled"
      ? [{ candidate: result.value, variant_index: variantIndex }]
      : [])
  let evaluations = successful.map((entry) => ({
    entry,
    evaluation: input.evaluate(entry.candidate, entry.variant_index),
  }))
  if (input.review && evaluations.length > 0) {
    const reviewed = await input.review(evaluations.map(({ entry, evaluation }) => ({
      ...entry,
      evaluation,
    })))
    if (reviewed.length !== evaluations.length
      || reviewed.some((evaluation, index) =>
        evaluation.candidate_id !== evaluations[index]!.evaluation.candidate_id)) {
      throw new Error("PUBLIC_CANDIDATE_REVIEW_RESULT_MISMATCH")
    }
    evaluations = evaluations.map((entry, index) => ({
      entry: entry.entry,
      evaluation: reviewed[index]!,
    }))
  }
  const ranked = evaluations
    .filter((entry) => entry.evaluation.release_eligible)
    .sort((left, right) =>
      right.evaluation.overall_score - left.evaluation.overall_score
      || left.evaluation.candidate_id.localeCompare(right.evaluation.candidate_id))
  const winner = ranked[0]
  if (!winner) {
    await input.on_rejected?.(
      evaluations.map((entry) => entry.evaluation),
      settled.length - successful.length,
    )
    throw new PublicQualityGateError(
      evaluations.map((entry) => entry.evaluation),
      settled.length - successful.length,
    )
  }
  return {
    winner: winner.entry.candidate,
    winner_evaluation: winner.evaluation,
    evaluations: evaluations.map((entry) => entry.evaluation),
    rejected_generation_count: settled.length - successful.length,
  }
}
