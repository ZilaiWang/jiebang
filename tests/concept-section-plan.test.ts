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

  test("大事实集拆成多个有界连续讲解单元", () => {
    const factIds = Array.from({ length: 12 }, (_, index) => `F${String(index + 1).padStart(3, "0")}`)
    const plan = buildConceptSectionPlan({
      objective_id: "O1", observable_behavior: "recognize",
      fact_ids: factIds, support: support({ factCount: factIds.length }),
    })
    const explanationSlots = plan.slots.filter((slot) => slot.kind === "fact_explanation")
    expect(explanationSlots.map((slot) => slot.fact_ids)).toEqual([
      ["F001", "F002", "F003"],
      ["F004", "F005", "F006"],
      ["F007", "F008", "F009"],
      ["F010", "F011", "F012"],
    ])
    expect(explanationSlots.every((slot) => slot.fact_ids.length <= 3)).toBe(true)
    expect(plan.slots.find((slot) => slot.kind === "guided_example")?.fact_ids).toEqual(factIds)
    expect(plan.slots.find((slot) => slot.kind === "recap")?.fact_ids).toEqual(factIds)
    expect(plan.slots.find((slot) => slot.kind === "guided_example")?.max_sentences).toBe(8)
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

  test("多个 worked example 只有首个复用可执行示例，其余按不同事实组织讲解", () => {
    const plan = buildConceptSectionPlan({
      objective_id: "O1",
      observable_behavior: "recognize",
      fact_ids: ["F1", "F2", "F3"],
      support: support({ behaviors: ["recognize", "explain"], factCount: 3 }),
      executable_example_fact_ids: ["F1", "F2"],
      pedagogy_contract: {
        lesson: { worked_example_count: 3, opening: "balanced", require_step_trace: false, require_debugging_clinic: false },
      } as any,
    })
    const examples = plan.slots.filter((slot) => slot.kind === "guided_example")
    expect(examples).toHaveLength(3)
    expect(examples[0]).toMatchObject({
      fact_ids: ["F1", "F2"],
      allowed_block_types: ["code"],
      requires_executable_code: true,
    })
    expect(examples[1]).toMatchObject({ fact_ids: ["F2"], allowed_block_types: ["paragraph"] })
    expect(examples[2]).toMatchObject({ fact_ids: ["F3"], allowed_block_types: ["paragraph"] })
  })
})
