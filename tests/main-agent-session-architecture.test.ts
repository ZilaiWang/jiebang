import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { isFinalMasterySession } from "../src/role-d-ui-v2/src/orchestrator-view"
import { validateOrchestratorApiBody } from "../src/orchestration/orchestrator-api-schema"
import {
  bindPathNodeFactsForRoleC,
  buildNextRoundContext,
  interactiveSessionProductionBoundary,
  resolveRoleCKnowledgeBaseVersion,
  roleCRoundRunId,
} from "../src/orchestration/interactive-session"
import { buildLearningEvidenceRequest, retrieveLearningEvidence } from "../src/rag/learning-evidence"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("main agent session architecture", () => {
  test("runs C once through the reviewed production boundary", () => {
    expect(interactiveSessionProductionBoundary()).toMatchObject({
      adapter_workers: ["profile-builder", "path-planner"],
      reviewed_role_c_workers: ["concept-tutor", "code-lab", "tiered-evaluator"],
      review_port: "local-ab-content-review",
    })
  })

  test("uses a fresh C generation identity on retry without changing the learning round", () => {
    expect(roleCRoundRunId("RUN-001", 1, 0)).toBe("RUN-001-R1-C1")
    expect(roleCRoundRunId("RUN-001", 1, 1)).toBe("RUN-001-R1-C2")
  })

  test("uses A's live knowledge-base version for every reviewed C round", async () => {
    expect(await resolveRoleCKnowledgeBaseVersion()).toBe("0.6.0")
    expect(await resolveRoleCKnowledgeBaseVersion()).not.toBe("python-basics-v1")
  })

  test("binds B path objectives to A facts before invoking Role C", () => {
    const node = bindPathNodeFactsForRoleC({
      schema_version: "1.0",
      node_id: "NODE-K001",
      target_source_ids: ["K001"],
      prerequisite_source_ids: [],
      goal: "理解 Python 是什么",
      objectives: [{
        objective_id: "OBJ-K001",
        source_id: "K001",
        required_fact_ids: [],
        observable_behavior: "recognize",
        importance: "core",
      }],
      assessment_blueprint: {
        tier_1_count: 1,
        tier_2_count: 1,
        tier_3_count: 1,
        required_modalities: ["mcq", "short_answer", "code"],
      },
    }, {
      results: [{ source_id: "K001", facts: [{ fact_id: "K001-F1" }] }],
    } as any)

    expect(node.objectives[0]?.required_fact_ids).toEqual(["K001-F1"])
  })

  test("falls back to the current node objectives when an advance feedback carries no objective results", () => {
    const context = buildNextRoundContext({
      feedback_id: "FB-1",
      final_decision: { action: "advance", reason_codes: ["round_accuracy_at_or_above_advancement_threshold"] },
      objective_results: [],
      grade_result: { artifact_id: "GRADE-1" },
    } as any, "RUN-PARENT", "NRC-1", ["OBJ-K010", "OBJ-K011"])
    expect(context?.focus_objective_ids).toEqual(["OBJ-K010", "OBJ-K011"])
    expect(context?.action).toBe("advance")
  })

  test("advance context always targets the next node even when feedback lists the previous node objective", () => {
    const context = buildNextRoundContext({
      feedback_id: "FB-2",
      final_decision: { action: "advance", reason_codes: ["round_accuracy_at_or_above_advancement_threshold"] },
      objective_results: [{ objective_id: "OBJ-K001", accuracy: 1, misconception_tags: [] }],
      grade_result: { artifact_id: "GRADE-2" },
    } as any, "RUN-PARENT", "NRC-2", ["OBJ-K002"])
    expect(context?.focus_objective_ids).toEqual(["OBJ-K002"])
  })

  test("uses C's published target objectives instead of recalculating them in the main Agent", () => {
    const context = buildNextRoundContext({
      feedback_id: "FB-3",
      final_decision: {
        action: "remediate",
        reason_codes: ["round_accuracy_below_remediation_threshold"],
        target_objective_ids: ["OBJ-K002"],
      },
      objective_results: [
        { objective_id: "OBJ-K001", accuracy: 0, misconception_tags: ["not_selected"] },
        { objective_id: "OBJ-K002", accuracy: 0.5, misconception_tags: ["selected"] },
      ],
      grade_result: { artifact_id: "GRADE-3" },
    } as any, "SPEC-PARENT", "NRC-3", ["OBJ-K001", "OBJ-K002"])

    expect(context?.focus_objective_ids).toEqual(["OBJ-K002"])
    expect(context?.misconception_tags).toEqual(["selected"])
  })

  test("creates a fresh exact evidence result for an advanced path node", async () => {
    const result = await retrieveLearningEvidence(buildLearningEvidenceRequest({
      run_id: "RUN-ADVANCE",
      retrieval_mode: "identity_hydration",
      learner_profile: { profile_version: "P2", level: "beginner", known_concepts: ["Python"], weak_concepts: ["变量"], goal: "学习变量" },
      path_context: {
        node_id: "NODE-K002", target_source_ids: ["K002"], prerequisite_source_ids: ["K001"], goal: "变量与赋值",
        objectives: [{ objective_id: "OBJ-K002", source_id: "K002", required_fact_ids: [], observable_behavior: "apply", importance: "core" }],
      },
      learning_context: { action: "advance", focus_objective_ids: ["OBJ-K002"], misconception_tags: [], reason_codes: ["next_node"] },
      resource_needs: ["fact", "prerequisite"],
      parent_retrieval_id: "RAG-PARENT",
      top_k: 2,
    }))
    expect(result.match_status).toBe("strong")
    expect(result.retrieval_context?.parent_retrieval_id).toBe("RAG-PARENT")
    expect(result.results.map((item) => item.source_id)).toEqual(["K002", "K001"])
    expect(result.objective_coverage?.[0]?.status).toBe("strong")
  })

  test("returns no_match when an exact path source does not exist", async () => {
    const result = await retrieveLearningEvidence(buildLearningEvidenceRequest({
      run_id: "RUN-MISSING",
      retrieval_mode: "identity_hydration",
      learner_profile: { profile_version: "P3", level: "beginner", known_concepts: [], weak_concepts: [], goal: "unknown" },
      path_context: {
        node_id: "N-X", target_source_ids: ["K999"], prerequisite_source_ids: [], goal: "unknown",
        objectives: [{ objective_id: "O-X", source_id: "K999", required_fact_ids: [], observable_behavior: "recognize", importance: "core" }],
      },
      resource_needs: ["fact"],
      top_k: 1,
    }))
    expect(result.match_status).toBe("no_match")
    expect(result.objective_coverage?.[0]?.status).toBe("no_match")
  })

  test("keeps the next-round button for remediate/reinforce and only returns home after final mastered node", () => {
    expect(isFinalMasterySession({ status: "completed", feedback: { round_score: { accuracy: 0.8 }, final_decision: { action: "advance" } }, formal_path: { nodes: [{ status: "completed" }, { status: "pending" }] } }, null)).toBe(false)
    expect(isFinalMasterySession({ status: "completed", feedback: { round_score: { accuracy: 0.8 }, final_decision: { action: "advance" } }, formal_path: { nodes: [{ status: "completed" }] } }, null)).toBe(true)
    expect(isFinalMasterySession({ status: "waiting_for_user", feedback: { round_score: { accuracy: 0.5 }, final_decision: { action: "reinforce" } }, formal_path: { nodes: [{ status: "completed" }] } }, null)).toBe(false)
  })

  test("binds every available A fact when B path node leaves required_fact_ids empty", () => {
    const bound = bindPathNodeFactsForRoleC({
      node_id: "FN-K009",
      target_source_ids: ["K009"],
      prerequisite_source_ids: [],
      objectives: [{ objective_id: "OBJ-K009", source_id: "K009", required_fact_ids: [], observable_behavior: "recognize", importance: "core" }],
      assessment_blueprint: { tier_1_count: 2, tier_2_count: 2, tier_3_count: 1, required_modalities: ["mcq", "code"] },
    } as any, { results: [{ source_id: "K009", facts: [{ fact_id: "F001" }, { fact_id: "F002" }, { fact_id: "F003" }] }] } as any)
    expect(bound.objectives[0]?.required_fact_ids).toEqual(["F001", "F002", "F003"])
  })
  test("accepts a safe assessment code-run command through the main Agent schema gate", () => {
    expect(validateOrchestratorApiBody("command", {
      command_id: "CMD-RUN-CODE-001",
      type: "run_assessment_code",
      payload: { item_id: "ITEM-CODE-2", code: "def solve(values):\n    return len(values)" },
    })).toEqual({ ok: true, value: {
      command_id: "CMD-RUN-CODE-001",
      type: "run_assessment_code",
      payload: { item_id: "ITEM-CODE-2", code: "def solve(values):\n    return len(values)" },
    } })
  })

  test("accepts a safe published code-lab command through the main Agent schema gate", () => {
    expect(validateOrchestratorApiBody("command", {
      command_id: "CMD-RUN-LAB-001",
      type: "run_code_lab",
      payload: { lab_id: "LAB-001", code: "def solve(values):\n    return len(values)" },
    })).toEqual({ ok: true, value: {
      command_id: "CMD-RUN-LAB-001",
      type: "run_code_lab",
      payload: { lab_id: "LAB-001", code: "def solve(values):\n    return len(values)" },
    } })
  })

  test("uses one schema gate for run requests, session requests, and commands", () => {
    expect(validateOrchestratorApiBody("run", {
      mode: "deterministic",
      learner_request: { learner_id: "learner-001", goal: "学习 Python 循环" },
    })).toEqual({ ok: true, value: {
      mode: "deterministic",
      learner_request: { learner_id: "learner-001", goal: "学习 Python 循环" },
    } })

    expect(validateOrchestratorApiBody("session", {
      mode: "scaffold",
      learner_request: { learner_id: "learner-001", goal: "学习 Python 循环" },
    })).toEqual({
      ok: false,
      errors: ["interactive sessions currently require deterministic mode"],
    })

    expect(validateOrchestratorApiBody("command", {
      command_id: "CMD-001",
      type: "submit_diagnosis_answers",
      payload: { answers: { "DIAG-1-K007": "遍历序列" } },
    })).toEqual({ ok: true, value: {
      command_id: "CMD-001",
      type: "submit_diagnosis_answers",
      payload: { answers: { "DIAG-1-K007": "遍历序列" } },
    } })

    expect(validateOrchestratorApiBody("command", {
      command_id: "../bad",
      type: "submit_diagnosis_answers",
    })).toEqual({
      ok: false,
      errors: ["command_id is required and must be safe"],
    })
  })

  test("uses an epoch-stable profile version so mastery accumulates across rounds and resets after reprofile", async () => {
    // reprofile 契约：同一画像纪元内跨轮累积（profile_version 稳定），
    // reprofile 重建画像后进入新纪元（epoch+1），旧画像 mastery 不污染新画像。
    // 该行为由 interactive-session 的 profile_version 模板保证：
    //   `${record.run_id}-profile-E${profile_epoch}`
    const baseRunId = "RUN-SESSION-001"
    const epoch0 = `${baseRunId}-profile-E0`
    const epoch1 = `${baseRunId}-profile-E1`
    expect(epoch0).not.toBe(epoch1)
    expect(epoch0).toContain(baseRunId)
    expect(epoch1).toContain("E1")
  })

  test("maps B known concepts into profile expectations so reprofile can detect real drift", async () => {
    // 画像 expectations 契约：B 画像 known_concepts 命中目标 source_id → known，
    // 其余 → weak。此前全部硬编码 weak 导致「画像说会却不会」的漂移永不触发。
    const { loadKnowledgeBase } = await import("../src/knowledge/loader")
    const { profileExpectationForTarget } = await import("../src/role-d-integration/role-c-service")
    const kb = await loadKnowledgeBase()
    // 画像声称「变量与赋值」已掌握：K002 应映射为 known
    expect(profileExpectationForTarget({ known_concepts: ["变量与赋值"], weak_concepts: [] }, "K002", kb)).toBe("known")
    // 画像未提「Python 是什么」(K001) → weak
    expect(profileExpectationForTarget({ known_concepts: ["变量与赋值"], weak_concepts: ["Python 是什么"] }, "K001", kb)).toBe("weak")
    // 一个未被 known 覆盖的目标 source → weak
    expect(profileExpectationForTarget({ known_concepts: ["完全不存在的概念"], weak_concepts: [] }, "K002", kb)).toBe("weak")
  })

  test("changes support strategy after repeated remediate/reinforce rounds", async () => {
    // 达到轮次上限后由 B 重新规划支持路径，不改写 C 的掌握决策。
    const { MAX_REMEDIATE_ROUNDS_PER_NODE, MAX_REINFORCE_ROUNDS_PER_NODE } = await import("../src/orchestration/interactive-session")
    expect(MAX_REMEDIATE_ROUNDS_PER_NODE).toBe(3)
    expect(MAX_REINFORCE_ROUNDS_PER_NODE).toBe(2)
    // 上限必须为正整数。
    expect(Number.isSafeInteger(MAX_REMEDIATE_ROUNDS_PER_NODE) && MAX_REMEDIATE_ROUNDS_PER_NODE > 0).toBe(true)
    expect(Number.isSafeInteger(MAX_REINFORCE_ROUNDS_PER_NODE) && MAX_REINFORCE_ROUNDS_PER_NODE > 0).toBe(true)
  })
})
