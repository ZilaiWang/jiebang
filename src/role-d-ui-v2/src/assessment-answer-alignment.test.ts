import { describe, expect, test } from "bun:test"
import { answersMatchAssessmentItems } from "./orchestrator-view"

describe("assessment answer/session alignment", () => {
  test("rejects stale answers after the next round publishes new item IDs", () => {
    const roundOneAnswers = {
      "ITEM-OLD-1": "OPTION-OLD",
      "ITEM-OLD-2": "answer",
    }
    const roundTwoItems = [
      { item_id: "ITEM-NEW-1" },
      { item_id: "ITEM-NEW-2" },
    ]
    expect(answersMatchAssessmentItems(roundTwoItems, roundOneAnswers)).toBe(false)
    expect(answersMatchAssessmentItems(roundTwoItems, {
      "ITEM-NEW-1": "OPTION-NEW",
      "ITEM-NEW-2": "answer",
    })).toBe(true)
  })
})
