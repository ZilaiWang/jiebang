import type { KnowledgeDifficulty } from "../knowledge/types"
import type { ProfileSnapshotOptions } from "../role-c-content/contracts/profile-adapter"
import { applyProgressObservation } from "./teaching-audit/progress-receiver"
import type {
  ProgressObservation,
  ReceiveProgressResult,
} from "./teaching-audit/types"
import type { AbilityDimension, LearnerProfile } from "./types"
import { buildRoleCPedagogyContract } from "./pedagogy-contract"

export type LearningGoalUseCase =
  | "coursework"
  | "competition"
  | "job"
  | "project"
  | "certification"
  | "interest"
  | "other"

export type ExplanationPreference =
  | "analogy_first"
  | "principle_first"
  | "example_first"
  | "step_by_step"
  | "balanced"

export type PracticePreference =
  | "quiz"
  | "coding"
  | "project"
  | "mixed"

export type LearningPacePreference = "slow" | "steady" | "fast"
export type ProfileRetention = "session_only" | "cross_session"

/**
 * 学习者画像 v2 的结构化采集输入。
 *
 * 所有字段都来自学习者明确回答或已有可信证据。背景与偏好使用独立字段，
 * 不再要求调用方把它们拼成一段不可计算的 background 文本。
 */
export interface LearnerProfileIntakeV2 {
  learner_id: string
  goal?: string
  background_summary?: string
  education_stage?: string
  discipline_background?: string[]
  role_context?: string
  prior_languages?: string[]
  prior_topics?: string[]
  self_rating?: KnowledgeDifficulty
  goal_use_case?: LearningGoalUseCase
  desired_outcome?: string
  deadline?: string
  weekly_time_budget_minutes?: number
  session_time_budget_minutes?: number
  explanation_preference?: ExplanationPreference
  practice_preference?: PracticePreference
  pace_preference?: LearningPacePreference
  preferred_contexts?: string[]
  tool_constraints?: string[]
  accommodations?: string[]
  privacy?: Partial<ProfilePrivacyPreferences>
}

export interface ProfilePrivacyPreferences {
  personalization_enabled: boolean
  retention: ProfileRetention
  allow_profile_display: boolean
}

export type ProfileFieldSource =
  | "learner"
  | "objective_diagnosis"
  | "assessment_history"
  | "learner_memory"
  | "system_default"

export interface ProfileFieldProvenance {
  field: string
  source: ProfileFieldSource
  observed_at: string
  source_ref?: string
  confidence?: number
}

export interface LearnerProfileV2 extends LearnerProfile {
  schema_version: "2.0"
  profile_id: string
  profile_version: string
  revision: number
  background_context: {
    summary: string | null
    education_stage: string | null
    discipline_background: string[]
    role_context: string | null
    prior_languages: string[]
    prior_topics: string[]
  }
  goal_context: {
    use_case: LearningGoalUseCase
    desired_outcome: string | null
    deadline: string | null
  }
  self_assessment: {
    reported_level: KnowledgeDifficulty
  }
  learning_preferences: {
    explanation: ExplanationPreference
    practice: PracticePreference
    pace: LearningPacePreference
    preferred_contexts: string[]
  }
  learning_constraints: {
    weekly_time_budget_minutes: number
    session_time_budget_minutes: number | null
    tool_constraints: string[]
    accommodations: string[]
  }
  progress: {
    mastery_by_source_id: Record<string, number>
    completed_session_ids: string[]
    recent_error_patterns: string[]
    last_observation_id: string | null
    last_observed_at: string | null
    last_assessment_accuracy: number | null
  }
  privacy: ProfilePrivacyPreferences
  provenance: {
    field_sources: ProfileFieldProvenance[]
  }
  created_at: string
  updated_at: string
}

export type ProfileClarificationQuestionId =
  | "profile.goal"
  | "profile.background"
  | "profile.self_rating"
  | "profile.goal_use_case"
  | "profile.weekly_time_budget"
  | "profile.desired_outcome"
  | "profile.explanation_preference"
  | "profile.practice_preference"
  | "profile.preferred_contexts"
  | "profile.tool_constraints"
  | "profile.retention"

export interface ProfileClarificationOption {
  value: string
  label: string
}

