import { describe, expect, test } from "bun:test"
import { buildConceptTutorModelInput } from "../src/role-c-content/context/concept-context"

function request(overrides: {
  examples?: Array<{ title: string; code: string; explanation: string; fact_refs?: Array<{ source_id: string; fact_id: string }> }>
  practice_tasks?: string[]
  facts?: Array<{ source_id: string; fact_id: string; content: string }>
} = {}) {
  const facts = overrides.facts ?? [
    { source_id: "K001", fact_id: "F001", content: "Python 使用 = 进行变量赋值。" },
    { source_id: "K001", fact_id: "F002", content: "变量可以被重新赋值，新值覆盖旧绑定。" },
    { source_id: "K001", fact_id: "F003", content: "使用未赋值的变量会引发 NameError。" },
  ]
  return {
    generation_spec: {
      spec_id: "SPEC-1",
      run_id: "R1",
      path_node: { target_source_ids: ["K001"], prerequisite_source_ids: [] },
      targets: [{ objective_id: "O1", source_id: "K001", required_fact_ids: ["F001", "F002"] }],
      learner_adaptation: {},
      difficulty: {},
      policies: {},
    },
    evidence_pack: {
      results: [{
        source_id: "K001",
        title: "变量与赋值",
        difficulty: "beginner",
        facts,
        examples: overrides.examples ?? [
          { title: "更新变量值", code: "age = 18\nage = 19", explanation: "变量先保存旧值，再通过赋值更新。", fact_refs: [{ source_id: "K001", fact_id: "F001" }, { source_id: "K001", fact_id: "F002" }] },
        ],
        practice_tasks: overrides.practice_tasks ?? ["定义 name、age 两个变量并输出"],
        quiz_seeds: [{ level: 1, type: "choice", question: "赋值符号是？", answer: "=", source_id: "K001", fact_id: "F001" }],
      }],
    },
  } as never
}

describe("讲义 model input 证据投影（改进方案6 第六/七节）", () => {
  test("examples 保留原始引用，无引用的 practice_tasks 不投影为证据", () => {
    const input = buildConceptTutorModelInput(request())
    const evidence = input.evidence[0]!
    expect(evidence.examples).toHaveLength(1)
    expect(evidence.examples[0]!.fact_refs).toEqual(
      expect.arrayContaining([{ source_id: "K001", fact_id: "F002" }]),
    )
    expect(evidence).not.toHaveProperty("practice_tasks")
  })

  test("quiz_seeds（含 answer）绝不进入讲义模型输入", () => {
    const input = buildConceptTutorModelInput(request())
    const serialized = JSON.stringify(input)
    expect(serialized).not.toContain("赋值符号是")
    expect(serialized).not.toContain("\"answer\"")
  })

  test("绑定不上 required fact 的 example / practice 不进入可信生成", () => {
    const input = buildConceptTutorModelInput(request({
      examples: [{ title: "无关示例", code: "天气晴朗", explanation: "今天适合外出散步" }],
      practice_tasks: ["整理房间并打扫卫生"],
    }))
    expect(input.evidence[0]!.examples).toHaveLength(0)
    expect(input.evidence[0]).not.toHaveProperty("practice_tasks")
  })

  test("facts 只保留 required_fact_ids 内的，越界事实被过滤", () => {
    const input = buildConceptTutorModelInput(request())
    const factIds = input.evidence[0]!.facts.map((fact) => fact.fact_id)
    expect(factIds).toEqual(["F001", "F002"])
    expect(factIds).not.toContain("F003")
  })
})
