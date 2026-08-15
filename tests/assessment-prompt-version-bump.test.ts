import { describe, expect, test } from "bun:test"
import { ROLE_C_PROMPT_MANIFEST_VERSION } from "../src/role-c-content/prompts/common-policy"
import { ASSESSMENT_EXECUTION_REPAIR_SYSTEM_PROMPT } from "../src/role-c-content/prompts/evaluator/staged.prompt"

describe("assessment repair prompt", () => {
  test("版本号遵循格式且执行修复提示词包含兜底说明", () => {
    expect(ROLE_C_PROMPT_MANIFEST_VERSION).toMatch(/^c-prompts-\d+\.\d+\.\d+$/)
    expect(ASSESSMENT_EXECUTION_REPAIR_SYSTEM_PROMPT).toContain("未通过全部隐藏测试")
  })
})
