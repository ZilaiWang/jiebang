import { describe, expect, test } from "bun:test"
import {
  applyProfileConfidenceAnswer,
  buildProfileConfidenceState,
  planNextProfileQuestion,
  type ProfileConfidenceEvidence,
} from "../src/role-b-profile/profile-confidence"

const evidence: ProfileConfidenceEvidence = {
  has_explicit_goal: true,
  has_goal_profile: true,
  self_rating_present: true,
  objective_answered_count: 3,
  objective_consistency: 0.9,
  known_concept_count: 2,
  weak_concept_count: 1,
  barrier_observation_count: 0,
  task_ability_observation_count: 0,
  explanation_preference_confirmed: false,
  practice_preference_confirmed: false,
}

describe("profile confidence driven questioning", () => {
  test("builds field-level confidence from evidence strength", () => {
    const state = buildProfileConfidenceState(evidence)
    expect(state.fields.goal.confidence).toBeGreaterThanOrEqual(0.9)
    expect(state.fields.level.confidence).toBeGreaterThan(state.fields.task_ability.confidence)
    expect(state.fields.learning_barrier.confidence).toBeLessThan(0.6)
  })

  test("asks the highest-impact uncertain dimension only", () => {
    const state = buildProfileConfidenceState(evidence)
    const question = planNextProfileQuestion(state)
    expect(question).not.toBeNull()
    expect(question?.dimension).toBe("task_ability")
    expect(question?.priority_score).toBeGreaterThan(0)
  })

  test("answer raises confidence and advances to the next gap until threshold", () => {
    const initial = buildProfileConfidenceState(evidence)
    const first = planNextProfileQuestion(initial)!
    const updated = applyProfileConfidenceAnswer(initial, {
      question_id: first.question_id,
      dimension: first.dimension,
      answer: "我能独立看懂代码，但综合题需要提示",
    })
    expect(updated.fields.task_ability.confidence).toBeGreaterThan(initial.fields.task_ability.confidence)
    expect(updated.answered_question_ids).toContain(first.question_id)
    expect(planNextProfileQuestion(updated)?.dimension).not.toBe("task_ability")
  })
})
