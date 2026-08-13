import { describe, expect, test } from "bun:test"

import { unifiedBoundaryReport, normalizeUnifiedHandoff } from "../src/contracts/unified"

describe("unified I/O contract package", () => {
  test("exports a boundary report for the full ABCD handoff", () => {
    const handoff = normalizeUnifiedHandoff({
      b_profile: {
        learner_id: "demo_loop_weak_001",
        level: "beginner",
        known_concepts: ["变量"],
        weak_concepts: ["循环"],
        goal: "完成成绩统计程序",
      },
      a_rag_result: {
        query: "循环",
        topK: 1,
        results: [{
          source_id: "K007",
          title: "for 循环",
          difficulty: "beginner",
          score: 20,
          facts: [{ source_id: "K007", fact_id: "F001", content: "for 循环可用于遍历序列。" }],
        }],
      },
      workflow_events: [],
      c_artifacts: [{
        id: "lesson-K007",
        kind: "lesson",
        title: "for 循环讲义",
        content: "for 循环可用于遍历序列。",
        citations: [{ source_id: "K007", fact_id: "F001" }],
      }],
    })

    expect(unifiedBoundaryReport(handoff)).toEqual({
      boundary: "A_B_C_D_FULL_HANDOFF",
      schemaVersion: "1.0",
      canonicalFields: ["profile", "retrieval", "artifacts", "workflow", "evidenceGaps"],
      evidenceGaps: [],
    })
  })
})
