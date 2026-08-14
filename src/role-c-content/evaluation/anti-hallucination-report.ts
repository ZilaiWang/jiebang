import type { RagEvidencePack } from "../contracts/evidence-pack"
import type { RecoverableReviewedCPipelineResult } from "../review/run-recoverable-pipeline"
import { extractReviewBlocks } from "../review/extract-review-blocks"
import { classifyReviewFinding } from "../review/failure-classification"
import type { ReviewablePublicArtifact } from "../review/types"

export interface AntiHallucinationAuditReport {
  report_kind: "role_c_anti_hallucination_audit"
  run_id: string
  spec_id: string
  evidence_hash: string
  review_policy_version: string
  pipeline_status: string
  publishable: boolean
  artifacts: Array<{
    artifact_kind: "concept" | "code_lab" | "assessment"
    artifact_id: string
    review_block_count: number
    cited_fact_count: number
    missing_or_unknown_citations: string[]
  }>
  review_rounds: Array<{
    revision_round: number
    decision: "pass" | "revise" | "reject"
    findings: Array<{
      code: string
      category: ReturnType<typeof classifyReviewFinding>["category"]
      owner: ReturnType<typeof classifyReviewFinding>["owner"]
      artifact_kind: "concept" | "code_lab" | "assessment"
      locator?: string
      evidence_refs: string[]
      message: string
    }>
  }>
}

export interface RepairAndDowngradeLog {
  log_kind: "role_c_repair_and_downgrade"
  run_id: string
  final_status: string
  final_recovery_code: string
  external_revision_rounds: Array<{
    revision_round: number
    decision: "pass" | "revise" | "reject"
    strategy: "initial_generation" | "targeted_rewrite" | "strong_rewrite_reduce_load"
    issue_codes: string[]
  }>
  input_recovery_attempts: Array<{
    attempt_no: number
    action: "new_evidence" | "new_spec"
    input_spec_id: string
    output_spec_id?: string
  }>
  terminal_action: string
}

export function buildAntiHallucinationAuditReport(
  result: RecoverableReviewedCPipelineResult,
  evidence: RagEvidencePack,
): AntiHallucinationAuditReport {
  const evidenceKeys = new Set(evidence.results.flatMap((entry) =>
    entry.facts.map((fact) => `${fact.source_id}:${fact.fact_id}`)))
  const artifacts = reviewableArtifacts(result).map((target) => {
    const blocks = extractReviewBlocks(target)
    const citedKeys = [...new Set(blocks.flatMap((block) =>
      block.citations.map((citation) => `${citation.source_id}:${citation.fact_id}`)))]
    return {
      artifact_kind: target.kind,
      artifact_id: target.artifact.artifact_id,
      review_block_count: blocks.length,
      cited_fact_count: citedKeys.length,
      missing_or_unknown_citations: citedKeys.filter((key) => !evidenceKeys.has(key)),
    }
  })
  return {
    report_kind: "role_c_anti_hallucination_audit",
    run_id: result.generation_spec.run_id,
    spec_id: result.generation_spec.spec_id,
    evidence_hash: result.generation_spec.evidence_content_hash,
    review_policy_version: result.review_policy_version,
    pipeline_status: result.status,
    publishable: result.status === "ready"
      && result.state === "READY"
      && result.review_reports.at(-1)?.decision === "pass"
      && artifacts.every((artifact) => artifact.missing_or_unknown_citations.length === 0),
    artifacts,
    review_rounds: result.review_reports.map((report) => ({
      revision_round: report.revision_round,
      decision: report.decision,
      findings: report.artifact_results.flatMap((artifact) =>
        artifact.findings.map((finding) => {
          const classification = classifyReviewFinding(finding)
          return {
            code: finding.code,
            category: classification.category,
            owner: classification.owner,
            artifact_kind: finding.artifact_kind,
            ...(finding.locator
              ? { locator: `${finding.locator.field}:${finding.locator.ref_id}` }
              : {}),
            evidence_refs: [...finding.evidence_refs],
            message: finding.message,
          }
        })),
    })),
  }
}

export function buildRepairAndDowngradeLog(
  result: RecoverableReviewedCPipelineResult,
): RepairAndDowngradeLog {
  return {
    log_kind: "role_c_repair_and_downgrade",
    run_id: result.generation_spec.run_id,
    final_status: result.status,
    final_recovery_code: result.recovery.code,
    external_revision_rounds: result.review_reports.map((report) => ({
      revision_round: report.revision_round,
      decision: report.decision,
      strategy: report.revision_round === 0
        ? "initial_generation"
        : report.revision_round === 1
          ? "targeted_rewrite"
          : "strong_rewrite_reduce_load",
      issue_codes: [...new Set(report.revision_instructions.map((item) => item.code))],
    })),
    input_recovery_attempts: result.recovery_history.map((attempt) => ({
      attempt_no: attempt.attempt_no,
      action: attempt.action,
      input_spec_id: attempt.input_spec_id,
      ...(attempt.output_spec_id ? { output_spec_id: attempt.output_spec_id } : {}),
    })),
    terminal_action: result.recovery.required_action,
  }
}

function reviewableArtifacts(
  result: RecoverableReviewedCPipelineResult,
): ReviewablePublicArtifact[] {
  const concept = result.public_artifacts.concept_lesson
  const codeLab = result.public_artifacts.code_lab
  const assessment = result.public_artifacts.assessment
  return [
    ...(concept ? [{ kind: "concept" as const, artifact: concept }] : []),
    ...(codeLab ? [{ kind: "code_lab" as const, artifact: codeLab }] : []),
    ...(assessment ? [{ kind: "assessment" as const, artifact: assessment }] : []),
  ]
}
