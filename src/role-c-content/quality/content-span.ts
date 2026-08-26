import type { CitationRef } from "../contracts/common"
import { visibleTeachingTextExpressesFact } from "../validators/claim-grounding"

export type ContentSpan =
  | {
      kind: "grounded_claim"
      text: string
      citations: CitationRef[]
      supported_fact_keys: string[]
    }
  | {
      kind: "pedagogical_scaffold"
      text: string
      citations: CitationRef[]
    }

/**
 * Explicitly separates factual teaching claims from non-factual scaffolding.
 * It does not weaken grounding: a span with a citation and visible fact meaning
 * remains a grounded claim; transitions and task instructions are scaffold.
 */
export function classifyContentSpan(input: {
  text: string
  citations: CitationRef[]
  facts: Array<{ source_id: string; fact_id: string; content: string }>
}): ContentSpan {
  const factByKey = new Map(input.facts.map((fact) => [`${fact.source_id}:${fact.fact_id}`, fact]))
  const supported = input.citations.flatMap((citation) => {
    const key = `${citation.source_id}:${citation.fact_id}`
    const fact = factByKey.get(key)
    return fact && visibleTeachingTextExpressesFact(input.text, fact.content) ? [key] : []
  })
  return supported.length > 0
    ? {
        kind: "grounded_claim",
        text: input.text,
        citations: structuredClone(input.citations),
        supported_fact_keys: supported,
      }
    : {
        kind: "pedagogical_scaffold",
        text: input.text,
        citations: structuredClone(input.citations),
      }
}
