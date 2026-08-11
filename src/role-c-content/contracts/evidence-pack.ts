import type { RagResult, RagResultItem } from "../../rag/retriever"
import type { KnowledgeDifficulty } from "../../knowledge/types"
import { C_SCHEMA_VERSION, stableId, type EvidenceRef, type SchemaVersion } from "./common"

export type RagMatchStatus = "strong" | "weak" | "no_match"

export interface EvidenceFact {
  source_id: string
  fact_id: string
  content: string
}

export interface EvidenceExample {
  title: string
  code: string
  explanation: string
}

/** Internal-only seed item. answer must never be copied to a public artifact. */
export interface EvidenceQuizSeed {
  level: number
  type: string
  question: string
  options?: string[]
  answer: string
  source_id: string
  fact_id: string
}

export interface EvidenceRetrievalTrace {
  matched_keywords: string[]
  matched_fields: string[]
  difficulty_match: boolean
  score_breakdown: {
    keyword: number
    title: number
    facts: number
    practice_tasks: number
    difficulty: number
    bonus: number
  }
}

export interface RagEvidenceItem {
  source_id: string
  title: string
  difficulty: KnowledgeDifficulty
  rank_score: number
  match_reason: string
  snippet: string
  facts: EvidenceFact[]
  examples: EvidenceExample[]
  practice_tasks: string[]
  quiz_seeds: EvidenceQuizSeed[]
  source_file: string
  retrieval_trace: EvidenceRetrievalTrace
}

/** A → C canonical contract. This object is backend-internal because it includes answer seeds. */
export interface RagEvidencePack {
  schema_version: SchemaVersion
  retrieval_id: string
  query: string
  learner_level?: KnowledgeDifficulty
  top_k: number
  match_status: RagMatchStatus
  kb_version: string
  rag_version: string
  results: RagEvidenceItem[]
}

/** Answer-free projection that may cross C's public boundary. */
export interface PublicRagEvidencePack extends Omit<RagEvidencePack, "results"> {
  results: Array<Omit<RagEvidenceItem, "quiz_seeds">>
}

export function projectPublicRagEvidencePack(
  pack: RagEvidencePack,
): PublicRagEvidencePack {
  return {
    schema_version: pack.schema_version,
    retrieval_id: pack.retrieval_id,
    query: pack.query,
    learner_level: pack.learner_level,
    top_k: pack.top_k,
    match_status: pack.match_status,
    kb_version: pack.kb_version,
    rag_version: pack.rag_version,
    results: pack.results.map(({ quiz_seeds: _quizSeeds, ...item }) =>
      structuredClone(item)),
  }
}

export interface EvidenceGapRequest {
  schema_version: SchemaVersion
  request_id: string
  run_id: string
  target_source_ids: string[]
  missing_type: "knowledge_item" | "fact" | "example" | "practice_task" | "quiz_seed" | "strong_match"
  reason: string
  learner_level: KnowledgeDifficulty
  required_facts: EvidenceRef[]
}

export interface FactAuditPacket {
  schema_version: SchemaVersion
  audit_id: string
  run_id: string
  source_id: string
  fact_id: string
  claim_text: string
  issue: "missing_support" | "conflicting_support" | "ambiguous_support"
  artifact_id: string
  requested_action: "confirm" | "correct" | "add_fact"
}

/** A-facing port. HTTP, MCP, or a local retriever can implement the same boundary. */
export interface EvidenceRefreshPort {
  refreshEvidence(request: EvidenceGapRequest): Promise<RagEvidencePack>
}

export interface FactAuditPort {
  sendFactAudits(packets: FactAuditPacket[]): Promise<void>
}

export function requestEvidenceRefresh(
  request: EvidenceGapRequest,
  port: EvidenceRefreshPort,
): Promise<RagEvidencePack> {
  return port.refreshEvidence(request)
}

export interface AdaptRagResultOptions {
  kb_version: string
  rag_version: string
  retrieval_id?: string
}

export function adaptRagResult(result: RagResult, options: AdaptRagResultOptions): RagEvidencePack {
  const normalizedResults = result.results.map(normalizeResultItem)
  const identity = {
    query: result.query,
    learner_level: result.learnerLevel,
    top_k: result.topK,
    kb_version: options.kb_version,
    rag_version: options.rag_version,
    source_ids: normalizedResults.map((item) => item.source_id),
  }

  return {
    schema_version: C_SCHEMA_VERSION,
    retrieval_id: options.retrieval_id ?? stableId("RAG", identity),
    query: result.query,
    learner_level: result.learnerLevel,
    top_k: result.topK,
    match_status: classifyMatch(result.results),
    kb_version: options.kb_version,
    rag_version: options.rag_version,
    results: normalizedResults,
  }
}

export function evidenceFactKeys(pack: RagEvidencePack): Set<string> {
  return new Set(
    pack.results.flatMap((item) => item.facts.map((fact) => `${fact.source_id}:${fact.fact_id}`)),
  )
}

function normalizeResultItem(item: RagResultItem): RagEvidenceItem {
  return {
    source_id: item.source_id ?? item.sourceId,
    title: item.title,
    difficulty: item.difficulty,
    rank_score: item.score,
    match_reason: item.reason,
    snippet: item.snippet,
    facts: item.facts.map((fact) => ({
      source_id: fact.source_id ?? fact.sourceId,
      fact_id: fact.fact_id ?? fact.factId,
      content: fact.content,
    })),
    examples: item.examples.map((example) => ({ ...example })),
    practice_tasks: [...item.practiceTasks],
    quiz_seeds: item.quizItems.map((quiz) => ({
      level: quiz.level,
      type: quiz.type,
      question: quiz.question,
      options: quiz.options ? [...quiz.options] : undefined,
      answer: quiz.answer,
      source_id: quiz.sourceId,
      fact_id: quiz.factId,
    })),
    source_file: item.file,
    retrieval_trace: {
      matched_keywords: [...item.retrievalTrace.matchedKeywords],
      matched_fields: [...item.retrievalTrace.matchedFields],
      difficulty_match: item.retrievalTrace.difficultyMatch,
      score_breakdown: {
        keyword: item.retrievalTrace.scoreBreakdown.keyword,
        title: item.retrievalTrace.scoreBreakdown.title,
        facts: item.retrievalTrace.scoreBreakdown.facts,
        practice_tasks: item.retrievalTrace.scoreBreakdown.practiceTasks,
        difficulty: item.retrievalTrace.scoreBreakdown.difficulty,
        bonus: item.retrievalTrace.scoreBreakdown.bonus,
      },
    },
  }
}

function classifyMatch(results: RagResultItem[]): RagMatchStatus {
  if (results.length === 0) return "no_match"
  return results.some(hasSubstantiveRagResultMatch) ? "strong" : "weak"
}

export function hasSubstantiveEvidenceMatch(item: RagEvidenceItem): boolean {
  const substantiveFields = new Set(["keywords", "title", "facts", "practiceTasks", "taskIntent"])
  return item.retrieval_trace.matched_fields.some((field) => substantiveFields.has(field))
}

function hasSubstantiveRagResultMatch(item: RagResultItem): boolean {
  const substantiveFields = new Set(["keywords", "title", "facts", "practiceTasks", "taskIntent"])
  return item.retrievalTrace.matchedFields.some((field) => substantiveFields.has(field))
}