export interface ProfileClarificationQuestion {
  id: ProfileClarificationQuestionId
  target_field: string
  prompt: string
  reason: string
  answer_type: "text" | "number" | "single_choice" | "multi_text"
  required: boolean
  priority: number
  options?: ProfileClarificationOption[]
}

export interface ProfileClarificationAnswer {
  question_id: ProfileClarificationQuestionId
  value: string | string[] | number
}

export interface ProfileIntakeAssessment {
  status: "ready" | "needs_clarification"
  completeness: {
    score: number
    required_completed: number
    required_total: number
    recommended_completed: number
    recommended_total: number
  }
  missing_required_fields: string[]
  missing_recommended_fields: string[]
  questions: ProfileClarificationQuestion[]
}

export interface CreateLearnerProfileV2Input {
  core_profile: LearnerProfile
  intake: LearnerProfileIntakeV2
  profile_id?: string
  profile_version?: string
  observed_at?: string
  field_sources?: ProfileFieldProvenance[]
}

export interface PersonalizationProfileHandoff {
  schema_version: "1.0"
  source_profile: {
    profile_id: string
    profile_version: string
    revision: number
  }
  learner: {
    learner_id: string
    level: KnowledgeDifficulty
    self_reported_level: KnowledgeDifficulty
    known_concepts: string[]
    weak_concepts: string[]
  }
  goal: {
    text: string
    use_case: LearningGoalUseCase
    desired_outcome: string | null
    deadline: string | null
  }
  background: LearnerProfileV2["background_context"]
  presentation: LearnerProfileV2["learning_preferences"]
  constraints: LearnerProfileV2["learning_constraints"]
  progress: LearnerProfileV2["progress"]
  privacy: ProfilePrivacyPreferences
}

export interface UpdateLearnerProfileV2Input {
  profile: LearnerProfileV2
  observation: ProgressObservation
  next_profile_version: string
  observed_at?: string
  completed_session_id?: string
  concept_matches?: (
    profileConcept: string,
    observation: ProgressObservation["conceptEvidence"][number],
  ) => boolean
}

export interface UpdateLearnerProfileV2Result {
  profile: LearnerProfileV2
  changes: ReceiveProgressResult["changes"]
  role_c_snapshot_options: ProfileSnapshotOptions
}

export interface UpdateLearnerProfileFromAnswersInput {
  profile: LearnerProfileV2
  /** 只填写本轮被学习者明确补充或纠正的字段。 */
  intake_patch: LearnerProfileIntakeV2
  next_profile_version: string
  observed_at?: string
}

export interface UpdateLearnerProfileFromAnswersResult {
  profile: LearnerProfileV2
  changed_fields: string[]
  role_c_snapshot_options: ProfileSnapshotOptions
}

const GOAL_USE_CASE_OPTIONS: ProfileClarificationOption[] = [
  { value: "coursework", label: "完成课程学习或作业" },
  { value: "competition", label: "参加算法或技能竞赛" },
  { value: "job", label: "求职或岗位能力提升" },
  { value: "project", label: "完成实际项目" },
  { value: "certification", label: "准备考试或认证" },
  { value: "interest", label: "个人兴趣学习" },
  { value: "other", label: "其他目标" },
]

const SELF_RATING_OPTIONS: ProfileClarificationOption[] = [
  { value: "beginner", label: "刚开始接触" },
  { value: "basic", label: "掌握少量基础" },
  { value: "intermediate", label: "能独立完成简单任务" },
  { value: "integrated", label: "能完成综合应用" },
]

const EXPLANATION_OPTIONS: ProfileClarificationOption[] = [
  { value: "analogy_first", label: "先用类比和生活化语言" },
  { value: "principle_first", label: "先解释原理和推导" },
  { value: "example_first", label: "先看具体例子" },
  { value: "step_by_step", label: "按步骤逐项讲解" },
  { value: "balanced", label: "讲解、例子和练习平衡" },
]

const PRACTICE_OPTIONS: ProfileClarificationOption[] = [
  { value: "quiz", label: "选择、填空和短答" },
  { value: "coding", label: "编程练习" },
  { value: "project", label: "项目或综合任务" },
  { value: "mixed", label: "多种形式混合" },
]

