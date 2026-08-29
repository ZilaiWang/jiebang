import { describe, expect, test } from "bun:test"
import {
  buildResumeDiagnosisPlan,
  evaluateResumeDiagnosis,
  type ResumeDiagnosisItem,
} from "../src/orchestration/resume-diagnosis"

describe("resume path short diagnosis", () => {
  const items: ResumeDiagnosisItem[] = [
    { item_id: "R-1", objective_id: "O-weak", question: "问题一", options: ["A", "B"], answer: "A" },
    { item_id: "R-2", objective_id: "O-recent", question: "问题二", options: ["C", "D"], answer: "D" },
  ]

  test("plans only paused-path weak or current objectives", () => {
    const plan = buildResumeDiagnosisPlan({
      path_id: "PATH-OLD",
      current_node_id: "NODE-2",
      mastery: { "O-weak": 0.2, "O-recent": 0.45, "O-mastered": 0.95 },
      objective_ids: ["O-weak", "O-recent", "O-mastered"],
    })
    expect(plan).toEqual({ path_id: "PATH-OLD", objective_ids: ["O-weak", "O-recent"] })
  })

  test("passes only when every selected objective reaches the short-diagnosis threshold", () => {
    expect(evaluateResumeDiagnosis(items, { "R-1": "A", "R-2": "D" })).toMatchObject({
      passed: true,
      level: "intermediate",
      weak_objective_ids: [],
    })
    expect(evaluateResumeDiagnosis(items, { "R-1": "B", "R-2": "D" })).toMatchObject({
      passed: false,
      level: "basic",
      weak_objective_ids: ["O-weak"],
    })
  })

  test("does not claim a paused path is resumed when diagnosis is incomplete", () => {
    expect(evaluateResumeDiagnosis(items, { "R-1": "A" })).toMatchObject({
      passed: false,
      level: "basic",
      weak_objective_ids: ["O-recent"],
    })
  })
})
