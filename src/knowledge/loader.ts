import { MODERN_AI_KNOWLEDGE_BASE } from "./modern-ai"
import { PYTHON_BASIC_KNOWLEDGE_BASE } from "./python-basic"
import { PYTHON_PROGRAMMING_KNOWLEDGE_BASE } from "./python-programming"
import type { KnowledgeBase } from "./types"

export async function loadKnowledgeBase(): Promise<KnowledgeBase> {
  const merged: KnowledgeBase = {
    module: "KnowBalance课程知识库",
    version: "0.6.0",
    updatedAt: "2026-08-05",
    sources: unique([
      ...PYTHON_BASIC_KNOWLEDGE_BASE.sources,
      ...PYTHON_PROGRAMMING_KNOWLEDGE_BASE.sources,
      ...MODERN_AI_KNOWLEDGE_BASE.sources,
    ]),
    items: [
      ...PYTHON_BASIC_KNOWLEDGE_BASE.items,
      ...PYTHON_PROGRAMMING_KNOWLEDGE_BASE.items,
      ...MODERN_AI_KNOWLEDGE_BASE.items,
    ],
  }
  validateKnowledgeBase(merged)
  return merged
}

function validateKnowledgeBase(knowledgeBase: KnowledgeBase): void {
  const sourceIds = new Set<string>()

  for (const item of knowledgeBase.items) {
    if (sourceIds.has(item.sourceId)) {
      throw new Error(`Duplicate knowledge source_id: ${item.sourceId}`)
    }
    sourceIds.add(item.sourceId)

    for (const fact of item.facts) {
      if (fact.sourceId !== item.sourceId) {
        throw new Error(`Fact ${fact.factId} is attached to the wrong source_id`)
      }
    }
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

export type { KnowledgeBase, KnowledgeFact, KnowledgeItem, KnowledgeDifficulty } from "./types"
