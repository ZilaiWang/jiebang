import type { AssessmentItemPlan } from "../providers/staged-generation"

/**
 * 题目表现形式规划（改进方案5 第九节）。
 *
 * 场景题过多不是模型文风问题，而是 planner 把同一个 preferred context 分配给
 * 每道题 + 提示词反复要求"具体情境"。本模块确定性地为每道题分配表现形式，
 * 整卷完整场景题控制在约 35% 封顶，其余用直接判断/代码追踪/错误诊断/比较。
 */

export type AssessmentPresentationMode =
  | "direct_fact"
  | "minimal_context"
  | "code_trace"
  | "error_diagnosis"
  | "comparison"
  | "scenario_transfer"
  | "construction"

export interface AssessmentPresentationPlan {
  item_id: string
  mode: AssessmentPresentationMode
  context?: string
  variation_axis:
    | "operation"
    | "reasoning_pattern"
    | "representation"
    | "answer_form"
    | "context_family"
}

/** 完整场景题占整卷的最大比例。 */
export const SCENARIO_BUDGET_RATIO = 0.35

/** 确定性分配每道题的 presentation mode。 */
export function buildAssessmentPresentationPlan(
  items: AssessmentItemPlan[],
  preferredContexts: string[],
): AssessmentPresentationPlan[] {
  const tier3Count = items.filter((item) => item.tier === 3).length
  const scenarioBudget = preferredContexts.length === 0 ? 0 : Math.min(
    tier3Count,
    Math.floor(items.length * SCENARIO_BUDGET_RATIO),
  )
  let usedScenarios = 0

  return items.map((item, index) => {
    if (item.tier === 1) {
      return {
        item_id: item.item_id,
        mode: "direct_fact" as const,
        variation_axis: index % 2 === 0 ? "operation" as const : "answer_form" as const,
      }
    }
    if (item.modality === "trace") {
      return {
        item_id: item.item_id,
        mode: "code_trace" as const,
        variation_axis: "representation" as const,
      }
    }
    if (item.cognitive_operation === "diagnose_error") {
      return {
        item_id: item.item_id,
        mode: "error_diagnosis" as const,
        variation_axis: "reasoning_pattern" as const,
      }
    }
    if (item.cognitive_operation === "construct_solution") {
      return {
        item_id: item.item_id,
        mode: "construction" as const,
        variation_axis: "operation" as const,
      }
    }
    if (item.tier === 3 && usedScenarios < scenarioBudget) {
      const context = preferredContexts[usedScenarios % Math.max(1, preferredContexts.length)]
      usedScenarios += 1
      return {
        item_id: item.item_id,
        mode: "scenario_transfer" as const,
        ...(context ? { context } : {}),
        variation_axis: "context_family" as const,
      }
    }
    return {
      item_id: item.item_id,
      mode: "minimal_context" as const,
      variation_axis: index % 2 === 0 ? "operation" as const : "reasoning_pattern" as const,
    }
  })
}

export interface PresentationBalanceIssue {
  code: "scenario_overuse" | "unexpected_scenario"
  path: string
  message: string
}

/** 确定性平衡校验：场景题不超 35%，非场景模式不得包装完整场景。 */
export function validateAssessmentPresentationBalance(
  payload: { items: Array<{ item_id: string; prompt?: string; structure_meta?: { context_family?: string } }> },
  plan: AssessmentPresentationPlan[],
): PresentationBalanceIssue[] {
  const issues: PresentationBalanceIssue[] = []
  const scenarioItems = plan.filter((item) => item.mode === "scenario_transfer")
  const maximum = Math.floor(plan.length * SCENARIO_BUDGET_RATIO)
  if (scenarioItems.length > maximum) {
    issues.push({
      code: "scenario_overuse",
      path: "$.items",
      message: `场景题最多 ${maximum} 道，实际 ${scenarioItems.length} 道`,
    })
  }
  // 场景包装启发式：模型可能写了场景题却填 context_family="direct"，这里再查题干文本。
  const SCENARIO_WRAPPER = /小明|小红|某(?:位)?同学|某(?:位)?顾客|假设你是|请帮(?:助)?.{0,6}(?:同学|顾客|用户|老板|经理)|一家(?:商店|公司|店铺)/u
  payload.items.forEach((item, index) => {
    const expected = plan[index]
    if (!expected) return
    const contextFamily = item.structure_meta?.context_family
    if (
      expected.mode !== "scenario_transfer"
      && ((contextFamily !== undefined && contextFamily !== "direct")
        || (item.prompt && SCENARIO_WRAPPER.test(item.prompt)))
    ) {
      issues.push({
        code: "unexpected_scenario",
        path: `$.items[${index}]`,
        message: "当前题目计划为直接考查，不应额外包装完整场景",
      })
    }
  })
  return issues
}
