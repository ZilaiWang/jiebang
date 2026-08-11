import { describe, expect, test } from "bun:test"
import { analyzePythonSource } from "../src/role-c-content/security/python-static-analyzer"
import { validatePublicArtifactNoSecrets } from "../src/role-c-content/validators/public-secure-leak-validator"

const contract = {
  language: "python" as const,
  execution_mode: "function" as const,
  entry_point: "solve",
  allowed_imports: [],
  input_contract: { type: "any", constraints: [] },
  output_contract: { type: "object", kind: "object" as const, constraints: [] },
  resource_limits: { timeout_ms: 1000, memory_mb: 64, max_output_bytes: 4096 },
}

describe("Role C adversarial security boundaries", () => {
  test.each([
    ['builtins subscript import', 'def solve(x):\n    return __builtins__["__import__"]("inspect")'],
    ['builtins getattr import', 'def solve(x):\n    return __builtins__.__getitem__("__import__")("inspect")'],
    ['frame back reference', 'def solve(x):\n    return x.f_back'],
    ['frame locals reference', 'def solve(x):\n    return x.f_locals'],
    ['generator frame reference', 'def solve(x):\n    return x.gi_frame'],
    ['class hierarchy reflection', 'def solve(x):\n    return x.__class__.__subclasses__()'],
  ])("blocks %s", (_name, source) => {
    expect(analyzePythonSource(source, contract).length).toBeGreaterThan(0)
  })

  test("does not disable forbidden-key scanning below public input", () => {
    const report = validatePublicArtifactNoSecrets({
      public_tests: [{
        input: {
          answer_spec: { target: 42 },
          hidden_tests: [{ expected: "SECRET" }],
          nested: { reference_solution: "return 42" },
        },
      }],
    })
    expect(report.issues.map((issue) => issue.code)).toContain("public_secure_leak")
    expect(report.issues.map((issue) => issue.path)).toContain("$.public_tests[0].input.answer_spec")
  })
})
