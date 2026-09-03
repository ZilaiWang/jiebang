import { expect, test } from "bun:test"
import { applyPublicFileFixtures, executePublicLabInputs, publicLabInputCases } from "../src/role-c-content/security/public-lab-inputs"
import type { CodeLabPublicPayload } from "../src/role-c-content/contracts/artifacts"

const payload = {
  lab_id: "LAB", objective_ids: ["O1"],
  execution_contract: { language: "python", execution_mode: "function", allowed_imports: [], resource_limits: { timeout_ms: 1000, memory_mb: 64, max_output_bytes: 1000 } },
  public_tests: [{ test_id: "P1", input: { args: ["data.txt"], kwargs: {} } }],
  programming_task: { public_examples: [{ case_id: "P1", input: { args: ["data.txt"], kwargs: {} } }, { case_id: "P2", input: { args: ["empty.txt"], kwargs: {} } }] },
} as unknown as CodeLabPublicPayload

test("public fixture patch keeps invocation args and both public representations consistent", () => {
  const patched = applyPublicFileFixtures(payload, [{ case_id: "P1", files: { "data.txt": "original" } }, { case_id: "P2", files: { "empty.txt": "" } }])
  expect(publicLabInputCases(patched)).toHaveLength(2)
  expect(patched.public_tests[0]!.input).toEqual(patched.programming_task!.public_examples[0]!.input)
  expect(patched.public_tests[0]!.input).toEqual({ args: ["data.txt"], kwargs: {}, files: { "data.txt": "original" } })
  expect((payload.public_tests[0]!.input as any).files).toBeUndefined()
  expect(() => applyPublicFileFixtures(patched, [{ case_id: "P1", files: { "data.txt": "different" } }, { case_id: "P2", files: {} }])).toThrow("existing_content_changed")
  expect(() => applyPublicFileFixtures(payload, [{ case_id: "unknown", files: {} }])).toThrow("case_mismatch")
})

test("probe executes every unique public case and reports actual reference failure", async () => {
  const result = await executePublicLabInputs({ runner_image_digest: "test", execute: async request => {
    expect(request.derive_expected).toBe(true)
    expect(request.test_suite!.tests.map(t => t.test_id)).toEqual(["P1", "P2"])
    return { status: "failed", passed_tests: 0, total_tests: 2, score_ratio: 0, failure_codes: ["P1:runtime_FileNotFoundError"], runner_image_digest: "test" }
  } }, payload, "def solve(path): return open(path).read()")
  expect(result.status).toBe("failed")
  expect(result.failure_codes).toContain("P1:runtime_FileNotFoundError")
})
