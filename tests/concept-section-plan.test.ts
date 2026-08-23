import { describe, expect, test } from "bun:test"
import { buildConceptSectionPlan, materializeConceptObjectiveV2, validateConceptSectionStructure } from "../src/role-c-content/planning/concept-section-plan"
import type { ObservableBehavior } from "../src/role-c-content/contracts/profile-adapter"

const support = (overrides: Partial<{ behaviors: ObservableBehavior[]; concept: string; factCount: number }> = {}) => ({
  objective_id: "O1",
  fact_refs: [],
  supported_behaviors: overrides.behaviors ?? ["recognize", "explain"],
  allowed_content_moves: [],
  artifact_support: { concept: (overrides.concept ?? "full") as never, code_lab: "unsupported" as never, assessment: "full" as never },
  missing_support: [],
})

describe("改进方案5 第六节：讲义 Section Plan", () => {
  test("每个 required slot 都生成（overview/fact_explanation/misconception/recap 恒有）", () => {
    const plan = buildConceptSectionPlan({
      objective_id: "O1", observable_behavior: "explain",
      fact_ids: ["F1"], support: support({ factCount: 1 }),
    })
    const kinds = plan.slots.map((slot) => slot.kind)
    expect(kinds).toContain("overview")
    expect(kinds).toContain("fact_explanation")
    expect(kinds).toContain("misconception")
    expect(kinds).toContain("recap")
  })

  test("一个 fact 也不会退化成三句固定模板（有多个 section 承载不同功能）", () => {
    const plan = buildConceptSectionPlan({
      objective_id: "O1", observable_behavior: "explain",
      fact_ids: ["F1"], support: support({ factCount: 1 }),
    })
    expect(plan.slots.length).toBeGreaterThanOrEqual(5)
    // 每个 slot 的 fact_ids 都锚定当前事实，但承担不同功能
    for (const slot of plan.slots) {
      expect(slot.fact_ids).toEqual(["F1"])
    }
  })

  test("未允许 procedure_trace 时不得生成 procedure_steps slot", () => {
    const plan = buildConceptSectionPlan({
      objective_id: "O1", observable_behavior: "explain",
      fact_ids: ["F1"], support: support({ behaviors: ["recognize", "explain"], factCount: 1 }),
    })
    expect(plan.slots.some((slot) => slot.kind === "procedure_steps")).toBe(false)
    expect(plan.mode).toBe("definition_only")
  })

  test("支持 trace 时进入 procedural 模式并生成 procedure_steps", () => {
    const plan = buildConceptSectionPlan({
      objective_id: "O1", observable_behavior: "trace",
      fact_ids: ["F1", "F2"], support: support({ behaviors: ["trace"], factCount: 2 }),
    })
    expect(plan.mode).toBe("procedural")
    expect(plan.slots.some((slot) => slot.kind === "procedure_steps")).toBe(true)
  })

  test("misconception slot 只允许 fact_negation，不允许 procedure_trace", () => {
    const plan = buildConceptSectionPlan({
      objective_id: "O1", observable_behavior: "trace",
      fact_ids: ["F1", "F2"], support: support({ behaviors: ["trace"], factCount: 2 }),
    })
    const misconception = plan.slots.find((slot) => slot.kind === "misconception")!
    expect(misconception.allowed_moves).toEqual(["fact_negation"])
    expect(misconception.allowed_moves).not.toContain("procedure_trace")
  })
})
