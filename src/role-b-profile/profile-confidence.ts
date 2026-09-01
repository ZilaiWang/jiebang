import type { LearnerProfile } from "./types"
import type { LearnerProfileV2, LearningGoalUseCase } from "./learner-profile-v2"
import type { LearningBarrier } from "./profile-gap-questions"
import type { GoalProfile } from "../role-c-content/planning/personalization-policy"

type ConfidenceProfileView = Pick<LearnerProfile, "learner_id" | "goal" | "goal_profile" | "level" | "known_concepts" | "weak_concepts" | "learning_barriers">
  & Partial<Pick<LearnerProfileV2, "learning_preferences" | "provenance">>

export function profileConfidenceEvidenceFromProfile(profile: ConfidenceProfileView): ProfileConfidenceEvidence {
  const learnerFields = new Set(
    profile.provenance?.field_sources
      .filter((entry) => entry.source === "learner")
      .map((entry) => entry.field) ?? [],
  )
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
    explanation_preference_confirmed: learnerFields.has("learning_preferences.explanation"),
    practice_preference_confirmed: learnerFields.has("learning_preferences.practice"),
  }
}

export function profileConfidenceStateFromProfile(profile: ConfidenceProfileView): ProfileConfidenceState {
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

export interface ProfileConfidenceWritebackResult {
  confidence_state: ProfileConfidenceState
  profile: LearnerProfileV2
  observation_value: string
  changed_fields: string[]
  learning_barrier?: LearningBarrier
}

/**
 * Applies the meaning of an explicit confidence answer to the structured B
 * profile. Objective level remains evidence-owned: a level answer updates only
 * self assessment and never promotes/demotes profile.level.
 */
export function applyProfileConfidenceAnswerWithWriteback(input: {
  profile: LearnerProfileV2
  state: ProfileConfidenceState
  question_id: string
  dimension: ProfileConfidenceDimension
  answer: string
  next_profile_version: string
  source_id?: string
  observed_at?: string
}): ProfileConfidenceWritebackResult {
  if (!input.next_profile_version.trim()) throw new Error("PROFILE_VERSION_EMPTY")
  const normalized = normalizeProfileConfidenceAnswer(input.dimension, input.answer)
  const confidenceState = applyProfileConfidenceAnswer(input.state, input)
  const profile = structuredClone(input.profile)
  const changedFields: string[] = []

  if (input.dimension === "goal_profile") {
    const goalProfile = normalized.value as GoalProfile
    profile.goal_profile = goalProfile
    profile.goal_context.use_case = useCaseForGoalProfile(goalProfile)
    changedFields.push("goal_profile", "goal_context.use_case")
  } else if (input.dimension === "explanation_preference") {
    profile.learning_preferences.explanation = normalized.value as LearnerProfileV2["learning_preferences"]["explanation"]
    changedFields.push("learning_preferences.explanation")
  } else if (input.dimension === "practice_preference") {
    profile.learning_preferences.practice = normalized.value as LearnerProfileV2["learning_preferences"]["practice"]
    changedFields.push("learning_preferences.practice")
  } else if (input.dimension === "level") {
    profile.self_assessment.reported_level = normalized.value as LearnerProfileV2["self_assessment"]["reported_level"]
    changedFields.push("self_assessment.reported_level")
  } else if (input.dimension === "learning_barrier" && normalized.learning_barrier) {
    const sourceId = input.source_id?.trim() || "PROFILE-GENERAL"
    const existing = (profile.learning_barriers ?? []).find((entry) =>
      entry.source_id === sourceId && entry.barrier === normalized.learning_barrier)
    if (existing) existing.count += 1
    else profile.learning_barriers = [
      ...(profile.learning_barriers ?? []),
      { source_id: sourceId, barrier: normalized.learning_barrier, count: 1 },
    ]
    changedFields.push("learning_barriers")
  }

  const observedAt = input.observed_at ?? new Date().toISOString()
  profile.profile_version = input.next_profile_version
  profile.revision += 1
  profile.updated_at = observedAt
  profile.confidence_state = structuredClone(confidenceState)
  profile.provenance.field_sources = dedupeFieldSources([
    ...profile.provenance.field_sources,
    ...changedFields.map((field) => ({ field, source: "learner" as const, observed_at: observedAt })),
  ])
  return {
    confidence_state: confidenceState,
    profile,
    observation_value: normalized.value,
    changed_fields: changedFields,
    ...(normalized.learning_barrier ? { learning_barrier: normalized.learning_barrier } : {}),
  }
}

export function normalizeProfileConfidenceAnswer(
  dimension: ProfileConfidenceDimension,
  answer: string,
): { value: string; learning_barrier?: LearningBarrier } {
  const value = answer.trim()
  if (!value) throw new Error("PROFILE_CONFIDENCE_ANSWER_EMPTY")
  if (dimension === "goal_profile") {
    if (/竞赛/u.test(value)) return { value: "algorithm_competition" }
    if (/求职|面试|岗位/u.test(value)) return { value: "job_interview" }
    if (/课程|考试|认证/u.test(value)) return { value: "coursework" }
    return { value: "general_learning" }
  }
  if (dimension === "explanation_preference") {
    if (/原理|推导/u.test(value)) return { value: "principle_first" }
    if (/例子|示例/u.test(value)) return { value: "example_first" }
    if (/图|类比|生活/u.test(value)) return { value: "analogy_first" }
    if (/做题|步骤/u.test(value)) return { value: "step_by_step" }
    return { value: "balanced" }
  }
  if (dimension === "practice_preference") {
    if (/编程|写代码/u.test(value)) return { value: "coding" }
    if (/综合|项目|案例/u.test(value)) return { value: "project" }
    if (/选择|填空|短答/u.test(value)) return { value: "quiz" }
    return { value: "mixed" }
  }
  if (dimension === "learning_barrier") {
    const barrier = classifyBarrier(value)
    return { value: barrier, learning_barrier: barrier }
  }
  if (dimension === "level") {
    if (/综合项目|综合题/u.test(value)) return { value: "integrated" }
    if (/变式|独立.*简单/u.test(value)) return { value: "intermediate" }
    if (/基础题/u.test(value)) return { value: "basic" }
    return { value: "beginner" }
  }
  if (dimension === "task_ability") {
    if (/综合/u.test(value)) return { value: "integrated_tasks" }
    if (/调试/u.test(value)) return { value: "debug_tasks" }
    if (/基础/u.test(value)) return { value: "basic_tasks" }
    if (/看懂|阅读/u.test(value)) return { value: "read_code" }
    return { value: "not_stable" }
  }
  if (dimension === "knowledge_state") {
    if (/综合/u.test(value)) return { value: "integrated_application" }
    if (/典型|方法/u.test(value)) return { value: "typical_methods" }
    if (/基础|概念/u.test(value)) return { value: "basic_concepts" }
    return { value: "uncertain" }
  }
  return { value: value.slice(0, 120) }
}

function useCaseForGoalProfile(value: GoalProfile): LearningGoalUseCase {
  if (value === "algorithm_competition") return "competition"
  if (value === "job_interview") return "job"
  if (value === "coursework") return "coursework"
  return "interest"
}

function classifyBarrier(value: string): LearningBarrier {
  if (/概念.*忘|忘.*概念|记不住|概念理解/u.test(value)) return "concept_recall"
  if (/写成代码|转成代码|不会.*代码|题目转代码/u.test(value)) return "code_translation"
  if (/调试|报错|debug/iu.test(value)) return "debugging"
  if (/边界|特殊情况/u.test(value)) return "boundary_condition"
  if (/题目.*懂|看不懂|读题|题目理解/u.test(value)) return "problem_understanding"
  return "unknown"
}

function dedupeFieldSources(entries: LearnerProfileV2["provenance"]["field_sources"]): LearnerProfileV2["provenance"]["field_sources"] {
  const values = new Map<string, LearnerProfileV2["provenance"]["field_sources"][number]>()
  for (const entry of entries) values.set(`${entry.field}\u0000${entry.source}\u0000${entry.source_ref ?? ""}`, entry)
  return [...values.values()]
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
