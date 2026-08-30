import { describe, expect, test } from "bun:test"
import { buildGenerationSpec } from "../src/role-c-content/contracts/generation-spec"
import { adaptLearnerProfile, defineLearningPathNode } from "../src/role-c-content/contracts/profile-adapter"
import { roleCSchemaRegistryMetadata, validateRoleCSchema } from "../src/role-c-content/validators/runtime-schema-validator"
import type { LearnerProfile } from "../src/role-b-profile/types"

function fixture() {
  const profile: LearnerProfile = {
    learner_id: "contract-learner",
    level: "basic",
    known_concepts: [],
    weak_concepts: ["列表"],
    goal: "完成数据结构课程作业",
  }
  const snapshot = adaptLearnerProfile(profile, {
    profile_version: "profile-contract-v1",
    goal_profile: "coursework",
  })
  const path = defineLearningPathNode({
    node_id: "NODE-LIST",
    target_source_ids: ["K009"],
    prerequisite_source_ids: [],
    goal: "理解列表",
    objectives: [{
      objective_id: "OBJ-LIST",
      source_id: "K009",
      required_fact_ids: ["F001"],
      observable_behavior: "recognize",
      importance: "core",
      difficulty_band: "foundation",
      progress_band: "developing",
    } as any],
    assessment_blueprint: {
      tier_1_count: 1,
      tier_2_count: 0,
      tier_3_count: 0,
      required_modalities: ["mcq"],
    },
  })
  const evidence = {
    retrieval_id: "RAG-CONTRACT",
    kb_version: "KB-1",
    rag_version: "RAG-1",
    match_status: "strong",
    results: [{
      source_id: "K009",
      title: "列表",
      facts: [{ source_id: "K009", fact_id: "F001", content: "列表可以按顺序保存多个元素。" }],
    }],
    evidence_sufficiency: { ok: true, missing_misconception_ids: [], worked_example_count: 1 },
  } as any
  return { snapshot, path, evidence }
}

describe("GenerationSpec closed-contract normalization", () => {
  test("builder strips upstream runtime metadata and emits a schema-valid contract", () => {
    const { snapshot, path, evidence } = fixture()
    const result = buildGenerationSpec({
      run_id: "RUN-CONTRACT-1",
      profile_snapshot: snapshot,
      path_node: path,
      evidence_pack: evidence,
      versions: {
        prompt_version: "P1",
        model_config_hash: "M1",
        provider_mode: "model",
      } as any,
      difficulty: { cognitive_demand: 2, resource_fit_label: "fit" } as any,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.spec.versions).not.toHaveProperty("provider_mode")
    expect(result.spec.targets[0]).not.toHaveProperty("difficulty_band")
    expect(result.spec.targets[0]).not.toHaveProperty("progress_band")
    expect(result.spec.difficulty).not.toHaveProperty("resource_fit_label")
    expect(validateRoleCSchema("generation_spec.schema.json", result.spec)).toEqual({ ok: true, issues: [] })
  })

  test("strict contract names the exact unknown property and path", () => {
    const { snapshot, path, evidence } = fixture()
    const result = buildGenerationSpec({
      run_id: "RUN-CONTRACT-2",
      profile_snapshot: snapshot,
      path_node: path,
      evidence_pack: evidence,
      versions: { prompt_version: "P1", model_config_hash: "M1" },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const invalid = structuredClone(result.spec) as any
    invalid.targets[0].difficulty_band = "foundation"
    const report = validateRoleCSchema("generation_spec.schema.json", invalid)
    expect(report.ok).toBe(false)
    expect(report.issues[0]?.code).toBe("schema_additionalProperties")
    expect(report.issues[0]?.path).toBe("$.targets[0].difficulty_band")
    expect(report.issues[0]?.message).toContain("difficulty_band")
  })

  test("schema and TypeScript both accept zero semantic revisions", () => {
    const { snapshot, path, evidence } = fixture()
    const result = buildGenerationSpec({
      run_id: "RUN-CONTRACT-3",
      profile_snapshot: snapshot,
      path_node: path,
      evidence_pack: evidence,
      versions: { prompt_version: "P1", model_config_hash: "M1" },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const compatibility = structuredClone(result.spec)
    compatibility.policies.max_semantic_revision = 0
    expect(validateRoleCSchema("generation_spec.schema.json", compatibility)).toEqual({ ok: true, issues: [] })
  })

  test("runtime exposes the loaded schema identity", () => {
    expect(roleCSchemaRegistryMetadata()).toMatchObject({
      generation_spec_contract: "generation-spec.v1.1",
      loaded_schema_count: 36,
    })
    expect(roleCSchemaRegistryMetadata().fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/)
  })
})
