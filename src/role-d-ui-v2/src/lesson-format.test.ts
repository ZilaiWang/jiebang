import { describe, expect, test } from "bun:test"
import { lessonPointParagraphs, normalizePythonDisplayIndentation, semanticLessonLines } from "./lesson-format"

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

  test("does not treat inline numeric values as numbered steps", () => {
    expect(semanticLessonLines("range(2, 8, 2) 指定起始为 2、结束为 8、步长为 2。"))
      .toEqual(["range(2, 8, 2) 指定起始为 2、结束为 8、步长为 2。"])
    expect(semanticLessonLines("操作如下：1、创建变量。2、输出结果。"))
      .toEqual(["操作如下：", "1、创建变量。", "2、输出结果。"])
  })

  test("normalizes short Python indentation for lesson display", () => {
    expect(normalizePythonDisplayIndentation('for item in ["a"]:\n print(item)'))
      .toBe('for item in ["a"]:\n    print(item)')
    expect(normalizePythonDisplayIndentation("if ready:\n    print('ok')"))
      .toBe("if ready:\n    print('ok')")
  })
})

describe("lesson point paragraphs", () => {
  test("splits single newline-separated lines into paragraphs (no blank lines in text)", () => {
    expect(lessonPointParagraphs("概念说明。\n注意边界。"))
      .toEqual(["概念说明。", "注意边界。"])
  })

  test("treats blank-line separated blocks as paragraphs and keeps inner newlines", () => {
    expect(lessonPointParagraphs("第一段内容。\n\n第二段内容。\n它还有续行。"))
      .toEqual(["第一段内容。", "第二段内容。\n它还有续行。"])
  })

  test("keeps a single paragraph intact and trims whitespace", () => {
    expect(lessonPointParagraphs("  Python 使用 if 进行条件判断。  "))
      .toEqual(["Python 使用 if 进行条件判断。"])
  })

  test("returns empty array for blank or whitespace-only text", () => {
    expect(lessonPointParagraphs("")).toEqual([])
    expect(lessonPointParagraphs("   \n  ")).toEqual([])
  })
})
