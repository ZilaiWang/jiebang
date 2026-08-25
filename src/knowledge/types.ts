export type KnowledgeDifficulty = "beginner" | "basic" | "intermediate" | "integrated"

export interface KnowledgeFact {
  sourceId: string
  factId: string
  source_id?: string
  fact_id?: string
  content: string
  /** V2 teaching metadata. Optional on legacy source files and hydrated at load time. */
  scope?: string[]
  exceptions?: string[]
  prerequisites?: string[]
  confidence?: number
  authority?: SourceAuthority
}

export type SourceAuthority = "curriculum" | "official_documentation" | "reviewed_reference"

export interface KnowledgeMisconception {
  misconceptionId: string
  incorrectBelief: string
  diagnosticSignals: string[]
  counterexample: string
  correctionStrategy: string
  distractorTemplates: string[]
  factRefs: Array<{ sourceId: string; factId: string }>
}

export interface KnowledgeWorkedExample {
  title: string
  problem: string
  steps: Array<{
    action: string
    rationale: string
    factIds: string[]
  }>
  boundaryCases: string[]
  fadingLevel: 0 | 1 | 2 | 3
}

export interface ObservableObjective {
  objectiveId: string
  behavior: "recognize" | "explain" | "trace" | "apply" | "debug" | "create"
  description: string
  factIds: string[]
}

export interface PracticeTemplate {
  templateId: string
  prompt: string
  cognitiveDemand: "understand" | "apply" | "analyze" | "transfer"
  factIds: string[]
}

export interface KnowledgeExample {
  title: string
  code: string
  explanation: string
}

export interface KnowledgeQuizItem {
  level: number
  type: string
  question: string
  options?: string[]
  answer: string
  sourceId: string
  factId: string
}

export interface KnowledgeItem {
  sourceId: string
  title: string
  module: string
  difficulty: KnowledgeDifficulty
  prerequisites: string[]
  keywords: string[]
  file: string
  snippet: string
  facts: KnowledgeFact[]
  examples: KnowledgeExample[]
  practiceTasks: string[]
  quizItems: KnowledgeQuizItem[]
  /** V2 fields are populated by the loader from the canonical source data. */
  misconceptions?: KnowledgeMisconception[]
  workedExamples?: KnowledgeWorkedExample[]
  counterexamples?: string[]
  observableObjectives?: ObservableObjective[]
  practiceTemplates?: PracticeTemplate[]
  assessmentConstraints?: string[]
}

export interface KnowledgeBase {
  module: string
  version: string
  updatedAt: string
  sources: string[]
  items: KnowledgeItem[]
}
