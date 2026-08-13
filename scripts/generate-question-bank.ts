import { auditQuestionBank } from "../src/question-bank/auditor"
import { generateQuestionBank, writeQuestionBankArtifacts } from "../src/question-bank/generator"
import { loadKnowledgeBase } from "../src/knowledge/loader"
import { analyzeQuestionBankQuality } from "../src/question-bank/quality"

const outputDir = process.argv[2] ?? "question_bank/generated"

const knowledgeBase = await loadKnowledgeBase()
const bank = generateQuestionBank(knowledgeBase)
const report = await auditQuestionBank(bank, knowledgeBase)
const quality = analyzeQuestionBankQuality(bank)
const written = await writeQuestionBankArtifacts({ bank, report, outputDir })

console.log(JSON.stringify({
  workflow: "Generate_QuestionBank_MVP",
  ok: true,
  output_dir: outputDir,
  bank_path: written.bankPath,
  audit_path: written.auditPath,
  report_path: written.reportPath,
  summary: {
    generated_questions: bank.summary.total_questions,
    source_count: bank.summary.source_count,
    training_items: bank.summary.training_items,
    exam_items: bank.summary.exam_items,
    diagnostic_items: bank.summary.diagnostic_items,
    citation_coverage: report.summary.citation_coverage,
    audit_pass_rate: report.summary.audit_pass_rate,
    unsupported_items: report.summary.unsupported_items,
    audit_status_counts: report.summary.audit_status_counts,
    quality_gate_passed: quality.summary.quality_gate_passed,
    template_duplication_rate: quality.summary.template_duplication_rate,
    programming_test_case_coverage: quality.summary.programming_test_case_coverage,
  },
}, null, 2))
