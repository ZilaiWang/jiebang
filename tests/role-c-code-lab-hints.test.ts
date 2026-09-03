import { describe, expect, test } from "bun:test"
import {
  normalizeCodeLabHintsToEvidence,
  normalizeCodeLabPublicAuthorPayload,
} from "../src/role-c-content/providers/model-backed-provider"
import {
  materializeCodeLabPublicAuthorPayload,
  projectDebuggingRepairPublicGuidance,
  validateCodeLabPublicAuthorAgainstPlan,
  type CodeLabObjectivePlan,
  type CodeLabPublicAuthorPayload,
} from "../src/role-c-content/providers/staged-generation"

const plan: CodeLabObjectivePlan[] = [{
  objective_id: "OBJ-K007",
  source_id: "K007",
  instruction_block_id: "BLOCK-1",
  public_test_id: "TEST-1",
  citations: [{ source_id: "K007", fact_id: "F001", relation: "derived_from" }],
}]

const evidence = {
  results: [{
    source_id: "K007",
    title: "for 循环",
    facts: [{ source_id: "K007", fact_id: "F001", content: "for 循环会依次取出序列中的每个元素。" }],
  }],
} as any

function payload(hints: string[]): CodeLabPublicAuthorPayload {
  return {
    title: "观察 for 循环变量",
    execution_contract: {
      language: "python",
      execution_mode: "stdin_stdout",
      allowed_imports: [],
      input_contract: { type: "none", constraints: [] },
      output_contract: { type: "stdout", constraints: [] },
      resource_limits: { timeout_ms: 1000, memory_mb: 64, max_output_bytes: 4096 },
    },
    starter_code: "fact_text = \"TODO：填写事实\"\nprint(fact_text)\n",
    objectives: [{
      instruction_text: "补全 for 循环事实并运行。",
      public_test: { description: "运行程序", input: "", expected_behavior: "输出 for 循环事实" },
      hints,
      reflection_question: "for 循环每轮取出的对象是什么？",
    }],
  }
}

const recallFactContract = {
  learner_action: "recall_fact" as const,
  learner_owned_region: "fact_literal" as const,
  input_form: "none" as const,
}

