import { mkdir, readdir } from "node:fs/promises"
import { resolve } from "node:path"
import {
  COMPETITION_CLAIM_AUDIT_VERSION,
  evidenceFactsFromDelivery,
  extractCompetitionClaimCandidates,
  ModelCompetitionClaimAuditor,
} from "../src/evaluation/competition-claim-auditor"
import { competitionArtifactViews } from "../src/evaluation/competition-artifact-view"
import {
  ARTIFACT_KINDS,
  computeCompetitionMetrics,
  type ClaimAuditRecord,
  type CompetitionCaseExpectation,
  type CompetitionMetricsReport,
  type DifficultyAuditRecord,
} from "../src/evaluation/competition-metrics"
import {
  MODEL_DIFFICULTY_JUDGE_VERSION,
  ModelResourceDifficultyJudge,
} from "../src/evaluation/resource-difficulty-judge"
import {
  buildCompetitionExpectations,
  renderManifestReviewTemplate,
} from "../src/evaluation/competition-manifest"
import { buildWeek3EvaluationCases, type Week3EvaluationCase } from "../src/evaluation/week3-evaluation"
import { loadKnowledgeBase } from "../src/knowledge/loader"
import { contentHash } from "../src/role-c-content/contracts/common"
import { createRoleCModelGatewayFromEnv } from "../src/role-c-content/contracts/model-gateway"
import { ROLE_C_PROMPT_MANIFEST_VERSION } from "../src/role-c-content/prompts/common-policy"
import { runRoleCWeek3Case, type RoleCWeek3CaseResult } from "../src/role-c-content/evaluation/week3-runner"
import type { RoleCForRoleDResult } from "../src/role-d-integration/contracts"

const ROOT = resolve(process.cwd())
const EVAL_DIR = resolve(ROOT, "evaluation")
const MANIFEST_PATH = resolve(EVAL_DIR, "manifest.v1.json")
const RUBRIC_PATH = resolve(EVAL_DIR, "difficulty-rubric.v1.md")
const args = parseArgs(process.argv.slice(2))

interface FrozenManifest {
  manifest_version: "competition-v1"
  total_cases: number
  expected_artifacts: number
  cases: CompetitionCaseExpectation[]
}

interface CompetitionProtocol {
  protocol_version: "competition-evaluation-protocol-v1"
  protocol_id: string
  repository_commit: string
  source_tree_hash: string
  model_provider: string
  model_id: string
  model_config_hash: string
  judge_model_id: string
  judge_model_config_hash: string
  generation_thinking: string
  generation_temperatures: Record<string, string>
  prompt_manifest_version: string
  knowledge_base_version: string
  evaluation_manifest_version: "competition-v1"
  evaluation_manifest_hash: string
  difficulty_rubric_version: "difficulty-rubric-v1"
  difficulty_rubric_hash: string
  claim_audit_version: string
  difficulty_judge_version: string
  repeats: number
  selected_case_ids: string[]
  started_at: string
}

interface CaseEvaluationRecord {
  protocol_id: string
  repeat_index: number
  case_id: string
  generated_at: string
  summary: RoleCWeek3CaseResult
  public_release?: Extract<RoleCForRoleDResult, { status: "ready" }>["reviewedRelease"]
  evidence_pack?: Extract<RoleCForRoleDResult, { status: "ready" }>["finalContext"]["evidencePack"]
  claim_audits: ClaimAuditRecord[]
  difficulty_audits: DifficultyAuditRecord[]
  evaluation_errors: string[]
}

interface FinalCompetitionReport {
  report_version: "competition-final-report-v1"
  generated_at: string
  protocol: CompetitionProtocol
  repeat_reports: Array<{ repeat_index: number; metrics: CompetitionMetricsReport }>
  aggregate: CompetitionMetricsReport
  operational: {
    expected_runs: number
    completed_case_records: number
    ready: number
    blocked: number
    failed: number
    code_execution_passed: number
    code_execution_failed: number
    code_execution_not_reached: number
    evaluation_error_cases: number
  }
  passed: boolean
}