const RETENTION_OPTIONS: ProfileClarificationOption[] = [
  { value: "session_only", label: "只在当前学习会话使用" },
  { value: "cross_session", label: "后续学习继续使用并更新" },
]

/**
 * 检查画像采集是否具备开始个性化规划的必要信息，并按优先级返回补充问题。
 * 默认每轮最多问 3 个问题；调用方可在收到回答后再次调用，形成有限多轮追问。
 */
export function assessProfileIntake(
  intake: LearnerProfileIntakeV2,
  options: { max_questions?: number; include_recommended?: boolean } = {},
): ProfileIntakeAssessment {
  const maxQuestions = Math.max(1, Math.min(10, options.max_questions ?? 3))
  const requiredChecks = [
    check("goal", hasText(intake.goal), question("profile.goal", "goal", "你希望学会什么，最终想完成什么？", "学习目标决定诊断范围和后续路径", "text", true, 100)),
    check("background_context", hasBackground(intake), question("profile.background", "background_summary", "请简单介绍你的学习或工作背景，以及接触过的相关知识。", "背景信息用于选择合适的解释方式和起点", "text", true, 90)),
    check("self_rating", Boolean(intake.self_rating), question("profile.self_rating", "self_rating", "你认为自己目前处于哪个学习阶段？", "自评将与客观诊断共同确定初始难度", "single_choice", true, 80, SELF_RATING_OPTIONS)),
    check("goal_use_case", Boolean(intake.goal_use_case), question("profile.goal_use_case", "goal_use_case", "这次学习主要是为了什么？", "课程、竞赛、求职和项目需要不同的资源组织方式", "single_choice", true, 70, GOAL_USE_CASE_OPTIONS)),
    check("weekly_time_budget_minutes", positive(intake.weekly_time_budget_minutes), question("profile.weekly_time_budget", "weekly_time_budget_minutes", "你每周大约能投入多少分钟学习？", "时间预算用于控制学习路径粒度和练习量", "number", true, 60)),
  ]
  const recommendedChecks = [
    check("desired_outcome", hasText(intake.desired_outcome), question("profile.desired_outcome", "desired_outcome", "完成这次学习后，你希望能够独立做成什么？", "明确成果可以让资源和验收更有针对性", "text", false, 50)),
    check("explanation_preference", Boolean(intake.explanation_preference), question("profile.explanation_preference", "explanation_preference", "你更希望先看哪种讲解？", "直接询问表达偏好比按专业背景猜测更可靠", "single_choice", false, 40, EXPLANATION_OPTIONS)),
    check("practice_preference", Boolean(intake.practice_preference), question("profile.practice_preference", "practice_preference", "你更希望以哪种方式练习？", "练习偏好可供资源负责人安排题型与实操比例", "single_choice", false, 35, PRACTICE_OPTIONS)),
    check("preferred_contexts", hasItems(intake.preferred_contexts), question("profile.preferred_contexts", "preferred_contexts", "哪些生活、专业或项目场景你最熟悉？", "熟悉场景可用于组织示例，但不能替代知识证据", "multi_text", false, 30)),
    check("tool_constraints", hasItems(intake.tool_constraints) || hasItems(intake.accommodations), question("profile.tool_constraints", "tool_constraints", "学习时有没有设备、软件、网络或无障碍方面的限制？", "现实约束会影响实操步骤和工具选择", "multi_text", false, 20)),
    check("retention", Boolean(intake.privacy?.retention), question("profile.retention", "privacy.retention", "是否允许后续会话继续使用并更新这份画像？", "跨会话保留必须由学习者明确选择", "single_choice", false, 10, RETENTION_OPTIONS)),
  ]

  const missingRequired = requiredChecks.filter((entry) => !entry.complete)
  const missingRecommended = recommendedChecks.filter((entry) => !entry.complete)
  const questionPool = [
    ...missingRequired.map((entry) => entry.question),
    ...(options.include_recommended === false ? [] : missingRecommended.map((entry) => entry.question)),
  ].sort((left, right) => right.priority - left.priority)
  const completed = requiredChecks.filter((entry) => entry.complete).length
    + recommendedChecks.filter((entry) => entry.complete).length
  const total = requiredChecks.length + recommendedChecks.length

  return {
    status: missingRequired.length === 0 ? "ready" : "needs_clarification",
    completeness: {
      score: Math.round((completed / total) * 100) / 100,
      required_completed: requiredChecks.length - missingRequired.length,
      required_total: requiredChecks.length,
      recommended_completed: recommendedChecks.length - missingRecommended.length,
      recommended_total: recommendedChecks.length,
    },
    missing_required_fields: missingRequired.map((entry) => entry.field),
    missing_recommended_fields: missingRecommended.map((entry) => entry.field),
    questions: questionPool.slice(0, maxQuestions),
  }
}

