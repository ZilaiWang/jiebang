import { describe, expect, test } from "bun:test"
import { classifyCodeLabVerificationFailure } from "../src/role-c-content/validators/code-lab-validator"

describe("Role C code-lab execution repair boundary", () => {
  test("keeps the public draft frozen and exposes only safe diagnostic categories", () => {
    const feedback = {
      issues: ["reference_solution 未通过全部隐藏测试：SECRET-TEST:wrong_output"],
      reference_failed: true,
      reference_failure_codes: ["SECRET-TEST:wrong_output"],
      starter_status: "failed" as const,
      failed_mutations: [],
    }
    const diagnostic = classifyCodeLabVerificationFailure(feedback)
    expect(diagnostic).toMatchObject({ code: "REFERENCE_SOLUTION_FAILED", safe_message: "参考实现未通过可信隐藏测试" })
    expect(diagnostic.private_details).toEqual(["SECRET-TEST:wrong_output"])
  })
})