async function main(): Promise<void> {
  const resultsDirectory = resolve(ROOT, args.outputDirectory)
  await mkdir(resultsDirectory, { recursive: true })
  const knowledgeBase = await loadKnowledgeBase()
  if (args.refreshManifest) {
    const cases = buildCompetitionExpectations(knowledgeBase)
    await Bun.write(MANIFEST_PATH, `${JSON.stringify({
      manifest_version: "competition-v1",
      total_cases: cases.length,
      expected_artifacts: cases.length * ARTIFACT_KINDS.length,
      cases,
    }, null, 2)}\n`)
    await Bun.write(
      resolve(EVAL_DIR, "manifest-review-template.csv"),
      renderManifestReviewTemplate(cases),
    )
    if (!args.all && !args.dev && args.limit === undefined && args.caseIds.length === 0) {
      console.log(`[competition] refreshed ${cases.length} frozen cases and the two-reviewer template`)
      return
    }
  }
  const manifest = await readAndValidateManifest(MANIFEST_PATH)
  const rubric = await Bun.file(RUBRIC_PATH).text()
  const allEvaluationCases = buildWeek3EvaluationCases()
  const selectedCases = selectCases(allEvaluationCases, args)
  assertSelectionMatchesManifest(selectedCases, manifest.cases)

  const localEnv = await readEnvFile(resolve(ROOT, ".env.role-c.local"))
  const explicitEnv = { ...localEnv, ...process.env }
  const persistedGenerationEnv = await readPersistedGenerationProvider(resolve(
    ROOT,
    explicitEnv.COMPETITION_GENERATION_CONFIG_PATH
      ?? ".tmp/integrated-orchestrator/provider-config.json",
  ))
  const env = { ...persistedGenerationEnv, ...explicitEnv }
  const judgeEnv = competitionJudgeEnv(env)
  const judgeUsage: Array<Record<string, unknown>> = []
  const judgeGateway = createRoleCModelGatewayFromEnv(judgeEnv, {
    on_usage(event) {
      judgeUsage.push({
        task: event.task,
        model_id: event.model_id,
        prompt_tokens: event.prompt_tokens,
        completion_tokens: event.completion_tokens,
        total_tokens: event.total_tokens,
        duration_ms: event.duration_ms,
      })
    },
  })
  const generationGateway = createRoleCModelGatewayFromEnv(env)
  if (generationGateway.model_config_hash === judgeGateway.model_config_hash
    && env.COMPETITION_ALLOW_SAME_MODEL_JUDGE !== "1") {
    throw new Error("COMPETITION_JUDGE_NOT_INDEPENDENT:生成与评审模型配置相同")
  }
  await Promise.all([
    probeEvaluationGateway(generationGateway, "generation"),
    probeEvaluationGateway(judgeGateway, "judge"),
  ])
  const protocolIdentity = {
    protocol_version: "competition-evaluation-protocol-v1" as const,
    repository_commit: gitOutput(["rev-parse", "HEAD"]),
    source_tree_hash: await evaluationSourceTreeHash(),
    model_provider: providerName(env.ROLE_C_MODEL_ENDPOINT),
    model_id: generationGateway.model_id,
    model_config_hash: generationGateway.model_config_hash,
    judge_model_id: judgeGateway.model_id,
    judge_model_config_hash: judgeGateway.model_config_hash,
    generation_thinking: env.ROLE_C_MODEL_THINKING ?? "provider-default",
    generation_temperatures: {
      concept: env.ROLE_C_MODEL_CONCEPT_TEMPERATURE ?? "provider-default",
      code_lab: env.ROLE_C_MODEL_CODE_LAB_TEMPERATURE ?? "provider-default",
      assessment: env.ROLE_C_MODEL_ASSESSMENT_TEMPERATURE ?? "provider-default",
    },
    prompt_manifest_version: ROLE_C_PROMPT_MANIFEST_VERSION,
    knowledge_base_version: knowledgeBase.version,
    evaluation_manifest_version: manifest.manifest_version,
    evaluation_manifest_hash: contentHash(manifest),
    difficulty_rubric_version: "difficulty-rubric-v1" as const,
    difficulty_rubric_hash: contentHash(rubric),
    claim_audit_version: COMPETITION_CLAIM_AUDIT_VERSION,
    difficulty_judge_version: MODEL_DIFFICULTY_JUDGE_VERSION,
    repeats: args.repeats,
    selected_case_ids: selectedCases.map((item) => item.case_id),
  }
  const protocol: CompetitionProtocol = {
    ...protocolIdentity,
    protocol_id: contentHash(protocolIdentity),
    started_at: new Date().toISOString(),
  }
  await Bun.write(resolve(resultsDirectory, "protocol.json"), `${JSON.stringify(protocol, null, 2)}\n`)

  const records: CaseEvaluationRecord[] = []
  for (let repeatIndex = 1; repeatIndex <= args.repeats; repeatIndex += 1) {
    const repeatDirectory = resolve(resultsDirectory, "runs", `repeat-${repeatIndex}`)
    await mkdir(repeatDirectory, { recursive: true })
    const repeatRecords = await mapConcurrent(selectedCases, args.concurrency, async (evaluationCase, index) => {
      const casePath = resolve(repeatDirectory, `${evaluationCase.case_id}.json`)
      if (!args.force) {
        const resumed = await readJsonOrUndefined<CaseEvaluationRecord>(casePath)
        if (resumed?.protocol_id === protocol.protocol_id
          && resumed.repeat_index === repeatIndex
          && resumed.case_id === evaluationCase.case_id
          && reusableCompletedCase(resumed)) {
          console.error(`[competition] resume r${repeatIndex} ${index + 1}/${selectedCases.length} ${evaluationCase.case_id}`)
          return resumed
        }
      }
      console.error(`[competition] run r${repeatIndex} ${index + 1}/${selectedCases.length} ${evaluationCase.case_id}`)
      const record = await evaluateCase({
        repeatIndex,
        evaluationCase,
        protocol,
        resultsDirectory,
        env,
        judgeEnv,
        judgeUsage,
      })
      await Bun.write(casePath, `${JSON.stringify(record, null, 2)}\n`)
      console.error(`[competition] done r${repeatIndex} ${evaluationCase.case_id} status=${record.summary.status} claims=${record.claim_audits.length}`)
      return record
    })
    records.push(...repeatRecords)
  }

  const expectationsById = new Map(manifest.cases.map((item) => [item.case_id, item]))
  const selectedExpectations = selectedCases.map((item) => expectationsById.get(item.case_id)!)
  const repeatReports = Array.from({ length: args.repeats }, (_, index) => {
    const repeatIndex = index + 1
    const repeatRecords = records.filter((record) => record.repeat_index === repeatIndex)
    return {
      repeat_index: repeatIndex,
      metrics: computeCompetitionMetrics({
        cases: selectedExpectations,
        claims: repeatRecords.flatMap((record) => record.claim_audits),
        difficultyAudits: repeatRecords.flatMap((record) => record.difficulty_audits),
      }),
    }
  })
  const aggregate = computeRepeatedMetrics(selectedExpectations, records)
  const report: FinalCompetitionReport = {
    report_version: "competition-final-report-v1",
    generated_at: new Date().toISOString(),
    protocol,
    repeat_reports: repeatReports,
    aggregate,
    operational: operationalSummary(records, selectedCases.length * args.repeats),
    passed: repeatReports.every((item) => item.metrics.passed) && aggregate.passed,
  }
  await writeFinalArtifacts(resultsDirectory, report, records, judgeUsage)
  await writeManualAuditTemplate(resultsDirectory, selectedCases, selectedExpectations, records)
  await writeShowcaseComparison(resultsDirectory, records)
  console.log(renderMarkdownReport(report))
  if (args.assertGates && !report.passed) {
    console.error("COMPETITION_EVALUATION_GATE_FAILED")
    process.exitCode = 1
  } else if (args.assertGates) {
    console.log("COMPETITION_EVALUATION_GATE_PASSED")
  }
}

