import { describe, expect, test } from "bun:test"
import { semanticLessonLines } from "./lesson-format"

describe("lesson semantic line breaks", () => {
  test("puts each explicit demonstration step on its own line", () => {
    expect(semanticLessonLines("第一步：创建变量。第二步：判断条件。第三步：输出结果。"))
      .toEqual(["第一步：创建变量。", "第二步：判断条件。", "第三步：输出结果。"])
  })

  test("preserves authored newlines and avoids splitting short ordinary prose", () => {
    expect(semanticLessonLines("概念说明。\n注意边界。"))
      .toEqual(["概念说明。", "注意边界。"])
    expect(semanticLessonLines("Python 使用 if 进行条件判断。"))
      .toEqual(["Python 使用 if 进行条件判断。"])
  })
})
