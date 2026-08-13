import { describe, expect, test } from "bun:test"
import { bindPathNodeFactsForRoleC } from "../src/orchestration/interactive-session"

describe("current B node canonical topic", () => {
  test("C receives the A title of the current source, not the learner's overall goal", () => {
    const node: any = {
      schema_version: "1.0", node_id: "N1", target_source_ids: ["K003"], prerequisite_source_ids: ["K002"],
      goal: "学习for 循环",
      objectives: [{ objective_id: "OBJ-K003", source_id: "K003", required_fact_ids: [], observable_behavior: "recognize", importance: "core" }],
      assessment_blueprint: { tier_1_count: 2, tier_2_count: 2, tier_3_count: 1, required_modalities: ["mcq", "trace", "code"] },
    }
    const bound = bindPathNodeFactsForRoleC(node, { results: [
      { source_id: "K003", title: "基本数据类型", facts: [{ fact_id: "F001", source_id: "K003", content: "int 表示整数。" }] },
      { source_id: "K002", title: "变量与赋值", facts: [{ fact_id: "F001", source_id: "K002", content: "变量可以被重新赋值。" }] },
    ] } as any)
    expect(bound.goal).toBe("基本数据类型")
    expect(bound.target_source_ids).toEqual(["K003"])
  })
})
