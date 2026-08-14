import { describe, expect, test } from "bun:test"
import {
  referenceFailureKind,
  referenceFailureShape,
} from "../src/role-c-content/providers/model-backed-provider"
import {
  expectedOnlyReferenceFailureCodes,
  isExpectedOnlyReferenceFailure,
  patchExpectedFromReferenceFailures,
} from "../src/role-c-content/providers/staged-generation"
import { classifyCodeLabVerificationFailure } from "../src/role-c-content/validators/code-lab-validator"

// 原 code-lab-reference-failure-classification / -code-extraction / -shape-diagnostics /
// code-lab-expected-sync-from-reference / code-lab-empty-envelope-diagnostic 合并而来。
// 主题：可信执行失败码的分类、提取与确定性修复。

describe("code lab reference failure classification", () => {
  test("按 test 级 harness 结果分类且不暴露具体数值", () => {
    expect(referenceFailureKind("H1:assertion_failed:expected=10:actual=11")).toBe("assertion_failed")
    expect(referenceFailureShape("H1:assertion_failed:expected=10:actual=11")).toBe("assertion_diff")
    expect(referenceFailureKind("H1:runtime_TypeError")).toBe("runtime_error")
    expect(referenceFailureKind("H1:syntax_error")).toBe("syntax_error")
    expect(referenceFailureKind("H1:static_policy")).toBe("static_policy")
    expect(referenceFailureShape("H1:static_policy")).toBe("static_policy")
  })

  test("分类无 test id 前缀的 Docker 顶层结果", () => {
    expect(referenceFailureKind("execution_timeout")).toBe("timeout")
    expect(referenceFailureShape("execution_timeout")).toBe("timeout")
    expect(referenceFailureKind("resource_limit_exceeded")).toBe("resource_limit")
    expect(referenceFailureKind("docker_container_failed")).toBe("runner_error")
    expect(referenceFailureKind("invalid_runner_json")).toBe("runner_error")
  })
})

describe("reference failure code extraction", () => {
  test("从可信 verifier 的 prose 里提取断言差异", () => {
    const codes = expectedOnlyReferenceFailureCodes({
      issues: ["reference_solution 未通过全部隐藏测试：H1:assertion_failed:expected=10:actual=11、H2:assertion_failed:expected=\"ok\":actual=[\"ok\",2]"],
    })
    expect(codes).toEqual([
      'H1:assertion_failed:expected=10:actual=11',
      'H2:assertion_failed:expected="ok":actual=["ok",2]',
    ])
  })
})

describe("code lab failure kind diagnostics include raw shape", () => {
  test("报告清洗后的结构形态", () => {
    expect(referenceFailureShape("H1:static:dynamic_execution")).toBe("static_dynamic_execution")
    expect(referenceFailureShape("static:dynamic_execution")).toBe("static_dynamic_execution")
    expect(referenceFailureShape("H1:output_limit")).toBe("output_limit")
    expect(referenceFailureShape("unknown_failure")).toBe("other")
  })
})

describe("expected-only reference failure repair", () => {
  test("识别无需再次调用模型即可修复的可信断言差异", () => {
    expect(isExpectedOnlyReferenceFailure([
      'H1:assertion_failed:expected=10:actual=11',
      'H2:assertion_failed:expected="ok":actual=["ok",2]',
    ])).toBe(true)
    expect(isExpectedOnlyReferenceFailure([
      'H1:runtime_ValueError',
    ])).toBe(false)
  })

  test("用可信实际输出重新同步过期的 expected", () => {
    const secure: any = {
      hidden_tests: [
        { test_id: "H1", expected: 10, comparison: { kind: "numeric", abs_tolerance: 1e-9, rel_tolerance: 1e-9 } },
        { test_id: "H2", expected: "ok", comparison: { kind: "exact" } },
      ],
    }
    const patched = patchExpectedFromReferenceFailures(secure, [
      'H1:assertion_failed:expected=10:actual=11',
      'H2:assertion_failed:expected="ok":actual=["ok",2]',
    ])
    expect(patched.hidden_tests[0].expected).toBe(11)
    expect(patched.hidden_tests[1].expected).toEqual(["ok", 2])
  })
})

describe("empty function invocation diagnostics", () => {
  test("不把空 args 协议封装归类为私有输入泄漏", () => {
    const diagnostic = classifyCodeLabVerificationFailure({
      issues: ["hidden_test_input_leak: empty invocation envelope"],
      public_payload: { public_tests: [{ input: { args: [], kwargs: {} } }] },
      secure_payload: { hidden_tests: [{ input: { args: [], kwargs: {} } }] },
    } as any)
    expect(diagnostic.code).not.toBe("HIDDEN_TEST_INPUT_LEAK")
  })
})
