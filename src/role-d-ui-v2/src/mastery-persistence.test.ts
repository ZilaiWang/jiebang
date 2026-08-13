import { describe, expect, test } from "bun:test"
import { addPlan, addUser, createEmptyWorkspace, markPlanConceptMastered, masteredConceptsForUser, recordPlanPublicState } from "./workspace"

describe("formal mastery persistence", () => {
  test("does not expose profile-known concepts as formally mastered", () => {
    let workspace = addUser(createEmptyWorkspace(), {
      id: "U1", name: "小王", weeklyHours: 5, pythonLevel: "beginner", learningStyle: "balanced", background: "", priorLanguages: [],
    })
    workspace = addPlan(workspace, "U1", { id: "P1", name: "列表" }, "2026-08-08T00:00:00Z")
    workspace = recordPlanPublicState(workspace, "U1", "P1", { sessionId: "S1", knownConcepts: ["变量"] })
    expect(masteredConceptsForUser(workspace, "U1")).toEqual([])
    workspace = markPlanConceptMastered(workspace, "U1", "P1", "列表")
    expect(masteredConceptsForUser(workspace, "U1")).toEqual(["列表"])
    workspace = recordPlanPublicState(workspace, "U1", "P1", { sessionId: "S1", status: "completed" })
    expect(masteredConceptsForUser(workspace, "U1")).toEqual(["列表"])
  })
})
