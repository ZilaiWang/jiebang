import { describe, expect, test } from "bun:test"
import { CONCEPT_SEGMENT_SYSTEM_PROMPT } from "../src/role-c-content/prompts/concept-tutor/staged.prompt"

describe("detailed current-node lesson prompt", () => {
  test("requires detailed teaching while forbidding overall-goal and future-node leakage", () => {
    expect(CONCEPT_SEGMENT_SYSTEM_PROMPT).toContain("当前 B 路径节点")
    expect(CONCEPT_SEGMENT_SYSTEM_PROMPT).toContain("不得根据学习者总体目标")
    expect(CONCEPT_SEGMENT_SYSTEM_PROMPT).toContain("解释至少输出 3 个独立语义段落")
    expect(CONCEPT_SEGMENT_SYSTEM_PROMPT).toContain("每个“第 N 步/步骤 N/1、2、3”单独一行")
  })
})
