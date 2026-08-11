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
})
