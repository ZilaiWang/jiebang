import { describe, expect, test } from "bun:test"
import { bindPathNodeFactsForRoleC } from "../src/orchestration/interactive-session"
import {
  buildAssessmentItemPlan,
  validateAssessmentPublicAuthorAgainstPlan,
} from "../src/role-c-content/providers/staged-generation"

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

  test("多题测评按画像允许的题型轮换，不会每题都取第一个偏好", () => {
    const node = {
      schema_version: "1.0", node_id: "N2B", target_source_ids: ["K001"], prerequisite_source_ids: [], goal: "Python 概念",
      objectives: [{ objective_id: "O2B", source_id: "K001", required_fact_ids: ["F001", "F002", "F004"], observable_behavior: "explain", importance: "core" }],
      assessment_blueprint: { tier_1_count: 3, tier_2_count: 2, tier_3_count: 0, required_modalities: ["short_answer"] },
    }
    const facts = ["F001", "F002", "F004"]
    const plan = buildAssessmentItemPlan({
      spec_id: "S2B", run_id: "R2B", path_node: node, targets: node.objectives,
      learner_adaptation: {
        level: "beginner", known_concepts: [], weak_concepts: ["K001"], preferred_contexts: [], scaffold_level: 3,
        pedagogy_contract: {
          assessment: { preferred_modalities: ["mcq", "true_false", "short_answer"], require_direct_core_measurement: true },
        },
      },
      assessment_blueprint: node.assessment_blueprint, policies: { seed: 1 },
    } as any, {
      results: [{
        source_id: "K001",
        facts: facts.map((fact_id) => ({ fact_id, capabilities: ["definition"] })),
      }],
    } as any)
    expect(plan.map((item) => item.modality)).toEqual([
      "mcq", "true_false", "mcq", "short_answer", "true_false",
    ])
    const trueFalseFacts = plan
      .filter((item) => item.modality === "true_false")
      .map((item) => item.citations.map((citation) => citation.fact_id))
    expect(trueFalseFacts).toEqual([["F001"], ["F002"]])
    const mcqFacts = plan
      .filter((item) => item.modality === "mcq")
      .map((item) => item.citations.map((citation) => citation.fact_id))
    expect(mcqFacts).toEqual([
      ["F001", "F002"],
      ["F002", "F004"],
    ])
  })

  test("recognize 的 mcq 保持理解测量，并提供两条事实设计有效对照", () => {
    const node = {
      schema_version: "1.0", node_id: "N3", target_source_ids: ["K001"], prerequisite_source_ids: [], goal: "Python 是什么",
      objectives: [{ objective_id: "O3", source_id: "K001", required_fact_ids: ["F001", "F002", "F003"], observable_behavior: "recognize", importance: "core" }],
      assessment_blueprint: { tier_1_count: 0, tier_2_count: 0, tier_3_count: 1, required_modalities: ["mcq"] },
    }
    const plan = buildAssessmentItemPlan({
      spec_id: "S3", run_id: "R3", path_node: node, targets: node.objectives,
      assessment_blueprint: node.assessment_blueprint, policies: { seed: 1 },
    } as any)
    expect(plan).toHaveLength(1)
    expect(plan[0]?.cognitive_demand).toBe("understand")
    expect(plan[0]?.citations).toHaveLength(2)
  })

  test("事实识别计划拒绝被作者改写成执行结果追踪题", () => {
    const issues = validateAssessmentPublicAuthorAgainstPlan({
      title: "变量测评",
      items: [{
        prompt: "依次执行 x = 10、x = 20 后，x 的最终值是什么？",
        options: ["Python 使用 = 进行变量赋值。", "Python 不使用 = 进行变量赋值。"],
        starter_code: null,
        structure_meta: {
          operation: "状态追踪",
          reasoning_pattern: "逐步追踪",
          representation: "代码片段",
          context_family: "direct",
          answer_form: "single_choice",
        },
      }],
    } as any, [{
      modality: "mcq",
      cognitive_operation: "recognize_fact",
    }] as any)
    expect(issues.join("\n")).toContain("冻结为事实识别题")
    expect(issues.join("\n")).toContain("不能索要具体值")
  })

  test("误区需要的事实未全部进入本题 citations 时不会强制绑定", () => {
    const node = {
      schema_version: "1.0", node_id: "N4", target_source_ids: ["K003"], prerequisite_source_ids: [], goal: "基本数据类型",
      objectives: [{ objective_id: "O4", source_id: "K003", required_fact_ids: ["F001", "F002", "F003", "F004"], observable_behavior: "recognize", importance: "core" }],
      assessment_blueprint: { tier_1_count: 1, tier_2_count: 0, tier_3_count: 0, required_modalities: ["mcq"] },
    }
    const plan = buildAssessmentItemPlan({
      spec_id: "S4", run_id: "R4", path_node: node, targets: node.objectives,
      assessment_blueprint: node.assessment_blueprint, policies: { seed: 1 },
    } as any, {
      results: [{
        source_id: "K003",
        facts: ["F001", "F002", "F003", "F004"].map((fact_id) => ({ fact_id })),
        misconceptions: [{
          misconceptionId: "MIS-K003-AUTHORED",
          factRefs: ["F001", "F002", "F004", "F005"].map((factId) => ({ sourceId: "K003", factId })),
        }],
      }],
    } as any)
    expect(plan[0]?.citations.map((citation) => citation.fact_id)).toEqual(["F001", "F002"])
    expect(plan[0]?.misconception_available).toBe(false)
    expect(plan[0]?.target_misconception_id).toBeUndefined()
  })
})
