import { describe, expect, test } from "bun:test"
import { bindPathNodeFactsForRoleC } from "../src/orchestration/interactive-session"
import { buildAssessmentItemPlan } from "../src/role-c-content/providers/staged-generation"

describe("B observable behavior controls C assessment modalities", () => {
  test("C preserves B's blueprint and assigns flexible slots by behavior", () => {
    const node: any = bindPathNodeFactsForRoleC({
      schema_version: "1.0", node_id: "N1", target_source_ids: ["K006"], prerequisite_source_ids: [], goal: "条件判断",
      objectives: [{ objective_id: "O1", source_id: "K006", required_fact_ids: [], observable_behavior: "recognize", importance: "core" }],
      assessment_blueprint: { tier_1_count: 2, tier_2_count: 2, tier_3_count: 1, required_modalities: ["mcq", "true_false"] },
    }, { results: [{ source_id: "K006", facts: [{ fact_id: "F001" }, { fact_id: "F002" }] }] } as any)
    expect(node.assessment_blueprint.required_modalities).toEqual(["mcq", "true_false"])
    const plan = buildAssessmentItemPlan({
      spec_id: "S", run_id: "R", path_node: node, targets: node.objectives,
      assessment_blueprint: node.assessment_blueprint, policies: { seed: 1 },
    } as any)
    expect(plan.map((item) => item.modality)).toEqual(["mcq", "mcq", "true_false", "true_false", "mcq"])
  })

  test("explain 目标的第二层仍是单事实理解检查，不会暗中抬成双事实迁移", () => {
    const node = {
      schema_version: "1.0", node_id: "N2", target_source_ids: ["K007"], prerequisite_source_ids: [], goal: "for 循环",
      objectives: [{ objective_id: "O2", source_id: "K007", required_fact_ids: ["F001", "F002", "F004"], observable_behavior: "explain", importance: "core" }],
      assessment_blueprint: { tier_1_count: 1, tier_2_count: 1, tier_3_count: 0, required_modalities: ["short_answer"] },
    }
    const plan = buildAssessmentItemPlan({
      spec_id: "S2", run_id: "R2", path_node: node, targets: node.objectives,
      assessment_blueprint: node.assessment_blueprint, policies: { seed: 1 },
    } as any, {
      results: [{ source_id: "K007", facts: [
        { fact_id: "F001", capabilities: ["definition"] },
        { fact_id: "F002", capabilities: ["rule"] },
        { fact_id: "F004", capabilities: ["procedure"] },
      ] }],
    } as any)
    expect(plan.map((item) => item.citations.length)).toEqual([1, 1])
    expect(plan.map((item) => item.cognitive_demand)).toEqual(["understand", "understand"])
  })
})
