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
        partition_id: "nominal",
        note: "裸 except 会捕获所有异常，所以这个用例可验证异常机制。",
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
    expect(normalized.hidden_tests[0]!.partition_id).toBe("nominal")
    expect(normalized.hidden_tests[0]!.note).toBe("典型输入：验证当前目标的主流程可正常完成。")
    expect(normalized.hidden_tests[0]!.note).not.toContain("except")
  })
})
