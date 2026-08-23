import { describe, expect, test } from "bun:test"
import {
  computeWeightedFit,
  overallFitScoreV2,
} from "../src/role-c-content/planning/resource-fit-v2"
import type { FitDimensionMeasurement } from "../src/role-c-content/planning/resource-fit-v2"

function dim(overrides: Partial<FitDimensionMeasurement>): FitDimensionMeasurement {
  return {
    name: "d",
    family: "challenge",
    target: 1,
    observed: 1,
    applicable: true,
    weight: 1,
    tolerance: 2,
    direction: "higher_is_harder",
    basis: [],
    ...overrides,
  }
}

describe("改进方案5 第四节：Resource Fit v2 加权适配指数", () => {
  test("没有任何可观测维度时返回 0，不把未知误报为满分", () => {
    expect(computeWeightedFit([])).toBe(0)
  })

  test("不适用维度（0 vs 0）不参与计分，不稀释真实偏差", () => {
    // 一个维度明显失配（gap=4），一个维度不适用（0 vs 0）
    const fit = computeWeightedFit([
      dim({ name: "reasoning", target: 1, observed: 5 }), // 明显失配
      dim({ name: "starter", target: 0, observed: 0, applicable: false }), // 不适用
    ])
    // 只有 reasoning 参与：gap=4, tolerance=2 → (4/2)²=4 → min(1,4)=1 → score=0
    expect(fit).toBe(0)
  })

  test("gap 与 tolerance 的平方惩罚：轻微 gap 小扣，大 gap 大扣", () => {
    const small = computeWeightedFit([dim({ target: 1, observed: 2 })]) // gap=1
    const big = computeWeightedFit([dim({ target: 1, observed: 4 })]) // gap=3
    // gap=1 → (1/2)²=0.25 → 0.75；gap=3 → (3/2)²=2.25→min1 → 0
    expect(small).toBe(0.75)
    expect(big).toBe(0)
  })

  test("weight 更高的维度失配影响更大", () => {
    const a = computeWeightedFit([
      dim({ name: "a", weight: 3, target: 1, observed: 5 }),
      dim({ name: "b", weight: 1, target: 1, observed: 1 }),
    ])
    // penalty = 1*3 / (3+1) = 0.75 → score 0.25
    expect(a).toBe(0.25)
  })

  test("overall 加权 + weakest 上限：实验 55 分不被 100 分讲义/测评掩盖", () => {
    const overall = overallFitScoreV2({ lesson: 1.0, lab: 0.55, assessment: 1.0 })
    // weightedMean = 0.3*1 + 0.35*0.55 + 0.35*1 = 0.3 + 0.1925 + 0.35 = 0.8425
    // weakest = 0.55 → min(0.8425, 0.63) = 0.63
    expect(overall).toBe(0.63)
  })

  test("overall 三资源都高时不压分", () => {
    const overall = overallFitScoreV2({ lesson: 0.95, lab: 0.9, assessment: 0.92 })
    const weightedMean = 0.3 * 0.95 + 0.35 * 0.9 + 0.35 * 0.92
    expect(overall).toBe(Math.round(Math.min(weightedMean, 0.9 + 0.08) * 1000) / 1000)
  })
})
