import { describe, expect, test } from "bun:test"
import { classifyCodeLabVerificationFailure } from "../src/role-c-content/validators/code-lab-validator"

describe("Role C code-lab private verification diagnostics", () => {
  test("classifies trusted-runner failures without exposing hidden test identities", () => {
    expect(classifyCodeLabVerificationFailure({
      issues: ["reference_solution 未通过全部隐藏测试：TEST-secret:wrong_output"],
      reference_failed: true,
      reference_failure_codes: ["TEST-secret:wrong_output"],
      starter_status: "failed",
      failed_mutations: [],
    })).toEqual({
      code: "REFERENCE_SOLUTION_FAILED",
      stage: "code_lab_secure_execution",
      safe_message: "参考实现未通过可信隐藏测试",
      private_details: ["TEST-secret:wrong_output"],
    })
  })

  test("prioritizes runner and starter failures with stable machine codes", () => {
    expect(classifyCodeLabVerificationFailure({
      issues: ["starter code 未能稳定执行：timeout"],
      reference_failed: false,
      reference_failure_codes: [],
      starter_status: "timeout",
      failed_mutations: [],
    }).code).toBe("STARTER_EXECUTION_UNSTABLE")
    expect(classifyCodeLabVerificationFailure({
      issues: ["执行结果 runner_image_digest 不一致"],
      reference_failed: false,
      reference_failure_codes: [],
      starter_status: "failed",
      failed_mutations: [],
    }).code).toBe("RUNNER_IDENTITY_MISMATCH")
  })
})
