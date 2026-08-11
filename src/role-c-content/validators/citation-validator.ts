import type { CitationRef } from "../contracts/common"
import { evidenceFactKeys, type RagEvidencePack } from "../contracts/evidence-pack"

export interface ValidationIssue {
  code: string
  path: string
  message: string
  severity: "warning" | "critical"
}

export interface ValidationReport {
  ok: boolean
  issues: ValidationIssue[]
}

export function validateCitations(citations: CitationRef[], evidence: RagEvidencePack): ValidationReport {
  const validFacts = evidenceFactKeys(evidence)
  const issues = citations.flatMap((citation, index) => {
    const key = `${citation.source_id}:${citation.fact_id}`
    if (validFacts.has(key)) return []
    return [{
      code: "invalid_citation",
      path: `citations[${index}]`,
      message: `引用 ${key} 不存在于本次 evidence_pack`,
      severity: "critical" as const,
    }]
  })
  return { ok: issues.length === 0, issues }
}
