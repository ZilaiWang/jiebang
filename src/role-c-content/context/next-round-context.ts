import type { NextRoundGenerationContext } from "../agents/types"

export interface ProjectedNextRoundContext extends NextRoundGenerationContext {
  teaching_strategy: "reduce_load" | "same_difficulty_new_variant" | "hold_current_path"
  variation_requirements: {
    lesson_structure: string[]
    scenario_policy: string
    code_lab_policy: string
    assessment_policy: string
  }
}

/**
 * Projects the shared next-round context onto the objectives visible to one model call.
 * The variation contract (teaching_strategy + variation_requirements) applies to EVERY
 * segment of the round: a remediate/reinforce round must produce remediated/reinforced
 * material for the whole lesson, not only for the segments containing a focus objective.
 * focus_objective_ids is filtered to the visible objectives (it only prioritizes which
 * objectives get extra attention); the contract fields are never dropped by segmentation.
 */
export function projectNextRoundContext(
  context: NextRoundGenerationContext | undefined,
  visibleObjectiveIds: readonly string[],
): ProjectedNextRoundContext | undefined {
  if (!context) return undefined
  const visible = new Set(visibleObjectiveIds)
  const focusObjectiveIds = context.focus_objective_ids.filter((objectiveId) =>
    visible.has(objectiveId),
  )
  const teachingStrategy = context.action === "remediate"
    ? "reduce_load"
    : context.action === "reinforce"
      ? "same_difficulty_new_variant"
      : "hold_current_path"
  return {
    ...structuredClone(context),
    focus_objective_ids: focusObjectiveIds,
    teaching_strategy: teachingStrategy,
    variation_requirements: variationRequirements(teachingStrategy),
  }
}

function variationRequirements(
  strategy: ProjectedNextRoundContext["teaching_strategy"],
): ProjectedNextRoundContext["variation_requirements"] {
  if (strategy === "reduce_load") {
    return {
      lesson_structure: ["错误表现与原因", "最小正确规则", "错误与修正对照", "分步基础练习", "自查清单"],
      scenario_policy: "使用单一、短小、低干扰的纠错场景；直接针对 misconception_tags；不得使用综合项目或迁移型案例。",
      code_lab_policy: "任务拆成一个核心操作，提供清晰 starter 与步骤提示；必须含明确纠错目标和错误代码到正确代码的修正过程。",
      assessment_policy: "新题以识别错误、解释原因和完成基础修正为主；不得只替换数字复用上一轮题面。",
    }
  }
  if (strategy === "same_difficulty_new_variant") {
    return {
      lesson_structure: ["规则快速回顾", "变式辨析", "全新场景迁移", "边界条件分析", "综合自查"],
      scenario_policy: "必须选用与 evidence.examples 主场景明显不同的新应用场景；若证据示例是成绩/平均分，禁止继续使用成绩、分数、班级平均值语境。",
      code_lab_policy: "保持同等或略高难度，但必须改变任务结构与输入形态，并加入至少一个边界条件；禁止只换数字、变量名或函数名。",
      assessment_policy: "新题必须改变题干情境、数据结构或推理方式，至少包含迁移或边界题；不得复用上一轮核心案例语境。",
    }
  }
  return {
    lesson_structure: ["核心规则", "示例", "练习", "自查"],
    scenario_policy: "保持当前路径和难度，使用与目标一致的清晰场景。",
    code_lab_policy: "保持当前合同要求。",
    assessment_policy: "保持当前测评蓝图。",
  }
}
