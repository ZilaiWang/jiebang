import { describe, expect, test } from "bun:test"
import { loadKnowledgeBase } from "../src/knowledge/loader"

const coreSourceIds = ["K002", "K003", "K006", "K007", "K009", "K013", "K018"]
const modernAiSourceIds = ["AI001", "AI002", "AI003", "AI004", "AI005", "AI006"]
const pythonProgrammingSourceIds = ["PY019", "PY020", "PY021", "PY022", "PY023", "PY024", "PY025", "PY026", "PY027", "PY028", "PY029", "PY030"]

describe("Python basics knowledge base", () => {
  test("loads a versioned Python basics module with traceable facts", async () => {
    const knowledgeBase = await loadKnowledgeBase()

    expect(knowledgeBase.module).toBe("KnowBalance课程知识库")
    expect(knowledgeBase.version).toMatch(/^0\.\d+\./)
    expect(knowledgeBase.items.length).toBeGreaterThanOrEqual(24)

    const sourceIds = new Set(knowledgeBase.items.map((item) => item.sourceId))
    expect(sourceIds.size).toBe(knowledgeBase.items.length)

    for (const item of knowledgeBase.items) {
      expect(item.sourceId).toMatch(/^(K|AI|PY)\d{3}$/)
      expect(item.title.length).toBeGreaterThan(0)
      expect(item.difficulty).toBeOneOf(["beginner", "basic", "intermediate", "integrated"])
      expect(item.keywords.length).toBeGreaterThan(0)
      expect(item.facts.length).toBeGreaterThanOrEqual(3)
      expect(item.quizItems.length).toBeGreaterThanOrEqual(2)
      for (const fact of item.facts) {
        expect(fact.factId).toMatch(/^F\d{3}$/)
        expect(fact.sourceId).toBe(item.sourceId)
        expect(fact.content.length).toBeGreaterThan(0)
      }
    }
  })

  test("provides real examples and quiz items for the week-one core concepts", async () => {
    const knowledgeBase = await loadKnowledgeBase()

    for (const sourceId of coreSourceIds) {
      const item = knowledgeBase.items.find((candidate) => candidate.sourceId === sourceId)
      expect(item).toBeDefined()
      expect(item?.examples[0]).toMatchObject({
        title: expect.any(String),
        code: expect.stringContaining("\n"),
        explanation: expect.any(String),
      })
      expect(item?.quizItems[0]).toMatchObject({
        level: 1,
        type: expect.any(String),
        question: expect.any(String),
        answer: expect.any(String),
        sourceId,
        factId: expect.stringMatching(/^F\d{3}$/),
      })
    }
  })

  test("ships a JSON index that mirrors the TypeScript knowledge registry", async () => {
    const knowledgeBase = await loadKnowledgeBase()
    const pythonIndex = await Bun.file("knowledge_base/python_basic/index.json").json()
    const pythonProgrammingIndex = await Bun.file("knowledge_base/python_programming/index.json").json()
    const modernAiIndex = await Bun.file("knowledge_base/modern_ai/index.json").json()

    expect(pythonIndex.module).toBe("Python基础")
    expect(pythonProgrammingIndex.module).toBe("Python程序设计")
    expect(modernAiIndex.module).toBe("现代人工智能基础")
    const indexedSourceIds = [
      ...pythonIndex.items.map((item: { source_id: string }) => item.source_id),
      ...pythonProgrammingIndex.items.map((item: { source_id: string }) => item.source_id),
      ...modernAiIndex.items.map((item: { source_id: string }) => item.source_id),
    ]
    expect(indexedSourceIds).toHaveLength(knowledgeBase.items.length)
    expect(indexedSourceIds).toContain("K007")
    expect(indexedSourceIds).toContain("PY030")
    expect(indexedSourceIds).toContain("AI005")
  })

  test("adds Python programming extension items with traceable quiz seeds", async () => {
    const knowledgeBase = await loadKnowledgeBase()

    for (const sourceId of pythonProgrammingSourceIds) {
      const item = knowledgeBase.items.find((candidate) => candidate.sourceId === sourceId)
      expect(item).toBeDefined()
      expect(item?.module).toBe("Python程序设计")
      expect(item?.facts.length).toBeGreaterThanOrEqual(3)
      expect(item?.quizItems.length).toBeGreaterThanOrEqual(4)
      expect(item?.quizItems.map((quiz) => quiz.type)).toEqual(expect.arrayContaining(["choice", "debugging", "practice"]))
      expect(item?.quizItems.every((quiz) => quiz.sourceId === sourceId && /^F\d{3}$/.test(quiz.factId))).toBe(true)
    }
  })

  test("adds modern AI training and exam seeds with traceable facts", async () => {
    const knowledgeBase = await loadKnowledgeBase()

    for (const sourceId of modernAiSourceIds) {
      const item = knowledgeBase.items.find((candidate) => candidate.sourceId === sourceId)
      expect(item).toBeDefined()
      expect(item?.module).toBe("现代人工智能基础")
      expect(item?.facts.length).toBeGreaterThanOrEqual(3)
      expect(item?.quizItems.length).toBeGreaterThanOrEqual(4)
      expect(item?.quizItems.map((quiz) => quiz.type)).toEqual(expect.arrayContaining(["choice", "debugging", "practice"]))
      expect(item?.quizItems.every((quiz) => quiz.sourceId === sourceId && /^F\d{3}$/.test(quiz.factId))).toBe(true)
    }
  })
})
