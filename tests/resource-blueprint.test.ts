import { describe, expect, test } from "bun:test"
import { contentHash } from "../src/role-c-content/contracts/common"
import { buildResourceBlueprint } from "../src/role-c-content/planning/resource-blueprint"

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
