import { describe, expect, test } from "bun:test"
import {
  planAssessmentCapacity,
  STRUCTURE_BUDGET_PER_OBJECTIVE,
} from "../src/role-c-content/planning/assessment-capacity"

describe("assessment capacity planning：事实/结构不足时少出题而非 retry", () => {
  test("可行题量 >= 需求 → FULL，不调整蓝图", () => {
    const plan = planAssessmentCapacity({
      requested: { tier_1_count: 2, tier_2_count: 1, tier_3_count: 0, required_modalities: ["mcq"] },
      objectives: [
        { objective_id: "O1", observable_behavior: "apply", importance: "core", available_facts: 5, used_structures: 0 },
        { objective_id: "O2", observable_behavior: "recognize", importance: "core", available_facts: 5, used_structures: 0 },
      ],
    })
    expect(plan.decision).toBe("FULL")
    expect(plan.adjusted_blueprint).toBeUndefined()
  })

  test("事实不足 → REDUCE，缩减蓝图且保留 core 覆盖", () => {
    const plan = planAssessmentCapacity({
      requested: { tier_1_count: 2, tier_2_count: 2, tier_3_count: 2, required_modalities: ["mcq", "code"] }, // 需求 6
      objectives: [
        { objective_id: "O1", observable_behavior: "create", importance: "core", available_facts: 1, used_structures: 0 },
        { objective_id: "O2", observable_behavior: "recognize", importance: "core", available_facts: 1, used_structures: 0 },
      ],
    })
    expect(plan.decision).toBe("REDUCE")
    expect(plan.feasible_items).toBeLessThan(6)
    // core objective 每个至少 1 条
    expect(plan.feasible_items).toBeGreaterThanOrEqual(2)
    expect(plan.limiting_factors).toContain("EVIDENCE_DIVERSITY_LOW")
    const adjusted = plan.adjusted_blueprint!
    expect(adjusted.tier_1_count + adjusted.tier_2_count + adjusted.tier_3_count).toBe(plan.feasible_items)
    // 缩减优先保留 tier_1
    expect(adjusted.tier_1_count).toBeGreaterThan(0)
  })

  test("core 的结构空间被历史占满 → REPLAN + HISTORY_STRUCTURE_SATURATION", () => {
    const plan = planAssessmentCapacity({
      requested: { tier_1_count: 3, tier_2_count: 0, tier_3_count: 0, required_modalities: ["mcq"] },
      objectives: [
        { objective_id: "O1", observable_behavior: "apply", importance: "core", available_facts: 10, used_structures: STRUCTURE_BUDGET_PER_OBJECTIVE },
      ],
    })
    expect(plan.decision).toBe("REPLAN")
    expect(plan.limiting_factors).toContain("HISTORY_STRUCTURE_SATURATION")
  })

  test("连 core objective 都无法覆盖 → REPLAN", () => {
    const plan = planAssessmentCapacity({
      requested: { tier_1_count: 3, tier_2_count: 0, tier_3_count: 0, required_modalities: ["mcq"] },
      objectives: [
        { objective_id: "O1", observable_behavior: "create", importance: "core", available_facts: 0, used_structures: 0 },
        { objective_id: "O2", observable_behavior: "create", importance: "core", available_facts: 0, used_structures: 0 },
      ],
    })
    expect(plan.decision).toBe("REPLAN")
  })

  test("supporting objective 事实不足时可为 0，不拖累 core", () => {
    const plan = planAssessmentCapacity({
      requested: { tier_1_count: 2, tier_2_count: 0, tier_3_count: 0, required_modalities: ["mcq"] },
      objectives: [
        { objective_id: "O1", observable_behavior: "apply", importance: "core", available_facts: 5, used_structures: 0 },
        { objective_id: "O2", observable_behavior: "apply", importance: "supporting", available_facts: 0, used_structures: 0 },
      ],
    })
    const supporting = plan.per_objective.find((entry) => entry.objective_id === "O2")!
    expect(supporting.feasible).toBe(0)
    expect(plan.decision).not.toBe("REPLAN")
  })

  test("零事实不会被便捷构造器伪装成一条证据", async () => {
    const { capacityObjectiveFromLearningObjective } = await import("../src/role-c-content/planning/assessment-capacity")
    const objective = capacityObjectiveFromLearningObjective({
      objective_id: "O1", observable_behavior: "apply", importance: "core", required_fact_ids: [],
    }, 0, 0)
    expect(objective.available_facts).toBe(0)
  })
})
