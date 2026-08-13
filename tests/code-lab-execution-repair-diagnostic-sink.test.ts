import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

describe("code lab execution repair diagnostics", () => {
  test("persists sanitized issue codes for execution-repair validation", () => {
    const source = readFileSync("src/role-c-content/providers/model-backed-provider.ts", "utf8")
    const start = source.indexOf('task: "role-c.code-lab.secure.execution-repair"')
    const end = source.indexOf("const normalizedRepairPatch", start)
    expect(source.slice(start, end)).toContain("diagnostic_sink: this.stageFailureDiagnosticSink")
  })
})
