import { describe, expect, test } from "bun:test"
import { applyAssessmentNoveltyPatch } from "../src/role-c-content/providers/model-backed-provider"

const structure = {
  operation: "比较输出",
  reasoning_pattern: "单步判断",
  representation: "选择题",
  context_family: "购物折扣",
  answer_form: "单选",
}

describe("assessment novelty targeted patch", () => {
  test("只更新命题字段并保留冻结的题目身份、目标、题型、分值和引用", () => {
    const previous: {
      items: Array<{
        item_id: string
        objective_id: string
        tier: number
        modality: string
        max_score: number
        prompt: string
        options: string[]
        citations: Array<{ source_id: string; fact_id: string }>
        structure_meta?: typeof structure
      }>
    } = {
      items: [{
        item_id: "ITEM-1",
        objective_id: "OBJ-1",
        tier: 1,
        modality: "mcq",
        max_score: 2,
        prompt: "旧题",
        options: ["旧A", "旧B"],
        citations: [{ source_id: "K001", fact_id: "F001" }],
      }],
    }
    const patched = applyAssessmentNoveltyPatch(previous, [{
      index: 0,
      prompt: "新题",
      options: ["新A", "新B"],
      starter_code: null,
      structure_meta: structure,
    }], [0])
    expect(patched.items[0]).toEqual({
      ...previous.items[0],
      prompt: "新题",
      options: ["新A", "新B"],
      structure_meta: structure,
    })
  })

  test("null 可选字段会被省略，且不允许修改未授权索引", () => {
    const previous = {
      items: [
        { item_id: "ITEM-1", prompt: "文本题", options: ["A", "B"], starter_code: "print(1)" },
        { item_id: "ITEM-2", prompt: "保持不变" },
      ],
    }
    const patched = applyAssessmentNoveltyPatch(previous, [
      { index: 0, prompt: "新文本题", options: null, starter_code: null, structure_meta: structure },
      { index: 1, prompt: "不应修改", options: null, starter_code: null, structure_meta: structure },
    ], [0])
    expect(patched.items[0]?.options).toBeUndefined()
    expect(patched.items[0]?.starter_code).toBeUndefined()
    expect(patched.items[0]?.item_id).toBe("ITEM-1")
    expect(patched.items[1]).toEqual(previous.items[1])
  })
})
