import { describe, expect, test } from "bun:test"
import { classifyPublicSecureLeak } from "../src/role-c-content/validators/public-secure-leak-validator"

describe("code lab input leak precision", () => {
  const base = {
    title: "lab", starter_code: "def solve(value):\n    pass", instructions: [], hint_ladders: [], reflection_questions: [],
    public_tests: [{ test_id: "P1", objective_id: "O1", description: "value 10 is an example", expected_behavior: "returns result", input: { args: [10], kwargs: {} }, citations: [] }],
  }
  const secure = (input: any) => ({
    lab_id: "L", test_suite_id: "S", reference_solution: "def solve(value):\n    return value + 1", mutation_variants: [], scoring_groups: [], misconception_map: [], objective_coverage: [],
    hidden_tests: [{ test_id: "H1", objective_id: "O1", weight: 1, input, expected: 11, comparison: { kind: "numeric" } }],
  })
  test("does not call a value mentioned in prose a leak", () => {
    const issues = classifyPublicSecureLeak({ public_payload: base as any, secure_payload: secure({ args: [11], kwargs: {} }) as any, execution_mode: "function" })
    expect(issues.some((issue: any) => issue.code === "hidden_test_input_leak")).toBe(false)
  })
  test("still catches exact public test input reuse", () => {
    const issues = classifyPublicSecureLeak({ public_payload: base as any, secure_payload: secure({ args: [10], kwargs: {} }) as any, execution_mode: "function" })
    expect(issues.some((issue: any) => issue.code === "hidden_test_input_leak")).toBe(true)
  })
})