/** 将一条补充回答应用到结构化采集输入；不修改原对象。 */
export function applyProfileClarificationAnswer(
  intake: LearnerProfileIntakeV2,
  answer: ProfileClarificationAnswer,
): LearnerProfileIntakeV2 {
  const next = structuredClone(intake)
  switch (answer.question_id) {
    case "profile.goal":
      next.goal = requiredText(answer.value, answer.question_id)
      break
    case "profile.background":
      next.background_summary = requiredText(answer.value, answer.question_id)
      break
    case "profile.self_rating":
      next.self_rating = allowedValue<KnowledgeDifficulty>(answer.value, answer.question_id, ["beginner", "basic", "intermediate", "integrated"])
      break
    case "profile.goal_use_case":
      next.goal_use_case = allowedValue<LearningGoalUseCase>(answer.value, answer.question_id, ["coursework", "competition", "job", "project", "certification", "interest", "other"])
      break
    case "profile.weekly_time_budget":
      next.weekly_time_budget_minutes = requiredPositiveNumber(answer.value, answer.question_id)
      break
    case "profile.desired_outcome":
      next.desired_outcome = requiredText(answer.value, answer.question_id)
      break
    case "profile.explanation_preference":
      next.explanation_preference = allowedValue<ExplanationPreference>(answer.value, answer.question_id, ["analogy_first", "principle_first", "example_first", "step_by_step", "balanced"])
      break
    case "profile.practice_preference":
      next.practice_preference = allowedValue<PracticePreference>(answer.value, answer.question_id, ["quiz", "coding", "project", "mixed"])
      break
    case "profile.preferred_contexts":
      next.preferred_contexts = answerItems(answer.value, answer.question_id)
      break
    case "profile.tool_constraints":
      next.tool_constraints = answerItems(answer.value, answer.question_id)
      break
    case "profile.retention":
      next.privacy = {
        ...next.privacy,
        retention: allowedValue<ProfileRetention>(answer.value, answer.question_id, ["session_only", "cross_session"]),
      }
      break
  }
  return next
}

/**
 * 在已有可信核心画像上建立 v2 画像。调用前必须完成五项必要采集信息；
 * 可选信息缺失时使用显式、保守默认值，并在 provenance 中标注来源。
 */
