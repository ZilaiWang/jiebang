import type { CodeGapSpec, CodeGapTemplate } from "./contracts"

export interface GapLearnerContract {
  statement: string
  input_description: string
  output_description: string
  constraints: string[]
  gap_template: CodeGapTemplate
}

const GAP_PATTERN = /\{\{gap:([A-Za-z][A-Za-z0-9_-]{0,63})\}\}/gu

export function validateGapTemplate(template: CodeGapTemplate): string[] {
  const issues: string[] = []
  const specs = new Map<string, CodeGapSpec>()
  for (const gap of template.gaps) {
    if (specs.has(gap.gap_id)) issues.push(`重复 gap_id: ${gap.gap_id}`)
    specs.set(gap.gap_id, gap)
    if (gap.max_chars < 1 || gap.max_chars > 20_000) issues.push(`${gap.gap_id}.max_chars 越界`)
    if (gap.max_lines < 1 || gap.max_lines > 100) issues.push(`${gap.gap_id}.max_lines 越界`)
  }
  const markers = [...template.template_code.matchAll(GAP_PATTERN)].map((match) => match[1]!)
  if (markers.length === 0) issues.push("template_code 未包含 gap marker")
  const counts = new Map<string, number>()
  for (const marker of markers) {
    counts.set(marker, (counts.get(marker) ?? 0) + 1)
    if (!specs.has(marker)) issues.push(`模板引用未知 gap: ${marker}`)
  }
  for (const gapId of specs.keys()) {
    if (!counts.has(gapId)) issues.push(`gap ${gapId} 未出现在模板中`)
    if ((counts.get(gapId) ?? 0) !== 1) issues.push(`gap ${gapId} 必须且只能出现一次`)
  }
  return issues
}

/** Learner-facing wording and the server materializer must describe the same blanks. */
export function validateGapLearnerContract(task: GapLearnerContract): string[] {
  const issues: string[] = []
  const visibleText = [task.statement, task.input_description, task.output_description, ...task.constraints].join("\n")
  if (/\{\{gap:/u.test(visibleText)) issues.push("学习者可见题面不得暴露内部 gap marker")
  if (!/(?:填|补全|完成|替换)/u.test(task.statement)) {
    issues.push("程序填空题面必须明确说明填写或补全动作")
  }
  task.gap_template.gaps.forEach((gap, index) => {
    if (!gap.answer_format) issues.push(`gaps[${index}] 必须声明 answer_format`)
    if (!gap.label.trim() || /^(?:gap|空|todo|待填)$/iu.test(gap.label.trim())) {
      issues.push(`gaps[${index}] 必须使用可理解的学习者标签`)
    }
  })
  return issues
}

export function materializeGapCode(
  template: CodeGapTemplate,
  answers: Record<string, string>,
): { code: string; gap_ranges: Record<string, { start_line: number; end_line: number }> } {
  const issues = validateGapTemplate(template)
  if (issues.length > 0) throw new Error(issues.join("；"))
  const expected = new Set(template.gaps.map((gap) => gap.gap_id))
  const extra = Object.keys(answers).filter((key) => !expected.has(key))
  const missing = [...expected].filter((key) => !(key in answers))
  if (extra.length > 0) throw new Error(`包含未知 gap_answers: ${extra.join("、")}`)
  if (missing.length > 0) throw new Error(`缺少 gap_answers: ${missing.join("、")}`)
  let code = template.template_code
  const gapRanges: Record<string, { start_line: number; end_line: number }> = {}
  for (const gap of template.gaps) {
    const marker = `{{gap:${gap.gap_id}}}`
    const offset = code.indexOf(marker)
    const raw = normalizeAnswer(answers[gap.gap_id] ?? "", gap)
    const lineStart = code.lastIndexOf("\n", offset) + 1
    const indent = /^\s*/u.exec(code.slice(lineStart, offset))?.[0] ?? ""
    const replacement = raw.split("\n").map((line, index) => index === 0 ? line : `${indent}${line}`).join("\n")
    const startLine = countLines(code.slice(0, offset))
    gapRanges[gap.gap_id] = { start_line: startLine, end_line: startLine + countNewlines(replacement) }
    code = `${code.slice(0, offset)}${replacement}${code.slice(offset + marker.length)}`
  }
  if (/\{\{gap:[A-Za-z][A-Za-z0-9_-]{0,63}\}\}/u.test(code)) throw new Error("物化后仍存在 gap marker")
  return { code, gap_ranges: gapRanges }
}

export function failClosedStarterCode(template: CodeGapTemplate): string {
  const answers = Object.fromEntries(template.gaps.map((gap) => [
    gap.gap_id,
    failClosedGapPlaceholder(gap),
  ]))
  return materializeGapCode(template, answers).code
}

/**
 * Produce an inert placeholder which is valid for the gap's frozen syntax
 * contract.  The starter must be renderable before a learner has answered,
 * while still failing closed when it is executed unchanged.
 */
function failClosedGapPlaceholder(gap: CodeGapSpec): string {
  switch (gap.answer_format) {
    case "python_string_literal":
      return '"TODO"'
    case "python_identifier":
      return "__TODO__"
    case "python_statement":
      return 'raise NotImplementedError("TODO")'
    case "python_expression":
      return "__TODO__"
  }
  return gap.kind === "block" || gap.kind === "statement"
    ? 'raise NotImplementedError("TODO")'
    : "__TODO__"
}

function normalizeAnswer(value: string, gap: CodeGapSpec): string {
  const answer = value.replace(/\r\n/gu, "\n").trimEnd()
  if (answer.includes("{{gap:")) throw new Error(`${gap.gap_id} 不得包含 gap marker`)
  if (answer.length > gap.max_chars) throw new Error(`${gap.gap_id} 超过最大字符数`)
  const lines = answer.split("\n")
  if (lines.length > gap.max_lines) throw new Error(`${gap.gap_id} 超过最大行数`)
  if (!answer.trim()) throw new Error(`${gap.gap_id} 不能为空`)
  if (gap.kind === "identifier" && !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(answer.trim())) {
    throw new Error(`${gap.gap_id} 必须是合法标识符`)
  }
  if (gap.answer_format === "python_string_literal" && !isPythonStringLiteral(answer.trim())) {
    throw new Error(`${gap.gap_id} 必须填写带英文单引号或双引号的 Python 字符串，例如 \"一行文字\"`)
  }
  if (gap.kind !== "block" && lines.length > 1) throw new Error(`${gap.gap_id} 只允许单行答案`)
  return answer
}

function isPythonStringLiteral(value: string): boolean {
  return /^(?:"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')$/u.test(value)
}

function countLines(value: string): number { return countNewlines(value) + 1 }
function countNewlines(value: string): number { return value.match(/\n/gu)?.length ?? 0 }
