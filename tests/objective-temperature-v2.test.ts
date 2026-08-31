import { describe, expect, test } from "bun:test"
import { updateLearnerProfileV2, createLearnerProfileV2 } from "../src/role-b-profile/learner-profile-v2"
import type { LearnerProfile } from "../src/role-b-profile/types"
import type { LearnerProfileV2, LearnerProfileIntakeV2 } from "../src/role-b-profile/learner-profile-v2"
import type { ProgressObservation } from "../src/role-b-profile/teaching-audit/types"

function completeIntake(): LearnerProfileIntakeV2 {
  return {
    learner_id: "learner-001",
    goal: "独立完成一个 Python 数据分析项目",
    background_summary: "计算机专业本科生，学过 C 语言",
    education_stage: "本科",
    role_context: "学生",
    discipline_background: ["计算机"],
    prior_languages: ["C"],
    prior_topics: ["变量", "条件判断"],
    self_rating: "basic",
    goal_use_case: "coursework",
    desired_outcome: "完成成绩统计程序",
    weekly_time_budget_minutes: 300,
    session_time_budget_minutes: 45,
    explanation_preference: "example_first",
    practice_preference: "project",
    pace_preference: "steady",
    preferred_contexts: ["校园调研"],
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
    level: "beginner",
    known_concepts: ["变量"],
    weak_concepts: ["循环"],
    goal: "独立完成一个 Python 数据分析项目",
    ability_dimensions: [{ label: "programming", value: 0.45 }],
  }
}

// 模拟主 Agent 完整链路：测评 → 追加 history → updateLearnerProfileV2（生产 v2 路径）
function baseV2Profile(): LearnerProfileV2 {
  return createLearnerProfileV2({
    core_profile: coreProfile(),
    intake: completeIntake(),
  })
}

function advanceObservation(): ProgressObservation {
  return {
    observationId: `obs-${Math.random()}`,
    action: "advance",
    overallAccuracy: 0.9,
    mastery: [{ objectiveId: "OBJ-K001", mastery: 0.9, evidenceBatches: 2 }],
    conceptEvidence: [],
  } as ProgressObservation
}

describe("生产链路：温度真实影响 v2 画像等级（欧阳）", () => {
  test("高温：单轮达标即升级（不看历史）", () => {
    const profile = baseV2Profile()
    const r = updateLearnerProfileV2({
      profile,
      observation: advanceObservation(),
      next_profile_version: "v2-2",
      objective_history: [], // 高温不依赖历史
      temperature: 2,
    })
    expect(r.profile.level).toBe("basic")
  })

  test("中温：只有 1 轮达标（还差 1 轮）→ 保持 beginner", () => {
    const profile = baseV2Profile()
    const history = [{ round_no: 1, correct: 5, total: 5 }]
    const r = updateLearnerProfileV2({
      profile,
      observation: advanceObservation(),
      next_profile_version: "v2-2",
      objective_history: history,
      temperature: 1,
    })
    expect(r.profile.level).toBe("beginner")
  })

  test("中温：2 轮连续达标 → 升级 basic", () => {
    const profile = baseV2Profile()
    const history = [
      { round_no: 1, correct: 5, total: 5 },
      { round_no: 2, correct: 4, total: 5 }, // 本轮主 Agent 追加（4/5 未全对 → 不算达标）
    ]
    const r = updateLearnerProfileV2({
      profile,
      observation: advanceObservation(),
      next_profile_version: "v2-2",
      objective_history: history,
      temperature: 1,
    })
    // 第 2 轮 4/5 未全对，不达标 → 只有 1 轮达标 → 不升级
    expect(r.profile.level).toBe("beginner")
  })

  test("低温：3 轮连续达标 → 升级；2 轮 → 不升级", () => {
    const p1 = baseV2Profile()
    const r1 = updateLearnerProfileV2({
      profile: p1,
      observation: advanceObservation(),
      next_profile_version: "v2-2",
      objective_history: [
        { round_no: 1, correct: 5, total: 5 },
        { round_no: 2, correct: 5, total: 5 },
      ],
      temperature: 0,
    })
    expect(r1.profile.level).toBe("beginner") // 2 轮 < 3 轮

    const p2 = baseV2Profile()
    const r2 = updateLearnerProfileV2({
      profile: p2,
      observation: advanceObservation(),
      next_profile_version: "v2-2",
      objective_history: [
        { round_no: 1, correct: 5, total: 5 },
        { round_no: 2, correct: 5, total: 5 },
        { round_no: 3, correct: 5, total: 5 },
      ],
      temperature: 0,
    })
    expect(r2.profile.level).toBe("basic") // 3 轮达标
  })

  test("答错封顶：温度不影响降级", () => {
    const profile = baseV2Profile()
    profile.level = "basic"
    const r = updateLearnerProfileV2({
      profile,
      observation: { ...advanceObservation(), action: "remediate", overallAccuracy: 0.2 },
      next_profile_version: "v2-2",
      objective_history: [
        { round_no: 1, correct: 5, total: 5 },
        { round_no: 2, correct: 5, total: 5 },
        { round_no: 3, correct: 5, total: 5 },
      ],
      temperature: 0,
    })
    expect(r.profile.level).toBe("beginner") // 答错仍降级
  })
})
