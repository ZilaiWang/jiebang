import { mkdir } from "node:fs/promises"
import { resolve } from "node:path"
import { buildWeek3EvaluationCases } from "../src/evaluation/week3-evaluation"
import {
  prepareRoleCWeek3Input,
} from "../src/role-c-content/evaluation/week3-runner"
import {
  classifyReviewFinding,
  contentHash,
  createLocalABContentReviewPort,
  createRoleCModelGatewayFromEnv,
  ModelContentSemanticAuditPort,
  ROLE_C_PROMPT_MANIFEST_VERSION,
  type ContentReviewRequest,
  type ContentReviewResult,
} from "../src/role-c-content"
import { generateRoleCForRoleDWithRuntime } from "../src/role-d-integration/role-c-service"

const values = process.argv.slice(2)
const caseId = option(values, "--case-id") ?? "golden-cross-major-20"
const outputDirectory = resolve(
  process.cwd(),
  option(values, "--output-dir")
    ?? ".tmp/competition-sprint/day3-anti-hallucination",
)
const evaluationCase = buildWeek3EvaluationCases().find((item) => item.case_id === caseId)
if (!evaluationCase) throw new Error(`未知评测用例：${caseId}`)

await mkdir(outputDirectory, { recursive: true })
const prepared = await prepareRoleCWeek3Input(evaluationCase)
const gateway = createRoleCModelGatewayFromEnv()
const baseReviewPort = createLocalABContentReviewPort({
  knowledge_base: prepared.knowledgeBase,
  semantic_audit_port: new ModelContentSemanticAuditPort(gateway),
})
const captured: Array<{
  request: ContentReviewRequest
  result: ContentReviewResult
}> = []
const reviewPort = {
  policy_version: baseReviewPort.policy_version,
  async review(request: ContentReviewRequest): Promise<ContentReviewResult> {
    const result = await baseReviewPort.review(request)
    captured.push({
      request: structuredClone(request),
      result: structuredClone(result),
    })
    return result
  },
}
const runId = `RUN-C-DAY3-${Date.now().toString(36).toUpperCase()}-${caseId}`
const startedAt = Date.now()
const outcome = await generateRoleCForRoleDWithRuntime({
  profile: prepared.profile,
  ragResult: prepared.ragResult,
  kbVersion: prepared.kbVersion,
  runId,
  pathNode: prepared.pathNode,
}, {
  providerMode: "model",
  dataDirectory: resolve(outputDirectory, "runtime"),
  reviewPort,
})
const durationMs = Date.now() - startedAt

const evidenceKeys = new Set(
  outcome.status === "ready"
    ? outcome.finalContext.evidencePack.results.flatMap((item) =>
        item.facts.map((fact) => `${fact.source_id}:${fact.fact_id}`))
    : [],
)
const artifactRows = outcome.artifacts.map((artifact) => {
  const citations = unique(artifact.citations.map((citation) =>
    `${citation.source_id}:${citation.fact_id}`))
  return {
    artifact_id: artifact.id,
    kind: artifact.kind,
    citation_count: citations.length,
    unknown_citations: citations.filter((citation) => !evidenceKeys.has(citation)),
  }
})
const reviewRounds = captured.map(({ result }) => ({
  revision_round: result.revision_round,
  decision: result.decision,
  findings: result.artifact_results.flatMap((artifact) =>
    artifact.findings.map((finding) => ({
      code: finding.code,
      ...classifyReviewFinding(finding),
      artifact_kind: finding.artifact_kind,
      artifact_id: finding.artifact_id,
      locator: finding.locator ?? null,
      evidence_refs: finding.evidence_refs,
      message: finding.message,
    }))),
}))

const factAuditReport = {
  report_kind: "role_c_anti_hallucination_audit",
  generated_at: new Date().toISOString(),
  case_id: caseId,
  run_id: runId,
  duration_ms: durationMs,
  model_id: gateway.model_id,
  model_config_hash: gateway.model_config_hash,
  prompt_version: ROLE_C_PROMPT_MANIFEST_VERSION,
  kb_version: prepared.kbVersion,
  requested_target_source_ids: evaluationCase.target_source_ids,
  final_target_source_ids: outcome.status === "ready"
    ? outcome.finalContext.pathNode.target_source_ids
    : prepared.pathNode.target_source_ids,
  public_evidence_hash: outcome.status === "ready"
    ? contentHash(outcome.finalContext.evidencePack)
    : null,
  status: outcome.status,
  final_review_decision: outcome.audit?.arbitration.decision ?? "not_reached",
  fact_status: outcome.audit?.factStatus ?? "not_reached",
  publishable: outcome.status === "ready"
    && outcome.audit?.arbitration.decision === "pass"
    && artifactRows.length === 3
    && artifactRows.every((artifact) => artifact.unknown_citations.length === 0),
  artifacts: artifactRows,
  review_rounds: reviewRounds,
  ...(outcome.status === "ready" ? {} : { failure: outcome.failure }),
}

const repairLog = {
  log_kind: "role_c_repair_and_downgrade",
  generated_at: new Date().toISOString(),
  case_id: caseId,
  run_id: runId,
  external_revision_rounds: captured.map(({ request, result }, index) => ({
    spec_id: request.generation_spec.spec_id,
    generation_spec_hash: contentHash(request.generation_spec),
    revision_round: result.revision_round,
    decision: result.decision,
    strategy: index === 0
      ? "initial_generation"
      : captured[index - 1]!.request.generation_spec.spec_id !== request.generation_spec.spec_id
        ? "replanned_spec_generation"
        : result.revision_round === 1
          ? "targeted_rewrite"
          : "strong_rewrite_reduce_load",
    issue_codes: unique(result.revision_instructions.map((item) => item.code)),
  })),
  cross_spec_recovery: outcome.recovery ?? null,
  final_status: outcome.status,
  terminal_action: outcome.recovery?.requiredAction
    ?? (outcome.status === "ready" ? "none" : outcome.failure.nextAction),
}

await Bun.write(
  resolve(outputDirectory, "fact-audit-report.json"),
  `${JSON.stringify(factAuditReport, null, 2)}\n`,
)
await Bun.write(
  resolve(outputDirectory, "repair-and-downgrade-log.json"),
  `${JSON.stringify(repairLog, null, 2)}\n`,
)
console.log(JSON.stringify({
  status: outcome.status,
  case_id: caseId,
  publishable: factAuditReport.publishable,
  final_review_decision: factAuditReport.final_review_decision,
  review_rounds: captured.length,
  artifacts: artifactRows.map((artifact) => artifact.kind),
  outputs: [
    resolve(outputDirectory, "fact-audit-report.json"),
    resolve(outputDirectory, "repair-and-downgrade-log.json"),
  ],
}, null, 2))
if (!factAuditReport.publishable) process.exitCode = 1

function option(args: string[], name: string): string | undefined {
  return args.find((value) => value.startsWith(`${name}=`))
    ?.slice(name.length + 1)
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}
