import type { GenerationSpec } from "../contracts/generation-spec"
import { C_SCHEMA_VERSION, contentHash, stableId } from "../contracts/common"
import {
  type FactAuditPacket,
  type RagEvidencePack,
} from "../contracts/evidence-pack"
import type { ValidationIssue, ValidationReport } from "./citation-validator"

export function validateSpecEvidence(spec: GenerationSpec, evidence: RagEvidencePack): ValidationReport {
  const issues: ValidationIssue[] = []
  if (spec.evidence_ref !== evidence.retrieval_id) {
    issues.push({
      code: "evidence_ref_mismatch",
      path: "spec.evidence_ref",
      message: "GenerationSpec 引用的 retrieval_id 与实际 evidence_pack 不一致",
      severity: "critical",
    })
  }
  if (spec.evidence_content_hash !== contentHash(evidence)) {
    issues.push(issue(
      "evidence_content_hash_mismatch",
      "spec.evidence_content_hash",
      "GenerationSpec 绑定的 evidence_pack 内容哈希与实际输入不一致",
    ))
  }
  if (spec.versions.kb_version !== evidence.kb_version) {
    issues.push(issue("kb_version_mismatch", "spec.versions.kb_version", "GenerationSpec 的 KB 版本与 evidence_pack 不一致"))
  }
  if (spec.versions.rag_version !== evidence.rag_version) {
    issues.push(issue("rag_version_mismatch", "spec.versions.rag_version", "GenerationSpec 的 RAG 版本与 evidence_pack 不一致"))
  }
  if (evidence.match_status !== "strong") {
    issues.push({
      code: "insufficient_match",
      path: "evidence.match_status",
      message: `只有 strong evidence 才允许发布，当前为 ${evidence.match_status}`,
      severity: "critical",
    })
  }

  const sources = new Set(evidence.results.map((item) => item.source_id))
  const facts = new Set(
    evidence.results.flatMap((item) => item.facts.map((fact) => `${fact.source_id}:${fact.fact_id}`)),
  )
  spec.targets.forEach((target, targetIndex) => {
    if (!sources.has(target.source_id)) {
      issues.push({
        code: "missing_target_source",
        path: `spec.targets[${targetIndex}].source_id`,
        message: `缺少目标知识点 ${target.source_id}`,
        severity: "critical",
      })
    }
    target.required_fact_ids.forEach((factId, factIndex) => {
      if (!facts.has(`${target.source_id}:${factId}`)) {
        issues.push({
          code: "missing_required_fact",
          path: `spec.targets[${targetIndex}].required_fact_ids[${factIndex}]`,
          message: `缺少目标事实 ${target.source_id}:${factId}`,
          severity: "critical",
        })
      }
    })
  })
  return { ok: issues.length === 0, issues }
}

export interface EvidenceConflictReport extends ValidationReport {
  audit_packets: FactAuditPacket[]
}

/** Detects contradictory duplicate fact IDs and malformed cross-source fact ownership. */
export function detectEvidenceConflicts(
  evidence: RagEvidencePack,
  runId: string,
  artifactId = "evidence-intake",
): EvidenceConflictReport {
  const issues: ValidationIssue[] = []
  const packets: FactAuditPacket[] = []
  const contents = new Map<string, string>()
  const sourceIds = new Set<string>()
  for (const [itemIndex, item] of evidence.results.entries()) {
    if (sourceIds.has(item.source_id)) {
      issues.push(issue("duplicate_evidence_source", `evidence.results[${itemIndex}].source_id`, `重复知识点 ${item.source_id}`))
    }
    sourceIds.add(item.source_id)
    for (const [factIndex, fact] of item.facts.entries()) {
      const key = `${fact.source_id}:${fact.fact_id}`
      if (fact.source_id !== item.source_id) {
        issues.push(issue("fact_source_mismatch", `evidence.results[${itemIndex}].facts[${factIndex}]`, `${key} 不属于外层知识点 ${item.source_id}`))
        packets.push(auditPacket(runId, artifactId, fact.source_id, fact.fact_id, fact.content, "ambiguous_support"))
      }
      const prior = contents.get(key)
      if (prior !== undefined && normalize(prior) !== normalize(fact.content)) {
        issues.push(issue("conflicting_fact_content", `evidence.results[${itemIndex}].facts[${factIndex}]`, `${key} 在同一 evidence_pack 中出现冲突文本`))
        packets.push(auditPacket(runId, artifactId, fact.source_id, fact.fact_id, fact.content, "conflicting_support"))
      } else contents.set(key, fact.content)
    }
  }
  return { ok: issues.length === 0, issues, audit_packets: [...new Map(packets.map((packet) => [packet.audit_id, packet])).values()] }
}

function auditPacket(
  runId: string,
  artifactId: string,
  sourceId: string,
  factId: string,
  claimText: string,
  issueType: FactAuditPacket["issue"],
): FactAuditPacket {
  const identity = { runId, artifactId, sourceId, factId, claimText, issueType }
  return {
    schema_version: C_SCHEMA_VERSION,
    audit_id: stableId("FAP", identity),
    run_id: runId,
    source_id: sourceId,
    fact_id: factId,
    claim_text: claimText,
    issue: issueType,
    artifact_id: artifactId,
    requested_action: issueType === "conflicting_support" ? "confirm" : "correct",
  }
}

function issue(code: string, path: string, message: string): ValidationIssue {
  return { code, path, message, severity: "critical" }
}

function normalize(value: string): string { return value.normalize("NFKC").replace(/\s+/g, " ").trim() }
