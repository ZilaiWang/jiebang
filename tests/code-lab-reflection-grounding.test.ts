import { describe, expect, test } from "bun:test"
import { validateCodeLabReflectionQuestions } from "../src/role-c-content/programming/reflection-grounding"

describe("code-lab reflection grounding", () => {
  test("accepts one focused question about the implementation or public contract", () => {
    expect(validateCodeLabReflectionQuestions([
      "三行 print 语句分别输出哪个变量？",
      "哪个公开样例验证了函数返回值？",
    ])).toEqual([])
  })

  test("rejects the real compound question that invents a relation to a cited fact", () => {
    const issues = validateCodeLabReflectionQuestions([
      "你能否指出每行分别对应哪个变量？这和“Python 程序通常由解释器执行”这条事实有什么关系？",
    ])
    expect(issues).toEqual([
      "reflection_questions[0] 必须只包含一个聚焦问题，不得串联多个不同问题",
      "reflection_questions[0] 不得要求推导实验操作与引用事实之间未被证据声明的关系",
    ])
  })
})
