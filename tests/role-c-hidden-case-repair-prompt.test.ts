import { describe, expect, test } from "bun:test"
import { stagedRepairPrompt } from "../src/role-c-content/prompts/staged-repair.prompt"
import { ASSESSMENT_NOVELTY_REPAIR_SYSTEM_PROMPT } from "../src/role-c-content/prompts/evaluator/staged.prompt"

describe("Role C staged hidden-case repair prompt", () => {
  test("names machine leak codes and requires changed hidden vectors", () => {
    const prompt = stagedRepairPrompt("BASE", ["[hidden_test_input_leak] $.public: duplicate"])
    expect(prompt).toContain("hidden_test_input_leak")
    expect(prompt).toContain("hidden_test_expected_leak")
    expect(prompt).toContain("公开输入 JSON 相同")
    expect(prompt).toContain("previous_output 不同")
    expect(prompt).not.toContain("删除或改写 public payload。`")
  })

  test("treats forbidden imports as a targeted secure rewrite", () => {
    const prompt = stagedRepairPrompt("base", ["STATIC_FORBIDDEN_IMPORT"])
    expect(prompt).toContain("STATIC_FORBIDDEN_IMPORT")
    expect(prompt).toContain("allowed_imports=[]")
    expect(prompt).toContain("reference_solution 必须与 previous_output 不同")
  })

  test("requires a full AI-authored replacement for repeated public questions", () => {
    const prompt = stagedRepairPrompt("BASE", ["items[2] 与已发布题目 FORM-1:ITEM-1 重复"])
    expect(prompt).toContain("完整重写这些下标对应的题目")
    expect(prompt).toContain("repair_directive.required_change_indices")
    expect(prompt).toContain("只换数字、变量名")
  })

  test("requires form-level repair to follow a distinct task contract", () => {
    expect(ASSESSMENT_NOVELTY_REPAIR_SYSTEM_PROMPT).toContain("current_form_distinctions")
    expect(ASSESSMENT_NOVELTY_REPAIR_SYSTEM_PROMPT).toContain("required_task_shape")
    expect(ASSESSMENT_NOVELTY_REPAIR_SYSTEM_PROMPT).toContain("must_differ_from")
  })
})
