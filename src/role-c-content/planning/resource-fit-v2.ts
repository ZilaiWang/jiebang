/**
 * Resource Fit v2（改进方案5 第四节）。
 *
 * v1 的核心缺陷：把所有维度（含"0 vs 0"的不适用维度）都当作完美匹配计分，
 * 用均值稀释真正偏差，导致 score 结构性固定在 ~94；Assessment 的 target/observed
 * 都由 Tier 数量决定，形成自证循环。
 *
 * v2 的算法核心：
 *  - 每个维度标记 applicable；不适用维度不参与计分；
 *  - 每个维度有 weight 与 tolerance，penalty = (gap/tolerance)² × weight；
 *  - overall 用加权平均 + weakest 上限，防止某一资源被另两个资源掩盖。
 */

export interface FitDimensionMeasurement {
  name: string
  family: "challenge" | "support"
  target: number
  observed: number
  applicable: boolean
  weight: number
  tolerance: number
  direction: "higher_is_harder" | "higher_is_more_supportive"
  basis: Array<{ feature: string; value: number | string; source_ref?: string }>
}

/** 只统计 applicable 维度，penalty = (gap/tolerance)² × weight。 */
export function computeWeightedFit(dimensions: FitDimensionMeasurement[]): number {
  const active = dimensions.filter((item) => item.applicable)
  const totalWeight = active.reduce((sum, item) => sum + item.weight, 0)
  // 没有可观测维度时不能自证为满分；调用方应显示“未判定”。
  if (totalWeight === 0) return 0
  const weightedPenalty = active.reduce((sum, item) => {
    const normalizedGap = Math.abs(item.observed - item.target) / item.tolerance
    const penalty = Math.min(1, normalizedGap ** 2)
    return sum + penalty * item.weight
  }, 0)
  return Math.max(0, 1 - weightedPenalty / totalWeight)
}

/** overall 加权 + weakest 上限，防止明显偏难的资源被另两个资源掩盖。 */
export function overallFitScoreV2(scores: { lesson: number; lab: number; assessment: number }): number {
  const weightedMean =
    scores.lesson * 0.30
    + scores.lab * 0.35
    + scores.assessment * 0.35
  const weakest = Math.min(scores.lesson, scores.lab, scores.assessment)
  return Math.round(Math.min(weightedMean, weakest + 0.08) * 1000) / 1000
}
