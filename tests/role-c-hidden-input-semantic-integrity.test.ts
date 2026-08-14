import { describe, expect, test } from "bun:test"
import {
  normalizeCodeLabSecureAuthorPayloadLenient,
  type CodeLabSecureAuthorPayload,
  type CodeLabSecurePlan,
} from "../src/role-c-content/providers/staged-generation"

describe("Role C hidden-test semantic integrity", () => {
  test("does not silently change hidden input without recomputing its expected value", () => {
    const plan: CodeLabSecurePlan = {
      hidden_tests: [{
        test_id: "TEST-1",
        objective_id: "OBJ-1",
        case_kind: "normal",
        weight: 1,
      }],
      mutation_variants: [],
    }
    const authored: CodeLabSecureAuthorPayload = {
      reference_solution: "def double(value):\n    return value * 2\n",
      hidden_tests: [{
        input: { args: [10], kwargs: {} },
        expected: 20,
        comparison: { kind: "exact" },
        misconception_tag: "returns_input",
      }],
      mutation_variants: [],
    }

    const normalized = normalizeCodeLabSecureAuthorPayloadLenient(
      authored,
      plan,
      "function",
      [{ args: [10], kwargs: {} }],
      { type: "number" },
    )

    expect(normalized.hidden_tests[0]!.input).toEqual({ args: [10], kwargs: {} })
    expect(normalized.hidden_tests[0]!.expected).toBe(20)
  })
})
