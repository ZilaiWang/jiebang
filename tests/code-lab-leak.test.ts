import { describe, expect, test } from "bun:test"
import {
  classifyPublicSecureLeak,
  validateCodeLabPublicSecureSeparation,
} from "../src/role-c-content/validators/public-secure-leak-validator"

// 原 code-lab-expected-leak-precision / code-lab-input-leak-precision /
// code-lab-secure-input-leak-precision / code-lab-empty-envelope-no-leak 合并而来。
// 主题：公开/私有泄漏检测的精度（不漏判、不误杀）。

describe("code lab expected leak precision", () => {
  const basePublic: any = {
    lab_id: "LAB-1",
    title: "返回基础类型说明",
    objective_ids: ["OBJ-K003"],
    execution_contract: { language: "python", execution_mode: "function", entry_point: "identity_text", allowed_imports: [], input_contract: { type: "str", constraints: [] }, output_contract: { type: "str", constraints: ["返回字符串结果"] }, resource_limits: { timeout_ms: 1000, memory_mb: 64, max_output_bytes: 1000 } },
    starter_code: "def identity_text(value):\n    # TODO\n    pass",
    instructions: [{ block_id: "B1", block_type: "paragraph", text: "函数应返回字符串结果，例如处理文本时保持原样。", claims: [] }],
    public_tests: [{ test_id: "P1", objective_id: "OBJ-K003", input: { args: ["sample"], kwargs: {} }, expected_behavior: "返回传入的文本", citations: [] }],
    hint_ladders: [], reflection_questions: [], used_evidence: [], objective_coverage: [],
  }

  const baseSecure: any = {
    lab_id: "LAB-1",
    test_suite_id: "TS-1",
    execution_contract: basePublic.execution_contract,
    reference_solution: "def identity_text(value):\n    return value",
    hidden_tests: [{ test_id: "H1", objective_id: "OBJ-K003", weight: 1, input: { args: ["hidden_value"], kwargs: {} }, expected: "hidden_value", comparison: { kind: "exact" } }],
    scoring_groups: [], misconception_map: [], mutation_variants: [], objective_coverage: [],
  }

  test("不把通用的 expected-behavior 文案误判为隐藏答案泄漏", () => {
    const issues = classifyPublicSecureLeak({ public_payload: basePublic, secure_payload: baseSecure, execution_mode: "function" })
    expect(issues.map((issue) => issue.code)).not.toContain("hidden_test_expected_leak")
  })
})

describe("code lab input leak precision", () => {
  const base = {
    title: "lab", starter_code: "def solve(value):\n    pass", instructions: [], hint_ladders: [], reflection_questions: [],
    public_tests: [{ test_id: "P1", objective_id: "O1", description: "value 10 is an example", expected_behavior: "returns result", input: { args: [10], kwargs: {} }, citations: [] }],
  }
  const secure = (input: any) => ({
    lab_id: "L", test_suite_id: "S", reference_solution: "def solve(value):\n    return value + 1", mutation_variants: [], scoring_groups: [], misconception_map: [], objective_coverage: [],
    hidden_tests: [{ test_id: "H1", objective_id: "O1", weight: 1, input, expected: 11, comparison: { kind: "numeric" } }],
  })

  test("不把仅在文案里提到的数值当作隐藏输入泄漏", () => {
    const issues = classifyPublicSecureLeak({ public_payload: base as any, secure_payload: secure({ args: [11], kwargs: {} }) as any, execution_mode: "function" })
    expect(issues.some((issue: any) => issue.code === "hidden_test_input_leak")).toBe(false)
  })

  test("仍能捕获与公开测试完全相同的隐藏输入复用", () => {
    const issues = classifyPublicSecureLeak({ public_payload: base as any, secure_payload: secure({ args: [10], kwargs: {} }) as any, execution_mode: "function" })
    expect(issues.some((issue: any) => issue.code === "hidden_test_input_leak")).toBe(true)
  })
})

