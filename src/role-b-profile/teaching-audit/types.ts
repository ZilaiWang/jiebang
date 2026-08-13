// 输入: 无（纯类型定义）
// 输出: 教学审核与仲裁机制的完整数据契约
// 作用: B 角色 Week2 主线——教学审核（审核 C 生成内容的教学规范性）+ 仲裁（合并 A 事实审核与 B 教学审核）
//       Week3 扩展——结构化失败信息、路径规划、学习进展接收（C→B）
// 与 A 的事实审核互补：A 审"引用了没"，B 审"教得对不对"
import type { KnowledgeBase, KnowledgeDifficulty } from "../../knowledge/types"
import type { LearnerProfile } from "../types"
import type { LearningPathNode, LearningObjective, AssessmentBlueprint, LearnerProfileSnapshot } from "../../role-c-content/contracts/profile-adapter"
import type { DynamicFeedbackResult } from "../../role-c-content/contracts/dynamic-feedback"

// ── 教学审核维度 ──

export type TeachingAuditDimension =
  | "difficulty_alignment"   // 内容难度是否匹配学习者水平
  | "prerequisite_coverage"  // 前置知识是否已被学习者掌握
  | "weak_concept_coverage"  // 薄弱点是否被教学内容覆盖
  | "goal_alignment"         // 教学内容是否服务学习目标

export type TeachingAuditVerdict =
  | "aligned"        // 教学上合理
  | "misaligned"     // 不匹配（难度/前置/薄弱点）
  | "incomplete"     // 覆盖不足
  | "overscaffolded" // 过度简化（学习者水平高于内容）

export type TeachingAuditStatus = "pass" | "revise" | "reject"

// ── 恢复动作类型 ──

export type RequiredAction =
  | "adjust_content"       // artifact 范围内调整内容（修订即可）
  | "request_new_evidence"  // 需要 A 补充证据
  | "replan_path"           // 需要重新规划学习路径
  | "reprofile_learner"     // 需要更新学习者画像

export type FixScope = "artifact" | "new_evidence" | "new_spec"

// ── 教学审核输入 ──

export interface TeachingAuditInput {
  artifactId: string
  learnerProfile: LearnerProfile
  knowledgeBase: KnowledgeBase
  // C 生成内容中引用的知识点 source_id 列表（从 citations 提取）
  citedSourceIds: string[]
  // C 生成内容的目标知识点（默认为 citedSourceIds 去重）
  targetSourceIds?: string[]
  // 可选：教学内容的文本摘要，用于目标对齐判断
  contentSummary?: string
}

// ── 审核维度结果 ──

export interface DifficultyCheck {
  dimension: "difficulty_alignment"
  verdict: TeachingAuditVerdict
  learnerLevel: KnowledgeDifficulty
  contentMaxDifficulty: KnowledgeDifficulty | null
  reason: string
}

export interface PrerequisiteCheck {
  dimension: "prerequisite_coverage"
  verdict: TeachingAuditVerdict
  checkedConcepts: Array<{
    sourceId: string
    title: string
    prerequisites: string[]
    missingPrerequisites: string[]
  }>
  reason: string
}

export interface WeakConceptCheck {
  dimension: "weak_concept_coverage"
  verdict: TeachingAuditVerdict
  learnerWeakConcepts: string[]
  coveredWeakConcepts: string[]
  uncoveredWeakConcepts: string[]
  reason: string
}

export interface GoalCheck {
  dimension: "goal_alignment"
  verdict: TeachingAuditVerdict
  learnerGoal: string
  reason: string
}

// ── 教学审核输出（扩展版） ──

