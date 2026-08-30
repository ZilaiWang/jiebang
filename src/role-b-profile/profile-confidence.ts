import type { LearnerProfile } from "./types"

export function profileConfidenceEvidenceFromProfile(profile: Pick<LearnerProfile, "learner_id" | "goal" | "goal_profile" | "level" | "known_concepts" | "weak_concepts" | "learning_barriers">): ProfileConfidenceEvidence {
  return {
    has_explicit_goal: profile.goal.trim().length > 0,
    has_goal_profile: profile.goal_profile !== undefined,
    self_rating_present: profile.level !== "beginner",
    objective_answered_count: profile.known_concepts.length + profile.weak_concepts.length,
    objective_consistency: profile.known_concepts.length + profile.weak_concepts.length > 0 ? 0.75 : 0,
    known_concept_count: profile.known_concepts.length,
    weak_concept_count: profile.weak_concepts.length,
    barrier_observation_count: profile.learning_barriers?.reduce((sum, item) => sum + item.count, 0) ?? 0,
    task_ability_observation_count: 0,
    explanation_preference_confirmed: false,
    practice_preference_confirmed: false,
  }
}

export function profileConfidenceStateFromProfile(profile: Pick<LearnerProfile, "learner_id" | "goal" | "goal_profile" | "level" | "known_concepts" | "weak_concepts" | "learning_barriers">): ProfileConfidenceState {
  return buildProfileConfidenceState(profileConfidenceEvidenceFromProfile(profile))
}

export type ProfileConfidenceDimension =
  | "goal"
  | "goal_profile"
  | "level"
  | "knowledge_state"
  | "learning_barrier"
  | "task_ability"
  | "explanation_preference"
  | "practice_preference"

export interface ProfileConfidenceEvidence {
  has_explicit_goal: boolean
  has_goal_profile: boolean
  self_rating_present: boolean
  objective_answered_count: number
  objective_consistency: number
  known_concept_count: number
  weak_concept_count: number
  barrier_observation_count: number
  task_ability_observation_count: number
  explanation_preference_confirmed: boolean
  practice_preference_confirmed: boolean
}

export interface ProfileConfidenceField {
  confidence: number
  impact: number
  evidence_count: number
  status: "sufficient" | "uncertain"
}

export interface ProfileConfidenceState {
  version: "profile-confidence.v1"
  fields: Record<ProfileConfidenceDimension, ProfileConfidenceField>
  answered_question_ids: string[]
  round_no: number
}

export interface ProfileConfidenceQuestion {
  question_id: string
  dimension: ProfileConfidenceDimension
  question: string
  answer_type: "single_choice" | "text"
  options: string[]
  priority_score: number
  reason: string
}

const THRESHOLD = 0.75
const IMPACT: Record<ProfileConfidenceDimension, number> = {
  goal: 1.0,
  goal_profile: 0.9,
  level: 0.95,
  knowledge_state: 0.9,
  learning_barrier: 0.85,
  task_ability: 0.9,
  explanation_preference: 0.45,
  practice_preference: 0.5,
}

export function buildProfileConfidenceState(evidence: ProfileConfidenceEvidence): ProfileConfidenceState {
  const objectiveConsistency = clamp(evidence.objective_consistency)
  const objectiveEvidence = Math.min(1, evidence.objective_answered_count / 3)
  const fields: Record<ProfileConfidenceDimension, ProfileConfidenceField> = {
    goal: field(evidence.has_explicit_goal ? 0.95 : 0.1, evidence.has_explicit_goal ? 1 : 0, "goal"),
    goal_profile: field(evidence.has_goal_profile ? 0.95 : 0.1, evidence.has_goal_profile ? 1 : 0, "goal_profile"),
    level: field(clamp((evidence.self_rating_present ? 0.45 : 0.1) + objectiveEvidence * 0.5 * objectiveConsistency), evidence.objective_answered_count, "level"),
    knowledge_state: field(clamp(objectiveEvidence * objectiveConsistency + (evidence.known_concept_count > 0 ? 0.1 : 0)), evidence.objective_answered_count, "knowledge_state"),
    learning_barrier: field(Math.min(1, evidence.barrier_observation_count * 0.4), evidence.barrier_observation_count, "learning_barrier"),
    task_ability: field(Math.min(1, evidence.task_ability_observation_count * 0.4), evidence.task_ability_observation_count, "task_ability"),
    explanation_preference: field(evidence.explanation_preference_confirmed ? 0.9 : 0.2, evidence.explanation_preference_confirmed ? 1 : 0, "explanation_preference"),
    practice_preference: field(evidence.practice_preference_confirmed ? 0.9 : 0.2, evidence.practice_preference_confirmed ? 1 : 0, "practice_preference"),
  }
  return { version: "profile-confidence.v1", fields, answered_question_ids: [], round_no: 0 }
}

