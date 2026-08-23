import { describe, expect, test } from "bun:test"
import {
  splitDifficultyVector,
  challengeLevel,
  supportLevel,
  resourceFitReportHash,
  emptyResourceFitReport,
  RESOURCE_FIT_POLICY_VERSION,
} from "../src/role-c-content/contracts/resource-fit"
import type { DifficultyVector } from "../src/role-c-content/contracts/generation-spec"

const VEC: DifficultyVector = {
  domain_complexity: 2,
  cognitive_demand: 2,
  reasoning_steps: 3,
  code_complexity: 1,
  prerequisite_load: 2,
  scaffold_strength: 3,
  transfer_distance: 1,
  boundary_condition_density: 0,
  task_composition: 1,
}

describe("resource-fit 契约：术语分层与向量拆分", () => {
  test("splitDifficultyVector 把 scaffold 归到支持侧，其余归挑战侧", () => {
    const { challenge, support } = splitDifficultyVector(VEC)
    expect("scaffold_strength" in challenge).toBe(false)
    expect(challenge.domain_complexity).toBe(2)
    expect(challenge.reasoning_steps).toBe(3)
    expect(challenge.transfer_distance).toBe(1)
    expect(support.scaffold_strength).toBe(3)
    expect(support.reading_density).toBe("low") // scaffold 3 → 低密度
  })

  test("challengeLevel 取挑战侧最大值（不含 scaffold）", () => {
    expect(challengeLevel(splitDifficultyVector(VEC).challenge)).toBe(3) // reasoning_steps=3
  })

  test("supportLevel 取支持侧最大值", () => {
    expect(supportLevel(splitDifficultyVector(VEC).support)).toBe(3)
  })

  test("高 scaffold → 低阅读密度；低 scaffold → 高阅读密度", () => {
    expect(splitDifficultyVector({ ...VEC, scaffold_strength: 3 }).support.reading_density).toBe("low")
    expect(splitDifficultyVector({ ...VEC, scaffold_strength: 0 }).support.reading_density).toBe("high")
  })

  test("resourceFitReportHash 对相同内容稳定，对变化敏感", () => {
    const aggregation = {
      policy: "bottleneck_cap" as const,
      weighted_mean: 0.9,
      weakest_kind: "assessment" as const,
      weakest_score: 0.8,
      bottleneck_margin: 0.08,
      final_score: 0.88,
    }
    const base = {
      run_id: "RUN-1",
      spec_id: "SPEC-1",
      profile_ref: { profile_id: "p1", profile_version: "v1", profile_content_hash: "h1" },
      policy_version: RESOURCE_FIT_POLICY_VERSION,
      resources: [] as never[],
      overall: { verdict: "fit" as const, score: 1, aggregation },
    }
    expect(resourceFitReportHash(base)).toBe(resourceFitReportHash(base))
    expect(resourceFitReportHash(base)).not.toBe(
      resourceFitReportHash({ ...base, overall: { verdict: "too_hard" as const, score: 0.5, aggregation } }),
    )
  })

  test("emptyResourceFitReport 生成合法空报告", () => {
    const report = emptyResourceFitReport({
      run_id: "RUN-1",
      spec_id: "SPEC-1",
      profile_ref: { profile_id: "p1", profile_version: "v1", profile_content_hash: "h1" },
    })
    expect(report.overall.verdict).toBe("uncertain")
    expect(report.resources).toEqual([])
    expect(report.policy_version).toBe(RESOURCE_FIT_POLICY_VERSION)
  })
})
