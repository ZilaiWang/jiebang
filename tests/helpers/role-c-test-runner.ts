import type {
  CodeExecutionRequest,
  CodeExecutionResult,
  CodeRunner,
} from "../../src/role-c-content"

export const ROLE_C_TEST_RUNNER_DIGEST =
  `sha256:${"d".repeat(64)}`

/**
 * Fast deterministic runner for contract tests only.
 *
 * Production composition must inject the Docker-backed runner.
 */
export class RoleCTestRunner implements CodeRunner {
  readonly runner_image_digest = ROLE_C_TEST_RUNNER_DIGEST

  async execute(
    request: CodeExecutionRequest,
  ): Promise<CodeExecutionResult> {
    const declaredTests =
      request.test_suite?.tests.map((entry) => entry.test_id) ?? []
    const testIds = declaredTests.length > 0
      ? declaredTests
      : [
          "AT-O3-BASIC",
          "AT-O3-SINGLE",
          "AT-O3-DECIMAL",
          "AT-O3-FRACTION",
        ]
    const failed = request.code.includes("return None")
      || request.code.includes("pass\n")
      || request.code.includes("total = score")
      || request.code.includes("scores[:-1]")
      || request.code.includes("return 80")
      || request.code.includes("// count")
      ? testIds
      : []
    return {
      status: failed.length === 0 ? "passed" : "failed",
      passed_tests: testIds.length - failed.length,
      total_tests: testIds.length,
      score_ratio: testIds.length === 0
        ? 0
        : (testIds.length - failed.length) / testIds.length,
      failure_codes: failed.map(
        (testId) => `${testId}:assertion_failed`,
      ),
      runner_image_digest: this.runner_image_digest,
    }
  }
}
