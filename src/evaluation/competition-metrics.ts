/**
 * 赛题三项指标的正式计算（改进方案8 第四节）。
 *
 * 与旧离线评测的关键区别：
 *  - 幻觉率按原子事实声明计，bad = unsupported/contradicted/missing_citation/
 *    external_knowledge/semantic_unsupported/uncertain；分母为 0 时返回 null 而非 100%；
 *  - 覆盖率按 case_id + fact_id 计数，不全局去重；
 *  - 适配准确率测"每份实际生成资源"的难度分类，而不是知识点预设难度；
 *  - 漏审/漏生成通过 claim_audit_coverage 与 difficulty_audit_completeness 门禁被发现。
 */

export const ARTIFACT_KINDS = [
  "lesson",
  "lab",
  "assessment",
] as const

export type ArtifactKind = typeof ARTIFACT_KINDS[number]

export type Difficulty =
  | "beginner"
  | "basic"
  | "intermediate"
  | "integrated"

export type ClaimVerdict =
  | "supported"
  | "unsupported"
  | "contradicted"
  | "missing_citation"
  | "external_knowledge"
  | "semantic_unsupported"
  | "uncertain"

export interface CompetitionCaseExpectation {
  case_id: string

  /**
   * 每类资源分别冻结标准难度。
   * 不能在生成完成后根据输出反推标准。
   */
  expected_difficulty: Record<ArtifactKind, Difficulty>

  /** 生成前冻结的认知任务依据，供人工复核，不传给难度判定模型。 */
  expected_difficulty_basis?: Record<ArtifactKind, string>

  /**
   * 使用完整 ID，例如 K009:F001。
   * 覆盖率按 case_id + fact_id 计算。
   */
  required_fact_ids: string[]
}

export interface ClaimAuditRecord {
  repeat_index?: number
  case_id: string
  artifact_kind: ArtifactKind
  claim_id: string
  claim_text?: string
  citation_fact_ids?: string[]
  factual: boolean
  audited: boolean
  verdict: ClaimVerdict

  /**
   * 只有审核为 supported 的事实才应填写。
   */
  supported_fact_ids: string[]
  reason?: string
  judge_version?: string
  support_basis?: "citation_fact" | "artifact_self" | "nonfactual"
}

export interface DifficultyAuditRecord {
  repeat_index?: number
  case_id: string
  artifact_kind: ArtifactKind
  audited: boolean
  predicted_difficulty?: Difficulty
  reasons: string[]
  confidence?: number
  judge_version?: string
}

export interface MetricFraction {
  numerator: number
  denominator: number
  value: number | null
}

export interface CompetitionMetricsReport {
  total_cases: number
  expected_artifacts: number

  metrics: {
    hallucination_rate: MetricFraction
    resource_adaptation_accuracy: MetricFraction
    core_knowledge_coverage: MetricFraction

    // 防止通过漏审、漏生成降低分母
    claim_audit_coverage: MetricFraction
    difficulty_audit_completeness: MetricFraction
  }

  gates: {
    enough_cases: boolean
    hallucination_passed: boolean
    adaptation_passed: boolean
    coverage_passed: boolean
    claim_audit_complete: boolean
    difficulty_audit_complete: boolean
  }

  passed: boolean
}

const BAD_FACTUAL_VERDICTS = new Set<ClaimVerdict>([
  "unsupported",
  "contradicted",
  "missing_citation",
  "external_knowledge",
  "semantic_unsupported",
  "uncertain",
])

