import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import type { QuestionBank, QuestionBankItem } from "./types"

export interface QuestionBankQualityReport {
  workflow: "QuestionBank_Quality_Report"
  bank_id: string
  kb_version: string
  generated_at: string
  summary: {
    total_questions: number
    template_variant_count: number
    template_duplication_rate: number
    choice_option_validity: number
    exam_gradable_rate: number
    programming_test_case_coverage: number
    quality_gate_passed: boolean
  }
  details: {
    question_type_counts: Record<string, number>
    grading_method_counts: Record<string, number>
    purpose_counts: Record<string, number>
    failed_gates: string[]
  }
}

export interface WrittenQuestionBankQualityReport {
  qualityJsonPath: string
  qualityMarkdownPath: string
}

export function analyzeQuestionBankQuality(bank: QuestionBank): QuestionBankQualityReport {
  const templateVariantCount = new Set(bank.items.map((item) => item.template_variant)).size
  const templateDuplicationRate = bank.items.length === 0 ? 0 : 1 - (templateVariantCount / bank.items.length)
  const choiceItems = bank.items.filter((item) => item.type === "choice")
  const validChoiceItems = choiceItems.filter((item) => Array.isArray(item.options) && item.options.length === 4 && item.options.includes(item.answer))
  const examItems = bank.items.filter((item) => item.purpose === "exam")
  const gradableExamItems = examItems.filter((item) => item.grading_method === "unit_test" || item.rubric.length > 0)
  const programmingItems = bank.items.filter((item) => isProgrammingPractice(item))
  const programmingWithTests = programmingItems.filter((item) => (item.test_cases?.length ?? 0) >= 2 && item.test_cases!.some((testCase) => testCase.hidden))

  const summary = {
    total_questions: bank.items.length,
    template_variant_count: templateVariantCount,
    template_duplication_rate: round4(templateDuplicationRate),
    choice_option_validity: ratio(validChoiceItems.length, choiceItems.length),
    exam_gradable_rate: ratio(gradableExamItems.length, examItems.length),
    programming_test_case_coverage: ratio(programmingWithTests.length, programmingItems.length),
    quality_gate_passed: false,
  }
  const failedGates = [
    ...(summary.template_variant_count < 12 ? ["template_variant_count_lt_12"] : []),
    ...(summary.template_duplication_rate > 0.25 ? ["template_duplication_rate_gt_0.25"] : []),
    ...(summary.choice_option_validity < 1 ? ["choice_option_invalid"] : []),
    ...(summary.exam_gradable_rate < 1 ? ["exam_not_gradable"] : []),
    ...(summary.programming_test_case_coverage < 1 ? ["programming_test_case_missing"] : []),
  ]

  return {
    workflow: "QuestionBank_Quality_Report",
    bank_id: bank.bank_id,
    kb_version: bank.kb_version,
    generated_at: bank.generated_at,
    summary: { ...summary, quality_gate_passed: failedGates.length === 0 },
    details: {
      question_type_counts: countBy(bank.items, (item) => item.type),
      grading_method_counts: countBy(bank.items, (item) => item.grading_method),
      purpose_counts: countBy(bank.items, (item) => item.purpose),
      failed_gates: failedGates,
    },
  }
}

export async function writeQuestionBankQualityReport(
  report: QuestionBankQualityReport,
  outputDir = "question_bank/generated",
): Promise<WrittenQuestionBankQualityReport> {
  await mkdir(outputDir, { recursive: true })
  const qualityJsonPath = join(outputDir, "latest.quality.json")
  const qualityMarkdownPath = join(outputDir, "latest.quality.md")
  await Bun.write(qualityJsonPath, JSON.stringify(report, null, 2))
  await Bun.write(qualityMarkdownPath, renderQuestionBankQualityMarkdown(report))
  return { qualityJsonPath, qualityMarkdownPath }
}

export function renderQuestionBankQualityMarkdown(report: QuestionBankQualityReport): string {
  return [
    "# 题库质量报告",
    "",
    `- 题库 ID：${report.bank_id}`,
    `- 总题量：${report.summary.total_questions}`,
    `- 模板变体数：${report.summary.template_variant_count}`,
    `- 模板重复率：${(report.summary.template_duplication_rate * 100).toFixed(1)}%`,
    `- 选择题选项有效率：${(report.summary.choice_option_validity * 100).toFixed(1)}%`,
    `- 考试题可判分率：${(report.summary.exam_gradable_rate * 100).toFixed(1)}%`,
    `- 编程题测试用例覆盖率：${(report.summary.programming_test_case_coverage * 100).toFixed(1)}%`,
    `- 质量门禁：${report.summary.quality_gate_passed ? "通过" : "未通过"}`,
    "",
    "## 题型分布",
    "",
    ...Object.entries(report.details.question_type_counts).map(([type, count]) => `- ${type}: ${count}`),
    "",
    "## 评分方式分布",
    "",
    ...Object.entries(report.details.grading_method_counts).map(([method, count]) => `- ${method}: ${count}`),
    "",
  ].join("\n")
}

function isProgrammingPractice(item: QuestionBankItem): boolean {
  return item.type === "practice" && (item.source_id.startsWith("K") || item.source_id.startsWith("PY"))
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : round4(numerator / denominator)
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000
}

function countBy(items: QuestionBankItem[], selector: (item: QuestionBankItem) => string): Record<string, number> {
  return items.reduce<Record<string, number>>((counts, item) => {
    const key = selector(item)
    counts[key] = (counts[key] ?? 0) + 1
    return counts
  }, {})
}
