import { describe, expect, test } from "bun:test"
import { classifyPublicSecureLeak } from "../src/role-c-content/validators/public-secure-leak-validator"

describe("code lab secure function input leak precision", () => {
  test("does not reject a legitimate function invocation envelope merely because args are empty", () => {
    const result = classifyPublicSecureLeak({
      public_payload: {
        title: "zero arg lab", starter_code: "def solve():\n    pass", instructions: [], hint_ladders: [], reflection_questions: [],
        public_tests: [{ test_id: "P1", objective_id: "O1", description: "call solve", expected_behavior: "returns ok", input: { args: [], kwargs: {} }, citations: [] }],
      },
      secure_payload: {
        lab_id: "L", test_suite_id: "S", reference_solution: "def solve():\n    return 'ok'", mutation_variants: [], scoring_groups: [], misconception_map: [], objective_coverage: [],
        hidden_tests: [{ test_id: "H1", objective_id: "O1", weight: 1, input: { args: [], kwargs: {} }, expected: "ok", comparison: { kind: "exact" } }],
      },
      execution_mode: "function",
    } as any)
    expect(result.some((issue: any) => issue.code === "hidden_test_input_leak")).toBe(false)
  })
})