export function computeCompetitionMetrics(input: {
  cases: CompetitionCaseExpectation[]
  claims: ClaimAuditRecord[]
  difficultyAudits: DifficultyAuditRecord[]
}): CompetitionMetricsReport {
  assertUniqueCaseIds(input.cases)
  assertAuditIdentities(input)

  // ---------- 1. 幻觉率 ----------
  const factualClaims = input.claims.filter((claim) => claim.factual)
  const auditedFactualClaims = factualClaims.filter((claim) => claim.audited)

  const hallucinatedClaims = auditedFactualClaims.filter((claim) =>
    BAD_FACTUAL_VERDICTS.has(claim.verdict),
  )

  const hallucinationRate = fraction(
    hallucinatedClaims.length,
    auditedFactualClaims.length,
  )

  const claimAuditCoverage = fraction(
    auditedFactualClaims.length,
    factualClaims.length,
  )

  // ---------- 2. 难度适配准确率 ----------
  const difficultyByKey = new Map(
    input.difficultyAudits.map((audit) => [
      difficultyKey(audit.case_id, audit.artifact_kind),
      audit,
    ]),
  )

  let auditedDifficultyCount = 0
  let correctDifficultyCount = 0

  for (const evaluationCase of input.cases) {
    for (const kind of ARTIFACT_KINDS) {
      const audit = difficultyByKey.get(
        difficultyKey(evaluationCase.case_id, kind),
      )

      if (!audit?.audited || !audit.predicted_difficulty) continue

      auditedDifficultyCount += 1
      if (
        audit.predicted_difficulty
        === evaluationCase.expected_difficulty[kind]
      ) {
        correctDifficultyCount += 1
      }
    }
  }

  const expectedArtifactCount =
    input.cases.length * ARTIFACT_KINDS.length

  const adaptationAccuracy = fraction(
    correctDifficultyCount,
    auditedDifficultyCount,
  )

  const difficultyAuditCompleteness = fraction(
    auditedDifficultyCount,
    expectedArtifactCount,
  )

  // ---------- 3. 核心事实覆盖率 ----------
  // 使用 case_id + fact_id，避免全局去重造成虚高。
  const requiredUnits = new Set<string>()

  for (const evaluationCase of input.cases) {
    for (const factId of evaluationCase.required_fact_ids) {
      requiredUnits.add(coverageKey(evaluationCase.case_id, factId))
    }
  }

  const coveredUnits = new Set<string>()

  for (const claim of input.claims) {
    if (
      !claim.audited
      || !claim.factual
      || claim.verdict !== "supported"
    ) {
      continue
    }

    for (const factId of claim.supported_fact_ids) {
      const key = coverageKey(claim.case_id, factId)
      if (requiredUnits.has(key)) coveredUnits.add(key)
    }
  }

  const coreCoverage = fraction(
    coveredUnits.size,
    requiredUnits.size,
  )

  // ---------- 门禁 ----------
  const gates = {
    enough_cases: input.cases.length >= 50,

    // 赛题写的是 <5%，不是 <=5%
    hallucination_passed:
      hallucinationRate.value !== null
      && hallucinationRate.value < 0.05,

    adaptation_passed:
      adaptationAccuracy.value !== null
      && adaptationAccuracy.value >= 0.85,

    coverage_passed:
      coreCoverage.value !== null
      && coreCoverage.value >= 0.90,

    claim_audit_complete:
      claimAuditCoverage.value !== null
      && claimAuditCoverage.value >= 0.95,

    difficulty_audit_complete:
      difficultyAuditCompleteness.value === 1,
  }

  return {
    total_cases: input.cases.length,
    expected_artifacts: expectedArtifactCount,
    metrics: {
      hallucination_rate: hallucinationRate,
      resource_adaptation_accuracy: adaptationAccuracy,
      core_knowledge_coverage: coreCoverage,
      claim_audit_coverage: claimAuditCoverage,
      difficulty_audit_completeness: difficultyAuditCompleteness,
    },
    gates,
    passed: Object.values(gates).every(Boolean),
  }
}

function assertAuditIdentities(input: {
  cases: CompetitionCaseExpectation[]
  claims: ClaimAuditRecord[]
  difficultyAudits: DifficultyAuditRecord[]
}): void {
  const caseIds = new Set(input.cases.map((item) => item.case_id))
  const claimKeys = new Set<string>()
  for (const claim of input.claims) {
    if (!caseIds.has(claim.case_id)) {
      throw new Error(`UNKNOWN_COMPETITION_CLAIM_CASE:${claim.case_id}`)
    }
    const key = `${claim.case_id}::${claim.artifact_kind}::${claim.claim_id}`
    if (claimKeys.has(key)) throw new Error(`DUPLICATE_COMPETITION_CLAIM:${key}`)
    claimKeys.add(key)
  }
  const difficultyKeys = new Set<string>()
  for (const audit of input.difficultyAudits) {
    if (!caseIds.has(audit.case_id)) {
      throw new Error(`UNKNOWN_COMPETITION_DIFFICULTY_CASE:${audit.case_id}`)
    }
    const key = difficultyKey(audit.case_id, audit.artifact_kind)
    if (difficultyKeys.has(key)) throw new Error(`DUPLICATE_COMPETITION_DIFFICULTY:${key}`)
    difficultyKeys.add(key)
  }
}

function fraction(
  numerator: number,
  denominator: number,
): MetricFraction {
  return {
    numerator,
    denominator,
    value: denominator === 0
      ? null
      : round4(numerator / denominator),
  }
}

function difficultyKey(
  caseId: string,
  artifactKind: ArtifactKind,
): string {
  return `${caseId}::${artifactKind}`
}

function coverageKey(
  caseId: string,
  factId: string,
): string {
  return `${caseId}::${factId}`
}

function assertUniqueCaseIds(
  cases: CompetitionCaseExpectation[],
): void {
  const ids = new Set<string>()

  for (const evaluationCase of cases) {
    if (ids.has(evaluationCase.case_id)) {
      throw new Error(
        `DUPLICATE_COMPETITION_CASE:${evaluationCase.case_id}`,
      )
    }
    ids.add(evaluationCase.case_id)
  }
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000
}
