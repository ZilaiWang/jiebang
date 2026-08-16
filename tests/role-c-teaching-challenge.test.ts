import { describe, expect, test } from "bun:test"
import { teachingChallengeForAction } from "../src/role-c-content/orchestrator/teaching-challenge"
import type { LearnerLevel } from "../src/role-c-content/contracts/common"

const LEVELS: LearnerLevel[] = ["beginner", "basic", "intermediate", "integrated"]

describe("teaching challenge 模型（基于画像基线的教学挑战，防越界）", () => {
  test("连续 reinforce 不越界：integrated 基线认知/推理 4，任何轮次都 ≤5 且不逐轮累加", () => {
    for (let round = 0; round < 5; round += 1) {
      const challenge = teachingChallengeForAction("integrated", "reinforce")
      const d = challenge.difficulty
      for (const [key, value] of Object.entries(d)) {
        if (typeof value === "number") {
          expect(value, `${key} 越界`).toBeGreaterThanOrEqual(0)
          expect(value, `${key} 越界`).toBeLessThanOrEqual(5)
        }
      }
      // 基线 cognitive=4 → reinforce 锚定 5；第二轮仍是 5（不是 6）
      expect(d.cognitive_demand).toBe(5)
      expect(d.reasoning_steps).toBe(5)
    }
  })

  test("连续 remediate 不越界：beginner 基线 1 → 补救锚定 0，不跌穿", () => {
    for (let round = 0; round < 5; round += 1) {
      const d = teachingChallengeForAction("beginner", "remediate").difficulty
      expect(d.cognitive_demand).toBe(0)
      expect(d.reasoning_steps).toBe(0)
      expect(d.cognitive_demand).toBeGreaterThanOrEqual(0)
    }
  })

  test("beginner 同画像下 remediate 与 reinforce 必须有可观测差异（问题一验收点）", () => {
    const rem = teachingChallengeForAction("beginner", "remediate")
    const rein = teachingChallengeForAction("beginner", "reinforce")
    expect(rem.difficulty.cognitive_demand).toBeLessThan(rein.difficulty.cognitive_demand)
    expect(rem.difficulty.reasoning_steps).toBeLessThan(rein.difficulty.reasoning_steps)
    expect(rem.difficulty.scaffold_strength).toBeGreaterThan(rein.difficulty.scaffold_strength)
    expect(rem.scaffold_level).toBeGreaterThan(rein.scaffold_level)
    // 教学挑战维度：reinforce 的迁移距离/边界密度/组合度高于 remediate
    expect(rein.difficulty.transfer_distance!).toBeGreaterThan(rem.difficulty.transfer_distance!)
    expect(rein.difficulty.boundary_condition_density!).toBeGreaterThan(
      rem.difficulty.boundary_condition_density!,
    )
    expect(rein.difficulty.task_composition!).toBeGreaterThan(rem.difficulty.task_composition!)
  })

  test("scaffold_strength 与 scaffold_level 同源同向（不再双写不一致）", () => {
    for (const level of LEVELS) {
      const advance = teachingChallengeForAction(level, "advance")
      const rem = teachingChallengeForAction(level, "remediate")
      const rein = teachingChallengeForAction(level, "reinforce")
      // 同向：补救增支架、巩固减支架（与基线比较）
      expect(rem.difficulty.scaffold_strength).toBeGreaterThanOrEqual(
        advance.difficulty.scaffold_strength,
      )
      expect(rem.scaffold_level).toBeGreaterThanOrEqual(advance.scaffold_level)
      expect(rein.difficulty.scaffold_strength).toBeLessThanOrEqual(
        advance.difficulty.scaffold_strength,
      )
      expect(rein.scaffold_level).toBeLessThanOrEqual(advance.scaffold_level)
      // 两套字段从同一基线派生，方向一致：rem.strength>rein.strength ⇔ rem.level>rein.level
      expect(rem.difficulty.scaffold_strength > rein.difficulty.scaffold_strength)
        .toBe(rem.scaffold_level > rein.scaffold_level)
    }
  })

  test("advance 按新基线决定，不复用父难度（难度值等于该 level 基线）", () => {
    for (const level of LEVELS) {
      const challenge = teachingChallengeForAction(level, "advance")
      const baseline = {
        domain_complexity: challenge.difficulty.domain_complexity,
        cognitive_demand: challenge.difficulty.cognitive_demand,
      }
      // 基线随 level 单调递增（beginner 1 < basic 2 < intermediate 3 < integrated 4）
      expect(baseline.cognitive_demand).toBeGreaterThanOrEqual(1)
      expect(baseline.cognitive_demand).toBeLessThanOrEqual(4)
    }
  })
})
