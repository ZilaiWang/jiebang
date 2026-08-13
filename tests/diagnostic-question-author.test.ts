import { describe, expect, test } from "bun:test"
import {
  ModelDiagnosticQuestionAuthor,
  type DiagnosticQuestionAuthorInput,
} from "../src/orchestration/diagnostic-question-author"
import type { ModelGateway } from "../src/role-c-content/contracts/model-gateway"

class SequenceGateway implements ModelGateway {
  readonly model_id = "diagnostic-test-model"
  readonly model_config_hash = "MODEL-diagnostic-test"
  readonly requests: any[] = []

  constructor(private readonly outputs: unknown[]) {}

  async generateStructured<T>(request: any): Promise<T> {
    this.requests.push(request)
    return structuredClone(this.outputs[Math.min(this.requests.length - 1, this.outputs.length - 1)]) as T
  }
}

function input(): DiagnosticQuestionAuthorInput {
  return {
    session_id: "SESSION-DIAG-AI",
    learner_goal: "学习 Python for 循环",
    targets: [{
      source_id: "K007",
      concept: "for 循环",
      difficulty: "basic",
      selection_reason: "target",
      facts: [{ fact_id: "F001", content: "for 循环可以按顺序遍历可迭代对象中的元素。" }],
    }],
    prior_public_items: [{
      form_id: "DIAGFORM-OLD",
      item_id: "DIAG-OLD",
      objective_id: "DIAG-K007",
      modality: "mcq",
      prompt: "for 循环会按什么顺序遍历列表？",
      options: ["按元素顺序", "随机", "从不遍历"],
    }],
  }
}

describe("AI diagnostic question author", () => {
  test("repairs a repeated public question and keeps its answer grounded in an A fact", async () => {
    const gateway = new SequenceGateway([
      { items: [{ source_id: "K007", fact_id: "F001", question: "FOR 循环会按什么顺序遍历列表?", options: ["随机", "从不遍历", "按元素顺序"], answer: "按元素顺序" }] },
      { items: [{ source_id: "K007", fact_id: "F001", question: "给定 names = ['A', 'B']，哪个说法符合 for 遍历的行为？", options: ["依次取得 A 和 B", "只取得 B", "每次随机取值"], answer: "依次取得 A 和 B" }] },
    ])
    const result = await new ModelDiagnosticQuestionAuthor(gateway).author(input())
    expect(gateway.requests).toHaveLength(2)
    expect(gateway.requests[1].input.previous_validation_issues.join("\n")).toContain("重复")
    expect(result[0]).toMatchObject({ source_id: "K007", fact_id: "F001", answer: "依次取得 A 和 B" })
  })

  test("blocks invented fact identities instead of publishing them", async () => {
    const gateway = new SequenceGateway([
      { items: [{ source_id: "K007", fact_id: "F999", question: "这是一道无效诊断题吗？", options: ["是", "否", "不确定"], answer: "是" }] },
    ])
    await expect(new ModelDiagnosticQuestionAuthor(gateway).author(input())).rejects.toThrow("fact_id")
    expect(gateway.requests).toHaveLength(3)
  })

  test("canonicalizes cosmetically duplicated options without changing the answer", async () => {
    const gateway = new SequenceGateway([{
      items: [{
        source_id: "K007",
        fact_id: "F001",
        question: "给定 xs = [1, 2]，for 遍历时会发生什么？",
        options: ["依次取得 1 和 2", "随机取得元素", "不取得元素", "依次取得1和2。"],
        answer: "依次取得1和2。",
      }],
    }])
    const result = await new ModelDiagnosticQuestionAuthor(gateway).author(input())
    expect(gateway.requests).toHaveLength(1)
    expect(result[0]?.options).toEqual(["依次取得 1 和 2", "随机取得元素", "不取得元素"])
    expect(result[0]?.answer).toBe("依次取得 1 和 2")
  })
})
