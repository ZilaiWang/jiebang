import { describe, expect, test } from "bun:test"
import { stagedRepairPrompt } from "../src/role-c-content/prompts/staged-repair.prompt"

describe("Role C staged hidden-case repair prompt", () => {
  test("names machine leak codes and requires changed hidden vectors", () => {
    const prompt = stagedRepairPrompt("BASE", ["[hidden_test_input_leak] $.public: duplicate"])
    expect(prompt).toContain("hidden_test_input_leak")
    expect(prompt).toContain("hidden_test_expected_leak")
    expect(prompt).toContain("JSON 全值比较")
    expect(prompt).toContain("previous_output 不同")
    expect(prompt).not.toContain("删除或改写 public payload。`")
  })

  test("requires a full AI-authored replacement for repeated public questions", () => {
    const prompt = stagedRepairPrompt("BASE", ["items[2] 与已发布题目 FORM-1:ITEM-1 重复"])
    expect(prompt).toContain("完整重写这些下标对应的题目")
    expect(prompt).toContain("repair_directive.required_change_indices")
    expect(prompt).toContain("只换数字、变量名")
  })
})
