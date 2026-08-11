import { describe, expect, test } from "bun:test"
import { bindPathNodeFactsForRoleC } from "../src/orchestration/interactive-session"
import { buildAssessmentItemPlan } from "../src/role-c-content/providers/staged-generation"

describe("B observable behavior controls C assessment modalities", () => {
  test("a recognize-only node still uses the requested fixed formal composition", () => {
    const node: any = bindPathNodeFactsForRoleC({
      schema_version: "1.0", node_id: "N1", target_source_ids: ["K006"], prerequisite_source_ids: [], goal: "条件判断",
      objectives: [{ objective_id: "O1", source_id: "K006", required_fact_ids: [], observable_behavior: "recognize", importance: "core" }],
      assessment_blueprint: { tier_1_count: 2, tier_2_count: 2, tier_3_count: 1, required_modalities: ["mcq", "trace", "code"] },
    }, { results: [{ source_id: "K006", facts: [{ fact_id: "F001" }, { fact_id: "F002" }] }] } as any)
    expect(node.assessment_blueprint.required_modalities).toEqual(["mcq", "trace"])
    const plan = buildAssessmentItemPlan({
      spec_id: "S", run_id: "R", path_node: node, targets: node.objectives,
      assessment_blueprint: node.assessment_blueprint, policies: { seed: 1 },
    } as any)
    expect(plan.map((item) => item.modality)).toEqual(["mcq", "mcq", "trace", "code", "code"])
  })
})
