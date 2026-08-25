import type { KnowledgeItem } from "../knowledge/types"

export interface EmbeddingPort {
  embed(texts: string[]): Promise<number[][]>
}

export interface HybridRetrievalIntent {
  target_source_ids?: string[]
  required_fact_ids?: Array<{ source_id: string; fact_id: string }>
  prerequisite_source_ids?: string[]
  misconception_terms?: string[]
  resource_needs?: Array<"fact" | "prerequisite" | "example" | "practice_task">
  /** Natural-language concepts that are currently weak or instructionally central. */
  focus_terms?: string[]
}

export interface HybridRankSignal {
  source_id: string
  lexical_score: number
  vector_score: number
  metadata_score: number
  misconception_score: number
  matched_terms: string[]
  document_terms: Set<string>
}

/**
 * Topic-agnostic hybrid discovery. Identity and required facts are metadata,
 * while free-form language is handled by Chinese character n-gram BM25 and an
 * optional embedding port. No source id receives a hard-coded topic bonus.
 */
export async function rankKnowledgeHybrid(input: {
  query: string
  items: KnowledgeItem[]
  expanded_query?: string
  intent?: HybridRetrievalIntent
  embedding_port?: EmbeddingPort
}): Promise<HybridRankSignal[]> {
  const queryText = [input.query, input.expanded_query ?? "", ...(input.intent?.misconception_terms ?? [])]
    .filter(Boolean)
    .join(" ")
  const queryTerms = tokenize(queryText)
  const documents = input.items.map((item) => ({
    item,
    text: knowledgeSearchText(item),
    terms: tokenize(knowledgeSearchText(item)),
  }))
  const averageLength = documents.length === 0
    ? 1
    : documents.reduce((sum, entry) => sum + entry.terms.length, 0) / documents.length
  const documentFrequency = new Map<string, number>()
  for (const term of new Set(queryTerms)) {
    documentFrequency.set(term, documents.filter((entry) => entry.terms.includes(term)).length)
  }

  let vectors: number[][] | undefined
  if (input.embedding_port) {
    try {
      vectors = await input.embedding_port.embed([queryText, ...documents.map((entry) => entry.text)])
      if (vectors.length !== documents.length + 1 || vectors.some((vector) => !validVector(vector))) vectors = undefined
    } catch {
      // Embeddings improve recall but are never required for deterministic evidence discovery.
      vectors = undefined
    }
  }

  return documents.map((entry, index): HybridRankSignal => {
    const matchedTerms = [...new Set(queryTerms.filter((term) => entry.terms.includes(term)))]
    const lexicalScore = bm25(
      queryTerms,
      entry.terms,
      documents.length,
      documentFrequency,
      averageLength,
    )
    const vectorScore = vectors
      ? Math.max(0, cosine(vectors[0]!, vectors[index + 1]!))
      : 0
    return {
      source_id: entry.item.sourceId,
      lexical_score: round(lexicalScore),
      vector_score: round(vectorScore),
      metadata_score: round(metadataScore(entry.item, input.intent)),
      misconception_score: round(misconceptionScore(entry.item, input.intent)),
      matched_terms: matchedTerms.slice(0, 24),
      document_terms: new Set(entry.terms),
    }
  })
}

/** Maximal marginal relevance: preserve relevance while avoiding near-duplicate evidence. */
export function selectWithMmr<T extends { signal: HybridRankSignal; relevance: number }>(
  entries: T[],
  topK: number,
  lambda = 0.78,
): T[] {
  const maxRelevance = Math.max(1, ...entries.map((entry) => entry.relevance))
  const qualified = entries.filter((entry) => entry.relevance >= maxRelevance * 0.3)
  const remaining = [...(qualified.length >= Math.min(topK, entries.length) ? qualified : entries)]
  const selected: T[] = []
  while (remaining.length > 0 && selected.length < topK) {
    remaining.sort((left, right) => {
      const leftPenalty = selected.length === 0 ? 0 : Math.max(...selected.map((prior) =>
        jaccard(new Set(left.signal.matched_terms), new Set(prior.signal.matched_terms))))
      const rightPenalty = selected.length === 0 ? 0 : Math.max(...selected.map((prior) =>
        jaccard(new Set(right.signal.matched_terms), new Set(prior.signal.matched_terms))))
      const leftMmr = lambda * (left.relevance / maxRelevance) - (1 - lambda) * leftPenalty
      const rightMmr = lambda * (right.relevance / maxRelevance) - (1 - lambda) * rightPenalty
      return rightMmr - leftMmr || left.signal.source_id.localeCompare(right.signal.source_id)
    })
    selected.push(remaining.shift()!)
  }
  return selected
}

