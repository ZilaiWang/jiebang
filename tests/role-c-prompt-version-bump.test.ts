import { describe, expect, test } from "bun:test"
import {
  ROLE_C_COMMON_SYSTEM_POLICY,
  ROLE_C_PROMPT_MANIFEST_VERSION,
} from "../src/role-c-content/prompts/common-policy"
import { CONCEPT_TUTOR_SYSTEM_PROMPT } from "../src/role-c-content/prompts/concept-tutor/system.prompt"
import { CODE_LAB_SECURE_STAGE_SYSTEM_PROMPT } from "../src/role-c-content/prompts/code-lab/secure-stage.prompt"
import { stagedRepairPrompt } from "../src/role-c-content/prompts/staged-repair.prompt"

describe("role c prompt manifest version", () => {
  test("bumped to invalidate staged repair cache", () => {
    expect(ROLE_C_PROMPT_MANIFEST_VERSION).toBe("c-prompts-1.21.1")
  })

  test("keeps teaching scenarios inside the frozen evidence boundary", () => {
    expect(ROLE_C_COMMON_SYSTEM_POLICY).toContain("evidence 未提及的用途类别、应用领域和技术能力")
    expect(CONCEPT_TUTOR_SYSTEM_PROMPT).toContain("不得新增用途、领域、能力或真实案例")
    expect(CONCEPT_TUTOR_SYSTEM_PROMPT).toContain("不能自行扩展为网站、游戏、自动化、科学计算等其他用途")
  })

  test("makes an empty import contract explicit during authoring and repair", () => {
    expect(CODE_LAB_SECURE_STAGE_SYSTEM_PROMPT).toContain("allowed_imports=[] 时不得出现任何 import")
    expect(stagedRepairPrompt("base", ["STATIC_UNLISTED_IMPORT"])).toContain("输出必须完全不含 import")
  })
})
