import { describe, expect, test } from "bun:test"
import { classifyPublicSecureLeak } from "../src/role-c-content/validators/public-secure-leak-validator"

const basePublic: any = {
  lab_id: "LAB-1",
  title: "返回基础类型说明",
  objective_ids: ["OBJ-K003"],
  execution_contract: { language: "python", execution_mode: "function", entry_point: "identity_text", allowed_imports: [], input_contract: { type: "str", constraints: [] }, output_contract: { type: "str", constraints: ["返回字符串结果"] }, resource_limits: { timeout_ms: 1000, memory_mb: 64, max_output_bytes: 1000 } },
  starter_code: "def identity_text(value):\n    # TODO\n    pass",
  instructions: [{ block_id: "B1", block_type: "paragraph", text: "函数应返回字符串结果，例如处理文本时保持原样。", claims: [] }],
  public_tests: [{ test_id: "P1", objective_id: "OBJ-K003", input: { args: ["sample"], kwargs: {} }, expected_behavior: "返回传入的文本", citations: [] }],
  hint_ladders: [], reflection_questions: [], used_evidence: [], objective_coverage: []
}

const baseSecure: any = {
  lab_id: "LAB-1",
  test_suite_id: "TS-1",
  execution_contract: basePublic.execution_contract,
  reference_solution: "def identity_text(value):\n    return value",
  hidden_tests: [{ test_id: "H1", objective_id: "OBJ-K003", weight: 1, input: { args: ["hidden_value"], kwargs: {} }, expected: "hidden_value", comparison: { kind: "exact" } }],
  scoring_groups: [], misconception_map: [], mutation_variants: [], objective_coverage: []
}

describe("code lab expected leak precision", () => {
  test("does not reject generic expected-behavior prose as hidden expected leak", () => {
    const issues = classifyPublicSecureLeak({ public_payload: basePublic, secure_payload: baseSecure, execution_mode: "function" })
    expect(issues.map((issue) => issue.code)).not.toContain("hidden_test_expected_leak")
  })
})
