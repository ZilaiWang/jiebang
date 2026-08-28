import { loadKnowledgeBase } from "../knowledge/loader"
import { isSubstantivePythonExample } from "../knowledge/example-code"
import type { KnowledgeBase, KnowledgeItem } from "../knowledge/types"
import type { RagResultItem, RetrievalTrace } from "./retriever"

export interface StructuredEvidenceRequest {
  source_ids: string[]
  fact_ids_by_source?: Record<string, string[]>
}

export interface MissingFactReference {
  source_id: string
  fact_id: string
}

export interface StructuredEvidenceResult {
  results: RagResultItem[]
  missing_source_ids: string[]
  missing_fact_refs: MissingFactReference[]
}

/** A's identity-based evidence access, used after B has fixed a path. */
export interface StructuredEvidenceRetrievalPort {
  retrieveStructuredEvidence(
    request: StructuredEvidenceRequest,
  ): Promise<StructuredEvidenceResult>
}

/**
 * Reads evidence by stable source/fact identity. This is not a text search and
 * therefore has no topK or semantic-match score.
 */
export async function retrieveStructuredEvidence(
  request: StructuredEvidenceRequest,
): Promise<StructuredEvidenceResult> {
  return retrieveStructuredEvidenceFromKnowledgeBase(
    request,
    await loadKnowledgeBase(),
  )
}

export function retrieveStructuredEvidenceFromKnowledgeBase(
  request: StructuredEvidenceRequest,
  knowledgeBase: KnowledgeBase,
): StructuredEvidenceResult {
  const requestedSourceIds = unique(request.source_ids)
  const byId = new Map(
    knowledgeBase.items.map((item) => [item.sourceId, item]),
  )
  const results: RagResultItem[] = []
  const missingSourceIds: string[] = []
  const missingFactRefs: MissingFactReference[] = []

  for (const sourceId of requestedSourceIds) {
    const item = byId.get(sourceId)
    if (!item) {
      missingSourceIds.push(sourceId)
      continue
    }
    const requestedFactIds = unique(
      request.fact_ids_by_source?.[sourceId] ?? [],
    )
    const availableFactIds = new Set(
      item.facts.map((fact) => fact.factId),
    )
    for (const factId of requestedFactIds) {
      if (!availableFactIds.has(factId)) {
        missingFactRefs.push({ source_id: sourceId, fact_id: factId })
      }
    }
    results.push(toStructuredEvidenceItem(item, requestedFactIds))
  }

  return {
    results,
    missing_source_ids: missingSourceIds,
    missing_fact_refs: missingFactRefs,
  }
}

function toStructuredEvidenceItem(
  item: KnowledgeItem,
  requestedFactIds: string[],
): RagResultItem {
  const selectedFactIds = new Set(requestedFactIds)
  const includeAllFacts = selectedFactIds.size === 0
  const facts = item.facts
    .filter((fact) => includeAllFacts || selectedFactIds.has(fact.factId))
    .map((fact) => ({
      ...fact,
      source_id: fact.source_id ?? fact.sourceId,
      fact_id: fact.fact_id ?? fact.factId,
    }))
  const includesFact = (factId: string) => includeAllFacts || selectedFactIds.has(factId)
  const misconceptions = (item.misconceptions ?? [])
    .filter((entry) => entry.factRefs.length > 0 && entry.factRefs.every((ref) =>
      ref.sourceId === item.sourceId && includesFact(ref.factId)))
    .map((entry) => structuredClone(entry))
  const workedExamples = (item.workedExamples ?? [])
    .filter((entry) => entry.steps.length > 0 && entry.steps.every((step) =>
      step.factIds.length > 0 && step.factIds.every(includesFact)))
    .map((entry) => structuredClone(entry))
  const groundedExamples = item.examples.filter((example) => {
    const refs = example.factIds ?? []
    return refs.length > 0
      && isSubstantivePythonExample(example.code)
      && (includeAllFacts || refs.every((factId) => selectedFactIds.has(factId)))
  })
  const projectedExamples = includeAllFacts
    // Full-source discovery may expose reviewed chapter examples for ranking
    // and human inspection.  Empty factIds make their non-citable status
    // explicit; C's authoring projection will not treat them as evidence.
    ? item.examples.map((example) => ({
        ...example,
        factIds: [...(example.factIds ?? [])],
      }))
    : groundedExamples.length > 0
      ? groundedExamples.map((example) => ({
          ...example,
          factIds: [...(example.factIds ?? [])],
        }))
      : facts.map((fact) => ({
          title: `${item.title} · ${fact.factId} 事实示例`,
          // No executable example is better than relabelling unrelated chapter
          // code as evidence. This comment remains readable context, while C
          // excludes comment-only entries from code-shaped examples.
          code: `# ${fact.content}`,
          explanation: fact.content,
          factIds: [fact.factId],
        }))
  const projectedPracticeTasks = includeAllFacts
    ? [...item.practiceTasks]
    : facts.map((fact) => `依据已审核事实“${fact.content}”完成一次识别、解释或应用，并说明判断依据。`)
  const trace: RetrievalTrace = {
    matchedKeywords: [],
    matchedFields: ["source_id"],
    difficultyMatch: false,
    scoreBreakdown: {
      keyword: 0,
      title: 0,
      facts: 0,
      practiceTasks: 0,
      difficulty: 0,
      bonus: 0,
    },
  }
  return {
    sourceId: item.sourceId,
    source_id: item.sourceId,
    title: item.title,
    difficulty: item.difficulty,
    score: 0,
    reason: `按 source_id 从知识库读取证据：${item.sourceId}`,
    snippet: item.snippet,
    facts,
    coreFactIds: (item.coreFactIds ?? []).filter((factId) => includeAllFacts || selectedFactIds.has(factId)),
    // Legacy examples may lack fact references and remain discovery-only. A
    // fact-specific identity lookup admits only an explicitly grounded example
    // or an exact fact projection; it never relabels the whole chapter as the
    // smaller evidence bundle.
    examples: projectedExamples,
    practiceTasks: projectedPracticeTasks,
    quizItems: item.quizItems
      .filter((quiz) => includeAllFacts || selectedFactIds.has(quiz.factId))
      .map((quiz) => ({
        ...quiz,
        ...(quiz.options ? { options: [...quiz.options] } : {}),
      })),
    misconceptions,
    workedExamples,
    counterexamples: includeAllFacts ? [...(item.counterexamples ?? [])] : [],
    assessmentConstraints: [...(item.assessmentConstraints ?? [])],
    file: item.file,
    retrievalTrace: trace,
    retrieval_trace: {
      matched_keywords: trace.matchedKeywords,
      matched_fields: trace.matchedFields,
      difficulty_match: trace.difficultyMatch,
      score_breakdown: trace.scoreBreakdown,
    },
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}
