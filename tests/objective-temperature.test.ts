import { describe, expect, test } from "bun:test"
import { applyProgressObservation } from "../src/role-b-profile/teaching-audit/progress-receiver"
import type { ProgressObservation } from "../src/role-b-profile/teaching-audit/types"
import type { LearnerProfile } from "../src/role-b-profile/types"

function baseProfile(level: LearnerProfile["level"]): LearnerProfile {
  return {
    learner_id: "t1",
    level,
    known_concepts: ["变量"],
    weak_concepts: [],
    goal: "求职",
    goal_profile: "job_interview",
    ability_dimensions: [
      { label: "概念理解", value: 0.5 },
      { label: "代码认知", value: 0.5 },
      { label: "诊断表现", value: 0.5 },
    ],
  } as LearnerProfile
}

function advanceObservation(accuracy: number): ProgressObservation {
  return {
    observationId: `obs-${Math.random()}`,
    action: "advance",
    overallAccuracy: accuracy,
    mastery: [{ objectiveId: "OBJ-K001", mastery: 0.9, evidenceBatches: 2 }],
    conceptEvidence: [],
  } as ProgressObservation
}

const highTempHistory = [
  { round_no: 1, correct: 3, total: 3 },
  { round_no: 2, correct: 3, total: 3 },
  { round_no: 3, correct: 3, total: 3 },
]

describe("长期观察温度机制（欧阳）", () => {
  test("高温(2)：单轮达标即升级（不看历史）", () => {
    const r = applyProgressObservation({
      observation: advanceObservation(0.9),
      currentProfile: baseProfile("beginner"),
      profileVersion: "v1",
      objective_history: [],
      temperature: 2,
    })
    expect(r.profile.level).toBe("basic")
  })

  test("高温(2)：本轮未达标（remediate）→ 不升级", () => {
    const r = applyProgressObservation({
      observation: { ...advanceObservation(0.9), action: "remediate", overallAccuracy: 0.2 },
      currentProfile: baseProfile("beginner"),
      profileVersion: "v1",
      objective_history: [],
      temperature: 2,
    })
    expect(r.profile.level).toBe("beginner")
  })

  test("中温(1)：需连续 2 轮，历史 0 轮 → 不升级", () => {
    const r = applyProgressObservation({
      observation: advanceObservation(0.9),
      currentProfile: baseProfile("beginner"),
      profileVersion: "v1",
      objective_history: [],
      temperature: 1,
    })
    expect(r.profile.level).toBe("beginner")
  })

  test("中温(1)：历史 2 轮达标（含本轮由主 Agent 追加）→ 升级", () => {
    const r = applyProgressObservation({
      observation: advanceObservation(0.9),
      currentProfile: baseProfile("beginner"),
      profileVersion: "v1",
      objective_history: highTempHistory.slice(0, 2),
      temperature: 1,
    })
    expect(r.profile.level).toBe("basic")
  })

  test("低温(0)：历史 1 轮 → 不升级", () => {
    const r = applyProgressObservation({
      observation: advanceObservation(0.9),
      currentProfile: baseProfile("beginner"),
      profileVersion: "v1",
      objective_history: highTempHistory.slice(0, 1),
      temperature: 0,
    })
    expect(r.profile.level).toBe("beginner")
  })

  test("低温(0)：历史 3 轮全达标 → 升级", () => {
    const r = applyProgressObservation({
      observation: advanceObservation(0.9),
      currentProfile: baseProfile("beginner"),
      profileVersion: "v1",
      objective_history: highTempHistory,
      temperature: 0,
    })
    expect(r.profile.level).toBe("basic")
  })

  test("答错封顶不受温度影响（低温答错也降级）", () => {
    const r = applyProgressObservation({
      observation: { ...advanceObservation(0.2), action: "remediate", overallAccuracy: 0.2 },
      currentProfile: baseProfile("basic"),
      profileVersion: "v1",
      objective_history: highTempHistory,
      temperature: 0,
    })
    expect(r.profile.level).toBe("beginner")
  })
})
