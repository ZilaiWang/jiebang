import { describe, expect, test } from "bun:test"
import {
  buildAssessmentPresentationPlan,
  validateAssessmentPresentationBalance,
  SCENARIO_BUDGET_RATIO,
} from "../src/role-c-content/planning/assessment-presentation"
import type { AssessmentItemPlan } from "../src/role-c-content/providers/staged-generation"

function itemPlan(overrides: Partial<AssessmentItemPlan> & { item_id: string }): AssessmentItemPlan {
  return {
    family_id: "F", variant_id: "V", display_no: 1,
    objective_id: "O1", observation_key: "O1",
    tier: 1, modality: "mcq", max_score: 1, citations: [],
    cognitive_operation: "recognize_fact",
    context_strategy: { kind: "neutral_context" },
    ...overrides,
  }
}

describe("改进方案5 第九节：测评 presentation plan 场景额度", () => {
  test("5 题试卷最多 1 道完整场景题（35% 封顶）", () => {
    const items = [
      itemPlan({ item_id: "I1", tier: 1 }),
      itemPlan({ item_id: "I2", tier: 2 }),
      itemPlan({ item_id: "I3", tier: 2 }),
      itemPlan({ item_id: "I4", tier: 3 }),
      itemPlan({ item_id: "I5", tier: 3 }),
    ]
    const plan = buildAssessmentPresentationPlan(items, ["购物"])
    const scenarios = plan.filter((p) => p.mode === "scenario_transfer")
    expect(scenarios.length).toBeLessThanOrEqual(Math.floor(5 * SCENARIO_BUDGET_RATIO))
    expect(scenarios.length).toBe(1)
  })

  test("Tier 1 默认 direct_fact，不自动套生活场景", () => {
    const items = [itemPlan({ item_id: "I1", tier: 1 })]
    const plan = buildAssessmentPresentationPlan(items, ["购物"])
    expect(plan[0]!.mode).toBe("direct_fact")
    expect(plan[0]!.context).toBeUndefined()
  })

  test("trace 题直接 code_trace，debug 题 error_diagnosis", () => {
    const items = [
      itemPlan({ item_id: "I1", tier: 2, modality: "trace", cognitive_operation: "trace_execution" }),
      itemPlan({ item_id: "I2", tier: 2, modality: "mcq", cognitive_operation: "diagnose_error" }),
    ]
    const plan = buildAssessmentPresentationPlan(items, [])
    expect(plan[0]!.mode).toBe("code_trace")
    expect(plan[1]!.mode).toBe("error_diagnosis")
  })

  test("preferred contexts 轮换，不重复使用第一个", () => {
    const items = [
      itemPlan({ item_id: "I1", tier: 1 }),
      itemPlan({ item_id: "I2", tier: 2 }),
      itemPlan({ item_id: "I3", tier: 2 }),
      itemPlan({ item_id: "I4", tier: 3, cognitive_operation: "apply_rule" }),
      itemPlan({ item_id: "I5", tier: 3, cognitive_operation: "apply_rule" }),
      itemPlan({ item_id: "I6", tier: 3, cognitive_operation: "apply_rule" }),
    ]
    const contexts = ["购物", "成绩统计"]
    const plan = buildAssessmentPresentationPlan(items, contexts)
    const scenarios = plan.filter((p) => p.mode === "scenario_transfer")
    expect(scenarios.map((entry) => entry.context)).toEqual(["购物", "成绩统计"])
  })

  test("没有画像偏好场景时不规划空壳 scenario_transfer", () => {
    const items = Array.from({ length: 6 }, (_, index) => itemPlan({
      item_id: `I${index + 1}`,
      tier: index >= 3 ? 3 : 2,
      cognitive_operation: "apply_rule",
    }))
    const plan = buildAssessmentPresentationPlan(items, [])
    expect(plan.every((entry) => entry.mode !== "scenario_transfer")).toBe(true)
  })

  test("非场景模式 context_family 非 direct → unexpected_scenario", () => {
    const items = [
      itemPlan({ item_id: "I1", tier: 1 }),
    ]
    const plan = buildAssessmentPresentationPlan(items, [])
    const payload = {
      items: [{ item_id: "I1", structure_meta: { context_family: "购物" } }],
    } as never
    const issues = validateAssessmentPresentationBalance(payload, plan)
    expect(issues.some((issue) => issue.code === "unexpected_scenario")).toBe(true)
  })

  test("领域名词本身不被误判为完整故事包装", () => {
    const plan = buildAssessmentPresentationPlan([
      itemPlan({ item_id: "I1", tier: 1 }),
    ], [])
    const issues = validateAssessmentPresentationBalance({
      items: [{
        item_id: "I1",
        prompt: "成绩单中的总分字段表示什么？",
        structure_meta: { context_family: "direct" },
      }],
    }, plan)
    expect(issues).toEqual([])
  })

  test("scenario 题 context_family 为场景 → 不报 unexpected", () => {
    const items = [
      itemPlan({ item_id: "I1", tier: 1 }),
      itemPlan({ item_id: "I2", tier: 2 }),
      itemPlan({ item_id: "I3", tier: 2 }),
      itemPlan({ item_id: "I4", tier: 3 }),
      itemPlan({ item_id: "I5", tier: 3 }),
      itemPlan({ item_id: "I6", tier: 3 }),
    ]
    const plan = buildAssessmentPresentationPlan(items, ["购物", "成绩统计"])
    const scenarioIds = new Set(plan.filter((p) => p.mode === "scenario_transfer").map((p) => p.item_id))
    expect(scenarioIds.size).toBe(2) // 6 题 × 35% = 2
    const payload = {
      items: items.map((item) => ({
        item_id: item.item_id,
        structure_meta: { context_family: scenarioIds.has(item.item_id) ? "购物" : "direct" },
      })),
    } as never
    const issues = validateAssessmentPresentationBalance(payload, plan)
    expect(issues).toEqual([])
  })
})
