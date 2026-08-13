import { describe, expect, test } from "bun:test"
import { getPythonCurriculumTree, mapCurriculumNodeToSourceIds, resolveLearningGoalSpec } from "../src/knowledge/curriculum"
import { loadKnowledgeBase } from "../src/knowledge/loader"
import { retrieveKnowledge } from "../src/rag/retriever"

const pythonProgrammingSourceIds = [
  "PY019",
  "PY020",
  "PY021",
  "PY022",
  "PY023",
  "PY024",
  "PY025",
  "PY026",
  "PY027",
  "PY028",
  "PY029",
  "PY030",
  "PY031",
  "PY032",
  "PY033",
  "PY034",
  "PY035",
  "PY036",
  "PY037",
  "PY038",
  "PY039",
  "PY040",
  "PY041",
  "PY042",
  "PY043",
  "PY044",
  "PY045",
  "PY046",
  "PY047",
  "PY048",
  "PY049",
  "PY050",
  "PY051",
  "PY052",
  "PY053",
  "PY054",
  "PY055",
]

describe("Python programming knowledge extension", () => {
  test("loads PY019-PY055 as a traceable Python programming module", async () => {
    const knowledgeBase = await loadKnowledgeBase()
    const sourceIds = new Set(knowledgeBase.items.map((item) => item.sourceId))

    for (const sourceId of pythonProgrammingSourceIds) {
      const item = knowledgeBase.items.find((candidate) => candidate.sourceId === sourceId)
      expect(item, `${sourceId} should be loaded`).toBeDefined()
      expect(item?.module).toBe("Python程序设计")
      expect(item?.file).toStartWith("knowledge_base/python_programming/")
      expect(item?.facts.length).toBeGreaterThanOrEqual(3)
      expect(item?.examples.length).toBeGreaterThanOrEqual(1)
      expect(item?.examples[0].code).toContain("\n")
      expect(item?.practiceTasks.length).toBeGreaterThanOrEqual(2)
      expect(item?.quizItems.length).toBeGreaterThanOrEqual(4)
      expect(item?.quizItems.map((quiz) => quiz.type)).toEqual(expect.arrayContaining(["choice", "debugging", "practice"]))
      expect(item?.quizItems.every((quiz) => quiz.sourceId === sourceId && /^F\d{3}$/.test(quiz.factId))).toBe(true)
    }

    expect(sourceIds.size).toBe(knowledgeBase.items.length)
    expect(knowledgeBase.items.length).toBeGreaterThanOrEqual(61)
  })

  test("ships a display index that mirrors the Python programming runtime source", async () => {
    const knowledgeBase = await loadKnowledgeBase()
    const index = await Bun.file("knowledge_base/python_programming/index.json").json()
    const runtimeIds = knowledgeBase.items
      .filter((item) => item.module === "Python程序设计")
      .map((item) => item.sourceId)

    expect(index.module).toBe("Python程序设计")
    expect(index.items.map((item: { source_id: string }) => item.source_id)).toEqual(runtimeIds)
    expect(index.items.map((item: { source_id: string }) => item.source_id)).toEqual(pythonProgrammingSourceIds)
  })

  test("maps Python programming curriculum nodes and custom goals", () => {
    const tree = getPythonCurriculumTree()

    expect(tree.children.map((chapter) => chapter.title)).toEqual(expect.arrayContaining(["Python程序设计进阶"]))
    expect(mapCurriculumNodeToSourceIds("PY-PROG-S01")).toEqual(["PY019"])
    expect(mapCurriculumNodeToSourceIds("PY-PROG-S07")).toEqual(["PY025"])
    expect(mapCurriculumNodeToSourceIds("PY-PROG-S12")).toEqual(["PY030"])
    expect(mapCurriculumNodeToSourceIds("PY-PROG-S13")).toEqual(["PY031"])
    expect(mapCurriculumNodeToSourceIds("PY-PROG-S22")).toEqual(["PY040"])
    expect(mapCurriculumNodeToSourceIds("PY-PROG-S32")).toEqual(["PY050"])
    expect(mapCurriculumNodeToSourceIds("PY-PROG-S33")).toEqual(["PY051"])
    expect(mapCurriculumNodeToSourceIds("PY-PROG-S37")).toEqual(["PY055"])

    const spec = resolveLearningGoalSpec({
      mode: "custom_goal",
      custom_goal: "我想练习列表推导式、lambda排序、类的继承、random随机数、csv成绩管理、SQLite数据库和参数化查询",
    })

    expect(spec.mapped_source_ids).toEqual(expect.arrayContaining(["PY020", "PY026", "PY028", "PY030", "PY031", "PY035", "PY042", "PY051", "PY055"]))
  })

  test("retrieves Python programming topics through RAG", async () => {
    const cases = [
      { query: "怎么用切片取字符串或列表的一部分", expected: "PY019" },
      { query: "列表推导式怎么筛选数据", expected: "PY020" },
      { query: "lambda排序学生成绩怎么写", expected: "PY026" },
      { query: "Python类和实例怎么保存对象状态", expected: "PY028" },
      { query: "继承和方法重写有什么用", expected: "PY030" },
      { query: "random如何生成随机整数", expected: "PY031" },
      { query: "CSV文件怎么逐行读取成绩", expected: "PY035" },
      { query: "requests怎么发送网页请求", expected: "PY038" },
      { query: "正则表达式怎么匹配文本模式", expected: "PY040" },
      { query: "编程题如何设计公开和隐藏测试用例", expected: "PY049" },
      { query: "SQLite数据库怎么连接", expected: "PY051" },
      { query: "数据库表结构和字段怎么设计", expected: "PY052" },
      { query: "SQL怎么INSERT插入和SELECT查询", expected: "PY053" },
      { query: "数据库如何UPDATE更新和DELETE删除", expected: "PY054" },
      { query: "参数化查询如何防止SQL注入", expected: "PY055" },
    ]

    for (const evaluation of cases) {
      const result = await retrieveKnowledge({ query: evaluation.query, topK: 5 })
      expect(
        result.results.map((item) => item.sourceId),
        `${evaluation.query} should hit ${evaluation.expected}`,
      ).toContain(evaluation.expected)
    }
  })
})
