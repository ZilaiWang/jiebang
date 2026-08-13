import { describe, expect, test } from "bun:test"
import { referenceFailureShape } from "../src/role-c-content/providers/model-backed-provider"

describe("code lab failure kind diagnostics include raw shape", () => {
  test("reports sanitized structural shapes", () => {
    expect(referenceFailureShape("H1:static:dynamic_execution")).toBe("static_dynamic_execution")
    expect(referenceFailureShape("static:dynamic_execution")).toBe("static_dynamic_execution")
    expect(referenceFailureShape("H1:output_limit")).toBe("output_limit")
    expect(referenceFailureShape("unknown_failure")).toBe("other")
  })
})