export function createLearnerProfileV2(input: CreateLearnerProfileV2Input): LearnerProfileV2 {
  const assessment = assessProfileIntake(input.intake, { include_recommended: false, max_questions: 10 })
  if (assessment.status !== "ready") {
    throw new Error(`PROFILE_INTAKE_INCOMPLETE:${assessment.missing_required_fields.join(",")}`)
  }
  const observedAt = input.observed_at ?? new Date().toISOString()
  const goal = input.intake.goal!.trim()
  if (input.core_profile.learner_id !== input.intake.learner_id) {
    throw new Error("PROFILE_LEARNER_ID_MISMATCH")
  }
  if (input.core_profile.goal.trim() !== goal) {
    throw new Error("PROFILE_GOAL_MISMATCH")
  }

  const profileId = input.profile_id ?? `PROFILE-${safeId(input.core_profile.learner_id)}`
  const profileVersion = input.profile_version ?? `${profileId}-v2-r1`
  const fieldSources = [
    ...defaultLearnerSources(input.intake, observedAt),
    ...(input.field_sources ?? []),
  ]

  return {
    schema_version: "2.0",
    profile_id: profileId,
    profile_version: profileVersion,
    revision: 1,
    learner_id: input.core_profile.learner_id,
    level: input.core_profile.level,
    known_concepts: unique(input.core_profile.known_concepts),
    weak_concepts: unique(input.core_profile.weak_concepts),
    goal,
    ...(input.core_profile.ability_dimensions
      ? { ability_dimensions: structuredClone(input.core_profile.ability_dimensions) as AbilityDimension[] }
      : {}),
    background_context: {
      summary: nullableText(input.intake.background_summary),
      education_stage: nullableText(input.intake.education_stage),
      discipline_background: unique(input.intake.discipline_background ?? []),
      role_context: nullableText(input.intake.role_context),
      prior_languages: unique(input.intake.prior_languages ?? []),
      prior_topics: unique(input.intake.prior_topics ?? []),
    },
    goal_context: {
      use_case: input.intake.goal_use_case!,
      desired_outcome: nullableText(input.intake.desired_outcome),
      deadline: nullableText(input.intake.deadline),
    },
    self_assessment: {
      reported_level: input.intake.self_rating!,
    },
    learning_preferences: {
      explanation: input.intake.explanation_preference ?? "balanced",
      practice: input.intake.practice_preference ?? "mixed",
      pace: input.intake.pace_preference ?? "steady",
      preferred_contexts: unique(input.intake.preferred_contexts ?? []),
    },
    learning_constraints: {
      weekly_time_budget_minutes: input.intake.weekly_time_budget_minutes!,
      session_time_budget_minutes: positive(input.intake.session_time_budget_minutes)
        ? input.intake.session_time_budget_minutes!
        : null,
      tool_constraints: unique(input.intake.tool_constraints ?? []),
      accommodations: unique(input.intake.accommodations ?? []),
    },
    progress: {
      mastery_by_source_id: {},
      completed_session_ids: [],
      recent_error_patterns: [],
      last_observation_id: null,
      last_observed_at: null,
      last_assessment_accuracy: null,
    },
    privacy: {
      personalization_enabled: input.intake.privacy?.personalization_enabled ?? true,
      retention: input.intake.privacy?.retention ?? "session_only",
      allow_profile_display: input.intake.privacy?.allow_profile_display ?? true,
    },
    provenance: { field_sources: dedupeProvenance(fieldSources) },
    created_at: observedAt,
    updated_at: observedAt,
  }
}

/**
 * 使用已有 B 进展规则更新 level/known/weak，同时完整保留背景、目标用途、
 * 偏好、限制与隐私设置。该函数不持久化，由调用方决定写入位置。
 */
export function updateLearnerProfileV2(
  input: UpdateLearnerProfileV2Input,
): UpdateLearnerProfileV2Result {
  const observedAt = input.observed_at ?? new Date().toISOString()
  const coreResult = applyProgressObservation({
    observation: input.observation,
    currentProfile: coreProfile(input.profile),
    profileVersion: input.next_profile_version,
    conceptMatches: input.concept_matches,
  })
  const mastery = { ...input.profile.progress.mastery_by_source_id }
  for (const evidence of input.observation.conceptEvidence) {
    mastery[evidence.sourceId] = evidence.evidenceScore
  }
  const completedSessions = unique([
    ...input.profile.progress.completed_session_ids,
    ...(input.completed_session_id ? [input.completed_session_id] : []),
  ])
  const nextProfile: LearnerProfileV2 = {
    ...structuredClone(input.profile),
    ...coreResult.profile,
    schema_version: "2.0",
    profile_version: input.next_profile_version,
    revision: input.profile.revision + 1,
    progress: {
      ...structuredClone(input.profile.progress),
      mastery_by_source_id: mastery,
      completed_session_ids: completedSessions,
      last_observation_id: input.observation.observationId,
      last_observed_at: observedAt,
      last_assessment_accuracy: input.observation.overallAccuracy,
    },
    provenance: {
      field_sources: dedupeProvenance([
        ...input.profile.provenance.field_sources,
        { field: "level", source: "assessment_history", observed_at: observedAt, source_ref: input.observation.observationId },
        { field: "known_concepts", source: "assessment_history", observed_at: observedAt, source_ref: input.observation.observationId },
        { field: "weak_concepts", source: "assessment_history", observed_at: observedAt, source_ref: input.observation.observationId },
      ]),
    },
    updated_at: observedAt,
  }
  return {
    profile: nextProfile,
    changes: coreResult.changes,
    role_c_snapshot_options: buildRoleCProfileSnapshotOptions(nextProfile),
  }
}

