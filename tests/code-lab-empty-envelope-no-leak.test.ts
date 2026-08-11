import { describe, expect, test } from "bun:test"
import { validateCodeLabPublicSecureSeparation } from "../src/role-c-content/validators/public-secure-leak-validator"

describe("empty function invocation is protocol, not hidden input", () => {
  test("allows public and hidden empty args envelope for a zero-argument lab", () => {
    const publicPayload: any = {
      lab_id: "L", title: "zero args", objective_ids: ["O"], instructions: [],
      execution_contract: { execution_mode: "function", entry_point: "describe_python" },
      starter_code: "def describe_python():\n    raise NotImplementedError()",
      public_tests: [{ test_id: "P", objective_id: "O", description: "调用函数", input: { args: [], kwargs: {} }, expected_behavior: "返回描述", citations: [] }],
      hint_ladders: [], reflection_questions: [], objective_coverage: [], used_evidence: [],
    }
    const securePayload: any = {
      lab_id: "L", test_suite_id: "TS", execution_contract: publicPayload.execution_contract,
      reference_solution: "def describe_python():\n    return 'Python 是通用编程语言'",
      hidden_tests: [{ test_id: "H", objective_id: "O", input: { args: [], kwargs: {} }, expected: "Python 是通用编程语言", weight: 1, comparison: { kind: "exact" } }],
      scoring_groups: [], misconception_map: [], mutation_variants: [],
    }
    expect(validateCodeLabPublicSecureSeparation(publicPayload, securePayload).issues.map((x) => x.code)).not.toContain("hidden_test_input_leak")
  })
})
