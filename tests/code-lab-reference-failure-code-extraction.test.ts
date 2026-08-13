import { describe, expect, test } from "bun:test"
import { expectedOnlyReferenceFailureCodes } from "../src/role-c-content/providers/staged-generation"

describe("reference failure code extraction", () => {
  test("extracts assertion diffs from trusted verifier prose issues", () => {
    const codes = expectedOnlyReferenceFailureCodes({
      issues: ["reference_solution 未通过全部隐藏测试：H1:assertion_failed:expected=10:actual=11、H2:assertion_failed:expected=\"ok\":actual=[\"ok\",2]"],
    })
    expect(codes).toEqual([
      'H1:assertion_failed:expected=10:actual=11',
      'H2:assertion_failed:expected="ok":actual=["ok",2]',
    ])
  })
})
