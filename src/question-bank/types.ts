import type { FactAuditResult } from "../fact-audit/types"
import type { KnowledgeDifficulty } from "../knowledge/types"

export type QuestionBankSchemaVersion = "question-bank.v1"
export type QuestionPurpose = "training" | "exam" | "diagnostic"
export type QuestionType = "choice" | "short_answer" | "debugging" | "practice"
export type GradingMethod = "exact_match" | "rubric" | "unit_test"

export interface QuestionTestCase {
  input: unknown
  expected: unknown
  hidden?: boolean
}

export interface QuestionBankItem {
  question_id: string
  source_id: string
  fact_id: string
  module: string
  knowledge_title: string
  difficulty: KnowledgeDifficulty
  level: 1 | 2 | 3
  purpose: QuestionPurpose
  type: QuestionType
  question: string
  options?: string[]
  answer: string
  explanation: string
  grading_method: GradingMethod
  template_variant: string
  starter_code?: string
  test_cases?: QuestionTestCase[]
  rubric: string[]
  misconception_tags: string[]
}

export interface QuestionBank {
  schema_version: QuestionBankSchemaVersion
  bank_id: string
  kb_version: string
  generated_at: string
  generator: "deterministic-template-v1"
  policy: {
    questions_per_source: 4
    source_fact_binding_required: true
    answer_explanation_required: true
    role_a_audit_required: true
  }
  summary: {
    total_questions: number
    source_count: number
    training_items: number
    exam_items: number
    diagnostic_items: number
  }
  items: QuestionBankItem[]
}

export interface QuestionBankAuditItem {
  question_id: string
  source_id: string
  fact_id: string
  audit: FactAuditResult
}

export interface QuestionBankAuditReport {
  workflow: "QuestionBank_RoleA_Audit"
  bank_id: string
  kb_version: string
  audited_at: string
  summary: {
    total_questions: number
    citation_coverage: number
    audit_pass_rate: number
    unsupported_items: number
    audit_status_counts: {
      pass: number
      revise: number
      reject: number
    }
  }
  items: QuestionBankAuditItem[]
}

export interface WrittenQuestionBankArtifacts {
  bankPath: string
  auditPath: string
  reportPath: string
}
