import type { KnowledgeDifficulty } from "../../knowledge/types"
import type { ObservableBehavior } from "../contracts/profile-adapter"

/**
 * 画像等级 → 默认可观察行为基线（改进方案6 第三节）。
 *
 * 老逻辑只用目标文本里的动词正则判断 observable_behavior，导致"学习 Python 列表"
 * "掌握机器学习基础"这类泛化目标全部落到 recognize，随后测评题型偏向识别/选择，
 * observed difficulty 只有 1~2，与 intermediate 画像的 target=3 严重错配。
 *
 * 这里引入等级基线：泛化目标（没有明确动作动词）按画像等级兜底——
 * intermediate 学泛化目标应至少 apply，而不是 recognize。
 */
export const LEVEL_BEHAVIOR_BASELINE: Record<KnowledgeDifficulty, ObservableBehavior[]> = {
  beginner: ["recognize", "explain"],
  basic: ["explain", "apply"],
  intermediate: ["apply", "trace", "debug"],
  integrated: ["trace", "debug", "create"],
}

/**
 * 从目标文本提取"明确动作动词"对应的行为；泛化目标（无明确动词）返回 null，
 * 交给画像等级基线兜底，而不是默认 recognize。
 */
export function explicitBehaviorFromGoal(goal: string): ObservableBehavior | null {
  const normalized = goal.toLowerCase()
  if (/(debug|调试|排错|修复|改错)/.test(normalized)) return "debug"
  if (/(create|implement|build|编写|实现|创建|完成|搭建|设计)/.test(normalized)) return "create"
  if (/(trace|追踪|追溯|预测输出|逐步分析)/.test(normalized)) return "trace"
  if (/(apply|use|使用|应用|计算|统计|处理|转换|读取|写入|查询)/.test(normalized)) return "apply"
  if (/(explain|解释|说明|理解|比较)/.test(normalized)) return "explain"
  return null
}

/**
 * 决定单个学习目标的可观察行为：
 *   1. 目标文本有明确动作动词 → 该行为；
 *   2. 泛化目标 → 画像等级基线兜底（不再默认 recognize）。
 *
 * 说明：本函数只给出画像与目标语义的请求行为。B 的初始路径构造随后会把
 * 该请求与 A 返回的 evidence capabilities 对齐；显式动作不被悄悄改写，泛化
 * 目标则选择同一画像基线中知识事实能够真实支撑的行为。
 */
export function decideObservableBehavior(input: {
  goal: string
  learner_level: KnowledgeDifficulty
}): ObservableBehavior {
  const explicit = explicitBehaviorFromGoal(input.goal)
  if (explicit) return explicit
  return LEVEL_BEHAVIOR_BASELINE[input.learner_level][0]!
}
