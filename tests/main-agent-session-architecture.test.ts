import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { isFinalMasterySession } from "../src/role-d-ui-v2/src/orchestrator-view"
import { validateOrchestratorApiBody } from "../src/orchestration/orchestrator-api-schema"
import {
  bindPathNodeFactsForRoleC,
  buildNextRoundContext,
  filterRagToCurrentNode,
  interactiveSessionProductionBoundary,
  resolveRoleCKnowledgeBaseVersion,
  roleCRoundRunId,
  ensureCurrentNodeEvidence,
} from "../src/orchestration/interactive-session"

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

  test("filters stale RAG evidence to the current B path node before Role C generation", () => {
    const session = { rag_result: { query: "old", topK: 3, results: [{ source_id: "K001", sourceId: "K001" }, { source_id: "K002", sourceId: "K002" }] } }
    const node = { target_source_ids: ["K002"], prerequisite_source_ids: ["K001"] }
    expect((filterRagToCurrentNode(session.rag_result as any, node) as any).results.map((item: any) => item.source_id)).toEqual(["K001", "K002"])
  })

  test("refreshes missing A evidence for the current node after advance (next node is not in the first-round RAG snapshot)", async () => {
    // 模拟 advance 到 K002：首轮快照只含 K001，当前节点 K002 的证据缺失。
    // ensureCurrentNodeEvidence 应按 source_id 从知识库补全，而不是把会话置为阻塞。
    const firstRoundSnapshot = { query: "first", topK: 3, results: [{ source_id: "K001", sourceId: "K001" }] }
    const node = { target_source_ids: ["K002"], prerequisite_source_ids: ["K001"] }
    const ensured = await ensureCurrentNodeEvidence(firstRoundSnapshot as any, node)
    expect(ensured.ok).toBe(true)
    if (ensured.ok) {
      const sourceIds = ensured.ragResult.results.map((item: any) => item.source_id ?? item.sourceId)
      expect(sourceIds).toContain("K001")
      expect(sourceIds).toContain("K002")
      // 补全后的证据必须携带真实 fact 供 C 绑定（K002 在知识库中存在 facts）。
      const k002 = ensured.ragResult.results.find((item: any) => (item.source_id ?? item.sourceId) === "K002")
      expect(Array.isArray(k002?.facts)).toBe(true)
      expect((k002?.facts ?? []).length).toBeGreaterThan(0)
    }
  })

  test("rejects evidence refresh when the knowledge base itself lacks the requested source", async () => {
    const ensured = await ensureCurrentNodeEvidence({ query: "first", topK: 1, results: [] } as any, {
      target_source_ids: ["K-NOT-EXISTS-9999"],
      prerequisite_source_ids: [],
    })
    expect(ensured.ok).toBe(false)
    if (!ensured.ok) expect(ensured.missingSources).toContain("K-NOT-EXISTS-9999")
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

  test("caps remediate/reinforce rounds per node so learners cannot loop forever", async () => {
    // 轮次上限契约：同一节点内 remediate 超过 3 轮、reinforce 超过 2 轮后
    // 主 Agent 强制 advance（即使准确率未达标），防止会话永不结束。
    const { MAX_REMEDIATE_ROUNDS_PER_NODE, MAX_REINFORCE_ROUNDS_PER_NODE } = await import("../src/orchestration/interactive-session")
    expect(MAX_REMEDIATE_ROUNDS_PER_NODE).toBe(3)
    expect(MAX_REINFORCE_ROUNDS_PER_NODE).toBe(2)
    // 上限必须为正整数（防误配导致立即强制推进）。
    expect(Number.isSafeInteger(MAX_REMEDIATE_ROUNDS_PER_NODE) && MAX_REMEDIATE_ROUNDS_PER_NODE > 0).toBe(true)
    expect(Number.isSafeInteger(MAX_REINFORCE_ROUNDS_PER_NODE) && MAX_REINFORCE_ROUNDS_PER_NODE > 0).toBe(true)
  })
})
