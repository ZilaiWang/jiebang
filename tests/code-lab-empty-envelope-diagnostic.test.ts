import { describe, expect, test } from "bun:test"
import { classifyCodeLabVerificationFailure } from "../src/role-c-content/validators/code-lab-validator"

describe("empty function invocation diagnostics", () => {
  test("does not classify an empty args protocol envelope as a private input leak", () => {
    const diagnostic = classifyCodeLabVerificationFailure({
      issues: ["hidden_test_input_leak: empty invocation envelope"],
      public_payload: { public_tests: [{ input: { args: [], kwargs: {} } }] },
      secure_payload: { hidden_tests: [{ input: { args: [], kwargs: {} } }] },
    } as any)
    expect(diagnostic.code).not.toBe("HIDDEN_TEST_INPUT_LEAK")
  })
})
