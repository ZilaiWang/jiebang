import { describe, expect, test } from "bun:test"
import {
  applyProfileClarificationAnswer,
  assessProfileIntake,
  buildPersonalizationProfileHandoff,
  createLearnerProfileV2,
  updateLearnerProfileFromAnswers,
  updateLearnerProfileV2,
} from "../src/role-b-profile"
import type {
  LearnerProfile,
  LearnerProfileIntakeV2,
  LearnerProfileV2,
} from "../src/role-b-profile"

const observedAt = "2026-08-28T10:00:00.000Z"

function completeIntake(): LearnerProfileIntakeV2 {
  return {
    learner_id: "learner-001",
    goal: "独立完成一个 Python 数据分析项目",
    background_summary: "经管专业大二学生，学过一门计算机基础课",
    education_stage: "本科二年级",
    discipline_background: ["经济管理"],
    prior_languages: ["Python"],
    prior_topics: ["变量", "条件判断"],
    self_rating: "basic",
    goal_use_case: "competition",
    desired_outcome: "完成挑战杯数据分析原型",
    weekly_time_budget_minutes: 300,
    session_time_budget_minutes: 45,
    explanation_preference: "example_first",
    practice_preference: "project",
    pace_preference: "steady",
    preferred_contexts: ["校园调研", "问卷数据"],
    tool_constraints: ["只能使用个人电脑"],
    accommodations: ["关键步骤提供文字清单"],
    privacy: {
      personalization_enabled: true,
      retention: "cross_session",
      allow_profile_display: true,
    },
  }
}

function coreProfile(): LearnerProfile {
  return {
    learner_id: "learner-001",
    level: "basic",
    known_concepts: ["变量", "条件判断"],
    weak_concepts: ["循环"],
    goal: "独立完成一个 Python 数据分析项目",
    ability_dimensions: [{ label: "programming", value: 0.45 }],
  }
}

function profileV2(): LearnerProfileV2 {
  return createLearnerProfileV2({
    core_profile: coreProfile(),
    intake: completeIntake(),
    observed_at: observedAt,
  })
}

describe("learner profile v2 intake and clarification", () => {
  test("returns at most three high-priority questions and identifies required gaps", () => {
    const result = assessProfileIntake({ learner_id: "learner-001" })

    expect(result.status).toBe("needs_clarification")
    expect(result.missing_required_fields).toEqual([
      "goal",
      "background_context",
      "self_rating",
      "goal_use_case",
      "weekly_time_budget_minutes",
    ])
    expect(result.questions.map((item) => item.id)).toEqual([
      "profile.goal",
      "profile.background",
      "profile.self_rating",
    ])
  })

  test("applies answers immutably and supports finite follow-up rounds", () => {
    const initial: LearnerProfileIntakeV2 = {
      learner_id: "learner-001",
      goal: "学习 Python",
      background_summary: "零基础本科生",
      self_rating: "beginner",
    }
    const withUseCase = applyProfileClarificationAnswer(initial, {
      question_id: "profile.goal_use_case",
      value: "coursework",
    })
    const complete = applyProfileClarificationAnswer(withUseCase, {
      question_id: "profile.weekly_time_budget",
      value: "180",
    })

    expect(initial.goal_use_case).toBeUndefined()
    expect(assessProfileIntake(complete).status).toBe("ready")
    expect(complete.weekly_time_budget_minutes).toBe(180)
  })

  test("rejects an invalid choice instead of silently inventing profile data", () => {
    expect(() => applyProfileClarificationAnswer(
      { learner_id: "learner-001" },
      { question_id: "profile.goal_use_case", value: "随便猜一个" },
    )).toThrow("PROFILE_CLARIFICATION_ANSWER_INVALID:profile.goal_use_case")
  })
})

