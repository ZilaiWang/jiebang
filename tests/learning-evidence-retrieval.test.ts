import { describe, expect, test } from "bun:test"
import { loadKnowledgeBase } from "../src/knowledge/loader"
import {
  buildLearningEvidenceRequest,
  retrieveLearningEvidence,
  type LearningEvidenceRequest,
} from "../src/rag/learning-evidence"
import {
  createEvidenceAwareBPathPlanningPort,
  createRoleCRecoveryEvidenceRefreshPort,
} from "../src/role-d-integration/role-c-service"
import type { RoleBPathPlanningRequest } from "../src/role-c-content/contracts/recovery"

const learner: LearningEvidenceRequest["learner_profile"] = {
  profile_version: "PROFILE-V1",
  level: "beginner",
  known_concepts: [],
  weak_concepts: ["循环"],
  goal: "学习循环",
}

function loopPath(requiredFactIds: string[] = []) {
  return {
    node_id: "NODE-K007",
    target_source_ids: ["K007"],
    prerequisite_source_ids: [],
    goal: "理解并应用 for 循环",
    objectives: [{
      objective_id: "OBJ-LOOP",
      source_id: "K007",
      required_fact_ids: requiredFactIds,
      observable_behavior: "apply" as const,
      importance: "core" as const,
    }],
  }
}