describe("code lab secure function input leak precision", () => {
  test("不把空 args 的合法调用封装误判为输入泄漏", () => {
    const result = classifyPublicSecureLeak({
      public_payload: {
        title: "zero arg lab", starter_code: "def solve():\n    pass", instructions: [], hint_ladders: [], reflection_questions: [],
        public_tests: [{ test_id: "P1", objective_id: "O1", description: "call solve", expected_behavior: "returns ok", input: { args: [], kwargs: {} }, citations: [] }],
      },
      secure_payload: {
        lab_id: "L", test_suite_id: "S", reference_solution: "def solve():\n    return 'ok'", mutation_variants: [], scoring_groups: [], misconception_map: [], objective_coverage: [],
        hidden_tests: [{ test_id: "H1", objective_id: "O1", weight: 1, input: { args: [], kwargs: {} }, expected: "ok", comparison: { kind: "exact" } }],
      },
      execution_mode: "function",
    } as any)
    expect(result.some((issue: any) => issue.code === "hidden_test_input_leak")).toBe(false)
  })
})

describe("empty function invocation is protocol, not hidden input", () => {
  test("允许零参数实验的公开与隐藏空 args 封装", () => {
    const publicPayload: any = {
      lab_id: "L", title: "zero args", objective_ids: ["O"], instructions: [],
      execution_contract: { execution_mode: "function", entry_point: "describe_python" },
      starter_code: "def describe_python():\n    raise NotImplementedError()",
      public_tests: [{ test_id: "P", objective_id: "O", description: "调用函数", input: { args: [], kwargs: {} }, expected_behavior: "返回描述", citations: [] }],
      hint_ladders: [], reflection_questions: [], objective_coverage: [], used_evidence: [],
    }
    const securePayload: any = {
      lab_id: "L", test_suite_id: "TS", execution_contract: publicPayload.execution_contract,
      reference_solution: "def describe_python():\n    return 'Python 是通用编程语言'",
      hidden_tests: [{ test_id: "H", objective_id: "O", input: { args: [], kwargs: {} }, expected: "Python 是通用编程语言", weight: 1, comparison: { kind: "exact" } }],
      scoring_groups: [], misconception_map: [], mutation_variants: [],
    }
    expect(validateCodeLabPublicSecureSeparation(publicPayload, securePayload).issues.map((x) => x.code)).not.toContain("hidden_test_input_leak")
  })
})

describe("空 stdin 输入（无输入任务）不触发泄漏", () => {
  function stdinLab(publicInput: string, hiddenInput: string) {
    const execution_contract = { execution_mode: "stdin_stdout" as const }
    const publicPayload: any = {
      lab_id: "L", title: "纯输出", objective_ids: ["O"], instructions: [],
      execution_contract,
      starter_code: 'print("Hello")\n',
      public_tests: [{ test_id: "P", objective_id: "O", description: "输出问候", input: publicInput, expected_behavior: "输出 Hello", citations: [] }],
      hint_ladders: [], reflection_questions: [], objective_coverage: [], used_evidence: [],
    }
    const securePayload: any = {
      lab_id: "L", test_suite_id: "TS", execution_contract,
      reference_solution: 'print("Hello")\n',
      hidden_tests: [{ test_id: "H", objective_id: "O", input: hiddenInput, expected: "Hello\n", weight: 1, comparison: { kind: "exact" } }],
      scoring_groups: [], misconception_map: [], mutation_variants: [], objective_coverage: [],
    }
    return { publicPayload, securePayload }
  }

  test("public 和 hidden 的 input 都是空串时，不判为 hidden_test_input_leak", () => {
    const { publicPayload, securePayload } = stdinLab("", "")
    const issues = classifyPublicSecureLeak({ public_payload: publicPayload, secure_payload: securePayload, execution_mode: "stdin_stdout" })
    expect(issues.map((i) => i.code)).not.toContain("hidden_test_input_leak")
  })

  test("非空且完全相同的 input 仍被正确拦截（豁免不过度放宽）", () => {
    const { publicPayload, securePayload } = stdinLab("小明\n", "小明\n")
    const issues = classifyPublicSecureLeak({ public_payload: publicPayload, secure_payload: securePayload, execution_mode: "stdin_stdout" })
    expect(issues.map((i) => i.code)).toContain("hidden_test_input_leak")
  })
})