function reusableCompletedCase(record: CaseEvaluationRecord): boolean {
  return record.summary.status === "ready"
    && record.evaluation_errors.length === 0
    && record.claim_audits.length > 0
    && record.claim_audits.every((audit) => audit.audited)
    && ARTIFACT_KINDS.every((kind) => record.difficulty_audits.some((audit) =>
      audit.artifact_kind === kind && audit.audited && audit.predicted_difficulty))
    && record.summary.code_execution === "passed"
}

async function evaluateCase(input: {
  repeatIndex: number
  evaluationCase: Week3EvaluationCase
  protocol: CompetitionProtocol
  resultsDirectory: string
  env: Record<string, string | undefined>
  judgeEnv: Record<string, string | undefined>
  judgeUsage: Array<Record<string, unknown>>
}): Promise<CaseEvaluationRecord> {
  let captured: { result: RoleCForRoleDResult } | undefined
  const summary = await runRoleCWeek3Case(input.evaluationCase, {
    executionMode: "model",
    runId: `RUN-COMP-${input.protocol.protocol_id.slice(7, 19)}-R${input.repeatIndex}-${input.evaluationCase.case_id}`,
    runtime: {
      providerMode: "model",
      env: input.env,
      dataDirectory: resolve(input.resultsDirectory, "runtime", `repeat-${input.repeatIndex}`, input.evaluationCase.case_id),
    },
    onCaseEvidence(value) { captured = { result: value.result } },
  })
  const result = captured?.result
  if (!result || result.status !== "ready" || !result.reviewedRelease) {
    return unpublishedCaseRecord(input, summary)
  }
  // Start the independent judge budget only after generation completes.  A
  // single gateway created at batch start expired after six minutes and made
  // later ready cases look unaudited even though no judge call had begun.
  const caseJudgeGateway = createRoleCModelGatewayFromEnv(input.judgeEnv, {
    on_usage(event) {
      input.judgeUsage.push({
        repeat_index: input.repeatIndex,
        case_id: input.evaluationCase.case_id,
        task: event.task,
        model_id: event.model_id,
        prompt_tokens: event.prompt_tokens,
        completion_tokens: event.completion_tokens,
        total_tokens: event.total_tokens,
        duration_ms: event.duration_ms,
      })
    },
  })
  const claimAuditor = new ModelCompetitionClaimAuditor(caseJudgeGateway)
  const difficultyJudge = new ModelResourceDifficultyJudge(caseJudgeGateway)
  const candidates = extractCompetitionClaimCandidates(result.reviewedRelease)
  const evidence = evidenceFactsFromDelivery(result.finalContext.evidencePack)
  const views = competitionArtifactViews(result.reviewedRelease)
  const evaluationErrors: string[] = []
  let claimAudits: ClaimAuditRecord[]
  try {
    claimAudits = await claimAuditor.audit({
      repeat_index: input.repeatIndex,
      case_id: input.evaluationCase.case_id,
      candidates,
      evidence,
    })
  } catch (error) {
    evaluationErrors.push(`claim-audit:${errorMessage(error)}`)
    claimAudits = candidates.map((claim) => ({
      repeat_index: input.repeatIndex,
      case_id: input.evaluationCase.case_id,
      artifact_kind: claim.artifact_kind,
      claim_id: claim.claim_id,
      claim_text: claim.text,
      citation_fact_ids: claim.citations.map((citation) => `${citation.source_id}:${citation.fact_id}`),
      factual: true,
      audited: false,
      verdict: "uncertain",
      supported_fact_ids: [],
      reason: `独立声明审核失败：${errorMessage(error)}`,
      judge_version: COMPETITION_CLAIM_AUDIT_VERSION,
    }))
  }
  const difficultyAudits = await Promise.all(views.map(async (view): Promise<DifficultyAuditRecord> => {
    try {
      const audit = await difficultyJudge.classify({
        case_id: input.evaluationCase.case_id,
        artifact_kind: view.artifact_kind,
        title: view.title,
        content: view.content,
        rubric_version: "difficulty-rubric-v1",
      })
      return {
        repeat_index: input.repeatIndex,
        case_id: input.evaluationCase.case_id,
        artifact_kind: view.artifact_kind,
        audited: true,
        predicted_difficulty: audit.predicted_difficulty,
        reasons: audit.reasons,
        confidence: audit.confidence,
        judge_version: MODEL_DIFFICULTY_JUDGE_VERSION,
      }
    } catch (error) {
      evaluationErrors.push(`difficulty-${view.artifact_kind}:${errorMessage(error)}`)
      return {
        repeat_index: input.repeatIndex,
        case_id: input.evaluationCase.case_id,
        artifact_kind: view.artifact_kind,
        audited: false,
        reasons: [`独立难度审核失败：${errorMessage(error)}`],
        judge_version: MODEL_DIFFICULTY_JUDGE_VERSION,
      }
    }
  }))
  return {
    protocol_id: input.protocol.protocol_id,
    repeat_index: input.repeatIndex,
    case_id: input.evaluationCase.case_id,
    generated_at: new Date().toISOString(),
    summary,
    public_release: result.reviewedRelease,
    evidence_pack: result.finalContext.evidencePack,
    claim_audits: claimAudits,
    difficulty_audits: difficultyAudits,
    evaluation_errors: evaluationErrors,
  }
}

