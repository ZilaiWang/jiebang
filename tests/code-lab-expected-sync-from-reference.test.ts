import { describe, expect, test } from "bun:test"
import { isExpectedOnlyReferenceFailure, patchExpectedFromReferenceFailures } from "../src/role-c-content/providers/staged-generation"

describe("expected-only reference failure repair", () => {
  test("recognizes trusted assertion diffs that can be repaired without another model patch", () => {
    expect(isExpectedOnlyReferenceFailure([
      'H1:assertion_failed:expected=10:actual=11',
      'H2:assertion_failed:expected="ok":actual=["ok",2]',
    ])).toBe(true)
    expect(isExpectedOnlyReferenceFailure([
      'H1:runtime_ValueError',
    ])).toBe(false)
  })

  test("uses trusted actual output to resync stale expected values", () => {
    const secure: any = {
      hidden_tests: [
        { test_id: "H1", expected: 10, comparison: { kind: "numeric", abs_tolerance: 1e-9, rel_tolerance: 1e-9 } },
        { test_id: "H2", expected: "ok", comparison: { kind: "exact" } },
      ],
    }
    const patched = patchExpectedFromReferenceFailures(secure, [
      'H1:assertion_failed:expected=10:actual=11',
      'H2:assertion_failed:expected="ok":actual=["ok",2]',
    ])
    expect(patched.hidden_tests[0].expected).toBe(11)
    expect(patched.hidden_tests[1].expected).toEqual(["ok", 2])
  })
})
