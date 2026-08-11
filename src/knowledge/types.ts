export type KnowledgeDifficulty = "beginner" | "basic" | "intermediate" | "integrated"

export interface KnowledgeFact {
  sourceId: string
  factId: string
  source_id?: string
  fact_id?: string
  content: string
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
}

export interface KnowledgeBase {
  module: string
  version: string
  updatedAt: string
  sources: string[]
  items: KnowledgeItem[]
}
