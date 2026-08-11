import { describe, expect, test } from "bun:test"
import { CODE_LAB_SECURE_STAGE_SYSTEM_PROMPT } from "../src/role-c-content/prompts/code-lab/secure-stage.prompt"
import {
  validateExecutionContractResultSemantics,
  validateHiddenTestComparisonCompatibility,
  validateHiddenTestExpectedAgainstOutputContract,
} from "../src/role-c-content/validators/code-lab-validator"

describe("Role C code-lab hidden-test comparison contract", () => {
  test("rejects numeric comparison for non-numeric expected values before Docker", () => {
    expect(validateHiddenTestComparisonCompatibility({ kind: "numeric", abs_tolerance: 1e-9, rel_tolerance: 1e-9 }, { average: 80 }).join(" ")).toContain("numeric 比较只允许有限数值 expected")
    expect(validateHiddenTestComparisonCompatibility({ kind: "numeric", abs_tolerance: 1e-9, rel_tolerance: 1e-9 }, [1, 2]).join(" ")).toContain("numeric 比较只允许有限数值 expected")
    expect(validateHiddenTestComparisonCompatibility({ kind: "numeric", abs_tolerance: 1e-9, rel_tolerance: 1e-9 }, 80)).toEqual([])
    expect(validateHiddenTestComparisonCompatibility({ kind: "exact" }, { average: 80 })).toEqual([])
  })

  test("instructs the model to choose comparison from the frozen output contract", () => {
    expect(CODE_LAB_SECURE_STAGE_SYSTEM_PROMPT).toContain("数值返回值使用 numeric")
    expect(CODE_LAB_SECURE_STAGE_SYSTEM_PROMPT).toContain("对象、数组、字符串或布尔返回值使用 exact")
    expect(CODE_LAB_SECURE_STAGE_SYSTEM_PROMPT).not.toContain("expected：函数返回值的具体数值")
  })

  test("rejects function/stdout contradictions and expected type mismatches before Docker", () => {
    expect(validateExecutionContractResultSemantics({
      language: "python",
      execution_mode: "function",
      entry_point: "solve",
      allowed_imports: [],
      input_contract: { type: "list", constraints: [] },
      output_contract: { type: "stdout text" },
      resource_limits: { timeout_ms: 1000, memory_mb: 64, max_output_bytes: 4096 },
    }).join(" ")).toContain("function 模式只校验入口函数返回值")
    expect(validateHiddenTestExpectedAgainstOutputContract({ type: "stdout text" }, { average: 80 }).join(" ")).toContain("stdout text 只允许字符串 expected")
    expect(validateHiddenTestExpectedAgainstOutputContract({ type: "number" }, 80)).toEqual([])
    expect(validateHiddenTestExpectedAgainstOutputContract({ type: "list" }, [1, 2])).toEqual([])
    expect(validateHiddenTestExpectedAgainstOutputContract({ type: "object" }, { average: 80 })).toEqual([])
  })
})
