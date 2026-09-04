import { describe, expect, test } from "bun:test"
import { contentHash } from "../src/role-c-content/contracts/common"
import {
  buildResourceBlueprint,
  effectiveAssessmentBlueprint,
} from "../src/role-c-content/planning/resource-blueprint"

describe("Role C shared resource blueprint", () => {
  test("freezes one objective/evidence/assessment decision for all three agents", () => {
    const evidence: any = {
      schema_version: "1.0",
      retrieval_id: "RAG-BLUEPRINT",
      query: "variables functions",
      learner_level: "basic",
      top_k: 2,
      match_status: "strong",
      kb_version: "kb-1",
      rag_version: "rag-1",
      results: [
        { source_id: "K1", facts: [{ source_id: "K1", fact_id: "F1", content: "fact 1" }] },
        { source_id: "K2", facts: [{ source_id: "K2", fact_id: "F2", content: "fact 2" }] },
      ],
    }
    const spec: any = {
      spec_id: "SPEC-BLUEPRINT",
      run_id: "RUN-BLUEPRINT",
      evidence_ref: evidence.retrieval_id,
      evidence_content_hash: contentHash(evidence),
      path_node: { prerequisite_source_ids: ["K0"] },
      targets: [
        { objective_id: "O1", source_id: "K1", required_fact_ids: ["F1"], observable_behavior: "recognize", importance: "core" },
        { objective_id: "O2", source_id: "K2", required_fact_ids: ["F2"], observable_behavior: "create", importance: "core" },
      ],
      learner_adaptation: { preferred_contexts: ["成绩统计"] },
      assessment_blueprint: { tier_1_count: 2, tier_2_count: 2, tier_3_count: 1, required_modalities: ["mcq", "code"] },
      policies: { seed: 7 },
    }

    const blueprint = buildResourceBlueprint(spec, evidence)

    expect(blueprint.spec_id).toBe(spec.spec_id)
    expect(blueprint.objectives.map((entry) => entry.objective_id)).toEqual(["O1", "O2"])
    expect(blueprint.objectives[0]!.citations).toEqual([{ source_id: "K1", fact_id: "F1", relation: "derived_from" }])
    expect(blueprint.code_lab.objective_plan.map((entry) => entry.objective_id)).toEqual(["O1", "O2"])
    expect(blueprint.assessment.item_plan.some((item) => item.modality === "code")).toBe(true)
    expect(blueprint.assessment.item_plan.every((item) => item.cognitive_operation.length > 0)).toBe(true)
    expect(blueprint.assessment.total_score).toBe(10)
    // 本卷 Tier 3 是 code/construction，不是 scenario_transfer；构造难度进入
    // cognitive/reasoning，不能被错误记成跨情境迁移距离。
    expect(blueprint.assessment.item_plan.some((item) =>
      item.tier === 3 && item.presentation_mode === "construction")).toBe(true)
    expect(blueprint.difficulty_plan.assessment.challenge_target.transfer_distance).toBe(0)
    // 整卷目标由实际 item_plan 决定。本例同时冻结了 Tier 1/2/3，
    // 按分值加权后认知需求为 2，不应被某个 recognize 目标代表整卷。
    expect(blueprint.difficulty_plan.assessment.challenge_target.cognitive_demand).toBe(2)
    expect(Object.isFrozen(blueprint)).toBe(true)
  })

  test("rejects a blueprint built from evidence other than the frozen pack", () => {
    const evidence: any = { retrieval_id: "RAG-X", results: [] }
    const spec: any = {
      spec_id: "S",
      evidence_ref: "RAG-Y",
      evidence_content_hash: contentHash(evidence),
      targets: [],
      path_node: { prerequisite_source_ids: [] },
      assessment_blueprint: { tier_1_count: 1, tier_2_count: 0, tier_3_count: 0, required_modalities: [] },
      policies: { seed: 0 },
    }
    expect(() => buildResourceBlueprint(spec, evidence)).toThrow("RESOURCE_BLUEPRINT_EVIDENCE_IDENTITY_MISMATCH")
  })
})

