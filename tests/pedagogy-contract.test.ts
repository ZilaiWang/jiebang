import { describe, expect, test } from "bun:test"
import { buildRoleCPedagogyContract } from "../src/role-b-profile/pedagogy-contract"
import type { LearnerProfileV2 } from "../src/role-b-profile/learner-profile-v2"

function profile(overrides: Partial<LearnerProfileV2> = {}): LearnerProfileV2 {
  const base: LearnerProfileV2 = {
    schema_version: "2.0",
    profile_id: "PROFILE-1",
    profile_version: "PROFILE-1-v2-r1",
    revision: 1,
    learner_id: "learner-1",
    level: "basic",
    known_concepts: ["变量"],
    weak_concepts: ["循环"],
    goal: "学习循环",
    ability_dimensions: [],
    background_context: {
      summary: "零基础转专业学习者",
      education_stage: "本科",
      discipline_background: ["人文"],
      role_context: null,
      prior_languages: [],
      prior_topics: [],
    },
    goal_context: {
      use_case: "coursework",
      desired_outcome: "独立完成课程作业",
      deadline: null,
    },
    self_assessment: { reported_level: "basic" },
    learning_preferences: {
      explanation: "balanced",
      practice: "mixed",
      pace: "steady",
      preferred_contexts: [],
    },
    learning_constraints: {
      weekly_time_budget_minutes: 180,
      session_time_budget_minutes: 30,
      tool_constraints: [],
      accommodations: [],
    },
    progress: {
      mastery_by_source_id: { K001: 0.8, K007: 0.35 },
      completed_session_ids: [],
      recent_error_patterns: [],
      last_observation_id: null,
      last_observed_at: null,
      last_assessment_accuracy: null,
    },
    privacy: {
      personalization_enabled: true,
      retention: "session_only",
      allow_profile_display: true,
    },
    provenance: { field_sources: [] },
    created_at: "2026-08-28T00:00:00.000Z",
    updated_at: "2026-08-28T00:00:00.000Z",
  }
  return { ...base, ...overrides }
}

describe("Role B -> Role C pedagogy contract", () => {
  test("competition goal changes task shape, not locked core", () => {
    const contract = buildRoleCPedagogyContract(profile({
      goal_context: { use_case: "competition", desired_outcome: "独立完成算法题", deadline: null },
      learning_preferences: {
        explanation: "example_first",
        practice: "coding",
        pace: "steady",
        preferred_contexts: ["蓝桥杯"],
      },
    }))

    expect(contract.locked_core).toEqual({
      preserve_facts: true,
      preserve_objectives: true,
      preserve_answers: true,
      preserve_scoring: true,
      preserve_safety: true,
    })
    expect(contract.lesson.opening).toBe("example_then_rule")
    expect(contract.practice.shape).toBe("guided_coding")
    expect(contract.practice.require_troubleshooting).toBe(true)
    expect(contract.assessment.preferred_modalities).toContain("code")
    expect(contract.lesson.visible_contexts).toContain("蓝桥杯")
  })

  test("level controls scaffolding while discipline background does not", () => {
    const humanities = buildRoleCPedagogyContract(profile({
      level: "beginner",
      background_context: {
        summary: "文科背景",
        education_stage: "本科",
        discipline_background: ["人文"],
        role_context: null,
        prior_languages: [],
        prior_topics: [],
      },
    }))
    const engineering = buildRoleCPedagogyContract(profile({
      level: "beginner",
      background_context: {
        summary: "工科背景",
        education_stage: "本科",
        discipline_background: ["工科"],
        role_context: null,
        prior_languages: [],
        prior_topics: [],
      },
    }))
    expect(humanities.lesson.scaffold_strength).toBe(engineering.lesson.scaffold_strength)
    expect(humanities.lesson.terminology_density).toBe(engineering.lesson.terminology_density)
  })

  test("privacy opt-out removes personalized contexts", () => {
    const contract = buildRoleCPedagogyContract(profile({
      privacy: {
        personalization_enabled: false,
        retention: "session_only",
        allow_profile_display: false,
      },
      learning_preferences: {
        explanation: "example_first",
        practice: "project",
        pace: "slow",
        preferred_contexts: ["个人敏感场景"],
      },
    }))
    expect(contract.lesson.visible_contexts).toEqual([])
    expect(contract.practice.shape).toBe("mixed")
    expect(contract.rationale[0]).toContain("关闭了个性化")
  })
})
