import type { ReliabilityCaseSummary } from "./types"

export function buildReliabilityScorecard(records: Array<{
  case_id: string
  duration_ms: number
  reliability?: ReliabilityCaseSummary
}>, expected: number) {
  const summaries = records.flatMap((record) => record.reliability ? [record.reliability] : [])
  const stages = [...new Set(summaries.flatMap((summary) => summary.funnel.stages.map((stage) => stage.stage)))]
  const failures = summaries.flatMap((summary) => summary.failures)
  const durations = records.map((record) => record.duration_ms).filter(Number.isFinite).sort((a, b) => a - b)
  const quantile = (q: number) => durations.length ? durations[Math.max(0, Math.ceil(q * durations.length) - 1)]! : null
  return {
    version: "aws-aligned-agent-scorecard.v3",
    expected_cases: expected,
    recorded_cases: records.length,
    not_run: expected - records.length,
    metric_eligible: summaries.filter((summary) => summary.metric_eligible).length,
    publication_ready: summaries.filter((summary) => summary.publication_ready).length,
    quality_fail: summaries.filter((summary) => summary.operational_status === "quality_fail").length,
    infrastructure_incomplete: summaries.filter((summary) => summary.failures.some((failure) => failure.category === "infrastructure" || failure.category === "model_transport")).length,
    stage_success: Object.fromEntries(stages.map((name) => {
      const rows = summaries.flatMap((summary) => summary.funnel.stages.filter((stage) => stage.stage === name))
      return [name, { reached: rows.filter((row) => row.reached).length, passed: rows.filter((row) => row.passed).length, expected }]
    })),
    failure_categories: Object.fromEntries([...new Set(failures.map((failure) => failure.category))].map((category) =>
      [category, failures.filter((failure) => failure.category === category).length])),
    system: { p50_ms: quantile(0.5), p95_ms: quantile(0.95) },
    cases: records.map((record) => ({ case_id: record.case_id, ...record.reliability })),
  }
}
