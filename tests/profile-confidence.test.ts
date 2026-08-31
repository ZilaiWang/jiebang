import { describe, expect, test } from "bun:test"
import {
  applyProfileConfidenceAnswer,
  applyProfileConfidenceAnswerWithWriteback,
  buildProfileConfidenceState,
  planNextProfileQuestion,
  type ProfileConfidenceEvidence,
} from "../src/role-b-profile/profile-confidence"
import type { LearnerProfileV2 } from "../src/role-b-profile/learner-profile-v2"

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

  test("semantic writeback updates an explicit preference without changing objective level", () => {
    const profile = {
      schema_version: "2.0",
      profile_id: "PROFILE-1",
      profile_version: "PROFILE-1-v2-r1",
      revision: 1,
      learner_id: "learner-1",
      level: "basic",
      known_concepts: [],
      weak_concepts: ["循环"],
      goal: "学习循环",
      background_context: { summary: null, education_stage: null, discipline_background: [], role_context: null, prior_languages: [], prior_topics: [] },
      goal_context: { use_case: "coursework", desired_outcome: null, deadline: null },
      self_assessment: { reported_level: "basic" },
      learning_preferences: { explanation: "balanced", practice: "mixed", pace: "steady", preferred_contexts: [] },
      learning_constraints: { weekly_time_budget_minutes: 120, session_time_budget_minutes: 30, tool_constraints: [], accommodations: [] },
      progress: { mastery_by_source_id: {}, completed_session_ids: [], recent_error_patterns: [], last_observation_id: null, last_observed_at: null, last_assessment_accuracy: null },
      privacy: { personalization_enabled: true, retention: "session_only", allow_profile_display: true },
      provenance: { field_sources: [] },
      created_at: "2026-08-31T00:00:00.000Z",
      updated_at: "2026-08-31T00:00:00.000Z",
    } satisfies LearnerProfileV2
    const state = buildProfileConfidenceState(evidence)
    const result = applyProfileConfidenceAnswerWithWriteback({
      profile,
      state,
      question_id: "PROFILE-CONFIDENCE-explanation_preference",
      dimension: "explanation_preference",
      answer: "先讲原理",
      next_profile_version: "PROFILE-1-v2-r2",
      observed_at: "2026-08-31T01:00:00.000Z",
    })
    expect(result.profile.learning_preferences.explanation).toBe("principle_first")
    expect(result.observation_value).toBe("principle_first")
    expect(result.profile.level).toBe("basic")
    expect(result.profile.revision).toBe(2)
  })

  test("goal, self assessment and barriers write back to their owned fields", () => {
    const profile = {
      schema_version: "2.0",
      profile_id: "PROFILE-2",
      profile_version: "PROFILE-2-v2-r1",
      revision: 1,
      learner_id: "learner-2",
      level: "basic",
      known_concepts: [],
      weak_concepts: ["循环"],
      goal: "学习循环",
      background_context: { summary: null, education_stage: null, discipline_background: [], role_context: null, prior_languages: [], prior_topics: [] },
      goal_context: { use_case: "interest", desired_outcome: null, deadline: null },
      self_assessment: { reported_level: "beginner" },
      learning_preferences: { explanation: "balanced", practice: "mixed", pace: "steady", preferred_contexts: [] },
      learning_constraints: { weekly_time_budget_minutes: 120, session_time_budget_minutes: 30, tool_constraints: [], accommodations: [] },
      progress: { mastery_by_source_id: {}, completed_session_ids: [], recent_error_patterns: [], last_observation_id: null, last_observed_at: null, last_assessment_accuracy: null },
      privacy: { personalization_enabled: true, retention: "session_only", allow_profile_display: true },
      provenance: { field_sources: [] },
      created_at: "2026-08-31T00:00:00.000Z",
      updated_at: "2026-08-31T00:00:00.000Z",
    } satisfies LearnerProfileV2
    const state = buildProfileConfidenceState(evidence)
    const goal = applyProfileConfidenceAnswerWithWriteback({
      profile,
      state,
      question_id: "PROFILE-CONFIDENCE-goal_profile",
      dimension: "goal_profile",
      answer: "准备算法竞赛",
      next_profile_version: "PROFILE-2-v2-r2",
      observed_at: "2026-08-31T01:00:00.000Z",
    })
    expect(goal.profile.goal_profile).toBe("algorithm_competition")
    expect(goal.profile.goal_context.use_case).toBe("competition")

    const level = applyProfileConfidenceAnswerWithWriteback({
      profile: goal.profile,
      state: goal.confidence_state,
      question_id: "PROFILE-CONFIDENCE-level",
      dimension: "level",
      answer: "我能独立完成简单变式",
      next_profile_version: "PROFILE-2-v2-r3",
      observed_at: "2026-08-31T02:00:00.000Z",
    })
    expect(level.profile.self_assessment.reported_level).toBe("intermediate")
    expect(level.profile.level).toBe("basic")

    const barrier = applyProfileConfidenceAnswerWithWriteback({
      profile: level.profile,
      state: level.confidence_state,
      question_id: "PROFILE-CONFIDENCE-learning_barrier",
      dimension: "learning_barrier",
      answer: "我经常看不懂题目输入输出",
      source_id: "K007",
      next_profile_version: "PROFILE-2-v2-r4",
      observed_at: "2026-08-31T03:00:00.000Z",
    })
    expect(barrier.profile.learning_barriers).toEqual([
      { source_id: "K007", barrier: "problem_understanding", count: 1 },
    ])
    expect(barrier.profile.revision).toBe(4)
  })
})
