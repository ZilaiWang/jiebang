import { MODERN_AI_KNOWLEDGE_BASE } from "./modern-ai"
import { PYTHON_BASIC_KNOWLEDGE_BASE } from "./python-basic"
import { PYTHON_PROGRAMMING_KNOWLEDGE_BASE } from "./python-programming"
import type { KnowledgeBase } from "./types"
import { hydrateKnowledgeItemV2 } from "./v2"
import { isValidFactId, isValidSourceId } from "./identifiers"

let canonicalKnowledgeBase: KnowledgeBase | undefined

export async function loadKnowledgeBase(): Promise<KnowledgeBase> {
  if (canonicalKnowledgeBase) return structuredClone(canonicalKnowledgeBase)
  const merged: KnowledgeBase = {
    module: "KnowBalance课程知识库",
    version: "0.7.0",
    updatedAt: "2026-08-26",
    sources: unique([
      ...PYTHON_BASIC_KNOWLEDGE_BASE.sources,
      ...PYTHON_PROGRAMMING_KNOWLEDGE_BASE.sources,
      ...MODERN_AI_KNOWLEDGE_BASE.sources,
    ]),
    items: [
      ...PYTHON_BASIC_KNOWLEDGE_BASE.items,
      ...PYTHON_PROGRAMMING_KNOWLEDGE_BASE.items,
      ...MODERN_AI_KNOWLEDGE_BASE.items,
    ].map(hydrateKnowledgeItemV2),
  }
  validateKnowledgeBase(merged)
  canonicalKnowledgeBase = merged
  // Callers have historically received an isolated object. Keep that contract
  // while avoiding repeated capability derivation and integrity validation.
  return structuredClone(canonicalKnowledgeBase)
}

function validateKnowledgeBase(knowledgeBase: KnowledgeBase): void {
  const sourceIds = new Set<string>()

  for (const item of knowledgeBase.items) {
    if (!isValidSourceId(item.sourceId)) {
      throw new Error(`Invalid knowledge source_id: ${item.sourceId}`)
    }
    if (sourceIds.has(item.sourceId)) {
      throw new Error(`Duplicate knowledge source_id: ${item.sourceId}`)
    }
    sourceIds.add(item.sourceId)

    const factIds = new Set<string>()
    for (const fact of item.facts) {
      if (fact.sourceId !== item.sourceId) {
        throw new Error(`Fact ${fact.factId} is attached to the wrong source_id`)
      }
      if (!isValidFactId(fact.factId)) {
        throw new Error(`Invalid fact_id ${item.sourceId}:${fact.factId}`)
      }
      if (factIds.has(fact.factId)) {
        throw new Error(`Duplicate fact_id ${item.sourceId}:${fact.factId}`)
      }
      factIds.add(fact.factId)
      if (!fact.content.trim()) throw new Error(`Empty fact ${item.sourceId}:${fact.factId}`)
      if (!fact.capabilities?.length) {
        throw new Error(`Fact ${item.sourceId}:${fact.factId} has no evidence capabilities`)
      }
    }
    const assertFactRef = (factId: string, owner: string) => {
      if (!factIds.has(factId)) throw new Error(`${owner} references missing fact ${item.sourceId}:${factId}`)
    }
    item.quizItems.forEach((quiz, index) => {
      if (quiz.sourceId !== item.sourceId) throw new Error(`Quiz ${item.sourceId}[${index}] has wrong source_id`)
      assertFactRef(quiz.factId, `Quiz ${item.sourceId}[${index}]`)
    })
    item.misconceptions?.forEach((misconception) =>
      misconception.factRefs.forEach((ref) => {
        if (ref.sourceId !== item.sourceId) throw new Error(`Misconception ${misconception.misconceptionId} crosses source boundary`)
        assertFactRef(ref.factId, `Misconception ${misconception.misconceptionId}`)
      }))
    item.workedExamples?.forEach((example) => example.steps.forEach((step) =>
      step.factIds.forEach((factId) => assertFactRef(factId, `Worked example ${example.title}`))))
    item.observableObjectives?.forEach((objective) =>
      objective.factIds.forEach((factId) => assertFactRef(factId, `Objective ${objective.objectiveId}`)))
    item.practiceTemplates?.forEach((template) =>
      template.factIds.forEach((factId) => assertFactRef(factId, `Practice template ${template.templateId}`)))
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

export type { KnowledgeBase, KnowledgeFact, KnowledgeItem, KnowledgeDifficulty } from "./types"
