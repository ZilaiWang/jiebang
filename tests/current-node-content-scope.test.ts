import { describe, expect, test } from "bun:test"
import { validateCurrentNodeContentScope } from "../src/role-c-content/validators/content-scope-validator"

describe("current node content scope", () => {
  test("rejects lesson and assessment text that names an unrelated target topic", () => {
    const result = validateCurrentNodeContentScope({
      current_source_id: "K003",
      current_title: "基本数据类型",
      prerequisite_source_ids: ["K002"],
      lesson_text: "基本数据类型包括 int、float、str 和 bool。",
      assessment_prompts: ["请判断 int 是否表示整数。"],
    }, { forbidden_titles: ["for 循环", "while 循环"] })
    expect(result.ok).toBe(true)
    const bad = validateCurrentNodeContentScope({
      current_source_id: "K003",
      current_title: "基本数据类型",
      prerequisite_source_ids: ["K002"],
      lesson_text: "for 循环会遍历列表。",
      assessment_prompts: ["请写 for 循环。"],
    }, { forbidden_titles: ["for 循环", "while 循环"] })
    expect(bad.ok).toBe(false)
  })
})
