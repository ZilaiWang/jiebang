import { describe, expect, test } from "bun:test"
import { buildPersonalizationPolicy } from "../src/role-c-content/planning/personalization-policy"

test("learning barriers strengthen the matching teaching support", () => {
  const policy = buildPersonalizationPolicy({
    path_id: "path-1",
    goal_profile: "coursework",
    learner_level: "basic",
    progress_state: "stable",
    known_objective_count: 1,
    weak_objective_count: 1,
    learning_barriers: [{ source_id: "DS-1", barrier: "code_translation", count: 3 }],
  })
  expect(policy.teaching_strategy.scaffold_level).toBe(3)
  expect(policy.teaching_strategy.explanation_depth).toBe("standard")
  expect(policy.reasons).toContain("barrier=code_translation")
})