function unpublishedCaseRecord(
  input: { repeatIndex: number; evaluationCase: Week3EvaluationCase; protocol: CompetitionProtocol },
  summary: RoleCWeek3CaseResult,
): CaseEvaluationRecord {
  return {
    protocol_id: input.protocol.protocol_id,
    repeat_index: input.repeatIndex,
    case_id: input.evaluationCase.case_id,
    generated_at: new Date().toISOString(),
    summary,
    claim_audits: [],
    difficulty_audits: ARTIFACT_KINDS.map((artifactKind) => ({
      repeat_index: input.repeatIndex,
      case_id: input.evaluationCase.case_id,
      artifact_kind: artifactKind,
      audited: false,
      reasons: [`资源未发布：${summary.failure_reason ?? summary.status}`],
      judge_version: MODEL_DIFFICULTY_JUDGE_VERSION,
    })),
    evaluation_errors: [summary.failure_reason ?? "真实流水线未返回可评审公开资源"],
  }
}

async function writeFinalArtifacts(
  resultsDirectory: string,
  report: FinalCompetitionReport,
  records: CaseEvaluationRecord[],
  judgeUsage: Array<Record<string, unknown>>,
): Promise<void> {
  await Bun.write(resolve(resultsDirectory, "claims.json"), `${JSON.stringify(records.flatMap((record) => record.claim_audits), null, 2)}\n`)
  await Bun.write(resolve(resultsDirectory, "difficulty-audits.json"), `${JSON.stringify(records.flatMap((record) => record.difficulty_audits), null, 2)}\n`)
  await Bun.write(resolve(resultsDirectory, "latest.json"), `${JSON.stringify(report, null, 2)}\n`)
  await Bun.write(resolve(resultsDirectory, "latest.md"), renderMarkdownReport(report))
  await Bun.write(resolve(resultsDirectory, "judge-usage.json"), `${JSON.stringify(judgeUsage, null, 2)}\n`)
}

