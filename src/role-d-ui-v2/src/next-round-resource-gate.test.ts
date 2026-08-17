import { describe, expect, test } from "bun:test"
import { currentAssessmentAlreadyGraded, nextRoundResourceGate } from "./orchestrator-view"

describe("next-round resource gate", () => {
  test("blocks navigation while the main Agent is waiting for C to publish the new round", () => {
    expect(nextRoundResourceGate({
      status: "running",
      round_no: 2,
      feedback: { final_decision: { action: "remediate" } },
      learning_resources: { concept_lesson: { artifact_id: "OLD" } },
    })).toEqual({
      ready: false,
      label: "主 Agent正在调用 C 生成并审核下一轮资源…",
    })
  })

  test("enables navigation only after a new assessment round is publicly ready", () => {
    expect(nextRoundResourceGate({
      status: "waiting_for_user",
      round_no: 2,
      waiting_for: { type: "assessment_answers", items: [{ item_id: "NEW-1" }] },
      feedback: { final_decision: { action: "remediate" }, assessment_items: { items: [{ item_id: "OLD-1" }] } },
      assessment: { artifact_id: "ASSESSMENT-NEW", payload: { items: [{ item_id: "NEW-1" }] } },
      learning_resources: { concept_lesson: { artifact_id: "LESSON-NEW" } },
    })).toEqual({ ready: true, label: "进入下一轮学习" })
  })

  test("rejects a waiting session when it still exposes the previous assessment items", () => {
    expect(nextRoundResourceGate({
      status: "waiting_for_user",
      round_no: 2,
      waiting_for: { type: "assessment_answers", items: [{ item_id: "OLD-1" }] },
      feedback: { final_decision: { action: "reinforce" }, assessment_items: { items: [{ item_id: "OLD-1" }] } },
      assessment: { payload: { items: [{ item_id: "OLD-1" }] } },
      learning_resources: { concept_lesson: { artifact_id: "OLD-LESSON" } },
    }).ready).toBe(false)
  })
})

describe("current assessment feedback identity", () => {
  test("上一轮反馈不能把已经发布的新一轮测评判为结束", () => {
    expect(currentAssessmentAlreadyGraded({
      assessment: { payload: { items: [{ item_id: "ROUND-2-A" }, { item_id: "ROUND-2-B" }] } },
      feedback: { assessment_items: { items: [{ item_id: "ROUND-1-A" }, { item_id: "ROUND-1-B" }] } },
    })).toBe(false)
  })

  test("反馈题目身份与当前测评完全一致时才判为本轮已评分", () => {
    expect(currentAssessmentAlreadyGraded({
      assessment: { payload: { items: [{ item_id: "A" }, { item_id: "B" }] } },
      feedback: { assessment_items: { items: [{ item_id: "B" }, { item_id: "A" }] } },
    })).toBe(true)
  })
})