/**
 * 将后续对话里学习者明确给出的补充或纠正合并进画像。
 * 该入口不修改客观诊断产生的 known/weak/level，也不会把未提供字段重置为默认值。
 */
export function updateLearnerProfileFromAnswers(
  input: UpdateLearnerProfileFromAnswersInput,
): UpdateLearnerProfileFromAnswersResult {
  if (input.profile.learner_id !== input.intake_patch.learner_id) {
    throw new Error("PROFILE_LEARNER_ID_MISMATCH")
  }
  if (input.next_profile_version.trim() === "") {
    throw new Error("PROFILE_VERSION_EMPTY")
  }

  const patch = input.intake_patch
  const observedAt = input.observed_at ?? new Date().toISOString()
  const changedFields: string[] = []
  const nextProfile = structuredClone(input.profile)

  if (hasText(patch.goal)) {
    nextProfile.goal = patch.goal!.trim()
    changedFields.push("goal")
  }
  if (patch.background_summary !== undefined) {
    nextProfile.background_context.summary = nullableText(patch.background_summary)
    changedFields.push("background_context.summary")
  }
  if (patch.education_stage !== undefined) {
    nextProfile.background_context.education_stage = nullableText(patch.education_stage)
    changedFields.push("background_context.education_stage")
  }
  if (patch.discipline_background !== undefined) {
    nextProfile.background_context.discipline_background = unique(patch.discipline_background)
    changedFields.push("background_context.discipline_background")
  }
  if (patch.role_context !== undefined) {
    nextProfile.background_context.role_context = nullableText(patch.role_context)
    changedFields.push("background_context.role_context")
  }
  if (patch.prior_languages !== undefined) {
    nextProfile.background_context.prior_languages = unique(patch.prior_languages)
    changedFields.push("background_context.prior_languages")
  }
  if (patch.prior_topics !== undefined) {
    nextProfile.background_context.prior_topics = unique(patch.prior_topics)
    changedFields.push("background_context.prior_topics")
  }
  if (patch.goal_use_case !== undefined) {
    nextProfile.goal_context.use_case = patch.goal_use_case
    changedFields.push("goal_context.use_case")
  }
  if (patch.self_rating !== undefined) {
    nextProfile.self_assessment.reported_level = patch.self_rating
    changedFields.push("self_assessment.reported_level")
  }
  if (patch.desired_outcome !== undefined) {
    nextProfile.goal_context.desired_outcome = nullableText(patch.desired_outcome)
    changedFields.push("goal_context.desired_outcome")
  }
  if (patch.deadline !== undefined) {
    nextProfile.goal_context.deadline = nullableText(patch.deadline)
    changedFields.push("goal_context.deadline")
  }
  if (patch.explanation_preference !== undefined) {
    nextProfile.learning_preferences.explanation = patch.explanation_preference
    changedFields.push("learning_preferences.explanation")
  }
  if (patch.practice_preference !== undefined) {
    nextProfile.learning_preferences.practice = patch.practice_preference
    changedFields.push("learning_preferences.practice")
  }
  if (patch.pace_preference !== undefined) {
    nextProfile.learning_preferences.pace = patch.pace_preference
    changedFields.push("learning_preferences.pace")
  }
  if (patch.preferred_contexts !== undefined) {
    nextProfile.learning_preferences.preferred_contexts = unique(patch.preferred_contexts)
    changedFields.push("learning_preferences.preferred_contexts")
  }
  if (patch.weekly_time_budget_minutes !== undefined) {
    assertPositive(patch.weekly_time_budget_minutes, "weekly_time_budget_minutes")
    nextProfile.learning_constraints.weekly_time_budget_minutes = Math.round(patch.weekly_time_budget_minutes)
    changedFields.push("learning_constraints.weekly_time_budget_minutes")
  }
  if (patch.session_time_budget_minutes !== undefined) {
    assertPositive(patch.session_time_budget_minutes, "session_time_budget_minutes")
    nextProfile.learning_constraints.session_time_budget_minutes = Math.round(patch.session_time_budget_minutes)
    changedFields.push("learning_constraints.session_time_budget_minutes")
  }
  if (patch.tool_constraints !== undefined) {
    nextProfile.learning_constraints.tool_constraints = unique(patch.tool_constraints)
    changedFields.push("learning_constraints.tool_constraints")
  }
  if (patch.accommodations !== undefined) {
    nextProfile.learning_constraints.accommodations = unique(patch.accommodations)
    changedFields.push("learning_constraints.accommodations")
  }
  if (patch.privacy?.personalization_enabled !== undefined) {
    nextProfile.privacy.personalization_enabled = patch.privacy.personalization_enabled
    changedFields.push("privacy.personalization_enabled")
  }
  if (patch.privacy?.retention !== undefined) {
    nextProfile.privacy.retention = patch.privacy.retention
    changedFields.push("privacy.retention")
  }
  if (patch.privacy?.allow_profile_display !== undefined) {
    nextProfile.privacy.allow_profile_display = patch.privacy.allow_profile_display
    changedFields.push("privacy.allow_profile_display")
  }

  nextProfile.profile_version = input.next_profile_version
  nextProfile.revision = input.profile.revision + 1
  nextProfile.updated_at = observedAt
  nextProfile.provenance.field_sources = dedupeProvenance([
    ...nextProfile.provenance.field_sources,
    ...changedFields.map((field) => ({ field, source: "learner" as const, observed_at: observedAt })),
  ])

  return {
    profile: nextProfile,
    changed_fields: changedFields,
    role_c_snapshot_options: buildRoleCProfileSnapshotOptions(nextProfile),
  }
}