function computeRepeatedMetrics(expectations: CompetitionCaseExpectation[], records: CaseEvaluationRecord[]): CompetitionMetricsReport {
  const repeatedCases: CompetitionCaseExpectation[] = []
  const claims: ClaimAuditRecord[] = []
  const difficultyAudits: DifficultyAuditRecord[] = []
  const byExpectation = new Map(expectations.map((item) => [item.case_id, item]))
  for (const record of records) {
    const expectation = byExpectation.get(record.case_id)
    if (!expectation) continue
    const repeatedCaseId = `repeat-${record.repeat_index}:${record.case_id}`
    repeatedCases.push({ ...expectation, case_id: repeatedCaseId })
    claims.push(...record.claim_audits.map((claim) => ({ ...claim, case_id: repeatedCaseId })))
    difficultyAudits.push(...record.difficulty_audits.map((audit) => ({ ...audit, case_id: repeatedCaseId })))
  }
  return computeCompetitionMetrics({ cases: repeatedCases, claims, difficultyAudits })
}

function operationalSummary(records: CaseEvaluationRecord[], expectedRuns: number): FinalCompetitionReport["operational"] {
  return {
    expected_runs: expectedRuns,
    completed_case_records: records.length,
    ready: records.filter((record) => record.summary.status === "ready").length,
    blocked: records.filter((record) => record.summary.status === "blocked").length,
    failed: records.filter((record) => record.summary.status === "failed").length,
    code_execution_passed: records.filter((record) => record.summary.code_execution === "passed").length,
    code_execution_failed: records.filter((record) => record.summary.code_execution === "failed").length,
    code_execution_not_reached: records.filter((record) => record.summary.code_execution === "not_reached").length,
    evaluation_error_cases: records.filter((record) => record.evaluation_errors.length > 0).length,
  }
}

function renderMarkdownReport(report: FinalCompetitionReport): string {
  const lines = [
    "# 赛题三项指标正式评测报告", "",
    `- 协议：${report.protocol.protocol_id}`,
    `- 代码：${report.protocol.repository_commit}`,
    `- 源码树：${report.protocol.source_tree_hash}`,
    `- 生成模型：${report.protocol.model_id}`,
    `- 独立评审模型：${report.protocol.judge_model_id}`,
    `- manifest：${report.protocol.evaluation_manifest_hash}`,
    `- 正式运行：${report.protocol.selected_case_ids.length} 例 × ${report.protocol.repeats} 次`, "",
  ]
  for (const repeat of report.repeat_reports) lines.push(`## 第 ${repeat.repeat_index} 次`, "", ...metricLines(repeat.metrics), "")
  lines.push("## 两次合并口径", "", ...metricLines(report.aggregate), "")
  lines.push(
    "## 运行完整性", "",
    `- 记录：${report.operational.completed_case_records} / ${report.operational.expected_runs}`,
    `- ready / blocked / failed：${report.operational.ready} / ${report.operational.blocked} / ${report.operational.failed}`,
    `- Docker 可信执行 passed / failed / not_reached：${report.operational.code_execution_passed} / ${report.operational.code_execution_failed} / ${report.operational.code_execution_not_reached}`,
    `- 含生成/评测错误的案例：${report.operational.evaluation_error_cases}`, "",
    `## 总判定：${report.passed ? "通过" : "未通过"}`, "",
  )
  return `${lines.join("\n")}\n`
}

function metricLines(report: CompetitionMetricsReport): string[] {
  const pct = (value: number | null) => value === null ? "—" : `${(value * 100).toFixed(2)}%`
  const m = report.metrics
  return [
    `- 大模型内容幻觉率：${m.hallucination_rate.numerator} / ${m.hallucination_rate.denominator} = ${pct(m.hallucination_rate.value)}（要求 <5%）`,
    `- 画像—资源难度适配准确率：${m.resource_adaptation_accuracy.numerator} / ${m.resource_adaptation_accuracy.denominator} = ${pct(m.resource_adaptation_accuracy.value)}（要求 ≥85%）`,
    `- 课程核心知识点覆盖率：${m.core_knowledge_coverage.numerator} / ${m.core_knowledge_coverage.denominator} = ${pct(m.core_knowledge_coverage.value)}（要求 ≥90%）`,
    `- 声明审核覆盖率：${pct(m.claim_audit_coverage.value)}（要求 ≥95%）`,
    `- 难度审核完整度：${pct(m.difficulty_audit_completeness.value)}（要求 100%）`,
    `- 本组判定：${report.passed ? "通过" : "未通过"}`,
  ]
}

