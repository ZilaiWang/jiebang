import { adaptationDefaults, type DifficultyVector } from "../contracts/generation-spec"
import type { LearnerLevel } from "../contracts/common"

/**
 * 教学挑战模型（remediate/reinforce 的唯一权威计算入口）。
 *
 * 设计原则（与 GPT 评审对齐）：
 * 1. 画像能力基线（adaptationDefaults(level)）是锚点，绝不逐轮累加：
 *    连续 N 次 reinforce/remediate 只在本轮从基线偏移一次，不会把 integrated
 *    的认知难度从 4 推到 5、6 而越界（GenerationSpec 要求 0..5）。
 * 2. 学习难度 vs 教学挑战分开：
 *    - 学习难度（domain/cognitive/reasoning/code/prerequisite）：知识负荷，
 *      remediate 降、reinforce 同界内略增，clamp 在画像能力区间内。
 *    - 教学挑战（transfer_distance/boundary_condition_density/task_composition）：
 *      同一知识边界内的迁移距离、边界辨析、任务组合；remediate 保持低值
 *      （近迁移、直接修正），reinforce 增加（远迁移、边界、组合）。
 * 3. scaffold_strength 与 learner_adaptation.scaffold_level 同一函数派生，
 *    从基线同向变化，保证双字段永远一致，不再双写。
 *
 * advance 不在这里调整：推进新节点/新画像时难度直接按新基线（adaptationDefaults）
 * 决定，不复用父难度——这是 buildGenerationSpec 的默认行为。
 */

export interface TeachingChallenge {
  difficulty: DifficultyVector
  scaffold_level: 0 | 1 | 2 | 3
  reading_density: "low" | "medium" | "high"
}

export type TeachingChallengeAction = "remediate" | "reinforce" | "advance"

function clamp(value: number, max: number): number {
  return Math.max(0, Math.min(max, value))
}

export function teachingChallengeForAction(
  level: LearnerLevel,
  action: TeachingChallengeAction,
): TeachingChallenge {
  const base = adaptationDefaults(level)
  if (action === "remediate") {
    return {
      difficulty: {
        domain_complexity: base.difficulty.domain_complexity,
        cognitive_demand: clamp(base.difficulty.cognitive_demand - 1, 5),
        reasoning_steps: clamp(base.difficulty.reasoning_steps - 1, 5),
        code_complexity: clamp(base.difficulty.code_complexity - 1, 5),
        prerequisite_load: clamp(base.difficulty.prerequisite_load - 1, 5),
        scaffold_strength: clamp(base.difficulty.scaffold_strength + 1, 5),
        transfer_distance: base.difficulty.transfer_distance ?? 0,
        boundary_condition_density: base.difficulty.boundary_condition_density ?? 0,
        task_composition: base.difficulty.task_composition ?? 0,
      },
      scaffold_level: clamp(base.scaffold_level + 1, 3) as 0 | 1 | 2 | 3,
      reading_density: base.reading_density === "high"
        ? "medium"
        : "low",
    }
  }
  if (action === "reinforce") {
    return {
      difficulty: {
        domain_complexity: base.difficulty.domain_complexity,
        cognitive_demand: clamp(base.difficulty.cognitive_demand + 1, 5),
        reasoning_steps: clamp(base.difficulty.reasoning_steps + 1, 5),
        code_complexity: base.difficulty.code_complexity,
        prerequisite_load: base.difficulty.prerequisite_load,
        scaffold_strength: clamp(base.difficulty.scaffold_strength - 1, 5),
        transfer_distance: clamp((base.difficulty.transfer_distance ?? 0) + 1, 5),
        boundary_condition_density: clamp((base.difficulty.boundary_condition_density ?? 0) + 1, 5),
        task_composition: clamp((base.difficulty.task_composition ?? 0) + 1, 5),
      },
      scaffold_level: clamp(base.scaffold_level - 1, 3) as 0 | 1 | 2 | 3,
      reading_density: base.reading_density,
    }
  }
  // advance：新节点/新画像按新基线，不复用父难度
  return {
    difficulty: { ...base.difficulty },
    scaffold_level: base.scaffold_level,
    reading_density: base.reading_density,
  }
}
