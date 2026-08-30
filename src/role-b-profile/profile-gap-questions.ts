import type { KnowledgeDifficulty } from "../knowledge/types"
import { planNextProfileQuestion, type ProfileConfidenceQuestion, type ProfileConfidenceState } from "./profile-confidence"

export type ProfileQuestionDimension = "learning_barrier" | "task_ability" | "explanation_preference" | "practice_preference"
export type LearningBarrier = "concept_recall" | "code_translation" | "debugging" | "boundary_condition" | "problem_understanding" | "unknown"

export interface ProfileGapContext {
  goal: string
  level: KnowledgeDifficulty
  known_concepts: string[]
  weak_concepts: string[]
  recent_error_patterns: string[]
  answered_dimensions: ProfileQuestionDimension[]
  recent_action?: "remediate" | "reinforce" | "advance"
}

export interface ProfileGapQuestion {
  question_id: string
  dimension: ProfileQuestionDimension
  source_id?: string
  concept?: string
  question: string
  answer_type: "single_choice" | "text"
  options: string[]
  reason: string
}

export function nextConfidenceQuestion(state: ProfileConfidenceState): ProfileConfidenceQuestion | null {
  return planNextProfileQuestion(state)
}

export function shouldAskProfileQuestion(context: ProfileGapContext): boolean {
  return context.recent_action === "remediate"
    && context.answered_dimensions.includes("learning_barrier") === false
}

export function buildProfileGapQuestions(context: ProfileGapContext): ProfileGapQuestion[] {
  if (!shouldAskProfileQuestion(context)) return []
  return [{
    question_id: "PROFILE-GAP-LEARNING-BARRIER",
    dimension: "learning_barrier",
    question: "刚才的题目你主要卡在哪里？",
    answer_type: "single_choice",
    options: ["概念忘记了", "知道概念但不会写成代码", "代码调试困难", "边界条件没考虑", "题目没有看懂", "不确定"],
    reason: `本轮学习动作是 remediate，且薄弱知识点有 ${context.weak_concepts.length} 个，需要确认具体困难。`,
  }]
}

export function buildBarrierFollowUpQuestion(input: {
  source_id: string
  concept: string
  action: "remediate" | "reinforce" | "advance"
}): ProfileGapQuestion {
  return {
    question_id: `PROFILE-BARRIER-${input.source_id}`,
    dimension: "learning_barrier",
    source_id: input.source_id,
    concept: input.concept,
    question: `关于“${input.concept}”，你刚才主要卡在哪里？`,
    answer_type: "single_choice",
    options: ["概念忘记了", "知道概念但不会写成代码", "代码调试困难", "边界条件没考虑", "题目没有看懂", "不确定"],
    reason: `本轮学习动作是 ${input.action}，需要补充具体学习障碍。`,
  }
}

export function classifyLearningBarrier(answer: string): LearningBarrier {
  const value = answer.trim()
  if (/概念.*忘|忘.*概念|记不住/.test(value)) return "concept_recall"
  if (/写成代码|转成代码|不会.*代码|不会编程/.test(value)) return "code_translation"
  if (/调试|报错|debug/.test(value.toLowerCase())) return "debugging"
  if (/边界|特殊情况/.test(value)) return "boundary_condition"
  if (/题目.*懂|看不懂|读题/.test(value)) return "problem_understanding"
  return "unknown"
}
