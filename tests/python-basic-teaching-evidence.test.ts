import { describe, expect, test } from "bun:test"
import { PYTHON_BASIC_KNOWLEDGE_BASE } from "../src/knowledge/python-basic"

const GENERIC = /请完成一个与|参考该知识点的\s*F\d+|能正确运用该知识点并解释关键步骤/u

describe("K001-K018 authored teaching evidence", () => {
  test("every formal source has explicit, fact-bound teaching material", () => {
    expect(PYTHON_BASIC_KNOWLEDGE_BASE.items).toHaveLength(18)
    for (const item of PYTHON_BASIC_KNOWLEDGE_BASE.items) {
      const factIds = new Set(item.facts.map((fact) => fact.factId))
      expect(item.coreFactIds?.length, item.sourceId).toBeGreaterThanOrEqual(3)
      expect(item.observableObjectives?.length, item.sourceId).toBeGreaterThan(0)
      expect(item.misconceptions?.length, item.sourceId).toBeGreaterThan(0)
      expect(item.workedExamples?.length, item.sourceId).toBeGreaterThan(0)
      expect(item.practiceTemplates?.length, item.sourceId).toBeGreaterThan(0)
      expect(item.examples.every((example) => (example.factIds?.length ?? 0) > 0), item.sourceId).toBe(true)

      const authoredRefs = [
        ...(item.coreFactIds ?? []),
        ...item.examples.flatMap((example) => example.factIds ?? []),
        ...(item.observableObjectives ?? []).flatMap((objective) => objective.factIds),
        ...(item.misconceptions ?? []).flatMap((entry) => entry.factRefs.map((ref) => ref.factId)),
        ...(item.workedExamples ?? []).flatMap((example) => example.steps.flatMap((step) => step.factIds)),
        ...(item.practiceTemplates ?? []).flatMap((entry) => entry.factIds),
      ]
      expect(authoredRefs.every((factId) => factIds.has(factId)), item.sourceId).toBe(true)
    }
  })

  test("formal learner-facing tasks and answers contain no generic placeholders", () => {
    for (const item of PYTHON_BASIC_KNOWLEDGE_BASE.items) {
      const visibleText = [
        ...item.practiceTasks,
        ...item.quizItems.flatMap((quiz) => [quiz.question, quiz.answer]),
      ].join("\n")
      expect(GENERIC.test(visibleText), item.sourceId).toBe(false)
    }
  })
})
