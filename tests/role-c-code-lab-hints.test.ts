import { describe, expect, test } from "bun:test"
import { normalizeCodeLabPublicAuthorPayload } from "../src/role-c-content/providers/model-backed-provider"
import {
  validateCodeLabPublicAuthorAgainstPlan,
  type CodeLabObjectivePlan,
  type CodeLabPublicAuthorPayload,
} from "../src/role-c-content/providers/staged-generation"

const plan: CodeLabObjectivePlan[] = [{
  objective_id: "OBJ-K007",
  source_id: "K007",
  instruction_block_id: "BLOCK-1",
  public_test_id: "TEST-1",
  citations: [{ source_id: "K007", fact_id: "F001", relation: "derived_from" }],
}]

const evidence = {
  results: [{
    source_id: "K007",
    title: "for 循环",
    facts: [{ source_id: "K007", fact_id: "F001", content: "for 循环会依次取出序列中的每个元素。" }],
  }],
} as any

function payload(hints: string[]): CodeLabPublicAuthorPayload {
  return {
    title: "观察 for 循环变量",
    execution_contract: {
      language: "python",
      execution_mode: "stdin_stdout",
      allowed_imports: [],
      input_contract: { type: "none", constraints: [] },
      output_contract: { type: "stdout", constraints: [] },
      resource_limits: { timeout_ms: 1000, memory_mb: 64, max_output_bytes: 4096 },
    },
    starter_code: "fact_text = \"TODO：填写事实\"\nprint(fact_text)\n",
    objectives: [{
      instruction_text: "补全 for 循环事实并运行。",
      public_test: { description: "运行程序", input: "", expected_behavior: "输出 for 循环事实" },
      hints,
      reflection_question: "for 循环每轮取出的对象是什么？",
    }],
  }
}

const recallFactContract = {
  learner_action: "recall_fact" as const,
  learner_owned_region: "fact_literal" as const,
  input_form: "none" as const,
}

describe("code lab content-specific hint ladders", () => {
  test("rejects the old reusable hint template", () => {
    const issues = validateCodeLabPublicAuthorAgainstPlan(payload([
      "先定位本目标要求表达的核心事实。",
      "确认填写内容保留了事实中的主语、对象和关系。",
      "只替换 TODO 字符串，不改动变量赋值和输出语句。",
    ]), plan, recallFactContract, undefined, undefined, evidence)
    expect(issues.some((issue) => issue.includes("通用占位提示"))).toBe(true)
  })

  test("accepts a progressive ladder grounded in the current for-loop fact", () => {
    const hints = [
      "先观察 for 循环面对一个序列时，每轮关注的是哪个对象。",
      "把序列想成排好队的元素：for 循环变量会按顺序接住其中一个元素。",
      "目标事实需要同时表达 for 循环、依次取出和序列中的每个元素。",
    ]
    expect(validateCodeLabPublicAuthorAgainstPlan(
      payload(hints), plan, recallFactContract, undefined, undefined, evidence,
    )).toEqual([])
  })

  test("normalization preserves model-authored task-specific hints", () => {
    const hints = [
      "先观察 for 循环每一轮处理的对象。",
      "for 循环变量会按序接收序列里的元素。",
      "完整表达应包含‘依次取出序列中的每个元素’。",
    ]
    const normalized = normalizeCodeLabPublicAuthorPayload(payload(hints), recallFactContract)
    expect(normalized.objectives[0]?.hints).toEqual(hints)
  })
})
