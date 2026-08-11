import { describe, expect, test } from "bun:test"
import {
  normalizeUnifiedArtifact,
  normalizeUnifiedHandoff,
  normalizeUnifiedRagResult,
  unifiedBoundaryReport,
} from "../src/unified-contract"

describe("unified contract", () => {
  test("normalizes camelCase and snake_case handoff payloads into the same canonical shape", () => {
    const shared = {
      b_profile: {
        learner_id: "demo_loop_weak_001",
        level: "beginner",
        known_concepts: ["变量"],
        weak_concepts: ["循环", "列表"],
        goal: "完成成绩统计程序",
      },
      c_artifacts: [],
      workflow_events: [],
    }

    const camel = normalizeUnifiedHandoff({
      ...shared,
      a_rag_result: {
        query: "循环",
        topK: 1,
        results: [{
          sourceId: "K007",
          title: "for 循环",
          difficulty: "beginner",
          score: 35,
          reason: "命中循环",
          snippet: "用于遍历序列",
          file: "K007_for_loop.md",
          facts: [{ sourceId: "K007", factId: "F001", content: "for 循环用于遍历序列" }],
          examples: [],
          practiceTasks: [],
          quizItems: [],
          retrievalTrace: {
            matchedKeywords: ["循环"],
            matchedFields: ["keywords"],
            difficultyMatch: true,
            scoreBreakdown: { keyword: 10, title: 0, facts: 0, practiceTasks: 0, difficulty: 3, bonus: 22 },
          },
        }],
      },
    })

    const snake = normalizeUnifiedHandoff({
      ...shared,
      a_rag_result: {
        query: "循环",
        top_k: 1,
        results: [{
          source_id: "K007",
          title: "for 循环",
          difficulty: "beginner",
          score: 35,
          reason: "命中循环",
          snippet: "用于遍历序列",
          file: "K007_for_loop.md",
          facts: [{ source_id: "K007", fact_id: "F001", content: "for 循环用于遍历序列" }],
          examples: [],
          practice_tasks: [],
          quiz_items: [],
          retrieval_trace: {
            matched_keywords: ["循环"],
            matched_fields: ["keywords"],
            difficulty_match: true,
            score_breakdown: { keyword: 10, title: 0, facts: 0, practiceTasks: 0, difficulty: 3, bonus: 22 },
          },
        }],
      },
    })

    expect(camel.schemaVersion).toBe("1.0")
    expect(camel.retrieval.items[0]).toEqual(snake.retrieval.items[0])
    expect(camel.retrieval.topK).toBe(1)
    expect(snake.retrieval.topK).toBe(1)
  })

  test("preserves missing citations as explicit evidence gaps instead of inventing them", () => {
    const session = normalizeUnifiedHandoff({
      b_profile: {
        learner_id: "demo_loop_weak_001",
        level: "beginner",
        known_concepts: ["变量"],
        weak_concepts: ["循环", "列表"],
        goal: "完成成绩统计程序",
      },
      a_rag_result: { query: "循环", topK: 0, results: [] },
      c_artifacts: [{
        id: "lesson-1",
        kind: "lesson",
        title: "循环讲义",
        status: "mock",
        content: "这一段还没有引用。",
        citations: [],
      }],
      workflow_events: [],
    })

    expect(session.artifacts[0].evidenceStatus).toBe("gap")
    expect(session.evidenceGaps).toEqual(["lesson-1"])
  })

  test("normalizes artifact citations and keeps invalid references visible", () => {
    const artifact = normalizeUnifiedArtifact(
      {
        id: "lesson-invalid-citation",
        kind: "lesson",
        title: "错误引用讲义",
        status: "mock",
        content: "这条引用不存在。",
        citations: [{ source_id: "MISSING", fact_id: "F404" }],
      },
      new Set(["K007-F001"]),
    )

    expect(artifact.evidenceStatus).toBe("gap")
    expect(artifact.citations).toEqual([{ sourceId: "MISSING", factId: "F404" }])
  })

  test("normalizes a raw RAG result into canonical retrieval fields", () => {
    const rag = normalizeUnifiedRagResult({
      query: "循环",
      top_k: 1,
      results: [{
        source_id: "K007",
        title: "for 循环",
        difficulty: "beginner",
        score: 2,
        facts: [],
        retrieval_trace: {
          score_breakdown: { practice_tasks: 2 },
          matched_keywords: ["循环"],
          matched_fields: ["keywords"],
          difficulty_match: true,
        },
      }],
    })

    expect(rag.topK).toBe(1)
    expect(rag.results[0].sourceId).toBe("K007")
    expect(rag.results[0].trace.scoreBreakdown.practiceTasks).toBe(2)
    expect(rag.results[0].trace.scoreBreakdown).not.toHaveProperty("practice_tasks")
  })

  test("is idempotent for the canonical handoff shape", () => {
    const once = normalizeUnifiedHandoff({
      eventMode: "live",
      session_id: "session-idempotent",
      updated_at: "2026-07-31T10:00:00.000Z",
      b_profile: {
        learner_id: "learner-idempotent",
        level: "intermediate",
        known_concepts: ["变量"],
        weak_concepts: ["循环"],
        goal: "完成循环练习",
      },
      b_provenance: {
        conflicts: [{
          concept: "循环",
          self_claim: "known",
          objective_verdict: "weak",
          resolution: "weak",
          rule: "objective_first",
        }],
      },
      a_rag_result: {
        query: "循环",
        top_k: 1,
        results: [{
          source_id: "K007",
          title: "for 循环",
          difficulty: "beginner",
          score: 35,
          reason: "命中循环",
          snippet: "用于遍历序列",
          file: "K007_for_loop.md",
          facts: [{ source_id: "K007", fact_id: "F001", content: "for 循环用于遍历序列" }],
          examples: [{ title: "遍历列表", code: "for item in items: print(item)", explanation: "逐项访问" }],
          practice_tasks: ["遍历一个列表"],
          quiz_items: [{ level: 1, question: "for 的作用是什么？", answer: "遍历" }],
          retrieval_trace: {
            matched_keywords: ["循环"],
            matched_fields: ["keywords"],
            difficulty_match: true,
            score_breakdown: { keyword: 10, title: 5, facts: 5, practice_tasks: 2, difficulty: 3, bonus: 10 },
          },
        }],
      },
      c_artifacts: [{
        id: "lesson-idempotent",
        kind: "lesson",
        title: "循环讲义",
        status: "real",
        content: "循环可以遍历序列。",
        citations: [{ source_id: "K007", fact_id: "F001" }],
      }],
      workflow_events: [{
        id: "event-1",
        agent: "A",
        stage: "retrieval",
        status: "completed",
        summary: "检索完成",
        timestamp: "2026-07-31T09:59:00.000Z",
      }],
      learning_path: [{
        id: "path-1",
        title: "循环基础",
        difficulty: "beginner",
        status: "current",
        reason: "当前薄弱点",
      }],
    })

    const twice = normalizeUnifiedHandoff(once)

    expect(twice).toEqual(once)
    expect(twice.conflicts).toHaveLength(1)
    expect(twice.retrieval.items).toHaveLength(1)
    expect(twice.retrieval.items[0].trace.matchedKeywords).toEqual(["循环"])
    expect(twice.workflow).toEqual(once.workflow)
    expect(twice.path).toEqual(once.path)
  })

  test("accepts canonical retrieval items without converting back to RAG field names", () => {
    const rag = normalizeUnifiedRagResult({
      query: "函数",
      topK: 1,
      items: [{
        sourceId: "K010",
        title: "函数",
        difficulty: "basic",
        score: 18,
        reason: "命中函数",
        snippet: "函数封装可复用逻辑",
        file: "K010_function.md",
        facts: [{ sourceId: "K010", factId: "F001", content: "函数可以复用" }],
        examples: [],
        practiceTasks: ["定义函数"],
        quizItems: [],
        trace: {
          matchedKeywords: ["函数"],
          matchedFields: ["title"],
          difficultyMatch: true,
          scoreBreakdown: { keyword: 8, title: 5, facts: 2, practiceTasks: 0, difficulty: 3, bonus: 0 },
        },
      }],
    })

    expect(rag.results).toHaveLength(1)
    expect(rag.results[0].sourceId).toBe("K010")
    expect(rag.results[0].practiceTasks).toEqual(["定义函数"])
    expect(rag.results[0].trace.matchedFields).toEqual(["title"])
  })

  test("reports the deepest boundary actually present instead of always claiming a full handoff", () => {
    const bOnly = normalizeUnifiedHandoff({
      b_profile: { learner_id: "L1", level: "beginner", known_concepts: [], weak_concepts: [], goal: "学习变量" },
    })
    expect(unifiedBoundaryReport(bOnly).boundary).toBe("B_PROFILE_TO_A_RAG_REQUEST")

    const throughA = normalizeUnifiedHandoff({
      b_profile: { learner_id: "L1", level: "beginner", known_concepts: [], weak_concepts: ["变量"], goal: "学习变量" },
      a_rag_result: {
        query: "变量",
        topK: 1,
        results: [{ source_id: "K002", title: "变量", difficulty: "beginner", score: 20, facts: [] }],
      },
    })
    expect(unifiedBoundaryReport(throughA).boundary).toBe("A_RAG_RESULT_TO_C_CONTENT")

    const full = normalizeUnifiedHandoff({
      ...throughA,
      a_rag_result: {
        query: "变量",
        topK: 1,
        results: [{ source_id: "K002", title: "变量", difficulty: "beginner", score: 20, facts: [] }],
      },
      c_artifacts: [{ id: "lesson-K002", kind: "lesson", title: "变量讲义", content: "变量基础", citations: [] }],
    })
    expect(unifiedBoundaryReport(full).boundary).toBe("A_B_C_D_FULL_HANDOFF")
  })

  test("preserves explicit A and C segments even when no result or artifact is published", () => {
    const noMatch = normalizeUnifiedHandoff({
      b_profile: { learner_id: "L-no-match", level: "beginner", goal: "未收录目标" },
      a_rag_result: { query: "未收录目标", topK: 0, results: [] },
    })
    expect(unifiedBoundaryReport(noMatch).boundary).toBe(
      "A_RAG_RESULT_TO_C_CONTENT",
    )

    const blockedC = normalizeUnifiedHandoff({
      b_profile: { learner_id: "L-blocked", level: "beginner", goal: "变量" },
      a_rag_result: { query: "变量", topK: 0, results: [] },
      c_artifacts: [],
    })
    expect(unifiedBoundaryReport(blockedC).boundary).toBe(
      "A_B_C_D_FULL_HANDOFF",
    )
  })

  test("keeps C's public evidence projection fields in the D retrieval view", () => {
    const handoff = normalizeUnifiedHandoff({
      b_profile: { learner_id: "L-public-pack", level: "basic", goal: "字典" },
      a_rag_result: {
        query: "字典",
        top_k: 1,
        results: [{
          source_id: "K010",
          title: "字典",
          difficulty: "basic",
          rank_score: 27,
          match_reason: "命中字典",
          source_file: "K010_dict.md",
          facts: [],
          retrieval_trace: {},
        }],
      },
    })
    expect(handoff.retrieval.items[0]).toMatchObject({
      sourceId: "K010",
      score: 27,
      reason: "命中字典",
      file: "K010_dict.md",
    })
  })
})