async function writeManualAuditTemplate(
  resultsDirectory: string,
  cases: Week3EvaluationCase[],
  expectations: CompetitionCaseExpectation[],
  records: CaseEvaluationRecord[],
): Promise<void> {
  const sampleIds = stratifiedManualSample(cases, 12)
  const expectationById = new Map(expectations.map((item) => [item.case_id, item]))
  const recordByKey = new Map(records.map((record) => [`${record.repeat_index}:${record.case_id}`, record]))
  const rows = [[
    "repeat_index", "case_id", "learner_profile_id", "artifact_kind", "expected_difficulty",
    "model_predicted_difficulty", "difficulty_human_agree", "factual_claims", "bad_claims",
    "claim_audit_human_agree", "required_facts", "covered_facts", "reviewer_1", "reviewer_2",
    "adjudication", "notes",
  ]]
  for (const caseId of sampleIds) {
    const evaluationCase = cases.find((item) => item.case_id === caseId)!
    const expectation = expectationById.get(caseId)!
    const record = recordByKey.get(`1:${caseId}`)
    for (const kind of ARTIFACT_KINDS) {
      const claims = record?.claim_audits.filter((claim) => claim.artifact_kind === kind) ?? []
      const difficulty = record?.difficulty_audits.find((audit) => audit.artifact_kind === kind)
      const covered = new Set(claims.flatMap((claim) => claim.verdict === "supported" ? claim.supported_fact_ids : []))
      rows.push([
        "1", caseId, evaluationCase.learner_profile_id, kind, expectation.expected_difficulty[kind],
        difficulty?.predicted_difficulty ?? "", "", String(claims.filter((claim) => claim.factual).length),
        String(claims.filter((claim) => claim.factual && claim.verdict !== "supported").length), "",
        String(expectation.required_fact_ids.length), String(expectation.required_fact_ids.filter((id) => covered.has(id)).length),
        "", "", "", "",
      ])
    }
  }
  // This file is intentionally a template. A real reviewer-owned
  // manual-audit.csv must never be overwritten by a rerun of the model.
  await Bun.write(resolve(resultsDirectory, "manual-audit-template.csv"), rows.map((row) => row.map(csvCell).join(",")).join("\n") + "\n")
}

async function writeShowcaseComparison(resultsDirectory: string, records: CaseEvaluationRecord[]): Promise<void> {
  const showcaseIds = ["golden-cs-basic-18", "golden-cross-major-18", "golden-zero-beginner-18"]
  const selected = showcaseIds.flatMap((caseId) => {
    const record = records.find((item) => item.repeat_index === 1 && item.case_id === caseId)
    return record ? [record] : []
  })
  const data = selected.map((record) => ({
    case_id: record.case_id,
    status: record.summary.status,
    expected_difficulty: record.summary.expected_difficulty,
    predicted_difficulty: Object.fromEntries(record.difficulty_audits.map((audit) => [audit.artifact_kind, audit.predicted_difficulty ?? "not_audited"])),
    artifact_previews: record.summary.artifacts.map((artifact) => ({ kind: artifact.kind, title: artifact.title, preview: artifact.preview })),
    claim_count: record.claim_audits.filter((claim) => claim.factual).length,
    bad_claim_count: record.claim_audits.filter((claim) => claim.factual && claim.verdict !== "supported").length,
    citation_coverage: record.summary.target_citation_coverage,
    code_execution: record.summary.code_execution,
  }))
  await Bun.write(resolve(resultsDirectory, "showcase-comparison.json"), `${JSON.stringify(data, null, 2)}\n`)
  const lines = [
    "# 三画像同目标展示案例（K018）", "",
    "| 案例 | 状态 | 期望难度 | 讲义/实验/测评判定 | 事实声明 | 问题声明 | 引用覆盖 | Docker |",
    "| --- | --- | --- | --- | ---: | ---: | ---: | --- |",
    ...data.map((item) => `| ${item.case_id} | ${item.status} | ${item.expected_difficulty} | ${Object.values(item.predicted_difficulty).join("/")} | ${item.claim_count} | ${item.bad_claim_count} | ${(item.citation_coverage * 100).toFixed(1)}% | ${item.code_execution} |`), "",
  ]
  await Bun.write(resolve(resultsDirectory, "showcase-comparison.md"), lines.join("\n"))
}

function stratifiedManualSample(cases: Week3EvaluationCase[], count: number): string[] {
  const preferred = [
    "golden-cs-basic-01", "golden-cs-basic-04", "golden-cs-basic-13", "golden-cs-basic-18",
    "golden-cross-major-01", "golden-cross-major-04", "golden-cross-major-13", "golden-cross-major-18",
    "golden-zero-beginner-01", "golden-zero-beginner-04", "golden-zero-beginner-13", "golden-zero-beginner-18",
  ]
  const available = new Set(cases.map((item) => item.case_id))
  const selected = preferred.filter((id) => available.has(id))
  for (const item of cases) {
    if (selected.length >= count) break
    if (!selected.includes(item.case_id)) selected.push(item.case_id)
  }
  return selected.slice(0, count)
}

function assertSelectionMatchesManifest(cases: Week3EvaluationCase[], expectations: CompetitionCaseExpectation[]): void {
  const manifestIds = new Set(expectations.map((item) => item.case_id))
  const missing = cases.filter((item) => !manifestIds.has(item.case_id)).map((item) => item.case_id)
  if (missing.length > 0) throw new Error(`COMPETITION_MANIFEST_CASE_MISSING:${missing.join(",")}`)
}

async function readAndValidateManifest(path: string): Promise<FrozenManifest> {
  const value = await Bun.file(path).json() as FrozenManifest
  if (value.manifest_version !== "competition-v1" || value.total_cases !== 60
    || value.expected_artifacts !== 180 || value.cases.length !== 60) throw new Error("COMPETITION_MANIFEST_INVALID")
  computeCompetitionMetrics({ cases: value.cases, claims: [], difficultyAudits: [] })
  return value
}

