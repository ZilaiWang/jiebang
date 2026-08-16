import { describe, expect, test } from "bun:test"
import {
  deriveCodeLabExecutionMode,
  freezeCodeLabExecutionContract,
  materializeCodeLabPublicAuthorPayload,
  validateCodeLabPublicAuthorAgainstPlan,
  validateCodeLabPublicAgainstPlan,
  type CodeLabObjectivePlan,
  type CodeLabPublicAuthorPayload,
} from "../src/role-c-content/providers/staged-generation"
import type { ExecutionContract } from "../src/role-c-content/contracts/artifacts"

/** 构造最小 CodeLabRequest，只填 deriveCodeLabExecutionMode 需要的字段。 */
function requestFor(title: string, facts: string[], level: string, goal = "") {
  return {
    generation_spec: {
      path_node: { target_source_ids: ["S1"], ...(goal ? { goal } : {}) },
      learner_adaptation: { level },
    },
    evidence_pack: {
      results: [{ source_id: "S1", title, facts: facts.map((content) => ({ source_id: "S1", fact_id: "F1", content })) }],
    },
  } as never
}

describe("deriveCodeLabExecutionMode（execution_mode 确定性推导）", () => {
  test("输入输出主题 → stdin_stdout", () => {
    expect(deriveCodeLabExecutionMode(requestFor(
      "输入输出",
      ["print 用于向屏幕输出内容。", "input 用于读取用户输入并返回字符串。"],
      "beginner",
    ))).toBe("stdin_stdout")
  })

  test("函数定义主题 → function", () => {
    expect(deriveCodeLabExecutionMode(requestFor(
      "函数定义与调用",
      ["def 用于定义函数。", "函数把可复用逻辑封装成命名代码块。"],
      "basic",
    ))).toBe("function")
  })

  test("参数与返回值主题 → function", () => {
    expect(deriveCodeLabExecutionMode(requestFor(
      "参数与返回值",
      ["参数用于把外部数据传入函数。", "return 用于把函数结果返回给调用者。"],
      "basic",
    ))).toBe("function")
  })

  test("中性知识点按学习者水平兜底：beginner → stdin_stdout", () => {
    expect(deriveCodeLabExecutionMode(requestFor("for循环", ["for 用于遍历序列。"], "beginner"))).toBe("stdin_stdout")
  })

  test("中性知识点按学习者水平兜底：intermediate → function", () => {
    expect(deriveCodeLabExecutionMode(requestFor("for循环", ["for 用于遍历序列。"], "intermediate"))).toBe("function")
  })

  test("函数信号优先于 IO 信号（主题同时涉及两者）", () => {
    expect(deriveCodeLabExecutionMode(requestFor(
      "函数封装输入处理",
      ["def 定义函数。", "函数内用 input() 读取用户输入。"],
      "basic",
    ))).toBe("function")
  })

  test("成绩统计器综合项目：facts 提及函数但无 def/return，goal 输出型 → stdin_stdout（死结回归）", () => {
    expect(deriveCodeLabExecutionMode(requestFor(
      "成绩统计器综合项目",
      ["成绩统计项目可综合练习列表、循环和函数。", "成绩列表可以用 for 循环逐项累计求和。", "把统计逻辑封装为函数可提升复用性。"],
      "integrated",
      "用 Python 完成一个成绩统计器综合项目",
    ))).toBe("stdin_stdout")
  })

  test("函数专题：facts 含 def 代码关键字，goal 非输出型 → function", () => {
    expect(deriveCodeLabExecutionMode(requestFor(
      "函数定义与调用",
      ["def 用于定义函数。", "函数把可复用逻辑封装成命名代码块。"],
      "basic",
      "学习函数定义与调用",
    ))).toBe("function")
  })
})

describe("freezeCodeLabExecutionContract（确定性字段冻结）", () => {
  const modelContract: ExecutionContract = {
    language: "python",
    execution_mode: "function",
    entry_point: "main",
    allowed_imports: [],
    input_contract: { type: "函数参数", constraints: ["输入一行文本"] },
    output_contract: { type: "string", constraints: ["输出一行文本"] },
    resource_limits: { timeout_ms: 999999, memory_mb: 9999, max_output_bytes: 1 },
  }

  test("stdin_stdout 冻结：强制 mode、删除 entry_point", () => {
    const frozen = freezeCodeLabExecutionContract(modelContract, "stdin_stdout")
    expect(frozen.execution_mode).toBe("stdin_stdout")
    expect(frozen.language).toBe("python")
    expect(frozen.entry_point).toBeUndefined()
  })

  test("stdin_stdout 冻结：output_contract.kind 确定为 string（避免 expected 类型错配）", () => {
    const frozen = freezeCodeLabExecutionContract(modelContract, "stdin_stdout")
    expect(frozen.output_contract.kind).toBe("string")
  })

  test("function 冻结：保留模型的 entry_point 命名", () => {
    const frozen = freezeCodeLabExecutionContract(modelContract, "function")
    expect(frozen.execution_mode).toBe("function")
    expect(frozen.entry_point).toBe("main")
  })

  test("resource_limits 越界值被钳制到 schema 合法范围", () => {
    const frozen = freezeCodeLabExecutionContract(modelContract, "stdin_stdout")
    expect(frozen.resource_limits.timeout_ms).toBe(5000)
    expect(frozen.resource_limits.memory_mb).toBe(512)
    expect(frozen.resource_limits.max_output_bytes).toBe(256)
  })

  test("保留模型的语义描述（constraints）", () => {
    const frozen = freezeCodeLabExecutionContract(modelContract, "stdin_stdout")
    expect(frozen.input_contract.constraints).toEqual(["输入一行文本"])
    expect(frozen.output_contract.constraints).toEqual(["输出一行文本"])
  })
})

