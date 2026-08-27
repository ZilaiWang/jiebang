import { describe, expect, test } from "bun:test"
import {
  computeCompetitionMetrics,
  type ClaimAuditRecord,
  type CompetitionCaseExpectation,
  type DifficultyAuditRecord,
} from "../src/evaluation/competition-metrics"

function makeCase(caseId: string, factIds: string[] = []): CompetitionCaseExpectation {
  return {
    case_id: caseId,
    expected_difficulty: { lesson: "beginner", lab: "beginner", assessment: "beginner" },
    required_fact_ids: factIds,
  }
}

function supportedClaim(caseId: string, factIds: string[]): ClaimAuditRecord {
  return {
    case_id: caseId,
    artifact_kind: "lesson",
    claim_id: `${caseId}-c`,
    factual: true,
    audited: true,
    verdict: "supported",
    supported_fact_ids: factIds,
  }
}

function badClaim(caseId: string, verdict: ClaimAuditRecord["verdict"]): ClaimAuditRecord {
  return {
    case_id: caseId,
    artifact_kind: "lesson",
    claim_id: `${caseId}-bad`,
    factual: true,
    audited: true,
    verdict,
    supported_fact_ids: [],
  }
}

function matchedAudit(caseId: string, difficulty: "beginner" | "basic" | "intermediate" | "integrated"): DifficultyAuditRecord {
  return { case_id: caseId, artifact_kind: "lesson", audited: true, predicted_difficulty: difficulty, reasons: [] }
}

