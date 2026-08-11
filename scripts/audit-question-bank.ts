import { auditQuestionBank } from "../src/question-bank/auditor"
import { renderQuestionBankAuditMarkdown } from "../src/question-bank/generator"
import type { QuestionBank } from "../src/question-bank/types"
import { loadKnowledgeBase } from "../src/knowledge/loader"

const inputFile = process.argv[2]
const outputPrefix = process.argv[3]

if (!inputFile) {
  printValidationError("MISSING_INPUT_FILE", "Usage: bun scripts/audit-question-bank.ts <question-bank.json> [output-prefix]")
}

const bank = await readAndValidateQuestionBank(inputFile)
const knowledgeBase = await loadKnowledgeBase()
const report = await auditQuestionBank(bank, knowledgeBase)

const auditPath = outputPrefix ? `${outputPrefix}.audit.json` : inputFile.replace(/\.json$/i, ".audit.json")
const reportPath = outputPrefix ? `${outputPrefix}.report.md` : inputFile.replace(/\.json$/i, ".report.md")
await Bun.write(auditPath, JSON.stringify(report, null, 2))
await Bun.write(reportPath, renderQuestionBankAuditMarkdown(report))

console.log(JSON.stringify({
  workflow: "Audit_QuestionBank_JSON_File",
  ok: true,
  input_file: inputFile,
  audit_path: auditPath,
  report_path: reportPath,
  summary: report.summary,
}, null, 2))

async function readAndValidateQuestionBank(path: string): Promise<QuestionBank> {
  const file = Bun.file(path)
  if (!(await file.exists())) {
    printValidationError("INPUT_FILE_NOT_FOUND", `Input file not found: ${path}`)
  }
  let value: unknown
  try {
    value = await file.json()
  } catch (error) {
    printValidationError("INVALID_JSON", error instanceof Error ? error.message : "Invalid JSON")
  }
  validateQuestionBank(value)
  return value
}

function validateQuestionBank(value: unknown): asserts value is QuestionBank {
  if (!isRecord(value)) printValidationError("INVALID_BANK", "Question bank must be a JSON object.")
  if (value.schema_version !== "question-bank.v1") printValidationError("INVALID_SCHEMA", "schema_version must be question-bank.v1.")
  if (typeof value.bank_id !== "string" || value.bank_id.trim() === "") printValidationError("MISSING_BANK_ID", "bank_id is required.")
  if (typeof value.kb_version !== "string" || value.kb_version.trim() === "") printValidationError("MISSING_KB_VERSION", "kb_version is required.")
  if (!Array.isArray(value.items)) printValidationError("INVALID_ITEMS", "items must be an array.")

  const seen = new Set<string>()
  value.items.forEach((item, index) => {
    if (!isRecord(item)) printValidationError("INVALID_ITEM", `items[${index}] must be an object.`)
    for (const field of ["question_id", "source_id", "fact_id", "question", "answer", "explanation"] as const) {
      if (typeof item[field] !== "string" || item[field].trim() === "") {
        printValidationError("INVALID_ITEM_FIELD", `items[${index}].${field} must be a non-empty string.`)
      }
    }
    if (seen.has(String(item.question_id))) printValidationError("DUPLICATE_QUESTION_ID", `Duplicate question_id: ${item.question_id}`)
    seen.add(String(item.question_id))
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function printValidationError(code: string, message: string, exitCode = 2): never {
  console.log(JSON.stringify({
    workflow: "Audit_QuestionBank_JSON_File",
    ok: false,
    input_file: inputFile ?? null,
    error: { code, message },
  }, null, 2))
  process.exit(exitCode)
}
