import { auditGeneratedContent } from "../fact-audit/auditor"
import type { FactAuditInput, GeneratedContentBlock } from "../fact-audit/types"
import type { KnowledgeBase, KnowledgeItem } from "../knowledge/types"
import type { RagResult, RagResultItem } from "../rag/retriever"
import type { QuestionBank, QuestionBankAuditReport, QuestionBankItem } from "./types"

export type { QuestionBankAuditReport } from "./types"

const AUDITED_AT = "2026-08-05T00:00:00.000Z"

export async function auditQuestionBank(bank: QuestionBank, knowledgeBase: KnowledgeBase): Promise<QuestionBankAuditReport> {
  const bySourceId = new Map(knowledgeBase.items.map((item) => [item.sourceId, item]))
  const items = bank.items.map((question) => {
    const knowledgeItem = bySourceId.get(question.source_id)
    if (!knowledgeItem) {
      return {
        question_id: question.question_id,
        source_id: question.source_id,
        fact_id: question.fact_id,
        audit: auditGeneratedContent({
          artifactId: question.question_id,
          generatedContent: { blocks: [toMissingEvidenceBlock(question)] },
        }),
      }
    }

    const auditInput: FactAuditInput = {
      artifactId: question.question_id,
      ragResult: toSingleItemRagResult(knowledgeItem, bank),
      generatedContent: { blocks: toAuditBlocks(question) },
    }
    return {
      question_id: question.question_id,
      source_id: question.source_id,
      fact_id: question.fact_id,
      audit: auditGeneratedContent(auditInput),
    }
  })

  const totalQuestions = bank.items.length
  const citedQuestions = bank.items.filter((item) => item.source_id.length > 0 && item.fact_id.length > 0).length
  const statusCounts = {
    pass: items.filter((item) => item.audit.status === "pass").length,
    revise: items.filter((item) => item.audit.status === "revise").length,
    reject: items.filter((item) => item.audit.status === "reject").length,
  }

  return {
    workflow: "QuestionBank_RoleA_Audit",
    bank_id: bank.bank_id,
    kb_version: bank.kb_version,
    audited_at: AUDITED_AT,
    summary: {
      total_questions: totalQuestions,
      citation_coverage: totalQuestions === 0 ? 0 : citedQuestions / totalQuestions,
      audit_pass_rate: totalQuestions === 0 ? 0 : statusCounts.pass / totalQuestions,
      unsupported_items: statusCounts.reject,
      audit_status_counts: statusCounts,
    },
    items,
  }
}

function toAuditBlocks(question: QuestionBankItem): GeneratedContentBlock[] {
  const citation = { source_id: question.source_id, fact_id: question.fact_id }
  return [
    { blockId: `${question.question_id}:question`, text: question.question, citations: [citation] },
    { blockId: `${question.question_id}:answer`, text: question.answer, citations: [citation] },
    { blockId: `${question.question_id}:explanation`, text: question.explanation, citations: [citation] },
  ]
}

function toMissingEvidenceBlock(question: QuestionBankItem): GeneratedContentBlock {
  return {
    blockId: `${question.question_id}:missing_source`,
    text: question.question,
    citations: [{ source_id: question.source_id, fact_id: question.fact_id }],
  }
}

function toSingleItemRagResult(item: KnowledgeItem, bank: QuestionBank): RagResult {
  return {
    query: `question-bank-audit:${item.sourceId}`,
    topK: 1,
    results: [toRagResultItem(item)],
  }
}

function toRagResultItem(item: KnowledgeItem): RagResultItem {
  return {
    sourceId: item.sourceId,
    source_id: item.sourceId,
    title: item.title,
    difficulty: item.difficulty,
    score: 100,
    reason: `题库审核按 source_id 绑定证据：${item.sourceId}`,
    snippet: item.snippet,
    facts: item.facts.map((fact) => ({ ...fact, source_id: fact.source_id ?? fact.sourceId, fact_id: fact.fact_id ?? fact.factId })),
    examples: item.examples,
    practiceTasks: item.practiceTasks,
    quizItems: item.quizItems,
    file: item.file,
    retrievalTrace: {
      matchedKeywords: [],
      matchedFields: ["source_id"],
      difficultyMatch: false,
      scoreBreakdown: { keyword: 0, title: 0, facts: 0, practiceTasks: 0, difficulty: 0, bonus: 0 },
    },
    retrieval_trace: {
      matched_keywords: [],
      matched_fields: ["source_id"],
      difficulty_match: false,
      score_breakdown: { keyword: 0, title: 0, facts: 0, practiceTasks: 0, difficulty: 0, bonus: 0 },
    },
  }
}
