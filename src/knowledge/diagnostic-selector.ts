import type { KnowledgeBase, KnowledgeQuizItem } from "./types"

export interface DiagnosticLearnerMemoryInput {
  weak_source_ids: string[]
}

export interface DiagnosticSelectorInput {
  knowledgeBase: KnowledgeBase
  target_source_ids: string[]
  prerequisite_source_ids: string[]
  learner_memory?: DiagnosticLearnerMemoryInput
  max_items: number
}

export interface DiagnosticItemCandidate {
  source_id: string
  fact_id: string | null
  concept: string
  difficulty: string
  question: string
  options?: string[]
  answer: string
  selection_reason: string
}

export interface DiagnosticSelection {
  items: DiagnosticItemCandidate[]
  coverage: {
    target_source_ids: string[]
    prerequisite_source_ids: string[]
    weak_source_ids: string[]
  }
  rationale: string[]
}

export function selectDiagnosticItems(input: DiagnosticSelectorInput): DiagnosticSelection {
  const weakSourceIds = input.learner_memory?.weak_source_ids ?? []
  const buckets: Array<{ label: string; sourceIds: string[] }> = [
    { label: "target", sourceIds: input.target_source_ids },
    { label: "prerequisite", sourceIds: input.prerequisite_source_ids },
    { label: "weak_history", sourceIds: weakSourceIds },
  ]
  const selected: DiagnosticItemCandidate[] = []
  const seen = new Set<string>()

  for (const bucket of buckets) {
    for (const sourceId of bucket.sourceIds) {
      if (selected.length >= input.max_items) break
      const item = input.knowledgeBase.items.find((candidate) => candidate.sourceId === sourceId)
      const quiz = item?.quizItems.find((candidate) => candidate.type === "choice") ?? item?.quizItems[0]
      if (!item || !quiz) continue
      const key = `${quiz.sourceId}:${quiz.factId}:${quiz.question}`
      if (seen.has(key)) continue
      seen.add(key)
      selected.push(toCandidate(item.title, item.difficulty, quiz, bucket.label))
    }
  }

  return {
    items: selected,
    coverage: {
      target_source_ids: [...input.target_source_ids],
      prerequisite_source_ids: [...input.prerequisite_source_ids],
      weak_source_ids: [...weakSourceIds],
    },
    rationale: buckets.map((bucket) => `${bucket.label}: ${bucket.sourceIds.join(",") || "none"}`).concat(
      selected.length === 0 ? ["没有可用的 A 题库映射，D 不补题"] : [],
    ),
  }
}

function toCandidate(
  concept: string,
  difficulty: string,
  quiz: KnowledgeQuizItem,
  reason: string,
): DiagnosticItemCandidate {
  return {
    source_id: quiz.sourceId,
    fact_id: quiz.factId,
    concept,
    difficulty,
    question: quiz.question,
    options: quiz.options,
    answer: quiz.answer,
    selection_reason: reason,
  }
}