describe("explicitFunctionTask 门禁：教学讲解不被误杀", () => {
  const plan: CodeLabObjectivePlan[] = [{
    objective_id: "OBJ-1", source_id: "K004", instruction_block_id: "B1", public_test_id: "T1", citations: [],
  }]

  function payloadWith(instruction: string): CodeLabPublicAuthorPayload {
    return {
      title: "输入输出",
      execution_contract: {
        language: "python", execution_mode: "stdin_stdout", allowed_imports: [],
        input_contract: { type: "stdin text", constraints: [] },
        output_contract: { type: "stdout text", constraints: [] },
        resource_limits: { timeout_ms: 1000, memory_mb: 64, max_output_bytes: 4096 },
      },
      starter_code: "name = input()\n# TODO\n",
      objectives: [{
        instruction_text: instruction,
        public_test: { description: "输入一行", input: "x\n", expected_behavior: "输出 x" },
        hints: ["h1", "h2", "h3"],
        reflection_question: "r",
      }],
    }
  }

  test("讲解内置函数返回（该函数返回…）不触发门禁", () => {
    const issues = validateCodeLabPublicAuthorAgainstPlan(
      payloadWith("input() 读取用户输入，该函数返回一个字符串。"),
      plan,
    )
    expect(issues.filter((i) => i.includes("STDIN_FUNCTION_CONTRACT_MISMATCH"))).toEqual([])
  })

  test("真正要求提交函数（实现函数…返回）仍被拦截", () => {
    const issues = validateCodeLabPublicAuthorAgainstPlan(
      payloadWith("实现函数 solve，返回计算结果。"),
      plan,
    )
    expect(issues.some((i) => i.includes("STDIN_FUNCTION_CONTRACT_MISMATCH"))).toBe(true)
  })
})

describe("组合一致性：模型写错 mode/entry_point 时，derive+freeze 全链纠正", () => {
  const plan: CodeLabObjectivePlan[] = [{
    objective_id: "OBJ-1", source_id: "K004", instruction_block_id: "B1", public_test_id: "T1",
    citations: [{ source_id: "K004", fact_id: "F002", relation: "derived_from" as const }],
  }]

  /** 构造能走通 materialize 的最小 request（含 targets + facts）。 */
  function requestForMaterialize(title: string, facts: string[], level: string) {
    return {
      generation_spec: {
        spec_id: "SPEC-1",
        path_node: { target_source_ids: ["K004"] },
        learner_adaptation: { level },
        targets: [{
          objective_id: "OBJ-1", source_id: "K004", required_fact_ids: ["F002"],
          observable_behavior: "apply", importance: "core",
        }],
      },
      evidence_pack: {
        results: [{ source_id: "K004", title, facts: facts.map((content, i) => ({ source_id: "K004", fact_id: `F00${i + 2}`, content })) }],
      },
    } as never
  }

  test("模型误写 function+entry_point，freeze 后产物为 stdin_stdout 且无 entry_point 门禁", () => {
    const request = requestForMaterialize("输入输出", ["input 用于读取用户输入并返回字符串。"], "beginner")
    const mode = deriveCodeLabExecutionMode(request)
    expect(mode).toBe("stdin_stdout")

    const author: CodeLabPublicAuthorPayload = {
      title: "输入输出",
      // 模型写错了：选了 function 还误设了 entry_point
      execution_contract: {
        language: "python", execution_mode: "function", entry_point: "main", allowed_imports: [],
        input_contract: { type: "string", constraints: ["输入为一行文本"] },
        output_contract: { type: "string", constraints: ["输出为一行文本"] },
        resource_limits: { timeout_ms: 999999, memory_mb: 9999, max_output_bytes: 1 },
      },
      starter_code: "name = input()\nprint(name)", // starter 本身是正确 stdin_stdout 风格
      objectives: [{
        instruction_text: "读取一行用户输入并原样输出。",
        public_test: { description: "输入一行", input: "小明\n", expected_behavior: "输出小明" },
        hints: ["h1", "h2", "h3"],
        reflection_question: "r",
      }],
    }

    author.execution_contract = freezeCodeLabExecutionContract(author.execution_contract, mode)
    const materialized = materializeCodeLabPublicAuthorPayload(request, author, "LAB-1", plan)

    expect(materialized.execution_contract.execution_mode).toBe("stdin_stdout")
    expect(materialized.execution_contract.entry_point).toBeUndefined()

    const issues = validateCodeLabPublicAgainstPlan(materialized, plan)
    expect(issues.filter((i) => i.includes("entry_point"))).toEqual([])
  })
})
