export interface GapDisplaySpec {
  gap_id: string
  label: string
  kind: string
  answer_format?: "python_string_literal" | "python_expression" | "python_statement" | "python_identifier"
  max_chars: number
  max_lines: number
}

export interface GapDisplayTemplate {
  template_code: string
  gaps: GapDisplaySpec[]
}

export function effectiveGapAnswerFormat(gap: GapDisplaySpec): NonNullable<GapDisplaySpec["answer_format"]> {
  if (gap.answer_format) return gap.answer_format
  // Older persisted sessions do not contain answer_format.  This migration
  // inference keeps their text blanks understandable without rewriting data.
  if (/事实|文字|文本|字符串/u.test(gap.label)) return "python_string_literal"
  if (gap.kind === "identifier") return "python_identifier"
  if (gap.kind === "statement" || gap.kind === "block") return "python_statement"
  return "python_expression"
}

export function gapAnswerGuidance(gap: GapDisplaySpec): string {
  const format = effectiveGapAnswerFormat(gap)
  if (format === "python_string_literal") return "填写等号右边的字符串，必须包含英文单引号或双引号"
  if (format === "python_identifier") return "填写一个变量名，不要包含空格或等号"
  if (format === "python_statement") return `填写 Python 语句 · 最多 ${gap.max_lines} 行`
  return `填写 Python 表达式 · 最多 ${gap.max_lines} 行`
}

export function gapAnswerIssue(gap: GapDisplaySpec, value: string): string | null {
  const answer = value.trim()
  if (!answer) return null
  if (answer.length > gap.max_chars) return `最多允许 ${gap.max_chars} 个字符`
  if (answer.split(/\r?\n/u).length > gap.max_lines) return `最多允许 ${gap.max_lines} 行`
  const format = effectiveGapAnswerFormat(gap)
  if (format === "python_string_literal"
    && !/^(?:"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')$/u.test(answer)) {
    return "这里要填写字符串，请在文字两侧加英文引号，例如：\"一行文字\""
  }
  if (format === "python_identifier" && !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(answer)) {
    return "这里要填写合法变量名，例如：total_score"
  }
  return null
}

export function gapTemplatePreview(template: GapDisplayTemplate, answers: Record<string, string>): string {
  const labels = new Map(template.gaps.map((gap) => [gap.gap_id, gap.label]))
  return template.template_code.replace(/\{\{gap:([A-Za-z][A-Za-z0-9_-]{0,63})\}\}/gu, (_, gapId: string) => {
    const answer = answers[gapId]?.trim()
    return answer || `[请在下方填写：${labels.get(gapId) ?? "此处"}]`
  })
}
