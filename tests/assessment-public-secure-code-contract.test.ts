import { describe, expect, test } from "bun:test"
import { validateAssessmentPublicSecureCodeContract } from "../src/role-c-content/validators/assessment-validator"

describe("assessment public/secure code contract", () => {
  test("rejects secure stdin input when public fixed-variable task never disclosed input ownership", () => {
    const issues = validateAssessmentPublicSecureCodeContract({
      objective_id: "OBJ-K006",
      modality: "code",
      prompt: "补全 if/elif/else，根据 temperature 输出建议。",
      starter_code: "temperature = 28\n# 补全条件分支\n",
    } as any, {
      execution_contract: { execution_mode: "stdin_stdout", input_contract: { type: "stdin text", constraints: [] }, output_contract: { type: "stdout text", constraints: [] }, allowed_imports: [], resource_limits: { timeout_ms: 1000, memory_mb: 64, max_output_bytes: 4096 } },
      reference_solution: "temperature = int(input())\nif temperature >= 30:\n print('穿短袖')",
      hidden_tests: [{ input: "35\n", expected: "穿短袖\n", objective_id: "OBJ-K006", weight: 1 }],
    } as any)
    expect(issues.map((issue) => issue.code)).toContain("public_secure_code_contract_mismatch")
  })

  test("allows stdin when public starter provides the complete input plumbing", () => {
    expect(validateAssessmentPublicSecureCodeContract({
      objective_id: "OBJ-K006", modality: "code", prompt: "只补全条件分支。", starter_code: "temperature = int(input())\n# 补全条件分支\n",
    } as any, {
      execution_contract: { execution_mode: "stdin_stdout" }, reference_solution: "temperature = int(input())\nif temperature >= 30:\n print('穿短袖')", hidden_tests: [],
    } as any)).toEqual([])
  })
})
