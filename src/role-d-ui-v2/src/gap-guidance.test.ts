import { describe, expect, test } from "bun:test"
import { effectiveGapAnswerFormat, gapAnswerIssue, gapTemplatePreview } from "./gap-guidance"

const textGap = {
  gap_id: "fact_text",
  label: "要输出的文字（需要包含引号）",
  kind: "expression",
  answer_format: "python_string_literal" as const,
  max_chars: 200,
  max_lines: 1,
}

describe("程序填空学习者指引", () => {
  test("不把内部 gap marker 暴露给学习者", () => {
    const preview = gapTemplatePreview({
      template_code: "fact_text = {{gap:fact_text}}\nprint(fact_text)",
      gaps: [textGap],
    }, {})
    expect(preview).not.toContain("{{gap:")
    expect(preview).toContain("[请在下方填写：要输出的文字")
  })

  test("填写后展示完整代码预览", () => {
    const preview = gapTemplatePreview({
      template_code: "fact_text = {{gap:fact_text}}\nprint(fact_text)",
      gaps: [textGap],
    }, { fact_text: '"Python 是一种通用编程语言。"' })
    expect(preview).toContain('fact_text = "Python 是一种通用编程语言。"')
  })

  test("文本空格拒绝无引号数字并兼容旧会话标签", () => {
    expect(gapAnswerIssue(textGap, "111")).toContain("加英文引号")
    expect(gapAnswerIssue(textGap, '"Python"')).toBeNull()
    expect(effectiveGapAnswerFormat({ ...textGap, answer_format: undefined, label: "事实文本" }))
      .toBe("python_string_literal")
  })
})