describe("competition metrics（改进方案8 三项指标正式计算）", () => {
  test("分母为 0 时不返回 100%，而是 null 且门禁不过", () => {
    const report = computeCompetitionMetrics({
      cases: [makeCase("c1")],
      claims: [],
      difficultyAudits: [],
    })
    expect(report.metrics.hallucination_rate.value).toBeNull()
    expect(report.gates.hallucination_passed).toBe(false)
    expect(report.gates.coverage_passed).toBe(false)
  })

  test("幻觉率：bad 声明占分子，<5% 通过、≥5% 不通过", () => {
    const claims: ClaimAuditRecord[] = [
      ...Array.from({ length: 96 }, (_, i) => ({ ...supportedClaim("c1", []), claim_id: `good-${i}` })),
      ...Array.from({ length: 4 }, (_, i) => ({ ...badClaim("c1", "unsupported"), claim_id: `bad-${i}` })),
    ]
    const report = computeCompetitionMetrics({
      cases: [makeCase("c1")],
      claims,
      difficultyAudits: [],
    })
    expect(report.metrics.hallucination_rate.value).toBe(0.04)
    expect(report.gates.hallucination_passed).toBe(true)

    // 5/100 = 5%，赛题要求 <5%，严格不等
    const five = computeCompetitionMetrics({
      cases: [makeCase("c1")],
      claims: [
        ...Array.from({ length: 95 }, (_, i) => ({ ...supportedClaim("c1", []), claim_id: `good-${i}` })),
        ...Array.from({ length: 5 }, (_, i) => ({ ...badClaim("c1", "unsupported"), claim_id: `bad-${i}` })),
      ],
      difficultyAudits: [],
    })
    expect(five.metrics.hallucination_rate.value).toBe(0.05)
    expect(five.gates.hallucination_passed).toBe(false)
  })

  test("覆盖率按 case_id + fact_id 计，不全局去重", () => {
    // 同一个 fact "K009:F001" 在 c1 覆盖、c2 未覆盖 → 覆盖率 50%
    const report = computeCompetitionMetrics({
      cases: [
        makeCase("c1", ["K009:F001"]),
        makeCase("c2", ["K009:F001"]),
      ],
      claims: [supportedClaim("c1", ["K009:F001"])],
      difficultyAudits: [],
    })
    expect(report.metrics.core_knowledge_coverage.numerator).toBe(1)
    expect(report.metrics.core_knowledge_coverage.denominator).toBe(2)
    expect(report.metrics.core_knowledge_coverage.value).toBe(0.5)
  })

  test("漏审被 claim_audit_coverage 门禁发现（<95% 不过）", () => {
    // 100 条 factual，只审 90 条 → 审核覆盖率 90% < 95%
    const claims: ClaimAuditRecord[] = [
      ...Array.from({ length: 90 }, (_, i) => ({ ...supportedClaim("c1", []), claim_id: `good-${i}` })),
      ...Array.from({ length: 10 }, (_, i) => ({
        case_id: "c1", artifact_kind: "lesson" as const, claim_id: `c1-u${i}`,
        factual: true, audited: false, verdict: "uncertain" as const, supported_fact_ids: [],
      })),
    ]
    const report = computeCompetitionMetrics({
      cases: [makeCase("c1")],
      claims,
      difficultyAudits: [],
    })
    expect(report.metrics.claim_audit_coverage.value).toBe(0.9)
    expect(report.gates.claim_audit_complete).toBe(false)
  })

  test("适配准确率精确匹配，漏审资源被 completeness 门禁发现", () => {
    // 2 案例 × 3 资源 = 6 期望资源，只审了 3 个（lesson），其中 2 个匹配
    const cases = [makeCase("c1"), makeCase("c2")]
    const audits: DifficultyAuditRecord[] = [
      matchedAudit("c1", "beginner"),
      matchedAudit("c2", "beginner"),
      { case_id: "c2", artifact_kind: "lab", audited: true, predicted_difficulty: "basic", reasons: [] },
    ]
    const report = computeCompetitionMetrics({
      cases,
      claims: [],
      difficultyAudits: audits,
    })
    expect(report.metrics.resource_adaptation_accuracy.numerator).toBe(2)
    expect(report.metrics.resource_adaptation_accuracy.denominator).toBe(3)
    // 只审了 3/6，完整性门禁不过
    expect(report.metrics.difficulty_audit_completeness.value).toBe(0.5)
    expect(report.gates.difficulty_audit_complete).toBe(false)
  })

  test("不足 50 案例时 enough_cases 门禁不过", () => {
    const report = computeCompetitionMetrics({
      cases: Array.from({ length: 49 }, (_, i) => makeCase(`c${i}`)),
      claims: [],
      difficultyAudits: [],
    })
    expect(report.gates.enough_cases).toBe(false)
    const enough = computeCompetitionMetrics({
      cases: Array.from({ length: 50 }, (_, i) => makeCase(`c${i}`)),
      claims: [],
      difficultyAudits: [],
    })
    expect(enough.gates.enough_cases).toBe(true)
  })

  test("重复 case_id 抛错", () => {
    expect(() => computeCompetitionMetrics({
      cases: [makeCase("c1"), makeCase("c1")],
      claims: [],
      difficultyAudits: [],
    })).toThrow(/DUPLICATE_COMPETITION_CASE/)
  })

  test("拒绝未知 case、重复声明和重复难度记录，防止重复计数或覆盖结果", () => {
    expect(() => computeCompetitionMetrics({
      cases: [makeCase("c1")],
      claims: [supportedClaim("unknown", [])],
      difficultyAudits: [],
    })).toThrow(/UNKNOWN_COMPETITION_CLAIM_CASE/)

    const claim = supportedClaim("c1", [])
    expect(() => computeCompetitionMetrics({
      cases: [makeCase("c1")],
      claims: [claim, claim],
      difficultyAudits: [],
    })).toThrow(/DUPLICATE_COMPETITION_CLAIM/)

    const audit = matchedAudit("c1", "beginner")
    expect(() => computeCompetitionMetrics({
      cases: [makeCase("c1")],
      claims: [],
      difficultyAudits: [audit, audit],
    })).toThrow(/DUPLICATE_COMPETITION_DIFFICULTY/)
  })

  test("全绿场景：三项指标达标 + 完整门禁 → passed", () => {
    const cases = Array.from({ length: 50 }, (_, i) => makeCase(`c${i}`, [`K${(i % 18) + 1}:F001`]))
    const claims: ClaimAuditRecord[] = cases.flatMap((c) =>
      c.required_fact_ids.map((factId) => supportedClaim(c.case_id, [factId])))
    const audits: DifficultyAuditRecord[] = cases.flatMap((c) =>
      (["lesson", "lab", "assessment"] as const).map((kind) =>
        ({ case_id: c.case_id, artifact_kind: kind, audited: true, predicted_difficulty: "beginner" as const, reasons: [] })))
    const report = computeCompetitionMetrics({ cases, claims, difficultyAudits: audits })
    expect(report.metrics.hallucination_rate.value).toBe(0)
    expect(report.metrics.resource_adaptation_accuracy.value).toBe(1)
    expect(report.metrics.core_knowledge_coverage.value).toBe(1)
    expect(report.gates.difficulty_audit_complete).toBe(true)
    expect(report.passed).toBe(true)
  })
})