/** Role C 现有画像快照适配器可直接消费的 options。 */
export function buildRoleCProfileSnapshotOptions(profile: LearnerProfileV2): ProfileSnapshotOptions {
  const pedagogyContract = buildRoleCPedagogyContract(profile)
  return {
    profile_id: profile.profile_id,
    profile_version: profile.profile_version,
    preferred_contexts: profile.privacy.personalization_enabled
      ? [...profile.learning_preferences.preferred_contexts]
      : [],
    accommodations: profile.privacy.personalization_enabled
      ? [...pedagogyContract.constraints.accommodations]
      : [],
    pedagogy_contract: pedagogyContract,
    provenance_ref: `role-b:profile-v2:${profile.profile_id}:${profile.profile_version}`,
  }
}

/** Narrow structural guard used at legacy-compatible orchestration boundaries. */
export function isLearnerProfileV2(profile: LearnerProfile): profile is LearnerProfileV2 {
  return (profile as Partial<LearnerProfileV2>).schema_version === "2.0"
}

/** 面向路径、讲义、代码实验和测评负责人的稳定只读交接视图。 */
export function buildPersonalizationProfileHandoff(
  profile: LearnerProfileV2,
): PersonalizationProfileHandoff {
  if (!profile.privacy.personalization_enabled) {
    throw new Error("PROFILE_PERSONALIZATION_DISABLED")
  }
  return {
    schema_version: "1.0",
    source_profile: {
      profile_id: profile.profile_id,
      profile_version: profile.profile_version,
      revision: profile.revision,
    },
    learner: {
      learner_id: profile.learner_id,
      level: profile.level,
      self_reported_level: profile.self_assessment.reported_level,
      known_concepts: [...profile.known_concepts],
      weak_concepts: [...profile.weak_concepts],
    },
    goal: {
      text: profile.goal,
      use_case: profile.goal_context.use_case,
      desired_outcome: profile.goal_context.desired_outcome,
      deadline: profile.goal_context.deadline,
    },
    background: structuredClone(profile.background_context),
    presentation: structuredClone(profile.learning_preferences),
    constraints: structuredClone(profile.learning_constraints),
    progress: structuredClone(profile.progress),
    privacy: structuredClone(profile.privacy),
  }
}

function check(
  field: string,
  complete: boolean,
  clarificationQuestion: ProfileClarificationQuestion,
): { field: string; complete: boolean; question: ProfileClarificationQuestion } {
  return { field, complete, question: clarificationQuestion }
}

function question(
  id: ProfileClarificationQuestionId,
  targetField: string,
  prompt: string,
  reason: string,
  answerType: ProfileClarificationQuestion["answer_type"],
  required: boolean,
  priority: number,
  options?: ProfileClarificationOption[],
): ProfileClarificationQuestion {
  return { id, target_field: targetField, prompt, reason, answer_type: answerType, required, priority, options }
}

