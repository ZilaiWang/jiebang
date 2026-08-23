import { describe, expect, test } from "bun:test"
import { buildResourceFitReport } from "../src/role-c-content/review/resource-fit-audit"
import type { ArtifactResourceFit } from "../src/role-c-content/contracts/resource-fit"

function entry(kind: ArtifactResourceFit["kind"], score: number): ArtifactResourceFit {
  return {
    artifact_id: `a-${kind}`,
    kind,
    target: {
      challenge: { domain_complexity: 1, cognitive_demand: 1, reasoning_steps: 1, code_complexity: 1, prerequisite_load: 1 },
      support: { scaffold_strength: 1, reading_density: "low", hint_strength: 1, starter_support: 1 },
    },
    observed: {
      challenge: { domain_complexity: 1, cognitive_demand: 1, reasoning_steps: 1, code_complexity: 1, prerequisite_load: 1 },
      support: { scaffold_strength: 1, reading_density: "low", hint_strength: 1, starter_support: 1 },
      confidence: 0.9,
    },
    fit: { verdict: "fit", score, mismatched_dimensions: [], reason_codes: [], dimensions: [] },
  }
}

describe("Resource Fit aggregation 口径（改进方案6 第一节）", () => {
  test("公开 weighted_mean / weakest_kind / 瓶颈封顶后的 final_score（复现 89/84/57）", () => {
    const report = buildResourceFitReport({
      run_id: "R1",
      spec_id: "S1",
      profile_ref: { profile_id: "p1", profile_version: "v1", profile_content_hash: "h1" },
      entries: [
        entry("concept_lesson", 0.89),
        entry("code_lab", 0.84),
        entry("assessment", 0.57),
      ],
    })
    const agg = report.overall.aggregation
    expect(agg.policy).toBe("bottleneck_cap")
    // 0.89*0.30 + 0.84*0.35 + 0.57*0.35
    expect(agg.weighted_mean).toBeCloseTo(0.761, 3)
    expect(agg.weakest_kind).toBe("assessment")
    expect(agg.weakest_score).toBe(0.57)
    // min(weighted_mean, weakest + 0.08) = min(0.761, 0.65) = 0.65
    expect(agg.final_score).toBeCloseTo(0.65, 3)
    expect(report.overall.score).toBeCloseTo(0.65, 3)
  })

  test("三资源都高时不因瓶颈封顶误压分", () => {
    const report = buildResourceFitReport({
      run_id: "R1",
      spec_id: "S1",
      profile_ref: { profile_id: "p1", profile_version: "v1", profile_content_hash: "h1" },
      entries: [
        entry("concept_lesson", 0.95),
        entry("code_lab", 0.92),
        entry("assessment", 0.90),
      ],
    })
    const agg = report.overall.aggregation
    expect(agg.weakest_score).toBe(0.90)
    // weighted_mean = 0.95*0.30 + 0.92*0.35 + 0.90*0.35 = 0.285+0.322+0.315 = 0.922
    expect(agg.final_score).toBeCloseTo(0.922, 3)
  })

  test("dimensions 输出包含 signed_gap，正值偏难、负值偏易", () => {
    // 直接验证契约语义：signed_gap = observed - target
    const { auditResourceFit } = require("../src/role-c-content/review/resource-fit-audit") as typeof import("../src/role-c-content/review/resource-fit-audit")
    const entry2 = auditResourceFit({
      artifact_id: "a1",
      kind: "concept_lesson",
      target: {
        challenge_target: { domain_complexity: 1, cognitive_demand: 1, reasoning_steps: 1, code_complexity: 1, prerequisite_load: 1 },
        support_target: { scaffold_strength: 3, reading_density: "low", hint_strength: 3, starter_support: 1 },
      } as never,
      payload: { title: "x", objective_ids: [], prerequisite_bridge: [], explanation_blocks: [], worked_examples: [], misconceptions: [], micro_checks: [], hint_ladders: [], summary: [], objective_coverage: [], used_evidence: [] } as never,
    })
    expect(Array.isArray(entry2.fit.dimensions)).toBe(true)
    expect(entry2.fit.dimensions.length).toBeGreaterThan(0)
    for (const dimension of entry2.fit.dimensions) {
      expect(dimension.signed_gap).toBeCloseTo(dimension.observed - dimension.target, 5)
      expect(typeof dimension.applicable).toBe("boolean")
    }
  })
})
