import { describe, expect, test } from "bun:test"
import { validateOrchestratorApiBody } from "../src/orchestration/orchestrator-api-schema"

test("accepts a bounded profile gap answer command", () => {
  const result = validateOrchestratorApiBody("command", {
    command_id: "cmd-gap-1",
    type: "submit_profile_gap_answer",
    payload: { question_id: "PROFILE-BARRIER-DS1", source_id: "DS1", answer: "概念忘记了" },
  })
  expect(result.ok).toBe(true)
})

test("rejects unbounded profile gap answer commands", () => {
  const result = validateOrchestratorApiBody("command", {
    command_id: "cmd-gap-2",
    type: "submit_profile_gap_answer",
    payload: { question_id: "../secret", source_id: "DS1", answer: "" },
  })
  expect(result.ok).toBe(false)
})
