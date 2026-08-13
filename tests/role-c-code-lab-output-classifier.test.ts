import { describe, expect, test } from "bun:test"
import {
  classifyOutputContract,
  normalizeCodeLabSecureAuthorPayloadLenient,
} from "../src/role-c-content/providers/staged-generation"
import {
  validateHiddenTestComparisonCompatibility,
  validateHiddenTestExpectedAgainstOutputContract,
} from "../src/role-c-content/validators/code-lab-validator"

describe("Role C code-lab authoritative output classification", () => {
  test("supports explicit kind, keeps legacy type, and gives containers precedence", () => {
    expect(classifyOutputContract({ kind: "number", type: "legacy prose" })).toBe("number")
    expect(classifyOutputContract({ type: "list of numbers" })).toBe("array")
    expect(classifyOutputContract({ type: "object mapping names to numeric scores" })).toBe("object")
    expect(classifyOutputContract({ type: "mystery result" })).toBe("unknown")
  })

  test("normalizer and validator use the same authoritative classifier", () => {
    const contract = { type: "list of numbers" }
    const normalized = normalizeCodeLabSecureAuthorPayloadLenient({
      reference_solution: "def solve(): return [1, 2]",
      hidden_tests: [{
        input: { args: [], kwargs: {} },
        expected: [1, 2],
        comparison: { kind: "numeric", abs_tolerance: 1e-9, rel_tolerance: 1e-9 },
        misconception_tag: "wrong-shape",
      }],
      mutation_variants: [],
    }, {
      hidden_tests: [{ test_id: "T-1", objective_id: "OBJ-1", case_kind: "normal", weight: 1 }],
      mutation_variants: [],
    }, "function", [], contract)

    expect(normalized.hidden_tests[0]?.comparison).toEqual({ kind: "exact" })
    expect(validateHiddenTestExpectedAgainstOutputContract(contract, [1, 2])).toEqual([])
    expect(validateHiddenTestComparisonCompatibility(
      normalized.hidden_tests[0]!.comparison,
      normalized.hidden_tests[0]!.expected,
      contract,
    )).toEqual([])
  })

  test("unknown output contracts fail closed", () => {
    expect(validateHiddenTestExpectedAgainstOutputContract({ type: "mystery result" }, 1).join(" "))
      .toContain("未知 output_contract")
  })
})