export interface TeachingAuditResult {
  artifactId: string
  learnerId: string
  status: TeachingAuditStatus
  checks: {
    difficulty: DifficultyCheck
    prerequisite: PrerequisiteCheck
    weakConcept: WeakConceptCheck
    goal: GoalCheck
  }
  summary: string
  revisionHints: string[]
  // ── Week3 扩展：结构化失败信息 ──
  /** 本次审核失败的维度列表 */
  failedDimensions: TeachingAuditDimension[]
  /** 缺失的前置知识 source_id 列表（从知识库中解析出的，不是学习者自述的概念名） */
  missingPrerequisiteSourceIds: string[]
  /** 知识库中不存在的前置知识点（无法解析的未知引用） */
  unknownPrerequisiteRefs: string[]
  /** C 需要的恢复动作 */
  requiredAction: RequiredAction
  /** 修复范围 */
  fixScope: FixScope
  /** 建议的学习者水平（仅在难度不匹配时有值） */
  recommendedLevel: KnowledgeDifficulty | null
  /** 是否可以通过重新规划路径恢复（非硬性驳回） */
  canRecover: boolean
}

// ── 路径规划 ──

export interface PlanRecoveryPathInput {
  learnerProfile: LearnerProfile
  knowledgeBase: KnowledgeBase
  auditResult: TeachingAuditResult
  /** C 当前的 generation_spec 路径节点，用于参考 */
  currentPathNode?: {
    target_source_ids: string[]
    prerequisite_source_ids: string[]
    goal: string
  }
}

export interface PlanRecoveryPathResult {
  /** 新规划的路径节点 */
  pathNode: LearningPathNode
  /** 规划说明 */
  rationale: string
  /** 是否需要A重新检索（新的 target_source_ids 与之前不同则需重新检索） */
  requiresNewRag: boolean
}

// ── 学习进展接收（C→B） ──

export interface ReceiveProgressInput {
  /** C 的动态反馈结果 */
  feedback: DynamicFeedbackResult
  /** 当前画像 */
  currentProfile: LearnerProfile
  /** 画像版本号递增依据（从 C 的 profile_version 解析） */
  profileVersion: string
}

export interface ReceiveProgressResult {
  /** 更新后的画像 */
  profile: LearnerProfile
  /** 新版画像快照（可直接交给 C） */
  snapshot: LearnerProfileSnapshot
  /** 本次更新的变更摘要 */
  changes: {
    levelChanged: boolean
    oldLevel: KnowledgeDifficulty
    newLevel: KnowledgeDifficulty
    knownAdded: string[]
    knownPromotedFromWeak: string[]
    weakAdded: string[]
    weakCleared: string[]
  }
}

/** B 内部统一使用的学习进展观察；可由完整反馈或 C 的进展信封转换得到。 */
export interface ProgressObservation {
  observationId: string
  action: DynamicFeedbackResult["final_decision"]["action"]
  /** 仅完整轮次反馈提供；事件批次缺少总分分母时为 null。 */
  overallAccuracy: number | null
  mastery: Array<{
    objectiveId: string
    mastery: number
    evidenceBatches: number
  }>
  /** 具有明确 source_id 的事件可用于更新画像中的知识点。 */
  conceptEvidence: Array<{
    sourceId: string
    concept: string
    evidenceScore: number
    evidenceBatches: number
  }>
}

export interface ApplyProgressObservationInput {
  observation: ProgressObservation
  currentProfile: LearnerProfile
  profileVersion: string
  conceptMatches?: (
    profileConcept: string,
    observation: ProgressObservation["conceptEvidence"][number],
  ) => boolean
}

// ── 仲裁机制 ──

export interface ArbitrationInput {
  artifactId: string
  factAuditStatus: "pass" | "revise" | "reject"
  teachingAuditStatus: TeachingAuditStatus
  revisionRound: number  // 当前是第几轮修订（从 0 开始，首轮为 0）
}

export type ArbitrationDecision = "pass" | "revise" | "reject"

export interface ArbitrationResult {
  artifactId: string
  decision: ArbitrationDecision
  revisionRound: number
  maxRevisionRounds: number
  canRevise: boolean
  reason: string
  // 分别来自两个审核的建议
  factAuditNotes: string[]
  teachingAuditNotes: string[]
}
