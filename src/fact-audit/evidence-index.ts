import type { RagResult } from "../rag/retriever"
import type { RagEvidencePack } from "../role-c-content/contracts/evidence-pack"
import type { EvidenceIndex } from "./types"

export function buildEvidenceIndex(ragResult: RagResult): EvidenceIndex {
  const index: EvidenceIndex = new Map()

  for (const item of ragResult.results) {
    for (const fact of item.facts) {
      const sourceId = fact.source_id ?? fact.sourceId
      const factId = fact.fact_id ?? fact.factId
      index.set(`${sourceId}:${factId}`, { ...fact, source_id: sourceId, fact_id: factId })
    }
  }

  return index
}

export function buildEvidenceIndexFromPack(evidencePack: RagEvidencePack): EvidenceIndex {
  const index: EvidenceIndex = new Map()

  for (const item of evidencePack.results) {
    for (const fact of item.facts) {
      index.set(`${fact.source_id}:${fact.fact_id}`, { ...fact, sourceId: fact.source_id, factId: fact.fact_id })
    }
  }

  return index
}
