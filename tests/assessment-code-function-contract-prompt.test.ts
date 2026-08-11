import { describe, expect, test } from "bun:test"
import { ASSESSMENT_PUBLIC_STAGE_SYSTEM_PROMPT, ASSESSMENT_SECURE_STAGE_SYSTEM_PROMPT } from "../src/role-c-content/prompts/evaluator/staged.prompt"

describe("assessment code task contract prompts", () => {
  test("requires public function signatures and forbids secure stdin drift", () => {
    expect(ASSESSMENT_PUBLIC_STAGE_SYSTEM_PROMPT).toContain("code 题统一使用函数模式")
    expect(ASSESSMENT_PUBLIC_STAGE_SYSTEM_PROMPT).toContain("starter_code 只保留函数签名")
    expect(ASSESSMENT_SECURE_STAGE_SYSTEM_PROMPT).toContain("不得使用 stdin_stdout")
    expect(ASSESSMENT_SECURE_STAGE_SYSTEM_PROMPT).toContain("public starter_code 的函数签名")
  })
})
