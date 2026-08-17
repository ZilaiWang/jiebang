import { describe, expect, test } from "bun:test"
import {
  buildFactIndex,
  lookupFact,
  lookupFacts,
  uniqueCitations,
  type FactIndex,
} from "./fact-lookup"

const sampleRagResult = {
  query: "成绩统计",
  learnerLevel: "beginner",
  topK: 2,
  results: [
    {
      source_id: "K007",
      sourceId: "K007",
      title: "for 循环",
      facts: [
        { source_id: "K007", fact_id: "F001", content: "for 循环可以依次遍历列表中的每个元素。" },
        { source_id: "K007", fact_id: "F002", content: "range(2, 5) 生成从 2 到 4 的整数序列。" },
      ],
    },
    {
      source_id: "K009",
      sourceId: "K009",
      title: "列表",
      facts: [
        { source_id: "K009", fact_id: "F001", content: "列表用于保存多个有序元素。" },
      ],
    },
  ],
}

describe("fact-lookup：引用事实索引", () => {
  test("从 rag_result 建索引并命中 source_id:fact_id", () => {
    const index = buildFactIndex(sampleRagResult)
    expect(index.size).toBe(3)
    const hit = lookupFact(index, { source_id: "K007", fact_id: "F001" })
    expect(hit.found).toBe(true)
    if (hit.found) {
      expect(hit.entry.content).toBe("for 循环可以依次遍历列表中的每个元素。")
      expect(hit.entry.source_title).toBe("for 循环")
    }
  })

  test("大小写/空白归一化：K007 vs k007、f001 vs F001 均可命中", () => {
    const index = buildFactIndex(sampleRagResult)
    const hit = lookupFact(index, { source_id: "k007", fact_id: "f001" })
    expect(hit.found).toBe(true)
    const withSpace = lookupFact(index, { source_id: " K009 ", fact_id: " F001 " })
    expect(withSpace.found).toBe(true)
  })

  test("缺失事实 → found:false（如实显示，不虚构来源）", () => {
    const index = buildFactIndex(sampleRagResult)
    expect(lookupFact(index, { source_id: "K007", fact_id: "F999" }).found).toBe(false)
    expect(lookupFact(index, { source_id: "K999", fact_id: "F001" }).found).toBe(false)
    expect(lookupFact(index, undefined).found).toBe(false)
    expect(lookupFact(index, null).found).toBe(false)
    expect(lookupFact(index, { source_id: "K007" }).found).toBe(false)
  })

  test("空/结构不符的 rag_result → 空索引，不抛错", () => {
    expect(buildFactIndex(null).size).toBe(0)
    expect(buildFactIndex(undefined).size).toBe(0)
    expect(buildFactIndex({ no_results: true }).size).toBe(0)
    expect(buildFactIndex({ results: "not-array" }).size).toBe(0)
    expect(buildFactIndex({ results: [{ title: "无facts" }] }).size).toBe(0)
    expect(buildFactIndex({ results: [{ source_id: "K1", facts: "bad" }] }).size).toBe(0)
  })

  test("camelCase sourceId/factId 与 snake_case 都兼容", () => {
    const camel = {
      results: [{ sourceId: "K013", title: "函数", facts: [{ factId: "F1", content: "def 定义函数。" }] }],
    }
    const index = buildFactIndex(camel)
    const hit = lookupFact(index, { source_id: "K013", fact_id: "F1" })
    expect(hit.found).toBe(true)
    if (hit.found) expect(hit.entry.content).toBe("def 定义函数。")
  })

  test("lookupFacts 批量查询保留顺序", () => {
    const index = buildFactIndex(sampleRagResult)
    const results = lookupFacts(index, [
      { source_id: "K007", fact_id: "F002" },
      { source_id: "K007", fact_id: "F999" },
    ])
    expect(results).toHaveLength(2)
    expect(results[0]!.result.found).toBe(true)
    expect(results[1]!.result.found).toBe(false)
    expect(lookupFacts(index, null)).toEqual([])
    expect(lookupFacts(index, undefined)).toEqual([])
  })

  test("uniqueCitations 按 source_id:fact_id 去重并跳过空值", () => {
    const deduped = uniqueCitations([
      { source_id: "K007", fact_id: "F001" },
      { source_id: "K007", fact_id: "F001" },
      { source_id: "K009", fact_id: "F001" },
      { source_id: "K007" },
      { fact_id: "F001" },
    ])
    expect(deduped).toHaveLength(2)
    expect(uniqueCitations(null)).toEqual([])
    expect(uniqueCitations(undefined)).toEqual([])
    void 0 as unknown as FactIndex
  })
})
