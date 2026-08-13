import { describe, expect, test } from "bun:test"
import { shouldPollOrchestratorSession } from "./orchestrator-view"

describe("orchestrator polling gate", () => {
  test("polls a running session until the new round is published", () => {
    expect(shouldPollOrchestratorSession({ session_id: "S1", status: "running" })).toBe(true)
    expect(shouldPollOrchestratorSession({ session_id: "S1", status: "waiting_for_user" })).toBe(false)
    expect(shouldPollOrchestratorSession({ session_id: "S1", status: "blocked" })).toBe(false)
  })
})
