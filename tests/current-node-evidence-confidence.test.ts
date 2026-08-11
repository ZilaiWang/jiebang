import { describe, expect, test } from "bun:test"
import { filterRagToCurrentNode } from "../src/orchestration/interactive-session"
import { adaptRagResult } from "../src/role-c-content/contracts/evidence-pack"

describe("current B node evidence confidence", () => {
  test("accepts legacy RAG items whose facts field is absent", () => {
    const filtered = filterRagToCurrentNode({
      query: "学习条件判断",
      learnerLevel: "beginner",
      topK: 5,
      results: [{ sourceId: "K001", source_id: "K001" }],
    } as any, { target_source_ids: ["K001"], prerequisite_source_ids: [] })
    expect(filtered.results).toHaveLength(1)
    expect(filtered.results[0]?.source_id).toBe("K001")
  })

  test("treats an exact source-id selected node with structured facts as strong evidence", () => {
    const filtered: any = filterRagToCurrentNode({
      query: "学习条件判断",
      learnerLevel: "beginner",
      topK: 5,
      results: [{
        sourceId: "K001", source_id: "K001", title: "Python 是什么", difficulty: "beginner", score: 3,
        reason: "query 与知识点内容存在弱匹配", snippet: "Python 是一种通用编程语言。",
        facts: [{ sourceId: "K001", factId: "F001", source_id: "K001", fact_id: "F001", content: "Python 是一种通用编程语言。" }],
        examples: [], practiceTasks: [], quizItems: [], file: "K001.md",
        retrievalTrace: { matchedKeywords: [], matchedFields: ["difficulty"], difficultyMatch: true, scoreBreakdown: { keyword: 0, title: 0, facts: 0, practiceTasks: 0, difficulty: 3, bonus: 0 } },
      }],
    } as any, { target_source_ids: ["K001"], prerequisite_source_ids: [] })
    expect(adaptRagResult(filtered, { kb_version: "test", rag_version: "test" }).match_status).toBe("strong")
  })
})
