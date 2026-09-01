import { describe, expect, test } from "bun:test"
import {
  conservativeAssessmentPublicSafetyRepair,
  conservativeCodeLabPublicSafetyPatch,
  conservativeCodeLabPublicSafetyRepair,
  shouldUseDeterministicPublicSafetyRepair,
} from "../src/role-c-content/providers/model-backed-provider"

describe("Role C targeted public-safety repair", () => {
  test("公开参考实现泄漏统一使用确定性定向清理", () => {
    expect(shouldUseDeterministicPublicSafetyRepair(["reference_solution_leak"])).toBe(true)
    expect(shouldUseDeterministicPublicSafetyRepair(["starter_equals_reference"])).toBe(true)
    expect(shouldUseDeterministicPublicSafetyRepair(["hidden_test_id_leak"])).toBe(false)
  })

  test("只清除 starter 泄漏，保留已经审核通过的公开教学内容", () => {
    const patch = conservativeCodeLabPublicSafetyPatch({
      starter_code: "def solve(values):\n    result = list(values)\n    result.append(4)\n    return result\n",
      execution_contract: { execution_mode: "function", entry_point: "solve" },
      instructions: [{ block_id: "B1", text: "保留具体任务说明" }],
      public_tests: [{ test_id: "P1", description: "测试空列表", expected_behavior: "返回空列表" }],
      hint_ladders: [{ objective_id: "O1", hints: [
        { text: "提示一" }, { text: "提示二" }, { text: "提示三" },
      ] }],
      reflection_questions: ["完整写出 solve 的实现"],
    } as any, "def solve(values):\n    result = list(values)\n    result.append(4)\n    return result\n")
    expect(patch.starter_code).toContain("NotImplementedError")
    expect(patch.starter_code).not.toContain("append(4)")
    expect(patch.public_test_descriptions).toHaveLength(1)
    expect(patch.instruction_texts).toEqual(["保留具体任务说明"])
    expect(patch.public_test_descriptions).toEqual(["测试空列表"])
    expect(patch.public_test_expected_behaviors).toEqual(["返回空列表"])
    expect(patch.hint_texts[0]).toEqual(["提示一", "提示二", "提示三"])
    expect(patch.hint_texts).toHaveLength(1)
    expect(patch.hint_texts[0]).toHaveLength(3)
    expect(JSON.stringify(patch)).not.toContain("append(4)")
  })

  test("recall_fact 泄漏修订保留可运行输出胶水而非退化为单行异常", () => {
    const patch = conservativeCodeLabPublicSafetyPatch({
      starter_code: "fact_text = \"Python 是一种通用编程语言\"\nprint(fact_text)\n",
      execution_contract: {
        execution_mode: "stdin_stdout",
        input_contract: { type: "none", constraints: [] },
        output_contract: {
          kind: "string", type: "stdout_lines",
          constraints: ["学习者只需替换 TODO 处的事实文本占位"],
        },
      },
      instructions: [{ block_id: "B1", text: "替换事实文本" }],
      public_tests: [{ test_id: "P1", description: "运行程序", expected_behavior: "输出事实" }],
      hint_ladders: [{ objective_id: "O1", hints: [
        { text: "看事实" }, { text: "替换引号" }, { text: "运行程序" },
      ] }],
      reflection_questions: ["为什么保留 print？"],
    } as any, "fact_text = \"Python 是一种通用编程语言\"\nprint(fact_text)\n")
    expect(patch.starter_code).toContain("fact_text =")
    expect(patch.starter_code).toContain("print(fact_text)")
    expect(patch.starter_code).toContain("TODO")
    expect(patch.starter_code).not.toContain("通用编程语言")
    expect(patch.starter_code).not.toContain("NotImplementedError")
  })

  test("安全修订清除分散在说明和提示中的参考实现行", () => {
    const patch = conservativeCodeLabPublicSafetyPatch({
      starter_code: "def greet(name):\n    # TODO\n    pass\n",
      execution_contract: { execution_mode: "function", entry_point: "greet" },
      instructions: [{ block_id: "B1", text: "先写 message = '你好，' + name" }],
      public_tests: [{ test_id: "P1", description: "调用 greet", expected_behavior: "返回问候文本" }],
      hint_ladders: [{ objective_id: "O1", hints: [
        { text: "先拼接" }, { text: "使用 message = '你好，' + name" }, { text: "最后 return message" },
      ] }],
      reflection_questions: ["为什么 return message？"],
    } as any, "def greet(name):\n    message = '你好，' + name\n    return message\n")
    const visible = JSON.stringify(patch)
    expect(visible).not.toContain("message = '你好，' + name")
    expect(visible).not.toContain("return message")
    expect(patch.instruction_texts).toHaveLength(1)
    expect(patch.hint_texts[0]).toHaveLength(3)
  })

  test("安全修订同时清理完整编程任务卡中的参考实现", () => {
    const reference = "def greet(name):\n    message = '你好，' + name\n    return message\n"
    const prior = {
      lab_id: "LAB-1",
      title: "问候函数",
      objective_ids: ["O1"],
      starter_code: "def greet(name):\n    # TODO\n    pass\n",
      execution_contract: {
        language: "python", execution_mode: "function", entry_point: "greet",
        allowed_imports: [], input_contract: { type: "json_args", constraints: [] },
        output_contract: { kind: "string", type: "json", constraints: [] },
        resource_limits: { timeout_ms: 1000, memory_mb: 64, max_output_bytes: 1024 },
      },
      instructions: [{ block_id: "B1", block_type: "paragraph", text: "实现 greet", claims: [] }],
      public_tests: [{
        test_id: "P1", objective_id: "O1", description: "调用 greet",
        input: { args: ["小王"] }, expected_behavior: "返回问候语", citations: [],
      }],
      hint_ladders: [{ objective_id: "O1", hints: [
        { hint_level: 1, text: "先看参数", citations: [] },
        { hint_level: 2, text: "拼接文本", citations: [] },
        { hint_level: 3, text: "返回结果", citations: [] },
      ] }],
      reflection_questions: ["如何验证？"],
      programming_task: {
        schema_version: "programming-task.v1", task_id: "TASK-1", blueprint_id: "BP-1",
        task_kind: "function_implementation", submission_mode: "full_code",
        statement: `请照抄：${reference}`, input_description: "一个名字",
        output_description: "问候语", constraints: [], starter_code: reference,
        public_examples: [{
          case_id: "E1", description: "公开样例", input: { args: ["小王"] },
          expected_behavior: "返回问候语",
        }],
        hint_ladders: [
          { level: 1, text: "看参数" },
          { level: 2, text: "message = '你好，' + name" },
          { level: 3, text: "return message" },
        ],
        gap_template: {
          schema_version: "code-gap-template.v1",
          template_code: "def greet(name):\n    {{gap:body}}\n",
          gaps: [{
            gap_id: "body", kind: "block", max_chars: 200, max_lines: 2,
            label: "填写 message = '你好，' + name",
            placeholder: "return message",
          }],
        },
      },
      objective_coverage: [{ objective_id: "O1", instruction_block_ids: ["B1"], public_test_ids: ["P1"] }],
      used_evidence: [],
    } as any
    const repaired = conservativeCodeLabPublicSafetyRepair(prior, reference)
    expect(repaired.programming_task?.statement).not.toContain("return message")
    expect(repaired.programming_task?.starter_code).toEqual(prior.starter_code)
    expect(JSON.stringify(repaired.programming_task?.hint_ladders)).not.toContain("return message")
    expect(JSON.stringify(repaired.programming_task)).not.toContain("message = '你好，' + name")
    expect(repaired.programming_task?.gap_template?.gaps[0]?.label).toBe("待填写代码片段 1")
    expect(repaired.programming_task?.gap_template?.gaps[0]?.placeholder).toBe("# 按题目要求填写")
  })

  test("compresses assessment code public fields when secure reference leaks", () => {
    const repaired = conservativeAssessmentPublicSafetyRepair({
      form_id: "FORM-1",
      title: "测评",
      objective_ids: ["O1"],
      items: [{
        item_id: "I1",
        family_id: "F1",
        variant_id: "V1",
        display_no: 1,
        objective_id: "O1",
        tier: 2,
        modality: "code",
        prompt: "写出完整实现：result=list(values); result.append(4); return result",
        starter_code: "def solve(values):\n    result = list(values)\n    result.append(4)\n    return result\n",
        max_score: 1,
      }],
      submission_policy: { max_attempts: 2, formative: true },
      routing: { anchor_item_ids: [], rules: [] },
      objective_coverage: [],
      used_evidence: [],
    } as any)
    expect(repaired.items[0].prompt).not.toContain("append(4)")
    expect(repaired.items[0].starter_code).toContain("TODO")
    expect(repaired.items[0].starter_code).not.toContain("append(4)")
  })
})
