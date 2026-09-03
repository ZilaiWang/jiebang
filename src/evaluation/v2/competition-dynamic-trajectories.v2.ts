import {
  COMPETITION_CASES_V2,
  COMPETITION_CASES_V2_BY_ID,
} from "./competition-cases.v2"

/** Dynamic definitions derive from the frozen case catalog. */
export const COMPETITION_DYNAMIC_TRAJECTORIES_V2 = COMPETITION_CASES_V2.flatMap(
  (c) =>
    c.dynamic_trajectory
      ? [{ case_id: c.case_id, ...c.dynamic_trajectory }]
      : [],
)
export function assertDynamicTrajectoryCatalogV2(): void {
  if (COMPETITION_DYNAMIC_TRAJECTORIES_V2.length !== 12)
    throw new Error("DYNAMIC_TRAJECTORY_COUNT")
  const counts = new Map<string, number>()
  for (const t of COMPETITION_DYNAMIC_TRAJECTORIES_V2) {
    if (!COMPETITION_CASES_V2_BY_ID.has(t.case_id))
      throw new Error(`UNKNOWN_DYNAMIC_CASE:${t.case_id}`)
    counts.set(t.expected_action, (counts.get(t.expected_action) ?? 0) + 1)
    if (!t.follow_up_excluded_from_main_metrics)
      throw new Error(`DYNAMIC_METRIC_LEAK:${t.case_id}`)
  }
  for (const [a, n] of Object.entries({
    remediate: 3,
    reinforce: 3,
    advance: 4,
    reprofile: 2,
  }))
    if (counts.get(a) !== n) throw new Error(`DYNAMIC_ACTION_DISTRIBUTION:${a}`)
}
export interface DynamicTrajectoryResultV2 {
  case_id: string
  expected_action: "remediate" | "reinforce" | "advance" | "reprofile"
  actual_action?: "remediate" | "reinforce" | "advance" | "reprofile"
  same_node_when_required: boolean
  next_node_when_required: boolean
  profile_version_transition_valid: boolean
  target_fact_boundary_preserved: boolean
  assessment_novelty_passed: boolean
  follow_up_published: boolean
}
export function computeDynamicTrajectoryMetricsV2(
  results: DynamicTrajectoryResultV2[],
) {
  const catalog = new Map<
    string,
    (typeof COMPETITION_DYNAMIC_TRAJECTORIES_V2)[number]
  >(COMPETITION_DYNAMIC_TRAJECTORIES_V2.map((t) => [t.case_id, t]))
  const seen = new Set<string>()
  for (const row of results) {
    const expected = catalog.get(row.case_id)
    if (
      !expected ||
      seen.has(row.case_id) ||
      row.expected_action !== expected.expected_action
    )
      throw new Error("DYNAMIC_RESULT_IDENTITY_MISMATCH")
    seen.add(row.case_id)
  }
  const ratio = (n: number) => n / COMPETITION_DYNAMIC_TRAJECTORIES_V2.length
  return {
    total: 12,
    recorded: results.length,
    missing: 12 - results.length,
    action_accuracy: ratio(
      results.filter((x) => x.actual_action === x.expected_action).length,
    ),
    path_transition_accuracy: ratio(
      results.filter(
        (x) => x.same_node_when_required && x.next_node_when_required,
      ).length,
    ),
    profile_transition_accuracy: ratio(
      results.filter((x) => x.profile_version_transition_valid).length,
    ),
    fact_boundary_preservation: ratio(
      results.filter((x) => x.target_fact_boundary_preserved).length,
    ),
    assessment_novelty_rate: ratio(
      results.filter((x) => x.assessment_novelty_passed).length,
    ),
    follow_up_publication_rate: ratio(
      results.filter((x) => x.follow_up_published).length,
    ),
  }
}
