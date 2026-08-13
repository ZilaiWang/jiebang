import { describe, expect, test } from "bun:test"
import { buildAssessmentItemPlan } from "../src/role-c-content/providers/staged-generation"

describe("formal assessment code-pair contract", () => {
  test("replaces subjective assessment with a simple 2-point code task and a 4-point comprehensive code task", () => {
    const plan = buildAssessmentItemPlan({
      spec_id: "SPEC-CODE-PAIR",
      run_id: "RUN-CODE-PAIR",
      profile_snapshot: {} as never,
      path_node: { objectives: [{ objective_id: "O1", source_id: "K009", required_fact_ids: ["F1"], observable_behavior: "apply", importance: "core" }] } as never,
      targets: [{ objective_id: "O1", source_id: "K009", required_fact_ids: ["F1"], observable_behavior: "apply", importance: "core" }],
      evidence_ref: "RAG-1",
      evidence_content_hash: "hash",
      versions: { prompt_version: "test", model_config_hash: "test", kb_version: "test", rag_version: "test", schema_version: "1.0" },
      learner_adaptation: { scaffold_level: 1, reading_density: "medium", level: "beginner", known_concepts: [], weak_concepts: [], preferred_contexts: [], accommodations: [] },
      difficulty: { domain_complexity: 1, cognitive_demand: 1, reasoning_steps: 1, code_complexity: 1, prerequisite_load: 1, scaffold_strength: 1 },
      assessment_blueprint: { tier_1_count: 2, tier_2_count: 2, tier_3_count: 1, required_modalities: ["mcq", "code"] },
      policies: { seed: 1, max_semantic_revision: 1, max_tool_retry: 1 },
    } as never)

    expect(plan.map((item) => [item.modality, item.max_score])).toEqual([
      ["mcq", 1],
      ["mcq", 1],
      ["trace", 2],
      ["code", 2],
      ["code", 4],
    ])
  })
})
