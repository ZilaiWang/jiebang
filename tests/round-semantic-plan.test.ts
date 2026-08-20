import { describe, expect, test } from "bun:test"
import { contentHash } from "../src/role-c-content/contracts/common"
import { buildResourceBlueprint } from "../src/role-c-content/planning/resource-blueprint"
import { ModelRoundSemanticPlanner } from "../src/role-c-content/planning/round-semantic-plan"

function fixture(reasoningSteps: number) {
  const evidence: any = {
    retrieval_id: "RAG-PLAN",
    results: [{ source_id: "K1", title: "循环综合", facts: [{ source_id: "K1", fact_id: "F1", content: "循环会重复执行代码。" }] }],
  }
  const spec: any = {
    spec_id: "SPEC-PLAN",
    run_id: "RUN-PLAN",
    evidence_ref: evidence.retrieval_id,
    evidence_content_hash: contentHash(evidence),
    path_node: { target_source_ids: ["K1"], prerequisite_source_ids: [], goal: "完成循环综合任务" },
    targets: [{ objective_id: "OBJ-1", source_id: "K1", required_fact_ids: ["F1"], observable_behavior: "apply", importance: "core", is_primary: true }],
    learner_adaptation: { level: "intermediate", known_concepts: [], weak_concepts: [], preferred_contexts: [], scaffold_level: 1, reading_density: "medium", accommodations: [] },
    difficulty: { domain_complexity: 2, cognitive_demand: 3, reasoning_steps: reasoningSteps, code_complexity: 3, prerequisite_load: 2, scaffold_strength: 2 },
    assessment_blueprint: { tier_1_count: 2, tier_2_count: 2, tier_3_count: 1, required_modalities: ["mcq", "code"] },
    policies: { seed: 1 },
  }
  return { spec, evidence, blueprint: buildResourceBlueprint(spec, evidence) }
}

describe("round semantic planning", () => {
  test("skips model planning for a FAST blueprint", async () => {
    const input = fixture(1)
    let calls = 0
    const planner = new ModelRoundSemanticPlanner({
      model_id: "glm-5.2",
      model_config_hash: "MODEL-X",
      async generateStructured() { calls += 1; return {} as never },
    })
    expect(input.blueprint.quality_requirement.profile).toBe("fast")
    expect(await planner.plan(input)).toBeUndefined()
    expect(calls).toBe(0)
  })

  test("uses one QUALITY/high compact call and binds every objective", async () => {
    const input = fixture(5)
    let request: any
    const planner = new ModelRoundSemanticPlanner({
      model_id: "glm-5.2",
      model_config_hash: "MODEL-X",
      async generateStructured(value) {
        request = value
        return {
          objective_strategy: [{ objective_id: "OBJ-1", teaching_focus: "先理解再迁移", misconception_focus: ["边界"], example_progression: ["基础", "迁移"] }],
          narrative_arc: ["事实", "例子", "实践"],
          code_lab_intent: { scenario: "循环处理数据", decomposition: ["输入", "处理", "输出"], boundary_focus: ["空输入"] },
          assessment_intents: [{ objective_id: "OBJ-1", cognitive_operation: "apply", variation_axis: "数据结构" }],
          cross_artifact_rules: { lesson_role: "解释", lab_role: "实践", assessment_role: "独立测量", forbidden_duplications: ["不复制题面"] },
        } as never
      },
    })
    const plan = await planner.plan(input)
    expect(plan).toMatchObject({ spec_id: "SPEC-PLAN", blueprint_id: input.blueprint.blueprint_id })
    expect(request.policy).toMatchObject({ profile: "quality", thinking: "enabled", reasoning_effort: "high" })
    expect(request.max_tokens).toBe(8_000)
  })
})
