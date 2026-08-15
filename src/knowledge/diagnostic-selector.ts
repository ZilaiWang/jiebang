import type { KnowledgeBase } from "./types"

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

export interface DiagnosticEvidenceTarget {
  source_id: string
  concept: string
  difficulty: string
  selection_reason: string
  facts: Array<{ fact_id: string; content: string }>
}

/** Selects what to diagnose without selecting or copying a pre-authored question. */
export function selectDiagnosticEvidenceTargets(input: DiagnosticSelectorInput): DiagnosticEvidenceTarget[] {
  const weakSourceIds = input.learner_memory?.weak_source_ids ?? []
  // 优先级：目标 → 历史薄弱 → 先修。历史薄弱排先修之前，因为画像里的薄弱点
  // 是最需要针对性诊断确认的信号；若目标+先修先把名额占满，薄弱点差异就会被淹没，
  // 个性化筛题就退化为固定模板。
  const buckets: Array<{ label: string; sourceIds: string[] }> = [
    { label: "target", sourceIds: input.target_source_ids },
    { label: "weak_history", sourceIds: weakSourceIds },
    { label: "prerequisite", sourceIds: input.prerequisite_source_ids },
  ]
  const selected: DiagnosticEvidenceTarget[] = []
  const seen = new Set<string>()
  for (const bucket of buckets) {
    for (const sourceId of bucket.sourceIds) {
      if (selected.length >= input.max_items || seen.has(sourceId)) continue
      const item = input.knowledgeBase.items.find((candidate) => candidate.sourceId === sourceId)
      const facts = (item?.facts ?? []).flatMap((fact) =>
        fact.factId && fact.content.trim()
          ? [{ fact_id: fact.factId, content: fact.content }]
          : [])
      if (!item || facts.length === 0) continue
      seen.add(sourceId)
      selected.push({
        source_id: sourceId,
        concept: item.title,
        difficulty: item.difficulty,
        selection_reason: bucket.label,
        facts,
      })
    }
  }
  return selected
}
