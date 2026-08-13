import type { RagResult } from "../rag/retriever"
import type { KnowledgeFact } from "../knowledge/types"
import type { RagEvidencePack } from "../role-c-content/contracts/evidence-pack"

export type Citation = {
  source_id: string
  fact_id: string
}

export type GeneratedContentBlock = {
  blockId: string
  text: string
  citations: Citation[]
}

export type FactAuditInput = {
  artifactId: string
  ragResult?: RagResult
  evidencePack?: RagEvidencePack
  expectedEvidenceContentHash?: string
  generatedContent: {
    blocks: GeneratedContentBlock[]
  }
}

export type FactAuditVerdict = "supported" | "missing_citation" | "unsupported" | "external_knowledge" | "semantic_unsupported"

export type FactAuditStatus = "pass" | "revise" | "reject"

export type CheckedClaim = {
  blockId: string
  claim: string
  citations: Citation[]
  verdict: FactAuditVerdict
  evidence?: string
  reason: string
  semantic?: {
    verdict: "supported" | "unsupported" | "uncertain"
    confidence: number
    reason: string
  }
}

export type FactAuditConflict = {
  blockId: string
  claim: string
  issue: string
  expectedEvidence?: string
}

export type FactAuditResult = {
  artifactId: string
  status: FactAuditStatus
  checkedClaims: CheckedClaim[]
  conflicts: FactAuditConflict[]
  evidence?: {
    kind: "rag_result" | "frozen_evidence_pack"
    retrieval_id?: string
    content_hash?: string
  }
}

export type EvidenceIndex = Map<string, KnowledgeFact>
