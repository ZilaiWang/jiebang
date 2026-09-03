import type { FrozenCompetitionManifestV2 } from "../v2/competition-manifest.v2"
import { COMPETITION_CASES_V2 } from "../v2/competition-cases.v2"
import type { CompetitionMetricsReport } from "../competition-metrics"
import type { ReliabilityCaseSummary } from "./types"

export type EvaluationGate = "canary" | "balanced12" | "formal60"

export function selectReliabilityCases(manifest: FrozenCompetitionManifestV2, gate: EvaluationGate): string[] {
  if (gate === "formal60") return manifest.cases.map((entry) => entry.case_id)
  const canaries = ([ ["explain", "beginner"], ["debug", "intermediate"], ["create", "integrated"] ] as const)
    .map(([behavior, difficulty]) => manifest.cases.find((entry) =>
      entry.objectives[0]?.observable_behavior === behavior && entry.expected_difficulty.lab === difficulty)?.case_id)
  if (canaries.some((id) => !id)) throw new Error("CANARY_COVERAGE_INCOMPLETE")
  if (gate === "canary") return canaries as string[]
  const selected = new Set(canaries as string[])
  const features = (id: string): string[] => {
    const entry = manifest.cases.find((value) => value.case_id === id)!
    const source = COMPETITION_CASES_V2.find((value) => value.case_id === id)!
    return [
      `profile:${entry.profile_fixture_id}`, `behavior:${entry.objectives[0]!.observable_behavior}`,
      ...Object.values(entry.expected_difficulty).map((value) => `difficulty:${value}`),
      `query:${source.query.style}`, `targets:${entry.target_source_ids.length === 1 ? "single" : "multiple"}`,
    ]
  }
  while (selected.size < 12) {
    const covered = new Set([...selected].flatMap(features))
    const counts = new Map<string, number>()
    for (const id of selected) {
      const profile = manifest.cases.find((entry) => entry.case_id === id)!.profile_fixture_id
      counts.set(profile, (counts.get(profile) ?? 0) + 1)
    }
    const next = manifest.cases.filter((entry) => !selected.has(entry.case_id))
      .sort((a, b) => {
        const score = (entry: typeof a) => features(entry.case_id).filter((feature) => !covered.has(feature)).length * 100
          - (counts.get(entry.profile_fixture_id) ?? 0) * 10
        return score(b) - score(a) || a.case_id.localeCompare(b.case_id)
      })[0]
    if (!next) throw new Error("BALANCED_CASES_INCOMPLETE")
    selected.add(next.case_id)
  }
  const all = new Set([...selected].flatMap(features))
  if ([...all].filter((value) => value.startsWith("profile:")).length !== 6
    || [...all].filter((value) => value.startsWith("behavior:")).length !== 5
    || [...all].filter((value) => value.startsWith("difficulty:")).length !== 4) throw new Error("BALANCED_COVERAGE_INCOMPLETE")
  return [...selected]
}

export function evaluateReliabilityGate(input: {
  gate: EvaluationGate
  expected: number
  records: Array<{ status?: string; reliability?: ReliabilityCaseSummary; code_execution: string }>
  metrics: CompetitionMetricsReport[]
}) {
  const rows = input.records
  const required = input.gate === "canary" ? 3 : input.gate === "balanced12" ? 12 : 60
  const checks = {
    expected_size: input.expected === required,
    all_recorded: rows.length === input.expected,
    all_evidence_complete: rows.length > 0 && rows.every((row) => row.reliability?.metric_eligible),
    all_artifacts_complete: rows.length > 0 && rows.every((row) => row.reliability?.artifact_validations.length === 3 && row.reliability.artifact_validations.every((artifact) => artifact.hard_pass)),
    all_docker_verified: rows.length > 0 && rows.every((row) => row.code_execution === "passed"),
    // Gate 1 verifies the complete execution chain. Independent negative
    // findings remain in metrics; the plan does not require a zero-error sample.
    all_published: rows.length > 0 && rows.every((row) => row.status === "ready"),
    quality_targets: input.gate === "canary" || input.metrics.length > 0 && input.metrics.every((report) =>
      report.gates.hallucination_passed && report.gates.adaptation_passed && report.gates.coverage_passed
      && report.metrics.claim_audit_coverage.value === 1 && report.metrics.difficulty_audit_completeness.value === 1),
  }
  return { gate: input.gate, checks, passed: Object.values(checks).every(Boolean) }
}

export function contractSatisfiability(manifest: FrozenCompetitionManifestV2) {
  const rows = manifest.cases.map((entry) => {
    const issues: string[] = []
    const tasks = entry.artifact_tasks
    for (const [kind, task] of Object.entries(tasks)) {
      if (task.target_count !== entry.target_source_ids.length) issues.push(`${kind}:TARGET_COUNT`)
      if (!entry.objectives.some((objective) => objective.observable_behavior === task.behavior)) issues.push(`${kind}:BEHAVIOR`)
    }
    if (entry.objectives.length === 0 || entry.objectives.some((objective) => objective.required_fact_ids.length === 0)) issues.push("EMPTY_OBJECTIVES_OR_FACTS")
    const assessment = tasks.assessment.assessment!
    const total = assessment.tier_1_count + assessment.tier_2_count + assessment.tier_3_count
    if (total < entry.objectives.length || total < assessment.required_modalities.length) issues.push("ASSESSMENT_CAPACITY")
    if (assessment.require_independent_code_item && !assessment.required_modalities.includes("code")) issues.push("CODE_MODALITY_MISSING")
    const lab = tasks.code_lab.lab!
    if (lab.public_test_minimum < 1 || lab.hidden_test_minimum < 1) issues.push("TEST_MINIMUM")
    if (lab.boundary_case_minimum > lab.public_test_minimum + lab.hidden_test_minimum) issues.push("BOUNDARY_CAPACITY")
    return { case_id: entry.case_id, passed: issues.length === 0, issues }
  })
  return { version: "contract-satisfiability.v3", passed: rows.length === 60 && rows.every((row) => row.passed), rows }
}