function selectCases(cases: Week3EvaluationCase[], cli: CliArgs): Week3EvaluationCase[] {
  const developmentIds = new Set([
    "golden-cs-basic-01", "golden-cs-basic-04", "golden-cs-basic-13", "golden-cs-basic-18",
    "golden-cross-major-01", "golden-cross-major-04", "golden-cross-major-13", "golden-cross-major-18",
    "golden-zero-beginner-01", "golden-zero-beginner-04", "golden-zero-beginner-13", "golden-zero-beginner-18",
  ])
  let selected = cli.dev
    ? cases.filter((item) => developmentIds.has(item.case_id))
    : cli.caseIds.length > 0
      ? cases.filter((item) => cli.caseIds.includes(item.case_id))
      : cases
  const unknown = cli.caseIds.filter((id) => !cases.some((item) => item.case_id === id))
  if (unknown.length > 0) throw new Error(`UNKNOWN_COMPETITION_CASE:${unknown.join(",")}`)
  if (cli.limit !== undefined) selected = selected.slice(0, cli.limit)
  if (!cli.all && !cli.dev && cli.limit === undefined && cli.caseIds.length === 0) throw new Error("真实竞赛评测必须显式传入 --all、--dev、--limit 或 --case-id")
  return selected
}

interface CliArgs {
  all: boolean
  dev: boolean
  assertGates: boolean
  refreshManifest: boolean
  force: boolean
  limit?: number
  repeats: number
  concurrency: number
  caseIds: string[]
  outputDirectory: string
}

function parseArgs(values: string[]): CliArgs {
  const limit = numberOption(values, "--limit")
  const repeats = numberOption(values, "--repeats") ?? 1
  const concurrency = numberOption(values, "--concurrency") ?? 2
  if (limit !== undefined && limit < 1) throw new Error("--limit 必须为正整数")
  if (repeats < 1 || repeats > 5) throw new Error("--repeats 必须为 1..5")
  if (concurrency < 1 || concurrency > 4) throw new Error("--concurrency 必须为 1..4")
  return {
    all: values.includes("--all"),
    dev: values.includes("--dev"),
    assertGates: values.includes("--assert-gates"),
    refreshManifest: values.includes("--refresh-manifest"),
    force: values.includes("--force"),
    limit,
    repeats,
    concurrency,
    caseIds: values.filter((value) => value.startsWith("--case-id=")).map((value) => value.slice(10)),
    outputDirectory: option(values, "--output-dir") ?? "evaluation/results",
  }
}

function numberOption(values: string[], name: string): number | undefined {
  const value = option(values, name)
  if (value === undefined) return undefined
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) throw new Error(`${name} 必须为整数`)
  return parsed
}

function option(values: string[], name: string): string | undefined {
  return values.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1)
}

function competitionJudgeEnv(env: Record<string, string | undefined>): Record<string, string | undefined> {
  const hasIndependentJudgeConfig = Boolean(
    env.COMPETITION_JUDGE_ENDPOINT?.trim() || env.COMPETITION_JUDGE_MODEL_ID?.trim(),
  )
  const endpoint = env.COMPETITION_JUDGE_ENDPOINT
    ?? env.MODEL_RUNTIME_ENDPOINT
    ?? env.ROLE_C_MODEL_ENDPOINT
  const model = env.COMPETITION_JUDGE_MODEL_ID
    ?? env.MODEL_RUNTIME_MODEL_ID
    ?? env.ROLE_C_MODEL_ID
  const apiKey = hasIndependentJudgeConfig
    ? env.COMPETITION_JUDGE_API_KEY
    : env.MODEL_RUNTIME_API_KEY ?? env.ROLE_C_MODEL_API_KEY
  const responseFormat = env.COMPETITION_JUDGE_RESPONSE_FORMAT
    ?? env.MODEL_RUNTIME_RESPONSE_FORMAT
    ?? env.ROLE_C_MODEL_RESPONSE_FORMAT
  const schemaStrict = env.COMPETITION_JUDGE_SCHEMA_STRICT
    ?? env.ROLE_C_MODEL_SCHEMA_STRICT
  const thinking = env.COMPETITION_JUDGE_THINKING ?? "disabled"
  const timeout = env.COMPETITION_JUDGE_TIMEOUT_MS ?? env.ROLE_C_MODEL_TIMEOUT_MS
  return {
    ...env,
    // createRoleCModelGatewayFromEnv gives MODEL_RUNTIME_* precedence, so set
    // both namespaces to keep judge overrides independent from generation.
    MODEL_RUNTIME_ENDPOINT: endpoint,
    MODEL_RUNTIME_MODEL_ID: model,
    MODEL_RUNTIME_API_KEY: apiKey,
    MODEL_RUNTIME_RESPONSE_FORMAT: responseFormat,
    ROLE_C_MODEL_ENDPOINT: endpoint,
    ROLE_C_MODEL_ID: model,
    ROLE_C_MODEL_API_KEY: apiKey,
    ROLE_C_MODEL_RESPONSE_FORMAT: responseFormat,
    ROLE_C_MODEL_SCHEMA_STRICT: schemaStrict,
    ROLE_C_MODEL_THINKING: thinking,
    ROLE_C_MODEL_TIMEOUT_MS: timeout,
  }
}

