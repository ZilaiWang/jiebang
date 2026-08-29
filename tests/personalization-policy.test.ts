import { describe, expect, test } from "bun:test"
import {
  buildPersonalizationPolicy,
  type PersonalizationInput,
} from "../src/role-c-content/planning/personalization-policy"

function input(overrides: Partial<PersonalizationInput> = {}): PersonalizationInput {
  return {
    path_id: "PATH-1",
    goal_profile: "coursework",
    learner_level: "basic",
    progress_state: "building",
    known_objective_count: 0,
    weak_objective_count: 1,
    ...overrides,
  }
}

describe("personalization policy", () => {
  test("coursework favors textbook-oriented guided learning", () => {
    const policy = buildPersonalizationPolicy(input({ goal_profile: "coursework" }))

    expect(policy.goal_profile).toBe("coursework")
    expect(policy.teaching_strategy.practice_mode).toBe("guided_application")
    expect(policy.teaching_strategy.example_style).toBe("textbook_context")
    expect(policy.teaching_strategy.explanation_depth).toBe("standard")
  })

  test("algorithm competition favors deep technical and coding practice", () => {
    const policy = buildPersonalizationPolicy(input({
      goal_profile: "algorithm_competition",
      learner_level: "intermediate",
      progress_state: "stable",
    }))

    expect(policy.teaching_strategy.explanation_depth).toBe("deep")
    expect(policy.teaching_strategy.practice_mode).toBe("integrated_practice")
    expect(policy.teaching_strategy.example_style).toBe("technical_context")
    expect(policy.teaching_strategy.challenge_ratio).toBeGreaterThan(policy.teaching_strategy.review_ratio)
  })

  test("job interview favors practical integrated scenarios", () => {
    const policy = buildPersonalizationPolicy(input({ goal_profile: "job_interview" }))

    expect(policy.teaching_strategy.example_style).toBe("workplace_context")
    expect(policy.teaching_strategy.practice_mode).toBe("project_practice")
  })

  test("mastered progress compresses review and adds challenge", () => {
    const policy = buildPersonalizationPolicy(input({
      learner_level: "intermediate",
      progress_state: "mastered",
      known_objective_count: 2,
      weak_objective_count: 0,
    }))

    expect(policy.teaching_strategy.review_ratio).toBeLessThan(0.3)
    expect(policy.teaching_strategy.challenge_ratio).toBeGreaterThan(0.5)
    expect(policy.teaching_strategy.scaffold_level).toBeLessThanOrEqual(1)
  })

  test("struggling progress increases reteaching and scaffolding", () => {
    const policy = buildPersonalizationPolicy(input({
      learner_level: "basic",
      progress_state: "struggling",
      weak_objective_count: 2,
    }))

    expect(policy.teaching_strategy.explanation_depth).toBe("introductory")
    expect(policy.teaching_strategy.practice_mode).toBe("guided_application")
    expect(policy.teaching_strategy.scaffold_level).toBe(3)
    expect(policy.teaching_strategy.review_ratio).toBeGreaterThanOrEqual(0.4)
  })

  test("goal and progress policy never changes learner level", () => {
    const policy = buildPersonalizationPolicy(input({
      goal_profile: "algorithm_competition",
      learner_level: "beginner",
      progress_state: "mastered",
    }))

    expect(policy.learner_level).toBe("beginner")
  })
})
