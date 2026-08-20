import { describe, expect, test } from "bun:test"
import { validateAssessmentPublicSecureSeparation } from "../src/role-c-content/validators/public-secure-leak-validator"

function fixture(prompt: string) {
  const publicPayload: any = {
    form_id: "F", title: "测评", objective_ids: ["O"],
    items: [{ item_id: "I", objective_id: "O", modality: "code", prompt, starter_code: "def solve(value):\n    raise NotImplementedError('TODO')", citations: [] }],
    submission_policy: { max_attempts: 3, formative: true }, routing: [], objective_coverage: [], used_evidence: [],
  }
  const securePayload: any = {
    form_id: "F",
    items: [{ item_id: "I", objective_id: "O", modality: "code", answer_spec: { kind: "code", test_suite_id: "TS" }, misconception_by_option: {} }],
    code_test_suites: [{
      test_suite_id: "TS",
      execution_contract: { execution_mode: "function" },
      reference_solution: "def solve(value):\n    return value + 1",
      hidden_tests: [{ test_id: "H", input: { args: [41], kwargs: {} }, expected: 42 }],
    }],
  }
  return { publicPayload, securePayload }
}

describe("assessment hidden-case leak precision", () => {
  test("公开题目提到一个可能输出值，不等于泄露隐藏用例", () => {
    const { publicPayload, securePayload } = fixture("结果可能是 42，请实现通用函数。")
    const codes = validateAssessmentPublicSecureSeparation(publicPayload, securePayload).issues.map((issue) => issue.code)
    expect(codes).not.toContain("hidden_test_expected_leak")
  })

  test("同一公开表面披露隐藏输入及其预期结果时仍会拦截", () => {
    const { publicPayload, securePayload } = fixture('隐藏测试输入为 {"args":[41],"kwargs":{}}，预期结果为 hidden-answer-42。')
    securePayload.code_test_suites[0].hidden_tests[0].expected = "hidden-answer-42"
    const codes = validateAssessmentPublicSecureSeparation(publicPayload, securePayload).issues.map((issue) => issue.code)
    expect(codes).toContain("hidden_test_input_leak")
    expect(codes).toContain("hidden_test_expected_leak")
  })
})
