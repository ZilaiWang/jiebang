import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { loadKnowledgeBase } from "../src/knowledge/loader"
import { auditQuestionBank, type QuestionBankAuditReport } from "../src/question-bank/auditor"
import { generateQuestionBank, writeQuestionBankArtifacts, type QuestionBank } from "../src/question-bank/generator"

describe("question bank generation and Role A audit", () => {
  test("generates traceable training/exam questions from the current knowledge base", async () => {
    const knowledgeBase = await loadKnowledgeBase()
    const bank = generateQuestionBank(knowledgeBase)
    const expectedQuestionCount = knowledgeBase.items.length * 4

    expect(bank.schema_version).toBe("question-bank.v1")
    expect(bank.kb_version).toBe(knowledgeBase.version)
    expect(bank.items).toHaveLength(expectedQuestionCount)
    expect(new Set(bank.items.map((item) => item.question_id)).size).toBe(expectedQuestionCount)

    const bySource = new Map<string, number>()
    for (const item of bank.items) {
      bySource.set(item.source_id, (bySource.get(item.source_id) ?? 0) + 1)
      expect(item.source_id).toMatch(/^(K|AI|PY)\d{3}$/)
      expect(item.fact_id).toMatch(/^F\d{3}$/)
      expect(item.purpose).toBeOneOf(["training", "exam", "diagnostic"])
      expect(item.type).toBeOneOf(["choice", "short_answer", "debugging", "practice"])
      expect(item.question.length).toBeGreaterThan(20)
      expect(item.answer.length).toBeGreaterThan(0)
      expect(item.explanation).toContain(item.source_id)
      if (item.type === "choice") {
        expect(item.options).toHaveLength(4)
        expect(item.options).toContain(item.answer)
      }
    }

    expect([...bySource.values()].every((count) => count === 4)).toBe(true)
  })

  test("audits the generated question bank with Role A fact-audit evidence", async () => {
    const knowledgeBase = await loadKnowledgeBase()
    const bank = generateQuestionBank(knowledgeBase)
    const report = await auditQuestionBank(bank, knowledgeBase)
    const expectedQuestionCount = knowledgeBase.items.length * 4

    expect(report.workflow).toBe("QuestionBank_RoleA_Audit")
    expect(report.summary.total_questions).toBe(expectedQuestionCount)
    expect(report.summary.audit_status_counts).toEqual({ pass: expectedQuestionCount, revise: 0, reject: 0 })
    expect(report.summary.citation_coverage).toBe(1)
    expect(report.summary.unsupported_items).toBe(0)
    expect(report.summary.audit_pass_rate).toBe(1)
    expect(report.items.every((item) => item.audit.status === "pass")).toBe(true)
  })

  test("writes latest JSON, audit JSON, and Markdown report artifacts", async () => {
    const knowledgeBase = await loadKnowledgeBase()
    const bank = generateQuestionBank(knowledgeBase)
    const report = await auditQuestionBank(bank, knowledgeBase)
    const written = await writeQuestionBankArtifacts({ bank, report, outputDir: ".tmp/question-bank-test" })
    const expectedQuestionCount = knowledgeBase.items.length * 4

    expect(existsSync(written.bankPath)).toBe(true)
    expect(existsSync(written.auditPath)).toBe(true)
    expect(existsSync(written.reportPath)).toBe(true)

    const persistedBank = await Bun.file(written.bankPath).json() as QuestionBank
    const persistedReport = await Bun.file(written.auditPath).json() as QuestionBankAuditReport
    const markdown = await Bun.file(written.reportPath).text()

    expect(persistedBank.items).toHaveLength(expectedQuestionCount)
    expect(persistedReport.summary.audit_status_counts.pass).toBe(expectedQuestionCount)
    expect(markdown).toContain("# 题库生成与 Role A 审核报告")
    expect(markdown).toContain(`总题量：${expectedQuestionCount}`)
  })
})
