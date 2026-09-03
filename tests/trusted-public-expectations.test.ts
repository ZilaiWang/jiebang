import { describe, expect, test } from "bun:test"
import type { CodeLabPublicPayload } from "../src/role-c-content/contracts/artifacts"
import { materializeTrustedPublicExpectations } from "../src/role-c-content/security/public-lab-inputs"

function payload(): CodeLabPublicPayload {
  const stale = "返回 {'categories': ['warning', 'normal'], 'sample': 'ERROR'}"
  return {
    lab_id: "LAB-1",
    title: "日志分类",
    objective_ids: ["OBJ-1"],
    instructions: [{ block_id: "B-1", block_type: "paragraph", text: `先比较：${stale}`, claims: [] }],
    execution_contract: {
      language: "python", execution_mode: "function", entry_point: "solve", allowed_imports: [],
      input_contract: { type: "function_arguments", constraints: [] },
      output_contract: { kind: "object", type: "return_value", constraints: [] },
      resource_limits: { timeout_ms: 2_000, memory_mb: 128, max_output_bytes: 32_768 },
    },
    starter_code: "def solve(levels, index):\n    return {}",
    public_tests: [{
      test_id: "CASE-1", objective_id: "OBJ-1", description: "分类全部日志",
      input: { args: [["ERROR", "WARN", "INFO"], 0], kwargs: {} },
      expected_behavior: stale, citations: [],
    }],
    hint_ladders: [{ objective_id: "OBJ-1", hints: [
      { hint_level: 1, text: stale, citations: [] },
      { hint_level: 2, text: "检查循环", citations: [] },
      { hint_level: 3, text: "检查分支", citations: [] },
    ] }],
    reflection_questions: [stale],
    programming_task: {
      schema_version: "programming-task.v1", task_id: "TASK-1", blueprint_id: "BP-1",
      task_kind: "debugging_repair", submission_mode: "full_code", statement: "修复分类器",
      input_description: "输入日志", output_description: "返回分类", constraints: [],
      starter_code: "def solve(levels, index):\n    return {}",
      public_examples: [{ case_id: "CASE-1", description: "分类全部日志", input: { args: [["ERROR", "WARN", "INFO"], 0], kwargs: {} }, expected_behavior: stale }],
      hint_ladders: [{ level: 1, text: stale }],
    },
    practical_guide: {
      schema_version: "practical-guide.v1", guide_id: "G-1", plan_id: "GP-1", lab_id: "LAB-1",
      practice_goal: "修复分类器", deliverable: "代码", estimated_minutes: 20,
      environment: { language: "python", execution_mode: "function", entry_point: "solve", input_type: "function_arguments", output_type: "return_value", allowed_imports: [], tool_constraints: [] },
      readiness_checks: [], steps: [],
      acceptance_criteria: [{ criterion_id: "AC-1", public_test_id: "CASE-1", objective_id: "OBJ-1", description: "分类全部日志", expected_behavior: stale }],
      troubleshooting: [],
      extension_task: { slot_id: "S-1", objective_id: "OBJ-1", citations: [], contract_refs: ["public_tests"], public_test_ids: ["CASE-1"], task: "扩展", changed_dimension: "数据", verification: stale },
      used_evidence: [],
    },
    objective_coverage: [{ objective_id: "OBJ-1", instruction_block_ids: ["B-1"], public_test_ids: ["CASE-1"] }],
    used_evidence: [],
  }
}

describe("trusted public expectations", () => {
  test("uses trusted output consistently on every duplicated learner surface", () => {
    const output = { categories: ["critical", "warning", "normal"], sample: "ERROR" }
    const result = materializeTrustedPublicExpectations(payload(), [output])
    const expected = `函数返回值应为：${JSON.stringify(output)}`

    expect(result.public_tests[0]?.expected_behavior).toBe(expected)
    expect(result.programming_task?.public_examples[0]?.expected_behavior).toBe(expected)
    expect(result.practical_guide?.acceptance_criteria[0]?.expected_behavior).toBe(expected)
    expect((result.instructions[0] as { text: string }).text).toContain(expected)
    expect(result.hint_ladders[0]?.hints[0]?.text).toBe(expected)
    expect(result.reflection_questions[0]).toBe(expected)
    expect(result.practical_guide?.extension_task.verification).toBe(expected)
    expect(result.starter_code).toContain("return {}")
  })

  test("fails closed when a public case has no trusted output", () => {
    expect(() => materializeTrustedPublicExpectations(payload(), [])).toThrow(
      "PUBLIC_EXPECTATION_OUTPUT_COUNT_MISMATCH",
    )
  })

  test("does not apply an ambiguous prose replacement across different cases", () => {
    const input = payload()
    const stale = input.public_tests[0]!.expected_behavior
    input.public_tests.push({
      ...structuredClone(input.public_tests[0]!),
      test_id: "CASE-2",
      input: { args: [["INFO"], 0], kwargs: {} },
    })
    input.programming_task!.public_examples.push({
      ...structuredClone(input.programming_task!.public_examples[0]!),
      case_id: "CASE-2",
      input: { args: [["INFO"], 0], kwargs: {} },
    })
    input.practical_guide!.acceptance_criteria.push({
      ...structuredClone(input.practical_guide!.acceptance_criteria[0]!),
      criterion_id: "AC-2",
      public_test_id: "CASE-2",
    })
    const result = materializeTrustedPublicExpectations(input, [
      { categories: ["critical", "warning", "normal"], sample: "ERROR" },
      { categories: ["normal"], sample: "INFO" },
    ])

    expect(result.public_tests[0]!.expected_behavior).not.toBe(stale)
    expect(result.public_tests[1]!.expected_behavior).not.toBe(stale)
    expect(result.public_tests[0]!.expected_behavior).not.toBe(result.public_tests[1]!.expected_behavior)
    expect((result.instructions[0] as { text: string }).text).toContain(stale)
  })
})