export function planNextProfileQuestion(state: ProfileConfidenceState): ProfileConfidenceQuestion | null {
  const candidates = (Object.entries(state.fields) as Array<[ProfileConfidenceDimension, ProfileConfidenceField]>)
    .filter(([dimension, fieldValue]) => fieldValue.confidence < THRESHOLD && !state.answered_question_ids.includes(questionId(dimension)))
    .map(([dimension, fieldValue]) => ({ dimension, fieldValue, priority: IMPACT[dimension] * (1 - fieldValue.confidence) }))
    .sort((a, b) => b.priority - a.priority)
  const selected = candidates[0]
  if (!selected) return null
  return questionFor(selected.dimension, selected.priority, selected.fieldValue.confidence)
}

export function applyProfileConfidenceAnswer(
  state: ProfileConfidenceState,
  input: { question_id: string; dimension: ProfileConfidenceDimension; answer: string },
): ProfileConfidenceState {
  if (!input.answer.trim()) throw new Error("PROFILE_CONFIDENCE_ANSWER_EMPTY")
  if (input.question_id !== questionId(input.dimension)) throw new Error("PROFILE_CONFIDENCE_QUESTION_MISMATCH")
  const next = structuredClone(state)
  const current = next.fields[input.dimension]
  current.confidence = Math.min(1, Math.max(current.confidence + 0.35, 0.8))
  current.evidence_count += 1
  current.status = current.confidence >= THRESHOLD ? "sufficient" : "uncertain"
  if (!next.answered_question_ids.includes(input.question_id)) next.answered_question_ids.push(input.question_id)
  next.round_no += 1
  return next
}

function field(confidence: number, evidenceCount: number, dimension: ProfileConfidenceDimension): ProfileConfidenceField {
  const value = clamp(confidence)
  return { confidence: value, impact: IMPACT[dimension], evidence_count: evidenceCount, status: value >= THRESHOLD ? "sufficient" : "uncertain" }
}

function questionId(dimension: ProfileConfidenceDimension): string {
  return `PROFILE-CONFIDENCE-${dimension}`
}

function questionFor(dimension: ProfileConfidenceDimension, priority: number, confidence: number): ProfileConfidenceQuestion {
  const common = { question_id: questionId(dimension), dimension, answer_type: "single_choice" as const, priority_score: Number(priority.toFixed(4)), reason: `当前置信度 ${confidence.toFixed(2)}，该维度教学影响度为 ${IMPACT[dimension].toFixed(2)}。` }
  if (dimension === "task_ability") return { ...common, question: "你目前不看答案能独立完成哪些任务？", options: ["看懂代码", "完成基础题", "完成综合题", "调试报错", "目前都不能稳定完成"] }
  if (dimension === "learning_barrier") return { ...common, question: "你学习这个内容时最容易卡在哪里？", options: ["概念理解", "题目转代码", "代码调试", "边界条件", "题目理解", "不确定"] }
  if (dimension === "level") return { ...common, question: "你目前能独立完成哪种难度的相关任务？", options: ["只能跟着示例", "能完成基础题", "能完成变式题", "能完成综合项目"] }
  if (dimension === "knowledge_state") return { ...common, question: "下面哪些相关知识点你能不看资料解释并应用？", options: ["基础概念", "典型方法", "综合应用", "目前都不能确定"] }
  if (dimension === "explanation_preference") return { ...common, question: "遇到新知识时，哪种讲法最有帮助？", options: ["先看例子", "先讲原理", "先看图", "先做题"] }
  if (dimension === "practice_preference") return { ...common, question: "你希望下一轮主要练习什么？", options: ["选择题", "代码阅读", "编程题", "综合案例"] }
  return { ...common, question: dimension === "goal" ? "你学习这个内容最主要想解决什么问题？" : "你的学习目标更接近哪种场景？", options: ["课程学习", "算法竞赛", "求职面试", "实际项目", "个人兴趣"] }
}

function clamp(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
}
