import { contentHash } from "../role-c-content/contracts/common"
import { buildEvidenceIndex, buildEvidenceIndexFromPack } from "./evidence-index"
import type { CheckedClaim, EvidenceIndex, FactAuditConflict, FactAuditInput, FactAuditResult, FactAuditStatus } from "./types"

const TOKEN_PATTERN = /[A-Za-z]+|[\u4e00-\u9fff]{2,}/g

export { buildEvidenceIndex }
export type { FactAuditInput, FactAuditResult } from "./types"

export interface SemanticAuditPort {
  auditClaim(input: {
    claim: string
    evidence: string
    citations: { source_id: string; fact_id: string }[]
  }): Promise<{
    verdict: "supported" | "unsupported" | "uncertain"
    confidence: number
    reason: string
  }>
}

export function auditGeneratedContent(input: FactAuditInput): FactAuditResult {
  const evidence = resolveAuditEvidence(input)
  if (evidence.error) {
    return {
      artifactId: input.artifactId,
      status: "reject",
      checkedClaims: [],
      conflicts: [evidence.error],
      evidence: evidence.metadata,
    }
  }

  const evidenceIndex = evidence.index
  const checkedClaims: CheckedClaim[] = []
  const conflicts: FactAuditConflict[] = []

  if (input.generatedContent.blocks.length === 0) {
    return {
      artifactId: input.artifactId,
      status: "reject",
      checkedClaims,
      conflicts: [{
        blockId: "__generated_content__",
        claim: input.artifactId,
        issue: "生成内容没有可审核的知识声明",
      }],
      evidence: evidence.metadata,
    }
  }

  for (const block of input.generatedContent.blocks) {
    if (block.citations.length === 0) {
      checkedClaims.push({
        blockId: block.blockId,
        claim: block.text,
        citations: [],
        verdict: "missing_citation",
        reason: "知识性内容缺少 source_id/fact_id 引用。",
      })
      conflicts.push({ blockId: block.blockId, claim: block.text, issue: "缺少知识库引用" })
      continue
    }

    const citedFacts = block.citations.map((citation) => ({
      citation,
      fact: evidenceIndex.get(`${citation.source_id}:${citation.fact_id}`),
    }))
    const missingCitation = citedFacts.find((entry) => !entry.fact)
    if (missingCitation) {
      checkedClaims.push({
        blockId: block.blockId,
        claim: block.text,
        citations: block.citations,
        verdict: "unsupported",
        reason: `引用不存在于当前 RAG 结果：${missingCitation.citation.source_id}:${missingCitation.citation.fact_id}`,
      })
      conflicts.push({ blockId: block.blockId, claim: block.text, issue: "引用不存在于当前 RAG 结果" })
      continue
    }

    const supportingFact = citedFacts.find((entry) => entry.fact && isClaimSupportedByFact(block.text, entry.fact.content))?.fact
    if (supportingFact) {
      checkedClaims.push({
        blockId: block.blockId,
        claim: block.text,
        citations: block.citations,
        verdict: "supported",
        evidence: supportingFact.content,
        reason: "生成内容与引用事实存在足够词面重叠。",
      })
      continue
    }

    checkedClaims.push({
      blockId: block.blockId,
      claim: block.text,
      citations: block.citations,
      verdict: "unsupported",
      reason: "生成内容未被引用事实支持。",
    })
    conflicts.push({
      blockId: block.blockId,
      claim: block.text,
      issue: "生成内容未被引用事实支持",
      expectedEvidence: citedFacts.map((entry) => entry.fact?.content).filter(Boolean).join("；"),
    })
  }

  return {
    artifactId: input.artifactId,
    status: deriveStatus(checkedClaims),
    checkedClaims,
    conflicts,
    evidence: evidence.metadata,
  }
}

export async function auditGeneratedContentWithSemantic(input: {
  input: FactAuditInput
  semanticAuditPort?: SemanticAuditPort
}): Promise<FactAuditResult> {
  const base = auditGeneratedContent(input.input)

  const evidence = resolveAuditEvidence(input.input)
  if (evidence.error) return base

  const checkedClaims: CheckedClaim[] = []
  const semanticConflicts: FactAuditConflict[] = []
  for (const claim of base.checkedClaims) {
    const evidenceText = claim.evidence ?? firstExistingEvidenceForClaim(claim, evidence.index)
    if ((claim.verdict !== "supported" && claim.verdict !== "unsupported") || !evidenceText) {
      checkedClaims.push(claim)
      continue
    }

    const deterministicSemantic = deterministicSemanticAudit({ claim: claim.claim, evidence: evidenceText })
    const semantic = deterministicSemantic.verdict === "unsupported" || !input.semanticAuditPort
      ? deterministicSemantic
      : await input.semanticAuditPort.auditClaim({
      claim: claim.claim,
      evidence: evidenceText,
      citations: claim.citations,
    })
    if (semantic.verdict === "supported") {
      checkedClaims.push({ ...claim, evidence: evidenceText, semantic })
      continue
    }

    checkedClaims.push({
      ...claim,
      verdict: "semantic_unsupported",
      semantic,
      reason: `语义审核未通过：${semantic.reason}`,
    })
    semanticConflicts.push({
      blockId: claim.blockId,
      claim: claim.claim,
      issue: "语义审核未通过",
      expectedEvidence: semantic.reason,
    })
  }

  return {
    ...base,
    status: checkedClaims.some((claim) => claim.verdict === "semantic_unsupported") ? "reject" : base.status,
    checkedClaims,
    conflicts: [...base.conflicts, ...semanticConflicts],
  }
}

