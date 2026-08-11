import { describe, expect, test } from "bun:test"
import { projectNextRoundContext } from "../src/role-c-content/context/next-round-context"
import { buildConceptTutorModelInput } from "../src/role-c-content/context/concept-context"
import { buildCodeLabModelInput } from "../src/role-c-content/context/code-lab-context"

const baseContext = {
  request_id: "REQ-1",
  parent_spec_id: "SPEC-0",
  prior_feedback_ref: "FB-0",
  trigger_grade_artifact_id: "GRADE-0",
  focus_objective_ids: ["O1"],
  reason_codes: ["round_accuracy_below_remediation_threshold"],
}

describe("next round context projection", () => {
  test("distinguishes remediate and reinforce teaching strategies", () => {
    const remediate = projectNextRoundContext({ ...baseContext, action: "remediate" }, ["O1"])
    const reinforce = projectNextRoundContext({ ...baseContext, action: "reinforce" }, ["O1"])

    expect(remediate?.teaching_strategy).toBe("reduce_load")
    expect(reinforce?.teaching_strategy).toBe("same_difficulty_new_variant")
    expect(remediate?.variation_requirements.lesson_structure).toContain("错误与修正对照")
    expect(remediate?.variation_requirements.code_lab_policy).toContain("纠错目标")
    expect(reinforce?.variation_requirements.lesson_structure).toContain("全新场景迁移")
    expect(reinforce?.variation_requirements.scenario_policy).toContain("禁止继续使用成绩")
    expect(reinforce?.variation_requirements.code_lab_policy).toContain("改变任务结构")
    expect(remediate?.variation_requirements).not.toEqual(reinforce?.variation_requirements)
    expect(remediate).not.toEqual(reinforce)
  })

  test("keeps the projected strategy visible in both concept and code lab inputs", () => {
    const concept = buildConceptTutorModelInput({
      generation_spec: {
        spec_id: "SPEC-1",
        run_id: "RUN-1",
        path_node: { node_id: "NODE-1", target_source_ids: ["K007"], prerequisite_source_ids: [], goal: "goal", objectives: [{ objective_id: "O1", source_id: "K007", required_fact_ids: ["F1"], observable_behavior: "trace", importance: "core" }], assessment_blueprint: { tier_1_count: 1, tier_2_count: 0, tier_3_count: 0, required_modalities: ["mcq"] } },
        targets: [{ objective_id: "O1", source_id: "K007", required_fact_ids: ["F1"], observable_behavior: "trace", importance: "core" }],
        learner_adaptation: { scaffold_level: 1, reading_density: "medium" },
        difficulty: { domain_complexity: 1, cognitive_demand: 1, reasoning_steps: 1, code_complexity: 1, prerequisite_load: 1, scaffold_strength: 1 },
        policies: { seed: 7, max_semantic_revision: 1, max_tool_retry: 1 },
      },
      evidence_pack: { retrieval_id: "RAG-1", results: [] } as never,
      next_round_context: { ...baseContext, action: "remediate" },
    } as never)

    const lab = buildCodeLabModelInput({
      generation_spec: {
        spec_id: "SPEC-1",
        run_id: "RUN-1",
        path_node: { node_id: "NODE-1", target_source_ids: ["K007"], prerequisite_source_ids: [], goal: "goal", objectives: [{ objective_id: "O1", source_id: "K007", required_fact_ids: ["F1"], observable_behavior: "apply", importance: "core" }], assessment_blueprint: { tier_1_count: 1, tier_2_count: 0, tier_3_count: 0, required_modalities: ["mcq"] } },
        targets: [{ objective_id: "O1", source_id: "K007", required_fact_ids: ["F1"], observable_behavior: "apply", importance: "core" }],
        learner_adaptation: { scaffold_level: 1, reading_density: "medium" },
        difficulty: { domain_complexity: 1, cognitive_demand: 1, reasoning_steps: 1, code_complexity: 1, prerequisite_load: 1, scaffold_strength: 1 },
        policies: { seed: 7, max_semantic_revision: 1, max_tool_retry: 1 },
      },
      evidence_pack: { retrieval_id: "RAG-1", results: [] } as never,
      concept_artifact: { artifact_id: "CONCEPT-1", payload: { objective_coverage: [], misconceptions: [], objective_ids: [], explanation_blocks: [], worked_examples: [], summary: [] } } as never,
      next_round_context: { ...baseContext, action: "reinforce" },
    } as never)

    expect(concept.upstream.next_round_context?.teaching_strategy).toBe("reduce_load")
    expect(lab.next_round_context?.teaching_strategy).toBe("same_difficulty_new_variant")
  })

  test("keeps the variation contract on segments without a focus objective (no silent drop)", () => {
    // 分段生成时，某一段可能不含 focus 目标。差异合同（teaching_strategy +
    // variation_requirements）必须仍然作用于该段，否则补救/强化轮次中
    // 部分讲义退回普通生成，导致“有区别但不严格按主题”。
    const projected = projectNextRoundContext(
      { ...baseContext, action: "remediate", focus_objective_ids: ["O2"] },
      ["O1", "O3"],
    )
    expect(projected).toBeDefined()
    expect(projected?.teaching_strategy).toBe("reduce_load")
    expect(projected?.variation_requirements.lesson_structure).toContain("错误与修正对照")
    // focus 过滤为本段可见目标；本段不含 O2 时为空数组，但差异合同不丢失。
    expect(projected?.focus_objective_ids).toEqual([])

    const reinforceProjected = projectNextRoundContext(
      { ...baseContext, action: "reinforce", focus_objective_ids: ["O2"] },
      ["O1"],
    )
    expect(reinforceProjected?.teaching_strategy).toBe("same_difficulty_new_variant")
    expect(reinforceProjected?.variation_requirements.scenario_policy).toContain("禁止继续使用成绩")
  })
})
