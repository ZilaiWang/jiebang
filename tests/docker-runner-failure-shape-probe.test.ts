import { describe, expect, test } from "bun:test"
import { DockerPythonCodeRunner } from "../src/role-c-content/security/code-runner"

describe("docker runner failure code shape probe", () => {
  test("returns assertion diff on mismatched returned values", async () => {
    const runner = new DockerPythonCodeRunner({
      image_id: "sha256:" + "a".repeat(64),
      executor: {
        async run() {
          return {
            exit_code: 0,
            stdout: JSON.stringify({ status: "completed", results: [{ outcome: "returned", actual: { ok: false } }] }),
            stderr: "",
            timed_out: false,
            output_truncated: false,
          }
        },
      },
    })
    const result = await runner.execute({
      language: "python",
      code: "def solve(x): return {'ok': True}",
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
        tests: [{ test_id: "H1", objective_id: "OBJ-1", weight: 1, input: { args: [1], kwargs: {} }, expected: { ok: true }, comparison: { kind: "exact" } }],
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
