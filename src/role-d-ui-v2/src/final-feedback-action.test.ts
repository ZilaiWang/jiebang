import { describe, expect, test } from "bun:test"
import { finalFeedbackAction } from "./orchestrator-view"

describe("final feedback interaction", () => {
  const completed = {
    status: "completed",
    current_path_node: null,
    feedback: { round_score: { accuracy: 0.9 }, final_decision: { action: "advance" } },
    formal_path: { nodes: [{ status: "completed" }] },
  }

  test("keeps the learner on feedback after closing the celebration", () => {
    expect(finalFeedbackAction(completed)).toEqual({ label: "返回首页", ready: true })
  })
})
