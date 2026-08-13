import { analyzeQuestionBankQuality, writeQuestionBankQualityReport } from "../src/question-bank/quality"
import type { QuestionBank } from "../src/question-bank/types"

const inputFile = process.argv[2] ?? "question_bank/generated/latest.json"
const outputDir = process.argv[3] ?? "question_bank/generated"

const bank = await readQuestionBank(inputFile)
const report = analyzeQuestionBankQuality(bank)
const written = await writeQuestionBankQualityReport(report, outputDir)

console.log(JSON.stringify({
  workflow: "Report_QuestionBank_Quality",
  ok: true,
  input_file: inputFile,
  quality_json_path: written.qualityJsonPath,
  quality_markdown_path: written.qualityMarkdownPath,
  summary: report.summary,
  details: report.details,
}, null, 2))

async function readQuestionBank(path: string): Promise<QuestionBank> {
  const file = Bun.file(path)
  if (!(await file.exists())) {
    console.log(JSON.stringify({
      workflow: "Report_QuestionBank_Quality",
      ok: false,
      input_file: path,
      error: { code: "INPUT_FILE_NOT_FOUND", message: `Input file not found: ${path}` },
    }, null, 2))
    process.exit(2)
  }
  return await file.json() as QuestionBank
}
