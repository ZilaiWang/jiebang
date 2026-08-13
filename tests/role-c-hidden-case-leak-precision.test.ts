import { describe, expect, test } from "bun:test"
import { validateCodeLabPublicSecureSeparation } from "../src/role-c-content/validators/public-secure-leak-validator"

function fixture(hiddenInput: unknown, hiddenExpected: unknown) {
  const publicPayload: any = {
    title: "计算列表长度",
    starter_code: "def solve(values):\n    raise NotImplementedError('TODO')\n",
    instructions: [],
    public_tests: [{ test_id: "P1", description: "检查普通输入", input: { args: [[1, 2]], kwargs: {} }, expected_behavior: "返回符合合同的结果" }],
    hint_ladders: [],
    reflection_questions: [],
  }
  const securePayload: any = {
    reference_solution: "def solve(values):\n    return len(values)\n",
    test_suite_id: "SECRET-SUITE",
    hidden_tests: [{ test_id: "H1", input: hiddenInput, expected: hiddenExpected }],
    mutation_variants: [],
  }
  return { publicPayload, securePayload }
}

describe("Role C hidden case leakage detector", () => {
  test("allows generic public wording when hidden scalar happens to appear as ordinary prose", () => {
    const { publicPayload, securePayload } = fixture({ args: [[1, 2, 3]], kwargs: {} }, 3)
    publicPayload.instructions = [{ block_id: "B1", block_type: "paragraph", text: "分三步检查输入、处理和返回形式。", claims: [] }]
    const codes = validateCodeLabPublicSecureSeparation(publicPayload, securePayload).issues.map((issue) => issue.code)
    expect(codes).not.toContain("hidden_test_input_leak")
    expect(codes).not.toContain("hidden_test_expected_leak")
  })

  test("still rejects exact public/hidden structured cases", () => {
    const hidden = { args: [[1, 2]], kwargs: {} }
    const { publicPayload, securePayload } = fixture(hidden, 2)
    const codes = validateCodeLabPublicSecureSeparation(publicPayload, securePayload).issues.map((issue) => issue.code)
    expect(codes).toContain("hidden_test_input_leak")
  })
})
