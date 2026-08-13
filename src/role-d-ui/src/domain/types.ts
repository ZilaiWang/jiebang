export type Difficulty = "beginner" | "basic" | "intermediate" | "integrated"
export type WorkflowStatus = "pending" | "running" | "completed" | "review" | "blocked"
export type ArtifactKind = "lesson" | "lab" | "assessment"
export type ArtifactStatus = "real" | "mock"

export interface LearnerProfileView {
  learnerId: string
  profileVersion?: string
  level: Difficulty
  knownConcepts: string[]
  weakConcepts: string[]
  goal: string
}

export interface ProfileConflictView {
  concept: string
  selfClaim: "known" | "weak"
  objectiveVerdict: string
  resolution: "known" | "weak"
  rule: string
}

export interface RetrievalFactView {
  sourceId: string
  factId: string
  content: string
}

export interface ScoreBreakdownView {
  keyword: number
  title: number
  facts: number
  practiceTasks: number
  difficulty: number
  bonus: number
}

export interface RetrievalItemView {
  sourceId: string
  title: string
  difficulty: Difficulty
  score: number
  reason: string
  snippet: string
  file: string
  facts: RetrievalFactView[]
  examples: Array<{ title: string; code: string; explanation: string }>
  practiceTasks: string[]
  quizItems: Array<{ level: number; question: string; answer: string }>
  trace: {
    matchedKeywords: string[]
    matchedFields: string[]
    difficultyMatch: boolean
    scoreBreakdown: ScoreBreakdownView
  }
}

export interface CitationView {
  sourceId: string
  factId: string
}

export interface LearningArtifactView {
  id: string
  kind: ArtifactKind
  title: string
  status: ArtifactStatus
  content: string
  options: string[]
  items?: Array<{
    id: string
    tier: 1 | 2 | 3
    modality: "mcq" | "true_false" | "trace" | "short_answer" | "code"
    prompt: string
    options: string[]
    optionIds?: string[]
    starterCode?: string
    citations: CitationView[]
  }>
  citations: CitationView[]
  evidenceStatus: "grounded" | "gap"
}

export interface WorkflowEventView {
  id: string
  agent: string
  stage: string
  status: WorkflowStatus
  summary: string
  timestamp: string
}

export interface LearningPathNodeView {
  id: string
  title: string
  difficulty: Difficulty
  status: "completed" | "current" | "upcoming"
  reason: string
}

export type RoleCAction = "remediate" | "reinforce" | "advance" | "reprofile"

export interface RoleCDecisionView {
  next: RoleCAction
  reason: string
}

export interface RoleCFeedbackView {
  feedbackId: string
  submissionId: string
  learnerId: string
  profileVersion: string
  pathNodeId: string
  roundScore: {
    rawScore: number
    maxScore: number
    accuracy: number
    evidenceScore: number
  }
  objectiveResults: Array<{
    objectiveId: string
    rawScore: number
    maxScore: number
    accuracy: number
    evidenceScore: number
    misconceptionTags: string[]
  }>
  itemResults: Array<{
    itemId: string
    objectiveId: string
    status: string
    rawScore: number
    maxScore: number
    evidenceScore: number
    misconceptionTags: string[]
  }>
  masterySnapshot: Array<{
    objectiveId: string
    mastery: number
    evidenceBatches: number
    observedModalities: string[]
    revision: number
  }>
  finalDecision: {
    action: RoleCAction
    basis: "round_accuracy" | "profile_drift"
    confidence: number
    reasonCodes: string[]
    targetObjectiveIds: string[]
    policyRef: string
  }
  feedbackSummary: string
}

export interface RoleDSession {
  version: 1
  eventMode: "demo" | "live"
  sessionId: string
  updatedAt: string
  profile: LearnerProfileView
  conflicts: ProfileConflictView[]
  retrieval: {
    query: string
    topK: number
    items: RetrievalItemView[]
  }
  artifacts: LearningArtifactView[]
  evidenceGaps: string[]
  workflow: WorkflowEventView[]
  path: LearningPathNodeView[]
  decision: RoleCDecisionView
  assessmentGraded?: boolean
  planSource: "demo" | "real-ab"
  planInput: {
    learnerId: string
    educationContext: string
    timeBudget: string
    priorLanguages?: string[]
    knownConcepts: string[]
    weakConcepts: string[]
  }
  diagnosis: Record<string, any>
  view: Record<string, any>
  [key: string]: any
}
