import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { loadKnowledgeBase } from "../src/knowledge/loader"
import { generateQuestionBank } from "../src/question-bank/generator"
import { analyzeQuestionBankQuality, writeQuestionBankQualityReport, type QuestionBankQualityReport } from "../src/question-bank/quality"

describe("question bank quality upgrade", () => {
  test("adds grading metadata, template variants, and executable test cases for programming practice", async () => {
    const bank = generateQuestionBank(await loadKnowledgeBase())

    expect(bank.items.every((item) => item.template_variant.length > 0)).toBe(true)
    expect(new Set(bank.items.map((item) => item.template_variant)).size).toBeGreaterThanOrEqual(12)
    expect(bank.items.every((item) => ["exact_match", "rubric", "unit_test"].includes(item.grading_method))).toBe(true)

    const pythonPractice = bank.items.filter((item) => item.type === "practice" && /^(K|PY)\d{3}$/.test(item.source_id))
    expect(pythonPractice.length).toBeGreaterThan(0)
    expect(pythonPractice.every((item) => item.grading_method === "unit_test")).toBe(true)
    expect(pythonPractice.every((item) => item.starter_code && item.starter_code.includes("TODO"))).toBe(true)
    expect(pythonPractice.every((item) => item.test_cases && item.test_cases.length >= 2)).toBe(true)
    expect(pythonPractice.every((item) => item.test_cases?.some((testCase) => testCase.hidden))).toBe(true)

    const aiPractice = bank.items.filter((item) => item.type === "practice" && item.source_id.startsWith("AI"))
    expect(aiPractice.length).toBeGreaterThan(0)
    expect(aiPractice.every((item) => item.grading_method === "rubric")).toBe(true)
    expect(aiPractice.every((item) => !item.test_cases || item.test_cases.length === 0)).toBe(true)
  })

  test("keeps template duplication below the quality threshold", async () => {
    const bank = generateQuestionBank(await loadKnowledgeBase())
    const report = analyzeQuestionBankQuality(bank)

    expect(report.workflow).toBe("QuestionBank_Quality_Report")
    expect(report.summary.total_questions).toBe(bank.items.length)
    expect(report.summary.template_variant_count).toBeGreaterThanOrEqual(12)
    expect(report.summary.template_duplication_rate).toBeLessThanOrEqual(0.25)
    expect(report.summary.choice_option_validity).toBe(1)
    expect(report.summary.exam_gradable_rate).toBe(1)
    expect(report.summary.programming_test_case_coverage).toBe(1)
    expect(report.summary.quality_gate_passed).toBe(true)
  })

  test("turns PY041-PY050 integrated practice into concrete exam tasks with meaningful IO cases", async () => {
    const bank = generateQuestionBank(await loadKnowledgeBase())
    const projectPractice = bank.items.filter((item) =>
      item.type === "practice" && /^PY04[1-9]|PY050$/.test(item.source_id))

    expect(projectPractice.map((item) => item.source_id).sort()).toEqual([
      "PY041",
      "PY042",
      "PY043",
      "PY044",
      "PY045",
      "PY046",
      "PY047",
      "PY048",
      "PY049",
      "PY050",
    ])

    for (const item of projectPractice) {
      expect(item.question).not.toContain("围绕")
      expect(item.question).not.toContain("完成一个小任务")
      expect(item.answer).not.toContain("能体现：")
      expect(item.starter_code).toContain("TODO")
      expect(item.test_cases).toBeDefined()
      expect(item.test_cases!.length).toBeGreaterThanOrEqual(3)
      expect(item.test_cases!.some((testCase) => testCase.hidden)).toBe(true)
      expect(item.test_cases!.every((testCase) => JSON.stringify(testCase.input) !== JSON.stringify(testCase.expected))).toBe(true)
    }

    const bySource = Object.fromEntries(projectPractice.map((item) => [item.source_id, item]))
    expect(bySource.PY041!.question).toContain("records")
    expect(bySource.PY042!.question).toContain("add_score")
    expect(bySource.PY043!.question).toContain("词频")
    expect(bySource.PY046!.question).toContain("FileNotFoundError")
    expect(bySource.PY049!.question).toContain("公开测试")
    expect(bySource.PY050!.question).toContain("diagnostic")
  })

  test("writes JSON and Markdown quality reports", async () => {
    const bank = generateQuestionBank(await loadKnowledgeBase())
    const report = analyzeQuestionBankQuality(bank)
    const written = await writeQuestionBankQualityReport(report, ".tmp/question-bank-quality-test")

    expect(existsSync(written.qualityJsonPath)).toBe(true)
    expect(existsSync(written.qualityMarkdownPath)).toBe(true)

    const persisted = await Bun.file(written.qualityJsonPath).json() as QuestionBankQualityReport
    const markdown = await Bun.file(written.qualityMarkdownPath).text()

    expect(persisted.summary.quality_gate_passed).toBe(true)
    expect(markdown).toContain("# 题库质量报告")
    expect(markdown).toContain("模板重复率")
    expect(markdown).toContain("编程题测试用例覆盖率")
  })
})
