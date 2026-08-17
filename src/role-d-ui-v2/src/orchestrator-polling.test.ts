import { describe, expect, test } from "bun:test"
import { shouldPollOrchestratorSession, sessionNeedsEventRefresh } from "./orchestrator-view"

describe("orchestrator polling gate", () => {
  test("polls a running session until the new round is published", () => {
    expect(shouldPollOrchestratorSession({ session_id: "S1", status: "running" })).toBe(true)
    expect(shouldPollOrchestratorSession({ session_id: "S1", status: "waiting_for_user" })).toBe(false)
    expect(shouldPollOrchestratorSession({ session_id: "S1", status: "blocked" })).toBe(false)
  })

  test("refreshes events when commands advance the public session revision", () => {
    expect(sessionNeedsEventRefresh(
      { session_id: "S1", revision: 1, events: [{ event_id: "E1" }] },
      { session_id: "S1", revision: 2 },
    )).toBe(true)
    expect(sessionNeedsEventRefresh(
      { session_id: "S1", revision: 1, events: [{ event_id: "E1" }] },
      { session_id: "S1", revision: 1 },
    )).toBe(false)
    expect(sessionNeedsEventRefresh(
      { session_id: "S1", revision: 1, events: [] },
      { session_id: "S1", revision: 1 },
    )).toBe(true)
  })
})
