import { describe, expect, test } from "bun:test"
import {
  DOCKER_CLI_STARTUP_GRACE_MS,
  DockerPythonCodeRunner,
} from "../src/role-c-content/security/code-runner"

describe("docker runner failure codes preserve assertion diffs", () => {
  test("Docker 启动开销不挤占学习者程序的执行时限", async () => {
    let outerTimeout = 0
    const runner = new DockerPythonCodeRunner({
      image_id: "sha256:" + "a".repeat(64),
      executor: {
        async run(request) {
          outerTimeout = request.timeout_ms
          return {
            exit_code: 0,
            stdout: JSON.stringify({ status: "completed", results: [{ outcome: "returned", actual: "ok\n" }] }),
            stderr: "",
            timed_out: false,
            output_truncated: false,
          }
        },
      },
    })
    const contract = {
      language: "python" as const,
      execution_mode: "stdin_stdout" as const,
      allowed_imports: [],
      input_contract: { type: "none", constraints: [] },
      output_contract: { type: "stdout_lines", kind: "string" as const, constraints: [] },
      resource_limits: { timeout_ms: 2000, memory_mb: 64, max_output_bytes: 4096 },
    }
    await runner.execute({
      language: "python", code: "print('ok')", test_suite_id: "TS-COLD",
      test_suite: {
        test_suite_id: "TS-COLD", execution_contract: contract,
        tests: [{ test_id: "T1", objective_id: "O1", weight: 1, input: "", expected: "ok\n", comparison: { kind: "exact" } }],
      },
      timeout_ms: 2000, memory_mb: 64, max_output_bytes: 4096, network_allowed: false,
    })
    expect(outerTimeout).toBe(2000 + DOCKER_CLI_STARTUP_GRACE_MS)
  })

  test("evaluates returned mismatches with expected/actual details", async () => {
    const runner = new DockerPythonCodeRunner({
      image_id: "sha256:" + "a".repeat(64),
      executor: {
        async run() {
          return {
            exit_code: 0,
            stdout: JSON.stringify({ status: "completed", results: [{ outcome: "returned", actual: 2 }] }),
            stderr: "",
            timed_out: false,
            output_truncated: false,
          }
        },
      },
    })
    const result = await runner.execute({
      language: "python",
      code: "def solve(x): return x + 1",
      test_suite_id: "TS-1",
      test_suite: {
        test_suite_id: "TS-1",
        execution_contract: {
          language: "python",
          execution_mode: "function",
          entry_point: "solve",
          allowed_imports: [],
          input_contract: { type: "any", constraints: [] },
          output_contract: { type: "any", constraints: [] },
          resource_limits: { timeout_ms: 1000, memory_mb: 64, max_output_bytes: 4096 },
        },
        tests: [{ test_id: "H1", objective_id: "OBJ-1", weight: 1, input: { args: [1], kwargs: {} }, expected: 3, comparison: { kind: "exact" } }],
      },
      timeout_ms: 1000,
      memory_mb: 64,
      max_output_bytes: 4096,
      network_allowed: false,
    })
    expect(result.failure_codes[0]).toContain("assertion_failed:expected=")
    expect(result.failure_codes[0]).toContain(":actual=")
  })
})
