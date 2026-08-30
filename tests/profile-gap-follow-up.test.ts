import { describe, expect, test } from "bun:test"
import { buildBarrierFollowUpQuestion } from "../src/role-b-profile/profile-gap-questions"

test("builds a follow-up question for a remediate assessment", () => {
  const question = buildBarrierFollowUpQuestion({
    source_id: "DS-LINKED-LIST",
    concept: "链表",
    action: "remediate",
  })
  expect(question).toMatchObject({
    dimension: "learning_barrier",
    source_id: "DS-LINKED-LIST",
    answer_type: "single_choice",
  })
  expect(question.options.length).toBeGreaterThan(3)
})
