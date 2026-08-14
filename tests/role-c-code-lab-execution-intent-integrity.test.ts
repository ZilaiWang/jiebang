import { describe, expect, test } from "bun:test"
import { normalizeCodeLabPublicAuthorPayload } from "../src/role-c-content/providers/model-backed-provider"
import { CODE_LAB_PUBLIC_STAGE_SYSTEM_PROMPT } from "../src/role-c-content/prompts/code-lab/public-stage.prompt"
import {
  validateCodeLabPublicAuthorAgainstPlan,
  type CodeLabObjectivePlan,
  type CodeLabPublicAuthorPayload,
} from "../src/role-c-content/providers/staged-generation"

describe("Role C code-lab execution intent integrity", () => {
  test("authors one execution mode consistently from the evidence", () => {
    expect(CODE_LAB_PUBLIC_STAGE_SYSTEM_PROMPT).toContain("先依据当前 facts 决定唯一执行方式")
    expect(CODE_LAB_PUBLIC_STAGE_SYSTEM_PROMPT).toContain("stdin_stdout 模式：提供完整程序骨架")
    expect(CODE_LAB_PUBLIC_STAGE_SYSTEM_PROMPT).toContain("不得出现 def、entry_point、return 或“返回值”语义")
    expect(CODE_LAB_PUBLIC_STAGE_SYSTEM_PROMPT).toContain("使用不带提示参数的 input()")
    expect(CODE_LAB_PUBLIC_STAGE_SYSTEM_PROMPT).toContain("不能只描述其中一部分")
  })

  test("does not silently change a function task into stdin/stdout", () => {
    const payload: CodeLabPublicAuthorPayload = {
      title: "问候函数",
      execution_contract: {
        language: "python",
        execution_mode: "function",
        entry_point: "greet",
        input_contract: { type: "function arguments", constraints: [] },
        output_contract: { type: "string", constraints: [] },
        allowed_imports: [],
        resource_limits: { timeout_ms: 1000, memory_mb: 64, max_output_bytes: 4096 },
      },
      starter_code: 'def greet(name):\n    raise NotImplementedError("TODO")\n',
      objectives: [{
        instruction_text: "编写函数 greet，并使用 print 输出问候语。",
        public_test: {
          description: "调用问候函数",
          input: { args: ["小明"], kwargs: {} },
          expected_behavior: "函数返回问候字符串",
        },
        hints: ["明确输入", "组织结果", "返回结果"],
        reflection_question: "返回值是否符合要求？",
      }],
    }
    const plan: CodeLabObjectivePlan[] = [{
      objective_id: "OBJ-1",
      source_id: "K004",
      instruction_block_id: "BLOCK-1",
      public_test_id: "TEST-1",
      citations: [{ source_id: "K004", fact_id: "F001", relation: "derived_from" }],
    }]

    const normalized = normalizeCodeLabPublicAuthorPayload(payload)

    expect(normalized.execution_contract.execution_mode).toBe("function")
    expect(validateCodeLabPublicAuthorAgainstPlan(normalized, plan)).toContain(
      "FUNCTION_OUTPUT_CONTRACT_MISMATCH: execution_contract 的 function 模式只校验入口函数返回值；请改为可 JSON 序列化的返回值，或将纯打印任务改为 stdin_stdout 模式",
    )
  })
})