function firstExistingEvidenceForClaim(claim: CheckedClaim, evidenceIndex: EvidenceIndex): string | undefined {
  return claim.citations
    .map((citation) => evidenceIndex.get(`${citation.source_id}:${citation.fact_id}`)?.content)
    .find((content): content is string => Boolean(content))
}

function resolveAuditEvidence(input: FactAuditInput): {
  index: EvidenceIndex
  metadata: NonNullable<FactAuditResult["evidence"]>
  error?: FactAuditConflict
} {
  if (input.evidencePack) {
    const actualHash = contentHash(input.evidencePack)
    const metadata = {
      kind: "frozen_evidence_pack" as const,
      retrieval_id: input.evidencePack.retrieval_id,
      content_hash: actualHash,
    }

    if (input.expectedEvidenceContentHash && input.expectedEvidenceContentHash !== actualHash) {
      return {
        index: new Map(),
        metadata,
        error: {
          blockId: "__evidence_pack__",
          claim: input.evidencePack.retrieval_id,
          issue: "冻结证据包哈希不匹配",
          expectedEvidence: `expected=${input.expectedEvidenceContentHash}; actual=${actualHash}`,
        },
      }
    }

    return { index: buildEvidenceIndexFromPack(input.evidencePack), metadata }
  }

  if (input.ragResult) {
    return { index: buildEvidenceIndex(input.ragResult), metadata: { kind: "rag_result" } }
  }

  return {
    index: new Map(),
    metadata: { kind: "rag_result" },
    error: {
      blockId: "__evidence__",
      claim: input.artifactId,
      issue: "缺少审核证据：必须提供 ragResult 或冻结 evidencePack",
    },
  }
}

function deriveStatus(checkedClaims: CheckedClaim[]): FactAuditStatus {
  if (checkedClaims.some((claim) => claim.verdict === "unsupported" || claim.verdict === "external_knowledge" || claim.verdict === "semantic_unsupported")) return "reject"
  if (checkedClaims.some((claim) => claim.verdict === "missing_citation")) return "revise"
  return "pass"
}

function isClaimSupportedByFact(claim: string, fact: string): boolean {
  const normalizedClaim = normalize(claim)
  const normalizedFact = normalize(fact)
  if (normalizedClaim.includes(normalizedFact) || normalizedFact.includes(normalizedClaim)) return true

  const claimTokens = new Set(tokens(normalizedClaim))
  const factTokens = tokens(normalizedFact)
  const overlap = factTokens.filter((token) => claimTokens.has(token)).length
  return overlap >= Math.min(2, factTokens.length)
}

function deterministicSemanticAudit(input: { claim: string; evidence: string }): {
  verdict: "supported" | "unsupported" | "uncertain"
  confidence: number
  reason: string
} {
  if (hasNegation(input.claim) !== hasNegation(input.evidence)) {
    return { verdict: "unsupported", confidence: 0.9, reason: "检测到否定词反转，claim 与引用事实语义方向不一致。" }
  }

  const claimNumbers = numbers(input.claim)
  const evidenceNumbers = numbers(input.evidence)
  if (claimNumbers.length > 0 && !sameStringSet(claimNumbers, evidenceNumbers)) {
    return { verdict: "unsupported", confidence: 0.86, reason: "检测到数字与引用事实不一致或证据中未提供该数字。" }
  }

  return { verdict: "supported", confidence: 0.8, reason: "确定性语义规则未发现否定反转或数字漂移。" }
}

function hasNegation(value: string): boolean {
  return /不|不是|不能|无法|没有|并非|禁止/.test(value)
}

function numbers(value: string): string[] {
  return value.match(/\d+(?:\.\d+)?/g) ?? []
}

function sameStringSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  const rightSet = new Set(right)
  return left.every((value) => rightSet.has(value))
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[，。、“”"'：:；;、\s]/g, "")
}

function tokens(value: string): string[] {
  return value.match(TOKEN_PATTERN) ?? []
}