function knowledgeSearchText(item: KnowledgeItem): string {
  return [
    item.title,
    item.module,
    ...item.keywords,
    ...item.facts.map((fact) => fact.content),
    ...item.examples.flatMap((example) => [example.title, example.explanation, example.code]),
    ...item.practiceTasks,
    ...(item.misconceptions ?? []).flatMap((entry) => [
      entry.incorrectBelief,
      ...entry.diagnosticSignals,
      entry.correctionStrategy,
    ]),
  ].join(" ")
}

function tokenize(value: string): string[] {
  const normalized = value.normalize("NFKC").toLocaleLowerCase()
  const ascii = normalized.match(/[a-z_][a-z0-9_+-]*/g) ?? []
  const chineseRuns = normalized.match(/[\p{Script=Han}]+/gu) ?? []
  const grams = chineseRuns.flatMap((run) => {
    const chars = [...run]
    if (chars.length <= 2) return [run]
    return [
      ...Array.from({ length: chars.length - 1 }, (_, index) => chars.slice(index, index + 2).join("")),
      ...Array.from({ length: Math.max(0, chars.length - 2) }, (_, index) => chars.slice(index, index + 3).join("")),
    ]
  })
  return [...ascii, ...grams].filter((term) => term.length > 0)
}

function bm25(
  queryTerms: string[],
  documentTerms: string[],
  documentCount: number,
  frequencies: Map<string, number>,
  averageLength: number,
): number {
  if (queryTerms.length === 0 || documentTerms.length === 0) return 0
  const counts = new Map<string, number>()
  documentTerms.forEach((term) => counts.set(term, (counts.get(term) ?? 0) + 1))
  const k1 = 1.35
  const b = 0.7
  return [...new Set(queryTerms)].reduce((sum, term) => {
    const frequency = counts.get(term) ?? 0
    if (frequency === 0) return sum
    const df = frequencies.get(term) ?? 0
    const idf = Math.log(1 + (documentCount - df + 0.5) / (df + 0.5))
    const denominator = frequency + k1 * (1 - b + b * documentTerms.length / Math.max(1, averageLength))
    return sum + idf * (frequency * (k1 + 1)) / denominator
  }, 0)
}

function metadataScore(item: KnowledgeItem, intent?: HybridRetrievalIntent): number {
  if (!intent) return 0
  let score = intent.target_source_ids?.includes(item.sourceId) ? 1 : 0
  score += intent.prerequisite_source_ids?.includes(item.sourceId) ? 0.55 : 0
  const required = (intent.required_fact_ids ?? []).filter((entry) => entry.source_id === item.sourceId)
  if (required.length > 0) {
    const factIds = new Set(item.facts.map((fact) => fact.factId))
    score += required.filter((entry) => factIds.has(entry.fact_id)).length / required.length
  }
  if (intent.resource_needs?.includes("example") && item.examples.length > 0) score += 0.2
  if (intent.resource_needs?.includes("practice_task") && item.practiceTasks.length > 0) score += 0.2
  const focusTerms = (intent.focus_terms ?? []).map(normalize).filter(Boolean)
  if (focusTerms.length > 0) {
    const itemTerms = [item.title, ...item.keywords].map(normalize)
    const matched = focusTerms.filter((focus) => itemTerms.some((term) =>
      term.includes(focus) || focus.includes(term))).length
    score += matched / focusTerms.length
  }
  return score
}

function misconceptionScore(item: KnowledgeItem, intent?: HybridRetrievalIntent): number {
  const terms = intent?.misconception_terms ?? []
  if (terms.length === 0) return 0
  const haystack = normalize((item.misconceptions ?? []).flatMap((entry) => [
    entry.incorrectBelief,
    ...entry.diagnosticSignals,
  ]).join(" "))
  return terms.filter((term) => haystack.includes(normalize(term))).length / terms.length
}

function cosine(left: number[], right: number[]): number {
  if (left.length === 0 || left.length !== right.length) return 0
  let dot = 0
  let leftMagnitude = 0
  let rightMagnitude = 0
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index]! * right[index]!
    leftMagnitude += left[index]! ** 2
    rightMagnitude += right[index]! ** 2
  }
  return leftMagnitude > 0 && rightMagnitude > 0
    ? dot / Math.sqrt(leftMagnitude * rightMagnitude)
    : 0
}

function jaccard(left: Set<string>, right: Set<string>): number {
  let intersection = 0
  left.forEach((term) => { if (right.has(term)) intersection += 1 })
  const union = left.size + right.size - intersection
  return union === 0 ? 0 : intersection / union
}

function validVector(vector: number[]): boolean {
  return Array.isArray(vector) && vector.length > 0 && vector.every(Number.isFinite)
}

function normalize(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase()
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}
