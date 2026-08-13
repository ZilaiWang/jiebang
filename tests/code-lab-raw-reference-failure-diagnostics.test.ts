import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

describe("code lab execution repair gets raw trusted failure codes", () => {
  test("passes reference failure codes into repair diagnostics", () => {
    const source = readFileSync("src/role-c-content/providers/model-backed-provider.ts", "utf8")
    const block = source.slice(
      source.indexOf('trusted_execution_report: {'),
      source.indexOf('staged_contract: {', source.indexOf('trusted_execution_report: {')),
    )
    expect(block).toContain("reference_failure_codes")
    expect(block).toContain("reference_failure_raw")
  })
})