async function probeEvaluationGateway(
  gateway: ReturnType<typeof createRoleCModelGatewayFromEnv>,
  role: "generation" | "judge",
): Promise<void> {
  const output = await gateway.generateStructured<{ ok: unknown }>({
    task: `competition.preflight.${role}`,
    system_prompt: "这是评测配置连通性检查。只输出符合 Schema 的 JSON。",
    input: { expected: true },
    output_schema_id: "competition_preflight_v1",
    output_schema: {
      type: "object",
      additionalProperties: false,
      required: ["ok"],
      properties: { ok: { const: true } },
    },
    temperature: 0,
    max_tokens: 64,
    idempotency_key: contentHash({ role, model: gateway.model_config_hash, version: 1 }),
  })
  if (output.ok !== true) throw new Error(`COMPETITION_${role.toUpperCase()}_PREFLIGHT_INVALID`)
}

async function readEnvFile(path: string): Promise<Record<string, string>> {
  const file = Bun.file(path)
  if (!await file.exists()) throw new Error(`MODEL_CONFIG_NOT_FOUND:${path}`)
  const parsed: Record<string, string> = {}
  for (const [lineNumber, sourceLine] of (await file.text()).split(/\r?\n/).entries()) {
    const line = sourceLine.trim()
    if (!line || line.startsWith("#")) continue
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/)
    if (!match) throw new Error(`INVALID_ENV_LINE:${lineNumber + 1}`)
    let value = match[2]!.trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    parsed[match[1]!] = value
  }
  return parsed
}

async function readPersistedGenerationProvider(path: string): Promise<Record<string, string>> {
  const file = Bun.file(path)
  if (!await file.exists()) return {}
  const parsed = JSON.parse((await file.text()).replace(/^\uFEFF/, "")) as Record<string, unknown>
  const endpoint = typeof parsed.endpoint === "string" ? parsed.endpoint.trim() : ""
  const model = typeof parsed.model_id === "string" ? parsed.model_id.trim() : ""
  const apiKey = typeof parsed.api_key === "string" ? parsed.api_key.trim() : ""
  if (parsed.provider_mode !== "model" || !endpoint || !model || !apiKey) {
    throw new Error(`INVALID_GENERATION_PROVIDER_CONFIG:${path}`)
  }
  return {
    ROLE_C_PROVIDER_MODE: "model",
    ROLE_C_MODEL_ENDPOINT: endpoint,
    ROLE_C_MODEL_ID: model,
    ROLE_C_MODEL_API_KEY: apiKey,
  }
}

async function evaluationSourceTreeHash(): Promise<string> {
  const roots = ["src", "scripts", "schemas", ".github", "package.json", "bun.lock"]
  const files: string[] = []
  for (const root of roots) {
    const path = resolve(ROOT, root)
    const stat = Bun.file(path)
    if (root.endsWith(".json") || root.endsWith(".lock")) {
      if (await stat.exists()) files.push(root)
    } else {
      try { files.push(...await recursiveFiles(path, root)) } catch { /* optional root */ }
    }
  }
  files.sort()
  const entries = await Promise.all(files.map(async (path) => ({ path, content: await Bun.file(resolve(ROOT, path)).text() })))
  return contentHash(entries)
}

async function recursiveFiles(directory: string, relative: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const nextRelative = `${relative}/${entry.name}`
    if (entry.isDirectory()) files.push(...await recursiveFiles(resolve(directory, entry.name), nextRelative))
    else if (entry.isFile()) files.push(nextRelative)
  }
  return files
}

function gitOutput(args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], { cwd: ROOT, stdout: "pipe", stderr: "pipe" })
  return result.exitCode === 0 ? result.stdout.toString().trim() : "unknown"
}

function providerName(endpoint: string | undefined): string {
  if (!endpoint) return "unconfigured"
  try { return new URL(endpoint).hostname } catch { return "configured-compatible-provider" }
}

async function mapConcurrent<T, R>(items: T[], concurrency: number, mapper: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = cursor++
      if (index >= items.length) return
      results[index] = await mapper(items[index]!, index)
    }
  }))
  return results
}

async function readJsonOrUndefined<T>(path: string): Promise<T | undefined> {
  const file = Bun.file(path)
  if (!await file.exists()) return undefined
  try { return await file.json() as T } catch { return undefined }
}

function csvCell(value: string): string { return `"${value.replaceAll('"', '""')}"` }
function errorMessage(error: unknown): string { return error instanceof Error ? `${error.name}:${error.message}` : "unknown error" }

await main()