describe("learning evidence retrieval", () => {
  test("difficulty can rank relevant items but cannot create an unrelated match", async () => {
    const request = buildLearningEvidenceRequest({
      run_id: "RUN-NO-MATCH",
      retrieval_mode: "semantic_discovery",
      learner_profile: { ...learner, weak_concepts: [], goal: "学习不存在的量子香蕉协议" },
      resource_needs: ["fact"],
      top_k: 3,
    })

    const result = await retrieveLearningEvidence(request)

    expect(result.match_status).toBe("no_match")
    expect(result.results).toHaveLength(0)
    expect(result.retrieval_context?.retrieval_mode).toBe("semantic_discovery")
  })

  test("identity hydration preserves exact source/fact identity and objective coverage", async () => {
    const knowledgeBase = await loadKnowledgeBase()
    const factId = knowledgeBase.items.find((item) => item.sourceId === "K007")!.facts[0]!.factId
    const request = buildLearningEvidenceRequest({
      run_id: "RUN-HYDRATE",
      retrieval_mode: "identity_hydration",
      learner_profile: learner,
      path_context: loopPath([factId]),
      learning_context: {
        action: "advance",
        focus_objective_ids: ["OBJ-LOOP"],
        misconception_tags: [],
        reason_codes: ["path_node_activated"],
      },
      resource_needs: ["fact", "example", "practice_task"],
      top_k: 1,
    })

    const result = await retrieveLearningEvidence(request, knowledgeBase)

    expect(result.match_status).toBe("strong")
    expect(result.results[0]?.source_id).toBe("K007")
    expect(result.results[0]?.facts.map((fact) => fact.fact_id)).toEqual([factId])
    expect(result.objective_coverage?.[0]).toMatchObject({
      objective_id: "OBJ-LOOP",
      source_id: "K007",
      status: "strong",
      missing_fact_ids: [],
    })
    expect(result.retrieval_id).toStartWith("RAG-")
    expect(result.retrieval_context?.request_hash).toStartWith("sha256:")
  })

  test("missing required facts produce a target-level weak result", async () => {
    const request = buildLearningEvidenceRequest({
      run_id: "RUN-MISSING-FACT",
      retrieval_mode: "evidence_repair",
      learner_profile: learner,
      path_context: loopPath(["F999"]),
      resource_needs: ["fact"],
      top_k: 1,
    })

    const result = await retrieveLearningEvidence(request)

    expect(result.match_status).toBe("weak")
    expect(result.objective_coverage?.[0]?.status).toBe("weak")
    expect(result.objective_coverage?.[0]?.missing_fact_ids).toEqual(["F999"])
  })

  test("multiple objectives on one source merge their required facts", async () => {
    const knowledgeBase = await loadKnowledgeBase()
    const [first, second] = knowledgeBase.items.find((item) => item.sourceId === "K007")!.facts
    const path = loopPath([first!.factId])
    path.objectives.push({
      objective_id: "OBJ-TRACE-LOOP",
      source_id: "K007",
      required_fact_ids: [second!.factId],
      observable_behavior: "apply",
      importance: "core",
    })
    const request = buildLearningEvidenceRequest({
      run_id: "RUN-MERGE-FACTS",
      retrieval_mode: "identity_hydration",
      learner_profile: learner,
      path_context: path,
      resource_needs: ["fact"],
      top_k: 1,
    })

    const result = await retrieveLearningEvidence(request, knowledgeBase)

    expect(result.match_status).toBe("strong")
    expect(new Set(result.results[0]?.facts.map((fact) => fact.fact_id))).toEqual(
      new Set([first!.factId, second!.factId]),
    )
    expect(result.objective_coverage?.every((entry) => entry.status === "strong")).toBe(true)
  })

  test("request and retrieval identities are stable for the same context and change with the round action", async () => {
    const common = {
      run_id: "RUN-LINEAGE",
      retrieval_mode: "identity_hydration" as const,
      learner_profile: learner,
      path_context: loopPath(),
      resource_needs: ["fact"] as const,
      top_k: 1,
    }
    const first = buildLearningEvidenceRequest({
      ...common,
      resource_needs: [...common.resource_needs],
      learning_context: { action: "advance", focus_objective_ids: ["OBJ-LOOP"], misconception_tags: [], reason_codes: [] },
    })
    const duplicate = buildLearningEvidenceRequest({
      ...common,
      resource_needs: [...common.resource_needs],
      learning_context: { action: "advance", focus_objective_ids: ["OBJ-LOOP"], misconception_tags: [], reason_codes: [] },
    })
    const remediate = buildLearningEvidenceRequest({
      ...common,
      resource_needs: [...common.resource_needs],
      learning_context: { action: "remediate", focus_objective_ids: ["OBJ-LOOP"], misconception_tags: ["off_by_one"], reason_codes: [] },
      parent_retrieval_id: (await retrieveLearningEvidence(first)).retrieval_id,
    })

    expect(first.request_id).toBe(duplicate.request_id)
    expect(remediate.request_id).not.toBe(first.request_id)
    const result = await retrieveLearningEvidence(remediate)
    expect(result.retrieval_context?.parent_retrieval_id).toStartWith("RAG-")
  })

  test("recovery evidence keeps the GenerationSpec objective identity", async () => {
    const knowledgeBase = await loadKnowledgeBase()
    const factId = knowledgeBase.items.find((item) => item.sourceId === "K007")!.facts[0]!.factId
    const port = createRoleCRecoveryEvidenceRefreshPort({
      kbVersion: knowledgeBase.version,
      knowledgeBase,
    })

    const evidence = await port.refreshEvidence({
      schema_version: "1.0",
      request_id: "EGR-OBJECTIVE-IDENTITY",
      run_id: "RUN-RECOVERY",
      target_source_ids: ["K007"],
      missing_type: "fact",
      reason: "补齐目标证据",
      learner_level: "beginner",
      required_facts: [{ source_id: "K007", fact_id: factId }],
      target_objectives: [{
        objective_id: "OBJ-FROM-SPEC",
        source_id: "K007",
        required_fact_ids: [factId],
        observable_behavior: "apply",
        importance: "core",
      }],
    })

    expect(evidence.match_status).toBe("strong")
    expect(evidence.objective_coverage?.[0]?.objective_id).toBe("OBJ-FROM-SPEC")
  })

  test("path replanning gives B candidates from a fresh A semantic discovery", async () => {
    const knowledgeBase = await loadKnowledgeBase()
    let received: RoleBPathPlanningRequest | undefined
    const port = createEvidenceAwareBPathPlanningPort(knowledgeBase, {
      async replanLearningPath(request) {
        received = request
        return {
          status: "blocked",
          request_id: request.request_id,
          code: "BLOCKED",
          reason: "capture",
          failed_dimensions: [],
          missing_prerequisite_source_ids: [],
          can_recover: false,
        }
      },
    })
    await port.replanLearningPath({
      schema_version: "1.0",
      request_id: "BPATH-DISCOVERY",
      run_id: "RUN-BPATH",
      current_spec_id: "SPEC-1",
      profile_snapshot: {
        schema_version: "1.0",
        profile_id: "PROFILE-1",
        profile_version: "PROFILE-V1",
        learner_id: "LEARNER-1",
        level: "beginner",
        known_concepts: [],
        weak_concepts: ["循环", "列表"],
        goal: "完成成绩统计程序",
        preferred_contexts: [],
        accommodations: [],
      },
      current_path_node: {
        schema_version: "1.0",
        ...loopPath(),
        assessment_blueprint: {
          tier_1_count: 1,
          tier_2_count: 0,
          tier_3_count: 0,
          required_modalities: ["mcq"],
        },
      },
      failed_dimensions: ["goal_alignment"],
      missing_prerequisite_source_ids: [],
      required_action: "replan_path",
      fix_scope: "new_spec",
      review_instruction_ids: ["REVIEW-1"],
    })

    expect(received?.candidate_retrieval_id).toStartWith("RAG-")
    expect(received?.candidate_source_ids?.length).toBeGreaterThan(0)
    expect(received?.candidate_source_ids).not.toContain("K007")
  })
})
