import { describe, expect, test } from "bun:test"
import { normalizeCodeLabPublicAuthorPayload } from "../src/role-c-content/providers/model-backed-provider"
import {
  validateCodeLabPublicAuthorAgainstPlan,
  type CodeLabObjectivePlan,
  type CodeLabPublicAuthorPayload,
} from "../src/role-c-content/providers/staged-generation"

describe("Role C code-lab execution intent integrity", () => {
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

  test("allows an input builtin return-value fact in stdin/stdout teaching text", () => {
    const payload: CodeLabPublicAuthorPayload = {
      title: "输入输出",
      execution_contract: {
        language: "python",
        execution_mode: "stdin_stdout",
        input_contract: { type: "stdin text", constraints: ["一行文本"] },
        output_contract: { type: "stdout text", constraints: ["一行文本"] },
        allowed_imports: [],
        resource_limits: { timeout_ms: 1000, memory_mb: 64, max_output_bytes: 4096 },
      },
      starter_code: "name = input()\n# TODO: 使用 print 输出 name\n",
      objectives: [{
        instruction_text: "读取一行用户输入，再将读取到的内容输出。",
        public_test: {
          description: "输入一行姓名",
          input: "小明\n",
          expected_behavior: "标准输出显示小明",
        },
        hints: [
          "input 用于读取用户输入并返回字符串。",
          "把 input 读取的内容保存起来。",
          "使用 print 向屏幕输出内容。",
        ],
        reflection_question: "input 与 print 在程序中分别负责什么？",
      }],
    }
    const plan: CodeLabObjectivePlan[] = [{
      objective_id: "OBJ-K004",
      source_id: "K004",
      instruction_block_id: "BLOCK-K004",
      public_test_id: "TEST-K004",
      citations: [{ source_id: "K004", fact_id: "F002", relation: "derived_from" }],
    }]

    expect(validateCodeLabPublicAuthorAgainstPlan(payload, plan)).toEqual([])
  })

  test("still rejects a real function assignment in stdin/stdout mode", () => {
    const payload: CodeLabPublicAuthorPayload = {
      title: "冲突的执行合同",
      execution_contract: {
        language: "python",
        execution_mode: "stdin_stdout",
        input_contract: { type: "stdin text", constraints: [] },
        output_contract: { type: "stdout text", constraints: [] },
        allowed_imports: [],
        resource_limits: { timeout_ms: 1000, memory_mb: 64, max_output_bytes: 4096 },
      },
      starter_code: "value = input()\n# TODO\n",
      objectives: [{
        instruction_text: "实现一个 solve 函数并返回处理结果。",
        public_test: {
          description: "调用 solve",
          input: "hello\n",
          expected_behavior: "solve 函数返回结果",
        },
        hints: ["定义函数", "处理参数", "返回结果"],
        reflection_question: "输入输出合同是什么？",
      }],
    }
    const plan: CodeLabObjectivePlan[] = [{
      objective_id: "OBJ-1",
      source_id: "K004",
      instruction_block_id: "BLOCK-1",
      public_test_id: "TEST-1",
      citations: [{ source_id: "K004", fact_id: "F001", relation: "derived_from" }],
    }]

    expect(validateCodeLabPublicAuthorAgainstPlan(payload, plan)).toContain(
      "STDIN_FUNCTION_CONTRACT_MISMATCH: 公开任务要求学习者提交函数，与 stdin_stdout 的完整程序接口冲突：实现一个 solve 函数并返回处理结果。",
    )
  })
})
