import { describe, expect, test } from "bun:test"
import { resourceMatchView } from "./orchestrator-view"

const officialResourceFit = {
  schema_version: "1.0",
  policy_version: "resource-fit-v2",
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

const currentResources = {
  concept_lesson: { artifact_id: "ART-1", run_id: "RUN-C-1" },
  code_lab: { artifact_id: "ART-2", run_id: "RUN-C-1" },
}
const currentAssessment = { artifact_id: "ART-3", run_id: "RUN-C-1" }

describe("resource match display view (official resource_fit)", () => {
  test("prefers the official C resource_fit fields over the D-side estimate", () => {
    const session = {
      run_id: "RUN-1",
      resource_fit: { ...officialResourceFit, run_id: "RUN-C-1" },
      learning_resources: currentResources,
      assessment: currentAssessment,
    }
    const view = resourceMatchView(session, {}, undefined)
    expect(view.source).toBe("official")
    expect(view.fresh).toBe(true)
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
    expect(view.reviewLabel).toBe("规则估计 · 尚未校准")
  })

  test("stale resource_fit (artifact mismatch) falls back instead of showing last round score", () => {
    const session = {
      run_id: "RUN-1",
      resource_fit: { ...officialResourceFit, run_id: "RUN-C-1" },
      learning_resources: {
        concept_lesson: { artifact_id: "NEW-ART-1", run_id: "RUN-C-1" }, // 已更新的下一轮资源
        code_lab: { artifact_id: "NEW-ART-2", run_id: "RUN-C-1" },
      },
      assessment: { artifact_id: "NEW-ART-3", run_id: "RUN-C-1" },
    }
    const view = resourceMatchView(session, {}, undefined)
    expect(view.source).toBe("fallback")
    expect(view.fresh).toBe(false)
  })

  test("stale resource_fit (run mismatch) falls back", () => {
    const session = {
      run_id: "RUN-ROOT",
      resource_fit: { ...officialResourceFit, run_id: "RUN-C-OLD" },
      learning_resources: {
        concept_lesson: { artifact_id: "ART-1", run_id: "RUN-C-NEW" },
        code_lab: { artifact_id: "ART-2", run_id: "RUN-C-NEW" },
      },
      assessment: { artifact_id: "ART-3", run_id: "RUN-C-NEW" },
    }
    const view = resourceMatchView(session, {}, undefined)
    expect(view.source).toBe("fallback")
  })

  test("三个条目重复引用同一 artifact 时不视为当前完整报告", () => {
    const duplicated = {
      ...officialResourceFit,
      run_id: "RUN-1",
      resources: officialResourceFit.resources.map((entry) => ({
        ...entry,
        artifact_id: "ART-1",
      })),
    }
    const view = resourceMatchView({
      run_id: "RUN-1",
      resource_fit: { ...duplicated, run_id: "RUN-C-1" },
      learning_resources: currentResources,
      assessment: currentAssessment,
    }, {}, undefined)
    expect(view.source).toBe("fallback")
    expect(view.fresh).toBe(false)
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
