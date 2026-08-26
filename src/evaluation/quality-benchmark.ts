export type BenchmarkArtifactKind = "concept_lesson" | "code_lab" | "assessment"

export interface QualityBenchmarkCase {
  case_id: string
  learner_profile_id: string
  artifact_kind: BenchmarkArtifactKind
  topic_ids: string[]
  required_fact_keys: string[]
  allowed_claims: string[]
  forbidden_claims: string[]
  expected_adaptation_decisions: string[]
  forbidden_adaptation_decisions: string[]
  target_misconception_ids: string[]
  expected_difficulty: number
}

export interface QualityBenchmarkObservation {
  case_id: string
  automatic_score: number
  human_scores: number[]
  checked_claims: number
  conflicting_claims: number
  required_fact_keys_covered: string[]
  expected_adaptation_decisions_observed: string[]
  target_misconception_ids_observed: string[]
  transfer_passed: boolean
}

export interface QualityBenchmarkReport {
  sample_count: number
  claim_hallucination_rate: number
  core_fact_coverage: number
  adaptation_precision: number
  adaptation_recall: number
  adaptation_f1: number
  misconception_recall: number
  transfer_pass_rate: number
  automatic_human_spearman: number | null
  human_score_mean: number | null
  human_score_confidence_interval_95: [number, number] | null
}

export function evaluateQualityBenchmark(
  cases: QualityBenchmarkCase[],
  observations: QualityBenchmarkObservation[],
): QualityBenchmarkReport {
  const observationById = new Map(observations.map((entry) => [entry.case_id, entry]))
  const paired = cases.flatMap((benchmarkCase) => {
    const observation = observationById.get(benchmarkCase.case_id)
    return observation ? [{ benchmarkCase, observation }] : []
  })
  const checkedClaims = paired.reduce((sum, entry) => sum + entry.observation.checked_claims, 0)
  const conflictingClaims = paired.reduce((sum, entry) => sum + entry.observation.conflicting_claims, 0)
  const requiredFacts = paired.flatMap((entry) => entry.benchmarkCase.required_fact_keys)
  const coveredFacts = paired.reduce((sum, entry) => {
    const observed = new Set(entry.observation.required_fact_keys_covered)
    return sum + entry.benchmarkCase.required_fact_keys.filter((key) => observed.has(key)).length
  }, 0)
  let adaptationTruePositive = 0
  let adaptationObserved = 0
  let adaptationExpected = 0
  let misconceptionExpected = 0
  let misconceptionObserved = 0
  const humanMeans: number[] = []
  const automaticScores: number[] = []
  for (const { benchmarkCase, observation } of paired) {
    const expectedAdaptation = new Set(benchmarkCase.expected_adaptation_decisions)
    const observedAdaptation = new Set(observation.expected_adaptation_decisions_observed)
    adaptationTruePositive += [...observedAdaptation].filter((entry) => expectedAdaptation.has(entry)).length
    adaptationObserved += observedAdaptation.size
    adaptationExpected += expectedAdaptation.size
    const expectedMisconceptions = new Set(benchmarkCase.target_misconception_ids)
    misconceptionExpected += expectedMisconceptions.size
    misconceptionObserved += observation.target_misconception_ids_observed
      .filter((entry) => expectedMisconceptions.has(entry)).length
    if (observation.human_scores.length > 0) {
      humanMeans.push(mean(observation.human_scores))
      automaticScores.push(observation.automatic_score)
    }
  }
  const precision = ratio(adaptationTruePositive, adaptationObserved)
  const recall = ratio(adaptationTruePositive, adaptationExpected)
  const humanMean = humanMeans.length > 0 ? mean(humanMeans) : null
  return {
    sample_count: paired.length,
    claim_hallucination_rate: round(ratio(conflictingClaims, checkedClaims)),
    core_fact_coverage: round(ratio(coveredFacts, requiredFacts.length)),
    adaptation_precision: round(precision),
    adaptation_recall: round(recall),
    adaptation_f1: round(precision + recall === 0 ? 0 : 2 * precision * recall / (precision + recall)),
    misconception_recall: round(ratio(misconceptionObserved, misconceptionExpected)),
    transfer_pass_rate: round(ratio(paired.filter((entry) => entry.observation.transfer_passed).length, paired.length)),
    automatic_human_spearman: humanMeans.length >= 3 ? round(spearman(automaticScores, humanMeans)) : null,
    human_score_mean: humanMean === null ? null : round(humanMean),
    human_score_confidence_interval_95: humanMean === null ? null : confidenceInterval95(humanMeans),
  }
}

function spearman(left: number[], right: number[]): number {
  const leftRanks = ranks(left)
  const rightRanks = ranks(right)
  const leftMean = mean(leftRanks)
  const rightMean = mean(rightRanks)
  const numerator = leftRanks.reduce((sum, value, index) =>
    sum + (value - leftMean) * (rightRanks[index]! - rightMean), 0)
  const denominator = Math.sqrt(
    leftRanks.reduce((sum, value) => sum + (value - leftMean) ** 2, 0)
      * rightRanks.reduce((sum, value) => sum + (value - rightMean) ** 2, 0),
  )
  return denominator === 0 ? 0 : numerator / denominator
}

function ranks(values: number[]): number[] {
  const sorted = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value)
  const result = Array(values.length).fill(0) as number[]
  for (let start = 0; start < sorted.length;) {
    let end = start + 1
    while (end < sorted.length && sorted[end]!.value === sorted[start]!.value) end += 1
    const rank = (start + 1 + end) / 2
    for (let index = start; index < end; index += 1) result[sorted[index]!.index] = rank
    start = end
  }
  return result
}

function confidenceInterval95(values: number[]): [number, number] {
  if (values.length <= 1) return [round(values[0] ?? 0), round(values[0] ?? 0)]
  const average = mean(values)
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1)
  const margin = 1.96 * Math.sqrt(variance / values.length)
  return [round(average - margin), round(average + margin)]
}

function ratio(numerator: number, denominator: number): number { return denominator === 0 ? 1 : numerator / denominator }
function mean(values: number[]): number { return values.reduce((sum, value) => sum + value, 0) / values.length }
function round(value: number): number { return Math.round(value * 10_000) / 10_000 }
