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

  test("function 公开样例在公开阶段就必须匹配 starter 的真实参数签名", () => {
    const payload: CodeLabPublicAuthorPayload = {
      title: "日志汇总函数",
      execution_contract: {
        language: "python",
        execution_mode: "function",
        entry_point: "solve",
        input_contract: { type: "function arguments", constraints: ["传入一个日志列表"] },
        output_contract: { type: "string", constraints: [] },
        allowed_imports: [],
        resource_limits: { timeout_ms: 1000, memory_mb: 64, max_output_bytes: 4096 },
      },
      starter_code: 'def solve(logs):\n    raise NotImplementedError("TODO")\n',
      objectives: [{
        instruction_text: "实现 solve(logs) 并返回汇总结果。",
        public_test: {
          description: "传入一组日志",
          input: { args: [["ok", "warn"]], kwargs: {} },
          expected_behavior: "返回汇总文本",
        },
        hints: ["观察 logs", "遍历列表", "返回文本"],
        reflection_question: "参数是一条日志还是日志列表？",
      }],
      programming_task: {
        statement: "实现日志汇总。",
        input_description: "一个日志列表。",
        output_description: "汇总文本。",
        constraints: ["不得读取 stdin", "必须返回结果"],
        additional_public_examples: [{
          description: "遗漏必填参数的错误样例",
          input: { args: [], kwargs: {} },
          expected_behavior: "返回空汇总",
        }],
      },
    }
    const plan: CodeLabObjectivePlan[] = [{
      objective_id: "OBJ-1",
      source_id: "K009",
      instruction_block_id: "BLOCK-1",
      public_test_id: "TEST-1",
      citations: [],
    }]

    expect(validateCodeLabPublicAuthorAgainstPlan(payload, plan)).toContain(
      "公开测试 2：solve 至少需要 1 个必填参数，当前调用未完整提供",
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

    expect(validateCodeLabPublicAuthorAgainstPlan(payload, plan).some((issue) =>
      issue.includes("STDIN_FUNCTION_CONTRACT_MISMATCH")
      && issue.includes("函数作为外部提交接口"),
    )).toBe(true)
  })

  test("stdin/stdout 完整程序允许使用辅助函数组织逻辑", () => {
    const payload: CodeLabPublicAuthorPayload = {
      title: "成绩统计程序",
      execution_contract: {
        language: "python",
        execution_mode: "stdin_stdout",
        input_contract: { type: "stdin text", constraints: ["第一行为数量"] },
        output_contract: { type: "stdout text", constraints: ["输出平均分"] },
        allowed_imports: [],
        resource_limits: { timeout_ms: 1000, memory_mb: 64, max_output_bytes: 4096 },
      },
      starter_code: "def average(scores):\n    # TODO\n    return 0\n\nn = int(input())\nscores = list(map(int, input().split()))\nprint(average(scores))\n",
      objectives: [{
        instruction_text: "编写完整程序，从标准输入读取成绩；可定义 average 辅助函数计算平均分，最后打印结果。",
        public_test: {
          description: "输入三个成绩",
          input: "3\n80 90 100\n",
          expected_behavior: "标准输出为 90",
        },
        hints: ["读取输入", "在辅助函数中计算", "使用 print 输出"],
        reflection_question: "判题器比较的是返回值还是标准输出？",
      }],
    }
    const plan: CodeLabObjectivePlan[] = [{
      objective_id: "OBJ-1",
      source_id: "K018",
      instruction_block_id: "BLOCK-1",
      public_test_id: "TEST-1",
      citations: [{ source_id: "K018", fact_id: "F001", relation: "derived_from" }],
    }]

    expect(validateCodeLabPublicAuthorAgainstPlan(payload, plan)).toEqual([])
  })
})