describe("resource blueprint difficulty_plan（三类资源目标难度分化）", () => {
  const evidence: any = {
    schema_version: "1.0", retrieval_id: "RAG-DIFF", query: "x", learner_level: "basic", top_k: 1,
    match_status: "strong", kb_version: "kb-1", rag_version: "rag-1",
    results: [{ source_id: "K1", facts: [{ source_id: "K1", fact_id: "F1", content: "f" }] }],
  }
  const spec: any = {
    spec_id: "SPEC-DIFF", run_id: "RUN-DIFF",
    evidence_ref: "RAG-DIFF", evidence_content_hash: contentHash(evidence),
    path_node: { prerequisite_source_ids: [] },
    targets: [{ objective_id: "O1", source_id: "K1", required_fact_ids: ["F1"], observable_behavior: "recognize", importance: "core" }],
    learner_adaptation: { level: "basic", scaffold_level: 2 },
    assessment_blueprint: { tier_1_count: 1, tier_2_count: 0, tier_3_count: 0, required_modalities: ["mcq"] },
    policies: { seed: 1 },
    difficulty: {
      domain_complexity: 2, cognitive_demand: 2, reasoning_steps: 2, code_complexity: 1,
      prerequisite_load: 1, scaffold_strength: 2, transfer_distance: 0, boundary_condition_density: 0, task_composition: 0,
    },
  }

  test("讲义支架最强、测评支架最低、代码实验 starter/hint 充分", () => {
    const plan = buildResourceBlueprint(spec, evidence).difficulty_plan
    // 讲义 scaffold 增强
    expect(plan.concept_lesson.support_target.scaffold_strength).toBeGreaterThan(plan.assessment.support_target.scaffold_strength)
    expect(plan.assessment.support_target.scaffold_strength).toBe(0)
    expect(plan.assessment.support_target.hint_strength).toBe(0)
    // basic 保留部分脚手架；beginner 才提升到 3。
    expect(plan.code_lab.support_target.starter_support).toBeGreaterThanOrEqual(2)
    expect(plan.code_lab.support_target.hint_strength).toBeGreaterThanOrEqual(2)
  })

  test("三类资源按教学形态分别规划挑战：讲义更缓、实验更重过程、测评保持独立目标", () => {
    const plan = buildResourceBlueprint(spec, evidence).difficulty_plan
    expect(plan.concept_lesson.challenge_target.domain_complexity).toBe(2)
    expect(plan.concept_lesson.challenge_target.cognitive_demand).toBe(2)
    expect(plan.code_lab.challenge_target.reasoning_steps).toBe(2.5)
    expect(plan.assessment.challenge_target.cognitive_demand).toBe(1)
  })

  test("缺 difficulty 时用画像 level 默认值兜底，不抛错", () => {
    const { difficulty: _omit, ...specWithoutDifficulty } = spec
    const plan = buildResourceBlueprint(specWithoutDifficulty, evidence).difficulty_plan
    expect(plan.concept_lesson.challenge_target.domain_complexity).toBe(2) // basic 默认 base=2
  })

  test("容量缩减后模型、校验器与执行蓝图读取同一份有效题量合同", () => {
    const capacity = {
      requested_items: 5,
      feasible_items: 2,
      per_objective: [{ objective_id: "O1", importance: "core" as const, requested: 2, feasible: 2 }],
      limiting_factors: ["EVIDENCE_DIVERSITY_LOW" as const],
      decision: "REDUCE" as const,
      adjusted_blueprint: {
        tier_1_count: 1, tier_2_count: 1, tier_3_count: 0, required_modalities: ["mcq" as const],
      },
    }
    const blueprint = buildResourceBlueprint(spec, evidence, {
      assessment_blueprint: capacity.adjusted_blueprint,
      assessment_capacity: capacity,
    })
    expect(blueprint.assessment.capacity.decision).toBe("REDUCE")
    expect(blueprint.assessment.item_plan).toHaveLength(2)
    expect(effectiveAssessmentBlueprint(spec, blueprint)).toEqual({
      tier_1_count: 1,
      tier_2_count: 1,
      tier_3_count: 0,
      required_modalities: ["mcq"],
    })
  })
})
