import { describe, expect, test } from "bun:test"
import { buildAssessmentAuthorModelInput } from "../src/role-c-content/context/assessment-context"
import { buildCodeLabModelInput } from "../src/role-c-content/context/code-lab-context"
import { buildConceptTutorModelInput } from "../src/role-c-content/context/concept-context"

const spec = {
  spec_id: "SPEC-CITABLE",
  run_id: "RUN-CITABLE",
  path_node: {
    node_id: "NODE-K003",
    goal: "基本数据类型",
    target_source_ids: ["K003"],
    prerequisite_source_ids: [],
    objectives: [{
      objective_id: "OBJ-K003",
      source_id: "K003",
      required_fact_ids: ["F001"],
      observable_behavior: "recognize",
      importance: "core",
    }],
    assessment_blueprint: { tier_1_count: 1, tier_2_count: 0, tier_3_count: 0, required_modalities: ["mcq"] },
  },
  targets: [{
    objective_id: "OBJ-K003",
    source_id: "K003",
    required_fact_ids: ["F001"],
    observable_behavior: "recognize",
    importance: "core",
  }],
  learner_adaptation: { scaffold_level: 1, reading_density: "medium" },
  difficulty: { domain_complexity: 1, cognitive_demand: 1, reasoning_steps: 1, code_complexity: 1, prerequisite_load: 1, scaffold_strength: 1 },
  assessment_blueprint: { tier_1_count: 1, tier_2_count: 0, tier_3_count: 0, required_modalities: ["mcq"] },
  policies: { seed: 3, max_semantic_revision: 2, max_tool_retry: 1 },
}
const evidencePack = {
  retrieval_id: "RAG-CITABLE",
  results: [{
    source_id: "K003",
    title: "基本数据类型",
    difficulty: "beginner",
    facts: [{ source_id: "K003", fact_id: "F001", content: "int 表示整数，float 表示小数。" }],
    examples: [{ title: "未绑定示例", code: "type(7)", explanation: "type 可查看类型" }],
    practice_tasks: ["使用 type 判断类型"],
  }],
}
const conceptArtifact = {
  artifact_id: "ART-CONCEPT",
  payload: {
    objective_ids: ["OBJ-K003"],
    explanation_blocks: [],
    worked_examples: [],
    summary: [],
    misconceptions: [],
    objective_coverage: [],
  },
}

describe("Role C citable authoring context", () => {
  test("does not expose unaddressable RAG examples or practice text as publishable evidence", () => {
    const concept = buildConceptTutorModelInput({ generation_spec: spec, evidence_pack: evidencePack } as never)
    const lab = buildCodeLabModelInput({ generation_spec: spec, evidence_pack: evidencePack, concept_artifact: conceptArtifact } as never)
    const assessment = buildAssessmentAuthorModelInput({ generation_spec: spec, evidence_pack: evidencePack, concept_artifact: conceptArtifact } as never)

    for (const input of [concept, lab, assessment]) {
      expect(input.evidence[0]).toEqual(expect.objectContaining({
        source_id: "K003",
        facts: [expect.objectContaining({ fact_id: "F001" })],
      }))
      expect(input.evidence[0]).not.toHaveProperty("examples")
      expect(input.evidence[0]).not.toHaveProperty("practice_tasks")
    }
  })
})
