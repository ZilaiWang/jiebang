import { describe, expect, test } from "bun:test"
import { validateAssessmentNovelty } from "../src/role-c-content/providers/staged-generation"

const history = [{
  form_id: "FORM-OLD",
  item_id: "ITEM-OLD",
  objective_id: "O1",
  modality: "mcq" as const,
  prompt: "for 循环会按什么顺序遍历列表？",
  options: ["按索引顺序", "随机顺序"],
}]

function assessmentItem(prompt: string, options: string[]) {
  return {
    item_id: "ITEM-NEW",
    display_no: 1,
    family_id: "FAMILY-NEW",
    variant_id: "VARIANT-NEW",
    objective_id: "O1",
    tier: 1 as const,
    modality: "mcq" as const,
    max_score: 1,
    prompt,
    options: options.map((text, index) => ({ option_id: `OPTION-${index}`, label: "AB"[index]!, text })),
    citations: [],
  }
}

describe("AI assessment novelty", () => {
  test("rejects an already published question even after cosmetic reformatting", () => {
    const issues = validateAssessmentNovelty({
      items: [assessmentItem("FOR 循环会按什么顺序遍历列表?", ["随机顺序", "按索引顺序"])],
    }, history)
    expect(issues).toHaveLength(1)
    expect(issues[0]).toContain("FORM-OLD:ITEM-OLD")
  })

  test("allows a new but related question on the same objective", () => {
    const issues = validateAssessmentNovelty({
      items: [assessmentItem("给定 names = ['A', 'B']，下列哪段代码会依次取出两个元素？", ["for name in names", "for names in name"])],
    }, history)
    expect(issues).toEqual([])
  })

  test("does not allow an objective-id change to disguise the same question", () => {
    const item = assessmentItem(" for 循环会按什么顺序遍历列表?", ["按索引顺序", "随机顺序"])
    item.objective_id = "O-REPLANNED"
    expect(validateAssessmentNovelty({ items: [item] }, history)).toHaveLength(1)
  })

  test("does not treat changed distractors as a new question", () => {
    const issues = validateAssessmentNovelty({
      items: [assessmentItem("for 循环会按什么顺序遍历列表？", ["从末尾开始", "由解释器随机决定"])],
    }, history)
    expect(issues).toHaveLength(1)
    expect(issues[0]).toContain("FORM-OLD:ITEM-OLD")
  })

  test("checks the complete history rather than only the latest 200 items", () => {
    const longHistory = [
      ...history,
      ...Array.from({ length: 205 }, (_, index) => ({
        form_id: `FORM-${index}`,
        item_id: `ITEM-${index}`,
        objective_id: "O1",
        modality: "mcq" as const,
        prompt: `第 ${index} 道不同的循环题`,
        options: ["选项一", "选项二"],
      })),
    ]
    const issues = validateAssessmentNovelty({
      items: [assessmentItem("for 循环会按什么顺序遍历列表？", ["新干扰项一", "新干扰项二"])],
    }, longHistory)
    expect(issues).toHaveLength(1)
    expect(issues[0]).toContain("FORM-OLD:ITEM-OLD")
  })
})
