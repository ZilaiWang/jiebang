import { describe, expect, test } from "bun:test"
import { ASSESSMENT_PUBLIC_STAGE_SYSTEM_PROMPT, ASSESSMENT_SECURE_STAGE_SYSTEM_PROMPT } from "../src/role-c-content/prompts/evaluator/staged.prompt"
import { deterministicAssessmentStarterRepair } from "../src/role-c-content/providers/staged-generation"

describe("assessment code task contract prompts", () => {
  test("requires public function signatures and forbids secure stdin drift", () => {
    expect(ASSESSMENT_PUBLIC_STAGE_SYSTEM_PROMPT).toContain("code 题统一使用函数模式")
    expect(ASSESSMENT_PUBLIC_STAGE_SYSTEM_PROMPT).toContain("starter_code 只保留函数签名")
    expect(ASSESSMENT_SECURE_STAGE_SYSTEM_PROMPT).toContain("不得使用 stdin_stdout")
    expect(ASSESSMENT_SECURE_STAGE_SYSTEM_PROMPT).toContain("public starter_code 的函数签名")
  })

  test("recovers a missing starter from the function contract in the public prompt", () => {
    expect(deterministicAssessmentStarterRepair(null, "请补全函数 summarize_scores(scores) 并返回结果。"))
      .toBe("def summarize_scores(scores):\n    # TODO: 补全你的代码实现\n    pass\n")
  })
})
