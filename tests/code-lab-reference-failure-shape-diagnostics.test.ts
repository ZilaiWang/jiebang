import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

describe("code lab failure kind diagnostics include raw shape", () => {
  test("progress diagnostics expose sanitized raw-code shape", () => {
    const source = readFileSync("src/role-c-content/providers/model-backed-provider.ts", "utf8")
    expect(source).toContain("reference_failure_shapes=")
    expect(source).toContain('rest.startsWith("static:")')
    expect(source).toContain('static_${rest.slice("static:".length)')
  })
})
