import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import { dirname, relative, resolve } from "node:path"

type ReviewDecision = "pass" | "revise" | "reject" | "not_reached"
type RunStatus = "ready" | "blocked" | "failed"

interface Day3AuditReport {
  report_kind: "role_c_anti_hallucination_audit"
  generated_at: string
  case_id: string
  run_id: string
  duration_ms: number
  status: RunStatus
  final_review_decision: ReviewDecision
  publishable: boolean
  artifacts: Array<{
    artifact_id: string
    kind: string
    citation_count: number
    unknown_citations: string[]
  }>
  review_rounds: Array<{
    revision_round: number
    decision: Exclude<ReviewDecision, "not_reached">
    findings: Array<{
      code: string
      category?: string
      owner?: string
      artifact_kind?: string
      artifact_id?: string
      locator?: unknown
      evidence_refs?: string[]
      message?: string
    }>
  }>
  failure?: {
    code: string
    stage: string
    issueCodes: string[]
    repairScope: string
    nextAction: string
    canRetry: boolean
    message: string
    fingerprint: string
  }
}

interface Day3RepairLog {
  log_kind: "role_c_repair_and_downgrade"
  run_id: string
  external_revision_rounds: Array<{
    spec_id: string
    generation_spec_hash: string
    revision_round: number
    decision: Exclude<ReviewDecision, "not_reached">
    strategy: string
    issue_codes: string[]
  }>
  cross_spec_recovery: null | {
    code: string
    failedDimensions: string[]
    missingPrerequisiteSourceIds: string[]
    unknownPrerequisiteRefs: string[]
    requiredAction: string
    fixScope: string
    canRecover: boolean
    attempts: number
    message: string
  }
  final_status: RunStatus
  terminal_action: string
}

export interface Day3AuditLedgerEntry {
  schema_version: "1.0"
  entry_id: string
  run_id: string
  case_id: string
  sequence_index: number
  unit_name: "role-c-content-pipeline" | "content-review-port" | "content-recovery"
  execution_type: "reviewed_pipeline" | "external_port"
  stage: "generation" | "review" | "recovery"
  status: "completed" | "blocked" | "failed"
  review_decision: ReviewDecision | null
  revision_round: number | null
  input_refs: string[]
  output_refs: string[]
  evidence_refs: string[]
  artifact_refs: string[]
  error_codes: string[]
  retry_or_recovery: {
    occurred: boolean
    strategy: string | null
    terminal_action: string | null
  }
  publishable: boolean
  observability: {
    execution_observed: true
    evidence_level: "E3"
    limitations: string[]
  }
}

export interface Day3AuditLedgerSummary {
  runs: number
  entries: number
  ready_runs: number
  blocked_or_failed_runs: number
  review_rounds_observed: number
  review_failure_observed: boolean
  repair_or_recovery_observed: boolean
  downgrade_or_blocked_observed: boolean
  internally_closed_runs: number
  acceptance_chain_complete: boolean
}

