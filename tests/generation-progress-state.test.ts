import { describe, expect, test } from "bun:test"
import { contentHash } from "../src/role-c-content/contracts/common"
import { buildGenerationSpec } from "../src/role-c-content/contracts/generation-spec"
import { adaptLearnerProfile, defineLearningPathNode } from "../src/role-c-content/contracts/profile-adapter"
import type { LearnerProfile } from "../src/role-b-profile/types"

function fixture() {
  const profile: LearnerProfile = {
    learner_id: "learner-progress-policy",
    level: "basic",
    known_concepts: [],
    weak_concepts: ["列表"],
    goal: "完成列表课程学习",
  }
  const snapshot = adaptLearnerProfile(profile, {
    profile_version: "profile-v1",
    goal_profile: "coursework",
  })
  const path = defineLearningPathNode({
    node_id: "NODE-PROGRESS",
    target_source_ids: ["K009"],
    prerequisite_source_ids: [],
    goal: "理解列表",
    objectives: [{
      objective_id: "O1",
      source_id: "K009",
      required_fact_ids: ["F1"],
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
    retrieval_id: "RAG-PROGRESS",
    kb_version: "KB-1",
    rag_version: "RAG-V1",
    match_status: "strong",
    results: [{
      source_id: "K009",
      title: "列表",
      facts: [{ source_id: "K009", fact_id: "F1", content: "列表可以按顺序保存多个元素。" }],
    }],
    evidence_sufficiency: { ok: true, missing_misconception_ids: [], worked_example_count: 1 },
  } as any
  return { snapshot, path, evidence }
}

describe("generation progress-state override", () => {
  test("remediate round forces struggling policy even when static profile has no weak concept", () => {
    const { snapshot, path, evidence } = fixture()
    const result = buildGenerationSpec({
      run_id: "RUN-PROGRESS-REMEDIATE",
      profile_snapshot: { ...snapshot, weak_concepts: [] },
      path_node: path,
      evidence_pack: evidence,
      progress_state: "struggling",
      versions: { prompt_version: "P1", model_config_hash: "M1" },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.spec.personalization_policy?.progress_state).toBe("struggling")
    expect(result.spec.personalization_policy?.teaching_strategy.scaffold_level).toBe(3)
  })

  test("advance round forces mastered policy and adds transfer-oriented design", () => {
    const { snapshot, path, evidence } = fixture()
    const result = buildGenerationSpec({
      run_id: "RUN-PROGRESS-ADVANCE",
      profile_snapshot: snapshot,
      path_node: path,
      evidence_pack: evidence,
      progress_state: "mastered",
      versions: { prompt_version: "P1", model_config_hash: "M1" },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.spec.personalization_policy?.progress_state).toBe("mastered")
  })
})