describe("learner profile v2 lifecycle and handoff", () => {
  test("creates a structured profile and a stable personalization handoff", () => {
    const profile = profileV2()
    const handoff = buildPersonalizationProfileHandoff(profile)

    expect(profile).toMatchObject({
      schema_version: "2.0",
      revision: 1,
      self_assessment: { reported_level: "basic" },
      goal_context: { use_case: "competition" },
      learning_preferences: { explanation: "example_first", practice: "project" },
      privacy: { retention: "cross_session" },
    })
    expect(handoff.learner).toMatchObject({
      level: "basic",
      self_reported_level: "basic",
      weak_concepts: ["循环"],
    })
    expect(handoff.presentation.preferred_contexts).toEqual(["校园调研", "问卷数据"])
    expect(handoff.constraints.weekly_time_budget_minutes).toBe(300)
  })

  test("uses conservative defaults and labels them as system defaults", () => {
    const intake = completeIntake()
    delete intake.explanation_preference
    delete intake.practice_preference
    delete intake.pace_preference
    delete intake.preferred_contexts
    delete intake.privacy

    const profile = createLearnerProfileV2({
      core_profile: coreProfile(),
      intake,
      observed_at: observedAt,
    })

    expect(profile.learning_preferences).toMatchObject({
      explanation: "balanced",
      practice: "mixed",
      pace: "steady",
    })
    expect(profile.privacy.retention).toBe("session_only")
    expect(profile.provenance.field_sources).toContainEqual(expect.objectContaining({
      field: "learning_preferences.explanation",
      source: "system_default",
    }))
    expect(profile.provenance.field_sources).toContainEqual(expect.objectContaining({
      field: "privacy.retention",
      source: "system_default",
    }))
  })

  test("merges later learner answers without resetting diagnosis or unrelated fields", () => {
    const original = profileV2()
    const result = updateLearnerProfileFromAnswers({
      profile: original,
      intake_patch: {
        learner_id: original.learner_id,
        desired_outcome: "完成比赛答辩用的数据故事",
        explanation_preference: "step_by_step",
        weekly_time_budget_minutes: 420,
        privacy: { retention: "session_only" },
      },
      next_profile_version: "PROFILE-learner-001-v2-r2",
      observed_at: "2026-08-28T11:00:00.000Z",
    })

    expect(original.learning_preferences.explanation).toBe("example_first")
    expect(result.profile.known_concepts).toEqual(original.known_concepts)
    expect(result.profile.weak_concepts).toEqual(original.weak_concepts)
    expect(result.profile.learning_preferences.explanation).toBe("step_by_step")
    expect(result.profile.learning_constraints.weekly_time_budget_minutes).toBe(420)
    expect(result.profile.privacy.retention).toBe("session_only")
    expect(result.changed_fields).toEqual([
      "goal_context.desired_outcome",
      "learning_preferences.explanation",
      "learning_constraints.weekly_time_budget_minutes",
      "privacy.retention",
    ])
  })

  test("updates assessed mastery and keeps resource-facing profile context intact", () => {
    const original = profileV2()
    const result = updateLearnerProfileV2({
      profile: original,
      observation: {
        observationId: "feedback-001",
        action: "advance",
        overallAccuracy: 0.9,
        mastery: [{ objectiveId: "OBJ-K007", mastery: 0.9, evidenceBatches: 2 }],
        conceptEvidence: [{
          sourceId: "K007",
          concept: "循环",
          evidenceScore: 0.9,
          evidenceBatches: 2,
        }],
      },
      next_profile_version: "PROFILE-learner-001-v2-r2",
      completed_session_id: "session-001",
      observed_at: "2026-08-28T12:00:00.000Z",
    })

    expect(result.profile.level).toBe("intermediate")
    expect(result.profile.known_concepts).toContain("循环")
    expect(result.profile.weak_concepts).not.toContain("循环")
    expect(result.profile.progress.mastery_by_source_id.K007).toBe(0.9)
    expect(result.profile.progress.completed_session_ids).toContain("session-001")
    expect(result.profile.background_context).toEqual(original.background_context)
    expect(result.role_c_snapshot_options.preferred_contexts).toEqual(["校园调研", "问卷数据"])
    expect(result.changes.knownPromotedFromWeak).toEqual(["循环"])
  })

  test("does not create a profile until required intake is complete", () => {
    expect(() => createLearnerProfileV2({
      core_profile: coreProfile(),
      intake: { learner_id: "learner-001" },
      observed_at: observedAt,
    })).toThrow("PROFILE_INTAKE_INCOMPLETE")
  })

  test("does not expose personalization context after the learner disables it", () => {
    const profile = profileV2()
    profile.privacy.personalization_enabled = false

    expect(() => buildPersonalizationProfileHandoff(profile)).toThrow("PROFILE_PERSONALIZATION_DISABLED")
    expect(updateLearnerProfileFromAnswers({
      profile,
      intake_patch: { learner_id: profile.learner_id },
      next_profile_version: "PROFILE-learner-001-v2-r2",
    }).role_c_snapshot_options).toMatchObject({
      preferred_contexts: [],
      accommodations: [],
    })
  })
})
