import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

describe("code lab execution repair progress diagnostics", () => {
  test("includes trusted reference failure codes when repair patch makes no progress", () => {
    const source = readFileSync("src/role-c-content/providers/model-backed-provider.ts", "utf8")
    const block = source.slice(
      source.indexOf("function validateCodeLabExecutionRepairProgress"),
      source.indexOf("function validateCodeLabExecutionRepairPatch"),
    )
    expect(block).toContain("reference_failure_kinds")
    expect(block).toContain("referenceFailureKind")
  })
})
