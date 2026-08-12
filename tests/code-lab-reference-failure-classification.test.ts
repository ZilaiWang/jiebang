import { describe, expect, test } from "bun:test"
import {
  referenceFailureKind,
  referenceFailureShape,
} from "../src/role-c-content/providers/model-backed-provider"

describe("code lab reference failure classification", () => {
  test("classifies per-test harness outcomes without exposing values", () => {
    expect(referenceFailureKind("H1:assertion_failed:expected=10:actual=11")).toBe("assertion_failed")
    expect(referenceFailureShape("H1:assertion_failed:expected=10:actual=11")).toBe("assertion_diff")
    expect(referenceFailureKind("H1:runtime_TypeError")).toBe("runtime_error")
    expect(referenceFailureKind("H1:syntax_error")).toBe("syntax_error")
    expect(referenceFailureKind("H1:static_policy")).toBe("static_policy")
    expect(referenceFailureShape("H1:static_policy")).toBe("static_policy")
  })

  test("classifies top-level Docker outcomes that have no test id prefix", () => {
    expect(referenceFailureKind("execution_timeout")).toBe("timeout")
    expect(referenceFailureShape("execution_timeout")).toBe("timeout")
    expect(referenceFailureKind("resource_limit_exceeded")).toBe("resource_limit")
    expect(referenceFailureKind("docker_container_failed")).toBe("runner_error")
    expect(referenceFailureKind("invalid_runner_json")).toBe("runner_error")
  })
})
