import { describe, expect, test } from "bun:test"
import { ROLE_C_PROMPT_MANIFEST_VERSION } from "../src/role-c-content/prompts/common-policy"
import { ASSESSMENT_EXECUTION_REPAIR_SYSTEM_PROMPT } from "../src/role-c-content/prompts/evaluator/staged.prompt"

describe("assessment repair prompt version", () => {
  test("bumped and includes generic-block fallback", () => {
    expect(ROLE_C_PROMPT_MANIFEST_VERSION).toBe("c-prompts-1.16.9")
    expect(ASSESSMENT_EXECUTION_REPAIR_SYSTEM_PROMPT).toContain("未通过全部隐藏测试")
  })
})
