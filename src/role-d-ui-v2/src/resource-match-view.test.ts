import { describe, expect, test } from "bun:test"
import { resourceMatchView } from "./orchestrator-view"

const officialResourceFit = {
  schema_version: "1.0",
  policy_version: "resource-fit-v1",
  profile_ref: { profile_id: "PROFILE-ac49f9b7" },
  resources: [
    {
      artifact_id: "ART-1",
      kind: "concept_lesson",
      target: { challenge: { domain_complexity: 1 }, support: { scaffold_strength: 4 } },
      observed: { challenge: { domain_complexity: 1.5 }, support: { scaffold_strength: 4.4 }, confidence: 0.85 },
      fit: { verdict: "fit", score: 0.928, mismatched_dimensions: [], reason_codes: [] },
    },
    {
      artifact_id: "ART-2",
      kind: "code_lab",
      target: { challenge: { code_complexity: 1 }, support: { starter_support: 3 } },
      observed: { challenge: { code_complexity: 1.9 }, support: { starter_support: 1.3 }, confidence: 0.9 },
      fit: { verdict: "too_hard", score: 0.912, mismatched_dimensions: ["starter_support"], reason_codes: ["starter_support_1.3_vs_target_3"] },
    },
    {
      artifact_id: "ART-3",
      kind: "assessment",
      target: { challenge: { cognitive_demand: 3 }, support: {} },
      observed: { challenge: { cognitive_demand: 3 }, support: {}, confidence: 0.9 },
      fit: { verdict: "fit", score: 0.992, mismatched_dimensions: [], reason_codes: [] },
    },
  ],
  overall: { verdict: "too_hard", score: 0.944 },
}

describe("resource match display view (official resource_fit)", () => {
  test("prefers the official C resource_fit fields over the D-side estimate", () => {
    const view = resourceMatchView({ resource_fit: officialResourceFit }, {}, undefined)
    expect(view.source).toBe("official")
    expect(view.score).toBe(94)
    expect(view.label).toBe("需要关注")
    expect(view.resources).toHaveLength(3)
    expect(view.resources[0].kind).toBe("concept_lesson")
    expect(view.resources[0].verdict).toBe("fit")
    expect(view.resources[0].score).toBe(0.928)
    expect(view.resources[1].verdict).toBe("too_hard")
    expect(view.resources[1].mismatchedDimensions).toContain("starter_support")
    expect(view.resources[1].reasonCodes).toContain("starter_support_1.3_vs_target_3")
    expect(view.overallVerdict).toBe("too_hard")
  })

  test("falls back to the D-side estimate when the official field is absent", () => {
    const view = resourceMatchView({
      profile: { level: "beginner" },
      current_path_node: { objectives: [{ objective_id: "OBJ-1" }] },
      content_review: { overall_status: "passed", publish_allowed: true },
    }, { objective_ids: ["OBJ-1"], difficulty: "beginner" }, { items: [{ objective_id: "OBJ-1" }] })
    expect(view.source).toBe("fallback")
    expect(view.score).toBe(100)
    expect(view.label).toBe("高度匹配")
    expect(view.resources).toHaveLength(0)
  })

  test("does not claim an official score before review is public", () => {
    const view = resourceMatchView({
      profile: { level: "beginner" },
      current_path_node: { objectives: [{ objective_id: "OBJ-1" }] },
    }, { objective_ids: ["OBJ-1"], difficulty: "beginner" })
    expect(view.label).toBe("等待审核")
    expect(view.reviewScore).toBeNull()
  })
})
