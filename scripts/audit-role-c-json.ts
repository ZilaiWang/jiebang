import { auditGeneratedContent } from "../src/fact-audit/auditor"
import { adaptRoleCBlocksToFactAuditInput, type RoleCBlockContract } from "../src/fact-audit/adapters/role-c-block-adapter"
import { retrieveKnowledge } from "../src/rag/retriever"
import type { KnowledgeDifficulty } from "../src/knowledge/types"

interface RoleCArtifactJson {
  artifactId: string
  query?: string
  learnerLevel?: KnowledgeDifficulty
  topK?: number
  blocks: RoleCBlockContract[]
}

const inputFile = process.argv[2]

if (!inputFile) {
  printValidationError("MISSING_INPUT_FILE", "Usage: bun scripts/audit-role-c-json.ts <role-c-artifact.json>", 1)
}

const artifact = await readAndValidateArtifact(inputFile)

const ragResult = await retrieveKnowledge({
  query: artifact.query ?? "初学者，不会循环，需要完成成绩统计程序",
  learnerLevel: artifact.learnerLevel ?? "beginner",
  topK: artifact.topK ?? 3,
})

const auditInput = adaptRoleCBlocksToFactAuditInput({
  artifactId: artifact.artifactId,
  ragResult,
  blocks: artifact.blocks,
})

console.log(JSON.stringify({
  workflow: "Audit_RoleC_JSON_File",
  ok: true,
  input_file: inputFile,
  rag_sources: ragResult.results.map((item) => ({ source_id: item.source_id, title: item.title })),
  audit: auditGeneratedContent(auditInput),
}, null, 2))

async function readAndValidateArtifact(path: string): Promise<RoleCArtifactJson> {
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

  validateArtifact(value)
  return value
}

function validateArtifact(value: unknown): asserts value is RoleCArtifactJson {
  if (!isRecord(value)) printValidationError("INVALID_ARTIFACT", "Role C artifact must be a JSON object.")
  if (typeof value.artifactId !== "string" || value.artifactId.trim() === "") {
    printValidationError("MISSING_ARTIFACT_ID", "Role C artifact requires a non-empty artifactId.")
  }
  if (!("blocks" in value)) printValidationError("MISSING_BLOCKS", "Role C artifact requires a blocks array.")
  if (!Array.isArray(value.blocks)) printValidationError("INVALID_BLOCKS", "Role C artifact blocks must be an array.")
  if (value.learnerLevel !== undefined
    && !["beginner", "basic", "intermediate", "integrated"].includes(
      String(value.learnerLevel),
    )) {
    printValidationError(
      "INVALID_LEARNER_LEVEL",
      "learnerLevel must be beginner, basic, intermediate or integrated.",
    )
  }
  if (value.topK !== undefined && (!Number.isInteger(value.topK) || value.topK <= 0)) {
    printValidationError("INVALID_TOP_K", "topK must be a positive integer.")
  }

  const seenBlockIds = new Set<string>()
  value.blocks.forEach((block, blockIndex) => {
    if (!isRecord(block)) printValidationError("INVALID_BLOCK", `blocks[${blockIndex}] must be an object.`)
    if (typeof block.blockId !== "string" || block.blockId.trim() === "") {
      printValidationError("MISSING_BLOCK_ID", `blocks[${blockIndex}] requires a non-empty blockId.`)
    }
    if (seenBlockIds.has(block.blockId)) {
      printValidationError("DUPLICATE_BLOCK_ID", `Duplicate blockId: ${block.blockId}`)
    }
    seenBlockIds.add(block.blockId)

    if (typeof block.text !== "string" || block.text.trim() === "") {
      printValidationError("MISSING_TEXT", `blocks[${blockIndex}] requires non-empty text.`)
    }
    if (!Array.isArray(block.citations)) {
      printValidationError("INVALID_CITATIONS", `blocks[${blockIndex}].citations must be an array.`)
    }
    block.citations.forEach((citation, citationIndex) => {
      if (!isRecord(citation) || typeof citation.source_id !== "string" || citation.source_id.trim() === "" || typeof citation.fact_id !== "string" || citation.fact_id.trim() === "") {
        printValidationError("INVALID_CITATION", `blocks[${blockIndex}].citations[${citationIndex}] requires source_id and fact_id.`)
      }
    })
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function printValidationError(code: string, message: string, exitCode = 2): never {
  console.log(JSON.stringify({
    workflow: "Audit_RoleC_JSON_File",
    ok: false,
    input_file: inputFile ?? null,
    error: { code, message },
  }, null, 2))
  process.exit(exitCode)
}
