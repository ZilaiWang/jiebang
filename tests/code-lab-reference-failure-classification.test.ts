import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

describe("code lab reference failure classification", () => {
  test("emits only failure kinds in progress diagnostics", () => {
    const source = readFileSync("src/role-c-content/providers/model-backed-provider.ts", "utf8")
    expect(source).toContain("reference_failure_kinds=")
    expect(source).toContain("function referenceFailureKind")
    expect(source).toContain('reason.startsWith("static:")')
    expect(source).toContain('return "static_policy"')
  })
})
