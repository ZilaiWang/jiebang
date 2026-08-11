// 输入: 无（纯类型定义）
// 输出: B 角色画像链的全部数据契约类型
// 作用: 三类证据 JSON、标准画像、溯源记录、rag_request 的统一类型来源。
// 词表约定: level 四档枚举与 schemas/rag_request.schema.json 及知识库难度完全一致。
import type { KnowledgeDifficulty } from "../knowledge/types"

// 每条抽取字段的原文引用：field 指向被支撑的字段名，text 是学习者原话逐字片段
export interface EvidenceQuote {
  field: string
  text: string
}

// background-collector 的产出：学习者背景证据（无证据的字段必须是 null / 空数组，禁止编造）
export interface BackgroundEvidence {
  evidence_type: "background"
  learner_id: string | null
  education_context: string | null
  prior_languages: string[]
  prior_topics: string[]
  goal_raw: string | null
  time_budget: string | null
  quotes: EvidenceQuote[]
}

// self-assessor 的产出：学习者自评证据
export interface SelfAssessmentEvidence {
  evidence_type: "self_assessment"
  self_rating: KnowledgeDifficulty | null
  claimed_known: string[]
  claimed_weak: string[]
  quotes: EvidenceQuote[]
}

export type DiagnosisVerdict = "correct" | "incorrect" | "unanswered"

// 客观诊断的单题记录：题目必须来自知识库 quizItems，因此天然携带 source_id/fact_id 溯源
export interface DiagnosisItem {
  source_id: string
  fact_id: string | null
  question: string
  learner_answer: string | null
  verdict: DiagnosisVerdict
  concept: string
  difficulty: KnowledgeDifficulty
}

// objective-diagnostician 的产出：客观诊断证据
export interface ObjectiveDiagnosisEvidence {
  evidence_type: "objective_diagnosis"
  items: DiagnosisItem[]
  quotes: EvidenceQuote[]
}

// 标准学习者画像：字段与 schemas/rag_request.schema.json 的 learner_profile 一一对应
export interface AbilityDimension {
  label: string
  value: number
}

export interface LearnerProfile {
  learner_id: string
  level: KnowledgeDifficulty
  known_concepts: string[]
  weak_concepts: string[]
  goal: string
  ability_dimensions?: AbilityDimension[]
}

// 单个概念进入画像的溯源：来自哪类证据、是否映射到知识库词表、命中哪些知识点
export interface ConceptProvenance {
  concept: string
  bucket: "known" | "weak"
  source: "objective" | "self" | "background"
  canonical: boolean
  matched_source_ids: string[]
}

// 自评与客观证据的冲突记录：不静默消化，交给 D 展示
// 字段名对齐统一 IO 契约（src/contracts/unified/）的 ProfileConflictView
export interface ProfileConflict {
  concept: string
  selfClaim: "known" | "weak"
  objectiveVerdict: DiagnosisVerdict
  resolution: "known" | "weak"
  rule: string
}

// 画像整体溯源：level 判定依据 + 每个概念的证据来源 + 冲突清单 + 未映射概念
export interface ProfileProvenance {
  level: {
    value: KnowledgeDifficulty
    source: "objective_cap" | "objective_promotion" | "self_rating" | "default"
    rule: string
  }
  concepts: ConceptProvenance[]
  conflicts: ProfileConflict[]
  unmapped_concepts: string[]
}

// B 交给 A 的最终请求：结构对齐 schemas/rag_request.schema.json
export interface RagRequest {
  learner_profile: LearnerProfile
  query: string
  top_k: number
}

// profile-builder 阶段的完整产出
export interface ProfileSynthesis {
  profile: LearnerProfile
  provenance: ProfileProvenance
  rag_request: RagRequest
}
