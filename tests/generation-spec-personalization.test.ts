import { describe, expect, test } from "bun:test"
import { contentHash } from "../src/role-c-content/contracts/common"
import { buildGenerationSpec } from "../src/role-c-content/contracts/generation-spec"
import { adaptLearnerProfile, defineLearningPathNode } from "../src/role-c-content/contracts/profile-adapter"
import type { LearnerProfile } from "../src/role-b-profile/types"
import { validateRoleCSchema } from "../src/role-c-content/validators/runtime-schema-validator"

function fixture() {
  const profile: LearnerProfile = {
    learner_id: "learner-policy",
    level: "basic",
    known_concepts: ["变量"],
    weak_concepts: ["列表"],
    goal: "完成数据结构课程作业",
  }
  const snapshot = adaptLearnerProfile(profile, {
    profile_version: "profile-v1",
    goal_profile: "coursework",
  })
  const path = defineLearningPathNode({
    node_id: "NODE-1",
    target_source_ids: ["K009"],
    prerequisite_source_ids: [],
    goal: "理解列表",
    objectives: [{
      objective_id: "O1",
      source_id: "K009",
      required_fact_ids: ["F001"],
      observable_behavior: "recognize",
      importance: "core",
    }],
    assessment_blueprint: {
      tier_1_count: 1,
      tier_2_count: 0,
      tier_3_count: 0,
      required_modalities: ["mcq"],
    },
  })
  const evidence = {
    retrieval_id: "RAG-1",
    kb_version: "KB-1",
    rag_version: "RAG-V1",
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

describe("buildGenerationSpec personalization integration", () => {
  test("derives a single goal policy and preserves it in the frozen spec", () => {
    const { snapshot, path, evidence } = fixture()
    const result = buildGenerationSpec({
      run_id: "RUN-POLICY-1",
      profile_snapshot: snapshot,
      path_node: path,
      evidence_pack: evidence,
      versions: { prompt_version: "P1", model_config_hash: "M1" },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.spec.personalization_policy).toMatchObject({
      path_id: "NODE-1",
      goal_profile: "coursework",
      learner_level: "basic",
      progress_state: "building",
    })
    expect(result.spec.personalization_policy).toBeDefined()
    expect(validateRoleCSchema("generation_spec.schema.json", result.spec)).toMatchObject({
      ok: true,
      issues: [],
    })
  })

  test("goal policy does not alter target facts or objective behavior", () => {
    const { snapshot, path, evidence } = fixture()
    const result = buildGenerationSpec({
      run_id: "RUN-POLICY-2",
      profile_snapshot: snapshot,
      path_node: path,
      evidence_pack: evidence,
      versions: { prompt_version: "P1", model_config_hash: "M1" },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.spec.targets[0]).toMatchObject({
      objective_id: "O1",
      required_fact_ids: ["F001"],
      observable_behavior: "recognize",
    })
  })
})
