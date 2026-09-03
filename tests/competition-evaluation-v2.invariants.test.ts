import { describe, expect, test } from "bun:test"
import { COMPETITION_CASES_V2 } from "../src/evaluation/v2/competition-cases.v2"
import { COMPETITION_PROFILE_FIXTURES_V2 } from "../src/evaluation/v2/competition-profiles.v2"
import { COMPETITION_DYNAMIC_TRAJECTORIES_V2 } from "../src/evaluation/v2/competition-dynamic-trajectories.v2"
const countBy = <T>(v: T[]) => {
  const m = new Map<T, number>()
  for (const x of v) m.set(x, (m.get(x) ?? 0) + 1)
  return m
}
describe("competition evaluation v2 catalog invariants", () => {
  test("60 unique cases and six V2 profiles", () => {
    expect(COMPETITION_CASES_V2).toHaveLength(60)
    expect(new Set(COMPETITION_CASES_V2.map((x) => x.case_id)).size).toBe(60)
    expect(Object.keys(COMPETITION_PROFILE_FIXTURES_V2)).toHaveLength(6)
    expect(
      Object.values(COMPETITION_PROFILE_FIXTURES_V2).every(
        (p) => p.schema_version === "2.0",
      ),
    ).toBeTrue()
    expect(
      Object.fromEntries(
        countBy(COMPETITION_CASES_V2.map((x) => x.profile_fixture_id)),
      ),
    ).toEqual({ P01: 10, P02: 10, P03: 10, P04: 10, P05: 10, P06: 10 })
  })
  test("behavior and difficulty distribution", () => {
    expect(
      Object.fromEntries(
        countBy(
          COMPETITION_CASES_V2.map((x) => x.objectives[0]!.observable_behavior),
        ),
      ),
    ).toEqual({ explain: 12, apply: 22, trace: 10, debug: 8, create: 8 })
    expect(
      Object.fromEntries(
        countBy(
          COMPETITION_CASES_V2.flatMap((x) => [
            x.artifact_plan.lesson.expected_difficulty,
            x.artifact_plan.lab.expected_difficulty,
            x.artifact_plan.assessment.expected_difficulty,
          ]),
        ),
      ),
    ).toEqual({ beginner: 36, basic: 76, intermediate: 52, integrated: 16 })
  })
  test("K001-K018 each have two single target cases", () => {
    expect(
      COMPETITION_CASES_V2.filter((c) => c.target_source_ids.length === 1),
    ).toHaveLength(40)
    expect(
      COMPETITION_CASES_V2.filter((c) => c.target_source_ids.length > 1),
    ).toHaveLength(20)
    const s = countBy(
      COMPETITION_CASES_V2.filter((x) => x.target_source_ids.length === 1).map(
        (x) => x.target_source_ids[0]!,
      ),
    )
    for (let i = 1; i <= 18; i++)
      expect(
        s.get(`K${String(i).padStart(3, "0")}`) ?? 0,
      ).toBeGreaterThanOrEqual(2)
  })
  test("18 counterfactual pairs", () => {
    const g = countBy(
      COMPETITION_CASES_V2.flatMap((x) =>
        x.counterfactual_group_id ? [x.counterfactual_group_id] : [],
      ),
    )
    expect(g.size).toBe(18)
    expect([...g.values()].every((n) => n === 2)).toBeTrue()
  })
  test("five or more assessment items", () => {
    for (const c of COMPETITION_CASES_V2) {
      const b = c.artifact_plan.assessment.blueprint
      expect(
        b.tier_1_count + b.tier_2_count + b.tier_3_count,
      ).toBeGreaterThanOrEqual(5)
    }
  })
  test("balanced styles/review focus and isolated dynamics", () => {
    expect(
      [
        ...countBy(COMPETITION_CASES_V2.map((x) => x.query.style)).values(),
      ].every((n) => n === 10),
    ).toBeTrue()
    expect(
      Object.fromEntries(
        countBy(COMPETITION_CASES_V2.map((x) => x.manual_review_focus)),
      ),
    ).toEqual({ lesson: 20, lab: 20, assessment: 20 })
    expect(COMPETITION_DYNAMIC_TRAJECTORIES_V2).toHaveLength(12)
    expect(
      Object.fromEntries(
        countBy(
          COMPETITION_DYNAMIC_TRAJECTORIES_V2.map((x) => x.expected_action),
        ),
      ),
    ).toEqual({ reinforce: 3, advance: 4, remediate: 3, reprofile: 2 })
    expect(
      COMPETITION_DYNAMIC_TRAJECTORIES_V2.every(
        (x) => x.follow_up_excluded_from_main_metrics,
      ),
    ).toBeTrue()
  })
})