describe("code lab content-specific hint ladders", () => {
  test("recall_fact 的旧通用提示由事实绑定物化替换，不再让候选卡死", () => {
    const author = payload([
      "先定位本目标要求表达的核心事实。",
      "确认填写内容保留了事实中的主语、对象和关系。",
      "只替换 TODO 字符串，不改动变量赋值和输出语句。",
    ])
    author.programming_task = {
      statement: "补全事实文本。",
      input_description: "无输入。",
      output_description: "输出事实文本。",
      constraints: ["只填字符串", "保留输出语句"],
      gap_template: {
        schema_version: "code-gap-template.v1",
        template_code: "fact_text = {{gap:fact_text}}\nprint(fact_text)\n",
        gaps: [{
          gap_id: "fact_text",
          label: "事实文本",
          kind: "expression",
          max_chars: 500,
          max_lines: 1,
        }],
      },
      additional_public_examples: [],
    }
    const issues = validateCodeLabPublicAuthorAgainstPlan(payload([
      "先定位本目标要求表达的核心事实。",
      "确认填写内容保留了事实中的主语、对象和关系。",
      "只替换 TODO 字符串，不改动变量赋值和输出语句。",
    ]), plan, recallFactContract, undefined, undefined, evidence)
    expect(issues.some((issue) => issue.includes("通用占位提示"))).toBe(false)
    const materialized = materializeCodeLabPublicAuthorPayload({
      generation_spec: {
        spec_id: "SPEC-1",
        path_node: { goal: "理解 for 循环" },
        targets: [{ objective_id: "OBJ-K007", source_id: "K007" }],
      },
      evidence_pack: evidence,
      resource_blueprint: { code_lab: { task_contract: {
        ...recallFactContract,
        primary_objective_id: "OBJ-K007",
      } } },
    } as any, author, "LAB-1", plan, undefined, {
      blueprint_id: "BP-1",
      task_kind: "code_completion",
      submission_mode: "gap_answers",
    } as any)
    const texts = materialized.hint_ladders[0]?.hints.map((hint) => hint.text) ?? []
    expect(texts).toHaveLength(3)
    expect(texts.join(" ")).toContain("for 循环")
    expect(texts.join(" ")).toContain("完整事实句")
    expect(texts.join(" ")).not.toContain("只替换 TODO 字符串")
  })

  test("accepts a progressive ladder grounded in the current for-loop fact", () => {
    const hints = [
      "先观察 for 循环面对一个序列时，每轮关注的是哪个对象。",
      "把序列想成排好队的元素：for 循环变量会按顺序接住其中一个元素。",
      "目标事实需要同时表达 for 循环、依次取出和序列中的每个元素。",
    ]
    expect(validateCodeLabPublicAuthorAgainstPlan(
      payload(hints), plan, recallFactContract, undefined, undefined, evidence,
    )).toEqual([])
  })

  test("normalization preserves model-authored task-specific hints", () => {
    const hints = [
      "先观察 for 循环每一轮处理的对象。",
      "for 循环变量会按序接收序列里的元素。",
      "完整表达应包含‘依次取出序列中的每个元素’。",
    ]
    const normalized = normalizeCodeLabPublicAuthorPayload(payload(hints), recallFactContract)
    expect(normalized.objectives[0]?.hints).toEqual(hints)
  })

  test("可执行任务保留模型提示主体并绑定当前标题与事实", () => {
    const author = payload([
      "先找出每轮发生变化的位置。",
      "再运行一个最小案例观察结果。",
      "最后核对输出是否满足题面。",
    ])
    normalizeCodeLabHintsToEvidence(author, plan, evidence)
    expect(author.objectives[0]!.hints[0]).toContain("先找出每轮发生变化的位置")
    expect(author.objectives[0]!.hints[1]).toContain("再运行一个最小案例观察结果")
    expect(author.objectives[0]!.hints.slice(0, 2).join(" ")).toContain("for 循环")
    expect(validateCodeLabPublicAuthorAgainstPlan(
      author,
      plan,
      { ...recallFactContract, learner_action: "implement_program" },
      undefined,
      undefined,
      evidence,
    ).some((issue) => issue.includes("至少两级必须点明"))).toBe(false)
  })

  test("debugging_repair 不允许题面逐项公布缺陷并在提示中给齐源码替换", () => {
    const author = payload([
      "观察公开样例，定位循环端点。",
      "需要使用 range(1, 5) 才能包含编号 4。",
      "将 logs[i] 改为 logs[i-1]，再重新运行。",
    ])
    author.programming_task = {
      statement: "当前 starter 代码中存在两个缺陷：条件分支缺陷、循环端点缺陷。",
      input_description: "传入日志列表。",
      output_description: "返回分类结果。",
      constraints: ["按顺序处理", "不得遗漏元素"],
      additional_public_examples: [],
    }
    const issues = validateCodeLabPublicAuthorAgainstPlan(
      author,
      plan,
      undefined,
      undefined,
      {
        task_kind: "debugging_repair",
        submission_mode: "full_code",
        public_case_count: 1,
        required_mutation_count: 2,
      } as any,
      evidence,
    )
    expect(issues.some((issue) => issue.includes("源码级缺陷"))).toBe(true)
    expect(issues.some((issue) => issue.includes("前两级提示"))).toBe(true)
  })

  test("debugging_repair 拒绝 TODO 骨架和在注释中公布缺陷", () => {
    const author = payload([
      "先运行公开样例观察结果。",
      "记录循环中每轮访问的位置。",
      "根据观察定位边界。",
    ])
    author.starter_code = "def solve(values):\n    # 缺陷1：range 起点错误，请修复\n    # TODO: 补全循环\n    return []"
    author.programming_task = {
      statement: "starter 代码中存在三类问题：请逐项处理。",
      input_description: "传入值列表。",
      output_description: "返回处理结果。",
      constraints: ["保留函数签名", "使用公开样例复现"],
      additional_public_examples: [],
    }
    const issues = validateCodeLabPublicAuthorAgainstPlan(
      author,
      plan,
      undefined,
      undefined,
      {
        task_kind: "debugging_repair",
        submission_mode: "full_code",
        public_case_count: 1,
        required_mutation_count: 1,
      } as any,
      evidence,
    )
    expect(issues.some((issue) => issue.includes("starter 必须是完整可运行") && issue.includes("starter_code"))).toBe(true)
    expect(issues.some((issue) => issue.includes("starter 注释不得公布") && issue.includes("starter_code"))).toBe(true)
    expect(issues.some((issue) => issue.includes("题面只能描述预期行为") && issue.includes("programming_task.statement"))).toBe(true)
  })

  test("debugging repair guidance is projected to observation-first public layers", () => {
    const author = payload([
      "请使用 range(0, len(values)) 遍历。",
      "应将 values[1] 改为 values[0]。",
      "把边界表达式改为 range(0, len(values))。",
    ])
    author.starter_code = "def solve(values):\n    result = []\n    for i in range(1, len(values)):\n        result.append(values[i])\n    return result\n"
    author.objectives[0]!.instruction_text = "请使用 range(0, len(values)) 修复循环。"
    author.programming_task = {
      statement: "starter 代码中存在一处故障：range 起点错误，应使用 range(0, len(values))。",
      input_description: "传入值列表。",
      output_description: "返回全部值。",
      constraints: ["保留函数签名", "保持输出顺序"],
      additional_public_examples: [],
    }
    projectDebuggingRepairPublicGuidance(author)
    expect(author.programming_task.statement).toContain("故障定位与修复任务")
    expect(author.programming_task.statement).not.toContain("range(0")
    expect(author.objectives[0]!.instruction_text).toContain("比较实际结果")
    expect(author.objectives[0]!.hints.slice(0, 2).join(" ")).not.toContain("range(0")
    expect(author.objectives[0]!.hints[2]).toContain("range(0")
    expect(author.starter_code).toContain("range(1")
  })

  test("normalization projects extra guide slots and duplicate public examples to the frozen plan", () => {
    const author = payload([
      "先观察 for 循环每一轮处理的对象。",
      "for 循环变量会按序接收序列里的元素。",
      "完整表达应包含依次取出序列中的每个元素。",
    ])
    author.practical_guide = {
      practice_goal: "运行练习",
      deliverable: "可运行程序",
      readiness_checks: [
        { title: "检查一", check: "检查输入", ready_when: "输入就绪" },
        { title: "多余检查", check: "重复检查", ready_when: "重复就绪" },
      ],
      steps: [
        { title: "步骤一", action: "运行", input: "空输入", expected_result: "看到输出", verification: "核对输出" },
        { title: "多余步骤", action: "重复", input: "空输入", expected_result: "重复", verification: "重复" },
      ],
      troubleshooting: [
        { symptom: "无输出", likely_cause: "未运行", recovery_steps: ["运行"], verification: "看到输出" },
        { symptom: "多余", likely_cause: "多余", recovery_steps: ["忽略"], verification: "完成" },
      ],
      extension_task: { task: "再次运行", changed_dimension: "文本", verification: "核对输出" },
    }
    author.programming_task = {
      statement: "输出事实。",
      input_description: "无输入。",
      output_description: "输出事实。",
      constraints: ["保留结构", "核对输出"],
      additional_public_examples: [
        { description: "重复空输入", input: "", expected_behavior: "输出事实" },
      ],
    }
    const normalized = normalizeCodeLabPublicAuthorPayload(
      author,
      undefined,
      {
        readiness_slots: [{}],
        step_slots: [{}],
        troubleshooting_slots: [{}],
      } as any,
      { public_case_count: 1 } as any,
    )
    expect(normalized.practical_guide?.readiness_checks).toHaveLength(1)
    expect(normalized.practical_guide?.steps).toHaveLength(1)
    expect(normalized.practical_guide?.troubleshooting).toHaveLength(1)
    expect(normalized.programming_task?.additional_public_examples).toBeUndefined()
  })
})
