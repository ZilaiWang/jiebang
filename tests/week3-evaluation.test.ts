import { describe, expect, test } from "bun:test"
import {
  buildWeek3EvaluationCases,
  GOLDEN_LEARNER_PROFILES,
  runWeek3Evaluation,
} from "../src/evaluation/week3-evaluation"

describe("Week 3 evaluation framework", () => {
  test("builds exactly 60 cases across three golden learner profiles and all core knowledge items", () => {
    const cases = buildWeek3EvaluationCases()

    expect(cases).toHaveLength(60)
    expect(new Set(cases.map((item) => item.case_id)).size).toBe(60)
    expect(new Set(cases.map((item) => item.learner_profile_id))).toEqual(new Set([
      "golden-cs-basic",
      "golden-cross-major",
      "golden-zero-beginner",
    ]))
    expect(new Set(cases.flatMap((item) => item.target_source_ids))).toEqual(new Set([
      "K001", "K002", "K003", "K004", "K005", "K006", "K007", "K008", "K009",
      "K010", "K011", "K012", "K013", "K014", "K015", "K016", "K017", "K018",
    ]))
  })

  test("golden learner profiles have required fields for B teaching audit", () => {
    for (const [id, profile] of Object.entries(GOLDEN_LEARNER_PROFILES)) {
      expect(profile.learner_id).toBe(id)
      expect(profile.level).toBeDefined()
      expect(profile.goal.length).toBeGreaterThan(0)
      expect(Array.isArray(profile.known_concepts)).toBe(true)
      expect(Array.isArray(profile.weak_concepts)).toBe(true)
    }

    // golden-cs-basic: has programming background
    const csBasic = GOLDEN_LEARNER_PROFILES["golden-cs-basic"]
    expect(csBasic.level).toBe("basic")
    expect(csBasic.known_concepts.length).toBeGreaterThanOrEqual(3)
    expect(csBasic.weak_concepts.length).toBeGreaterThanOrEqual(1)

    // golden-cross-major: beginner with some awareness
    const crossMajor = GOLDEN_LEARNER_PROFILES["golden-cross-major"]
    expect(crossMajor.level).toBe("beginner")
    expect(crossMajor.known_concepts.length).toBeGreaterThan(0)

    // golden-zero-beginner: complete beginner
    const zeroBeginner = GOLDEN_LEARNER_PROFILES["golden-zero-beginner"]
    expect(zeroBeginner.level).toBe("beginner")
    expect(zeroBeginner.known_concepts.length).toBe(0)
    expect(zeroBeginner.weak_concepts.length).toBeGreaterThanOrEqual(1)
  })

  test("runs the offline evaluation and reports A + B competition metrics", async () => {
    const report = await runWeek3Evaluation()

    expect(report.workflow).toBe("Week3_Offline_Evaluation")
    expect(report.total_cases).toBe(60)
    expect(report.case_results).toHaveLength(60)
    expect(report.case_results.every((item) => item.frozen_evidence_hash.startsWith("sha256:"))).toBe(true)

    // A 维度
    expect(report.metrics.hallucination_rate).toBeLessThanOrEqual(0.05)
    expect(report.metrics.core_knowledge_coverage).toBeGreaterThanOrEqual(0.9)

    // B 维度 — 所有指标应在 [0, 1] 区间
    expect(report.metrics.difficulty_match_accuracy).toBeGreaterThanOrEqual(0)
    expect(report.metrics.difficulty_match_accuracy).toBeLessThanOrEqual(1)
    expect(report.metrics.teaching_audit_pass_rate).toBeGreaterThanOrEqual(0)
    expect(report.metrics.teaching_audit_pass_rate).toBeLessThanOrEqual(1)
    expect(report.metrics.prerequisite_coverage).toBeGreaterThanOrEqual(0)
    expect(report.metrics.prerequisite_coverage).toBeLessThanOrEqual(1)
    expect(report.metrics.weak_concept_coverage).toBeGreaterThanOrEqual(0)
    expect(report.metrics.weak_concept_coverage).toBeLessThanOrEqual(1)
    expect(report.metrics.goal_alignment_rate).toBeGreaterThanOrEqual(0)
    expect(report.metrics.goal_alignment_rate).toBeLessThanOrEqual(1)

    // 每个 case result 都有 B 教学审核字段
    for (const result of report.case_results) {
      expect(typeof result.difficulty_matched).toBe("boolean")
      expect(["pass", "revise", "reject"]).toContain(result.teaching_audit_status)
      expect(typeof result.prerequisite_covered).toBe("boolean")
      expect(typeof result.weak_concepts_covered).toBe("boolean")
      expect(typeof result.goal_aligned).toBe("boolean")
    }
  })
})