function coreProfile(profile: LearnerProfileV2): LearnerProfile {
  return {
    learner_id: profile.learner_id,
    level: profile.level,
    known_concepts: [...profile.known_concepts],
    weak_concepts: [...profile.weak_concepts],
    goal: profile.goal,
    ...(profile.ability_dimensions
      ? { ability_dimensions: structuredClone(profile.ability_dimensions) }
      : {}),
  }
}

function defaultLearnerSources(
  intake: LearnerProfileIntakeV2,
  observedAt: string,
): ProfileFieldProvenance[] {
  return [
    learnerSource("goal", observedAt),
    learnerSource("background_context", observedAt),
    learnerSource("self_assessment.reported_level", observedAt),
    learnerSource("goal_context.use_case", observedAt),
    learnerSource("learning_constraints.weekly_time_budget_minutes", observedAt),
    conditionalSource("learning_preferences.explanation", intake.explanation_preference !== undefined, observedAt),
    conditionalSource("learning_preferences.practice", intake.practice_preference !== undefined, observedAt),
    conditionalSource("learning_preferences.pace", intake.pace_preference !== undefined, observedAt),
    conditionalSource("learning_preferences.preferred_contexts", intake.preferred_contexts !== undefined, observedAt),
    conditionalSource("privacy.personalization_enabled", intake.privacy?.personalization_enabled !== undefined, observedAt),
    conditionalSource("privacy.retention", intake.privacy?.retention !== undefined, observedAt),
    conditionalSource("privacy.allow_profile_display", intake.privacy?.allow_profile_display !== undefined, observedAt),
  ]
}

function learnerSource(field: string, observedAt: string): ProfileFieldProvenance {
  return { field, source: "learner", observed_at: observedAt }
}

function conditionalSource(
  field: string,
  providedByLearner: boolean,
  observedAt: string,
): ProfileFieldProvenance {
  return {
    field,
    source: providedByLearner ? "learner" : "system_default",
    observed_at: observedAt,
  }
}

function dedupeProvenance(entries: ProfileFieldProvenance[]): ProfileFieldProvenance[] {
  const byIdentity = new Map<string, ProfileFieldProvenance>()
  for (const entry of entries) {
    byIdentity.set(`${entry.field}\u0000${entry.source}\u0000${entry.source_ref ?? ""}`, structuredClone(entry))
  }
  return [...byIdentity.values()]
}

function hasBackground(input: LearnerProfileIntakeV2): boolean {
  return hasText(input.background_summary)
    || hasText(input.education_stage)
    || hasText(input.role_context)
    || hasItems(input.discipline_background)
    || hasItems(input.prior_languages)
    || hasItems(input.prior_topics)
}

function hasText(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0
}

function hasItems(value: string[] | undefined): boolean {
  return Array.isArray(value) && value.some((item) => item.trim().length > 0)
}

function positive(value: number | undefined): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0
}

function requiredText(value: ProfileClarificationAnswer["value"], questionId: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`PROFILE_CLARIFICATION_ANSWER_INVALID:${questionId}`)
  }
  return value.trim()
}

function requiredPositiveNumber(value: ProfileClarificationAnswer["value"], questionId: string): number {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error(`PROFILE_CLARIFICATION_ANSWER_INVALID:${questionId}`)
  }
  return Math.round(numeric)
}

function assertPositive(value: number, field: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`PROFILE_FIELD_INVALID:${field}`)
  }
}

function answerItems(value: ProfileClarificationAnswer["value"], questionId: string): string[] {
  const items = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[、,，;；\n]/)
      : []
  const normalized = unique(items)
  if (normalized.length === 0) throw new Error(`PROFILE_CLARIFICATION_ANSWER_INVALID:${questionId}`)
  return normalized
}

function allowedValue<T extends string>(
  value: ProfileClarificationAnswer["value"],
  questionId: string,
  allowed: readonly T[],
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`PROFILE_CLARIFICATION_ANSWER_INVALID:${questionId}`)
  }
  return value as T
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function nullableText(value: string | undefined): string | null {
  const normalized = value?.trim() ?? ""
  return normalized.length > 0 ? normalized : null
}

function safeId(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9_-]/g, "_")
  return normalized || "anonymous_learner"
}