export async function exportDay3AuditWorkerLedger(input: {
  run_directories: string[]
  output_file: string
}): Promise<{ entries: Day3AuditLedgerEntry[]; summary: Day3AuditLedgerSummary }> {
  if (input.run_directories.length === 0) throw new Error("at least one --run-dir is required")
  const entries: Day3AuditLedgerEntry[] = []
  const reports: Day3AuditReport[] = []
  const logs: Day3RepairLog[] = []
  const outputFile = resolve(input.output_file)
  const outputDirectory = dirname(outputFile)

  for (const rawDirectory of input.run_directories) {
    const directory = resolve(rawDirectory)
    const reportPath = resolve(directory, "fact-audit-report.json")
    const repairPath = resolve(directory, "repair-and-downgrade-log.json")
    await Promise.all([stat(reportPath), stat(repairPath)])
    const report = JSON.parse(await readFile(reportPath, "utf8")) as Day3AuditReport
    const repair = JSON.parse(await readFile(repairPath, "utf8")) as Day3RepairLog
    validatePair(report, repair)
    reports.push(report)
    logs.push(repair)
    const reportRef = relativeEvidenceRef(reportPath, outputDirectory)
    const repairRef = relativeEvidenceRef(repairPath, outputDirectory)
    let sequence = 1

    entries.push({
      schema_version: "1.0",
      entry_id: `${report.run_id}:pipeline`,
      run_id: report.run_id,
      case_id: report.case_id,
      sequence_index: sequence++,
      unit_name: "role-c-content-pipeline",
      execution_type: "reviewed_pipeline",
      stage: report.review_rounds.length > 0 ? "review" : "generation",
      status: report.status === "ready" ? "completed" : report.status,
      review_decision: report.final_review_decision,
      revision_round: null,
      input_refs: [report.case_id],
      output_refs: [reportRef, repairRef],
      evidence_refs: [report.failure?.fingerprint].filter((value): value is string => Boolean(value)),
      artifact_refs: report.artifacts.map((artifact) => artifact.artifact_id),
      error_codes: report.failure
        ? [report.failure.code, ...report.failure.issueCodes]
        : [],
      retry_or_recovery: {
        occurred: repair.external_revision_rounds.length > 1
          || Boolean(repair.cross_spec_recovery?.attempts),
        strategy: null,
        terminal_action: repair.terminal_action,
      },
      publishable: report.publishable,
      observability: {
        execution_observed: true,
        evidence_level: "E3",
        limitations: report.review_rounds.length === 0
          ? ["运行在进入 content review 前终止；审核输入、输出和结论均未发生。"]
          : [],
      },
    })

    for (const [roundIndex, round] of report.review_rounds.entries()) {
      const revision = repair.external_revision_rounds[roundIndex]
      if (roundIndex > 0 && revision) {
        entries.push({
          schema_version: "1.0",
          entry_id: `${report.run_id}:recovery:${roundIndex}`,
          run_id: report.run_id,
          case_id: report.case_id,
          sequence_index: sequence++,
          unit_name: "content-recovery",
          execution_type: "reviewed_pipeline",
          stage: "recovery",
          status: "completed",
          review_decision: null,
          revision_round: revision.revision_round,
          input_refs: [repair.external_revision_rounds[roundIndex - 1]!.spec_id],
          output_refs: [revision.spec_id, repairRef],
          evidence_refs: [revision.generation_spec_hash],
          artifact_refs: [],
          error_codes: unique([
            ...repair.external_revision_rounds[roundIndex - 1]!.issue_codes,
            ...(repair.cross_spec_recovery?.failedDimensions ?? []),
          ]),
          retry_or_recovery: {
            occurred: true,
            strategy: revision.strategy,
            terminal_action: repair.terminal_action,
          },
          publishable: false,
          observability: {
            execution_observed: true,
            evidence_level: "E3",
            limitations: [],
          },
        })
      }
      const reviewedArtifactRefs = unique(round.findings
        .map((finding) => finding.artifact_id)
        .filter((value): value is string => Boolean(value)))
      entries.push({
        schema_version: "1.0",
        entry_id: `${report.run_id}:review:${roundIndex + 1}`,
        run_id: report.run_id,
        case_id: report.case_id,
        sequence_index: sequence++,
        unit_name: "content-review-port",
        execution_type: "external_port",
        stage: "review",
        status: "completed",
        review_decision: round.decision,
        revision_round: round.revision_round,
        input_refs: reviewedArtifactRefs.length > 0
          ? reviewedArtifactRefs
          : report.artifacts.map((artifact) => artifact.artifact_id),
        output_refs: [reportRef],
        evidence_refs: round.findings.flatMap((finding) => finding.evidence_refs ?? []),
        artifact_refs: reviewedArtifactRefs.length > 0
          ? reviewedArtifactRefs
          : report.artifacts.map((artifact) => artifact.artifact_id),
        error_codes: round.findings.map((finding) => finding.code),
        retry_or_recovery: {
          occurred: round.decision !== "pass",
          strategy: revision?.strategy ?? null,
          terminal_action: null,
        },
        publishable: round.decision === "pass" && report.publishable,
        observability: {
          execution_observed: true,
          evidence_level: "E3",
          limitations: [],
        },
      })
    }

  }

  const reviewFailureObserved = reports.some((report) =>
    report.review_rounds.some((round) => round.decision !== "pass"))
  const recoveryObserved = logs.some((log) =>
    log.external_revision_rounds.length > 1 || Boolean(log.cross_spec_recovery?.attempts))
  const summary: Day3AuditLedgerSummary = {
    runs: reports.length,
    entries: entries.length,
    ready_runs: reports.filter((report) => report.status === "ready").length,
    blocked_or_failed_runs: reports.filter((report) => report.status !== "ready").length,
    review_rounds_observed: reports.reduce((sum, report) => sum + report.review_rounds.length, 0),
    review_failure_observed: reviewFailureObserved,
    repair_or_recovery_observed: recoveryObserved,
    downgrade_or_blocked_observed: reports.some((report) => report.status !== "ready")
      || logs.some((log) => log.terminal_action !== "none"),
    internally_closed_runs: reports.filter((report) =>
      (report.status === "ready" && report.publishable && report.final_review_decision === "pass")
      || (report.status !== "ready" && !report.publishable)).length,
    acceptance_chain_complete: reviewFailureObserved && recoveryObserved,
  }

  await mkdir(dirname(outputFile), { recursive: true })
  await writeFile(outputFile, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8")
  return { entries, summary }
}

function validatePair(report: Day3AuditReport, repair: Day3RepairLog): void {
  if (report.report_kind !== "role_c_anti_hallucination_audit") {
    throw new Error("unexpected fact audit report kind")
  }
  if (repair.log_kind !== "role_c_repair_and_downgrade") {
    throw new Error("unexpected repair log kind")
  }
  if (report.run_id !== repair.run_id) throw new Error("report and repair log run_id mismatch")
  if (report.status !== repair.final_status) throw new Error("report and repair log status mismatch")
  if (report.review_rounds.length !== repair.external_revision_rounds.length) {
    throw new Error("report and repair log review round count mismatch")
  }
  if (report.publishable && (report.status !== "ready"
    || report.final_review_decision !== "pass"
    || report.artifacts.length === 0)) {
    throw new Error("publishable run lacks a completed passing review and artifacts")
  }
  if (!report.publishable && report.artifacts.some((artifact) => artifact.unknown_citations.length > 0)) {
    return
  }
  if (report.status !== "ready" && report.publishable) {
    throw new Error("blocked or failed run cannot be publishable")
  }
}

function relativeEvidenceRef(path: string, outputDirectory: string): string {
  return relative(outputDirectory, path).replaceAll("\\", "/")
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}
