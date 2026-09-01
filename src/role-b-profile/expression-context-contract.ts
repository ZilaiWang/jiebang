import { redactDirectIdentifiers, sanitizeFreeTextList } from "../privacy/privacy-boundary"
import type { LearnerProfileV2 } from "./learner-profile-v2"
import type { LearningBarrier } from "./profile-gap-questions"

export type DisciplineFamily =
  | "humanities_social_sciences"
  | "science_engineering"
  | "business_management"
  | "arts_design"
  | "health_life_sciences"
  | "vocational_applied"
  | "interdisciplinary"
  | "unspecified"

export type AudienceRegister =
  | "secondary_school"
  | "higher_education"
  | "adult_professional"
  | "neutral"

export type ExplanationFrame =
  | "narrative_semantic"
  | "formal_structural"
  | "workflow_applied"
  | "visual_structural"
  | "balanced"

export type TerminologyBridge =
  | "plain_then_formal"
  | "formal_with_plain_gloss"
  | "example_then_term"
  | "balanced"

export type ComparisonStyle =
  | "story_sequence"
  | "state_transition"
  | "task_flow"
  | "structure_map"
  | "neutral"

/**
 * B-owned, privacy-safe expression policy consumed by Role C.
 *
 * It intentionally contains no raw background text or learner identity. The
 * values below may shape examples and explanation order, but never the locked
 * knowledge, objective, difficulty, answer or score.
 */
export interface RoleCExpressionContext {
  schema_version: "expression-context.v1"
  enabled: boolean
  source_profile: {
    profile_id: string
    profile_version: string
    revision: number
  }
  discipline_family: DisciplineFamily
  audience_register: AudienceRegister
  explanation_frame: ExplanationFrame
  terminology_bridge: TerminologyBridge
  comparison_style: ComparisonStyle
  analogy_domains: string[]
  task_contexts: string[]
  declared_prior_anchors: string[]
  hint_emphasis: string[]
  troubleshooting_focus: string[]
  guardrails: {
    preserve_facts: true
    preserve_objectives: true
    preserve_difficulty: true
    preserve_answers: true
    preserve_scoring: true
    omit_raw_background: true
    forbid_ability_inference: true
    require_evidence_for_technical_comparisons: true
    hide_profile_labels_in_public_content: true
    explicit_preferences_take_priority: true
  }
  rationale: string[]
}

export const ROLE_C_EXPRESSION_CONTEXT_CONTRACT_KEYS = {
  root: [
    "schema_version", "enabled", "source_profile", "discipline_family",
    "audience_register", "explanation_frame", "terminology_bridge",
    "comparison_style", "analogy_domains", "task_contexts",
    "declared_prior_anchors", "hint_emphasis", "troubleshooting_focus",
    "guardrails", "rationale",
  ],
  source_profile: ["profile_id", "profile_version", "revision"],
  guardrails: [
    "preserve_facts", "preserve_objectives", "preserve_difficulty",
    "preserve_answers", "preserve_scoring", "omit_raw_background",
    "forbid_ability_inference", "require_evidence_for_technical_comparisons",
    "hide_profile_labels_in_public_content", "explicit_preferences_take_priority",
  ],
} as const

const FAMILY_PATTERNS: Array<[Exclude<DisciplineFamily, "interdisciplinary" | "unspecified">, RegExp]> = [
  ["humanities_social_sciences", /(?:人文|文科|文史|中文|汉语言|历史|哲学|社会|法学|教育|外语|语言|新闻|传播|政治|humanit|liberal arts|social science|history|philosophy|law|linguistic|journalism)/u],
  ["science_engineering", /(?:理工|工科|理科|数学|计算机|软件|物理|化学|电子|自动化|机械|通信|土木|材料|工程|science|engineering|computer|software|mathematics|physics|chemistry|automation)/u],
  ["business_management", /(?:经管|经济|管理|商科|金融|会计|市场营销|工商|贸易|business|management|economics|finance|accounting|marketing)/u],
  ["arts_design", /(?:艺术|设计|美术|音乐|戏剧|影视|动画|视觉|(?<!liberal )\barts?\b|design|music|drama|animation)/u],
  ["health_life_sciences", /(?:医学|医药|护理|生物|生命科学|药学|公共卫生|临床|健康|medicine|medical|nursing|biology|life science|pharmacy|health)/u],
  ["vocational_applied", /(?:职业|技工|技能|中专|高职|应用技术|vocational|technical college|applied technolog)/u],
]

export function buildRoleCExpressionContext(profile: LearnerProfileV2): RoleCExpressionContext {
  if (!profile.privacy.personalization_enabled) return neutralExpressionContext(profile)

  const family = classifyDisciplineFamily(profile.background_context.discipline_background)
  const preference = profile.learning_preferences.explanation
  const barriers = profile.learning_barriers ?? []
  return {
    schema_version: "expression-context.v1",
    enabled: true,
    source_profile: sourceProfile(profile),
    discipline_family: family,
    audience_register: classifyAudienceRegister(profile.background_context.education_stage),
    explanation_frame: frameFor(preference, family),
    terminology_bridge: bridgeFor(preference, family),
    comparison_style: comparisonFor(preference, family),
    analogy_domains: analogyDomainsFor(family),
    task_contexts: sanitizeExpressionList([
      ...profile.learning_preferences.preferred_contexts,
      profile.background_context.role_context ?? "",
      profile.goal_context.desired_outcome ?? "",
    ], 6),
    declared_prior_anchors: sanitizeExpressionList([
      ...profile.background_context.prior_languages,
      ...profile.background_context.prior_topics,
    ], 8),
    hint_emphasis: hintEmphasisFor(barriers, profile.progress.recent_error_patterns),
    troubleshooting_focus: troubleshootingFocusFor(barriers, profile.progress.recent_error_patterns),
    guardrails: guardrails(),
    rationale: [
      `表达框架优先服从学习者明确选择的 explanation=${preference}。`,
      `discipline_family=${family} 只用于表达语境，不用于推断能力或调整难度。`,
      "原始背景文本和直接身份信息不进入 Role C。",
      "事实、目标、答案、评分和安全边界保持不变。",
    ],
  }
}

export function classifyDisciplineFamily(values: string[]): DisciplineFamily {
  const normalized = values.join("；").normalize("NFKC").toLocaleLowerCase()
  if (!normalized.trim()) return "unspecified"
  const matches = FAMILY_PATTERNS.filter(([, pattern]) => pattern.test(normalized)).map(([family]) => family)
  const unique = [...new Set(matches)]
  return unique.length === 0 ? "unspecified" : unique.length === 1 ? unique[0]! : "interdisciplinary"
}

export function classifyAudienceRegister(value: string | null): AudienceRegister {
  const normalized = (value ?? "").normalize("NFKC").toLocaleLowerCase()
  if (/(?:小学|初中|高中|中学|secondary|high school|middle school)/u.test(normalized)) return "secondary_school"
  if (/(?:大学|本科|专科|硕士|博士|研究生|高校|college|university|undergraduate|graduate|master|doctorate|phd)/u.test(normalized)) return "higher_education"
  if (/(?:成人|在职|工作|职业|岗位|professional|adult)/u.test(normalized)) return "adult_professional"
  return "neutral"
}

function frameFor(
  preference: LearnerProfileV2["learning_preferences"]["explanation"],
  family: DisciplineFamily,
): ExplanationFrame {
  if (preference === "analogy_first") return "narrative_semantic"
  if (preference === "principle_first") return "formal_structural"
  if (preference === "example_first" || preference === "step_by_step") return "workflow_applied"
  if (family === "humanities_social_sciences") return "narrative_semantic"
  if (family === "science_engineering") return "formal_structural"
  if (family === "business_management" || family === "vocational_applied") return "workflow_applied"
  if (family === "arts_design") return "visual_structural"
  return "balanced"
}

function bridgeFor(
  preference: LearnerProfileV2["learning_preferences"]["explanation"],
  family: DisciplineFamily,
): TerminologyBridge {
  if (preference === "analogy_first") return "plain_then_formal"
  if (preference === "principle_first") return "formal_with_plain_gloss"
  if (preference === "example_first") return "example_then_term"
  if (family === "humanities_social_sciences" || family === "arts_design") return "plain_then_formal"
  if (family === "science_engineering") return "formal_with_plain_gloss"
  if (family === "business_management" || family === "vocational_applied") return "example_then_term"
  return "balanced"
}

function comparisonFor(
  preference: LearnerProfileV2["learning_preferences"]["explanation"],
  family: DisciplineFamily,
): ComparisonStyle {
  if (preference === "analogy_first") return "story_sequence"
  if (preference === "principle_first") return "state_transition"
  if (preference === "example_first" || preference === "step_by_step") return "task_flow"
  if (family === "humanities_social_sciences") return "story_sequence"
  if (family === "science_engineering") return "state_transition"
  if (family === "business_management" || family === "vocational_applied") return "task_flow"
  if (family === "arts_design") return "structure_map"
  return "neutral"
}

function analogyDomainsFor(family: DisciplineFamily): string[] {
  switch (family) {
    case "humanities_social_sciences": return ["事件顺序", "分类与关系", "文本条目", "规则与例外"]
    case "science_engineering": return ["变量状态", "输入输出", "流程结构", "边界检查"]
    case "business_management": return ["任务清单", "业务流程", "分类统计", "条件规则"]
    case "arts_design": return ["版面结构", "图层顺序", "元素组合", "视觉分组"]
    case "health_life_sciences": return ["观察记录", "流程步骤", "分类指标", "条件核对"]
    case "vocational_applied": return ["操作工序", "检查清单", "输入输出", "故障定位"]
    case "interdisciplinary": return ["任务流程", "结构关系", "状态变化"]
    case "unspecified": return []
  }
}

function hintEmphasisFor(
  barriers: Array<{ barrier: LearningBarrier; count: number }>,
  recentErrors: string[],
): string[] {
  const ordered = [...barriers].sort((left, right) => right.count - left.count).map((entry) => entry.barrier)
  const values = ordered.flatMap((barrier) => {
    switch (barrier) {
      case "concept_recall": return ["先定位本题需要的概念关系"]
      case "code_translation": return ["把目标行为拆成输入、处理和输出步骤"]
      case "debugging": return ["先根据错误现象定位最小可疑步骤"]
      case "boundary_condition": return ["先列出最小值、最大值和空输入等边界"]
      case "problem_understanding": return ["先标出题目的已知条件与交付结果"]
      case "unknown": return []
    }
  })
  return sanitizeExpressionList([...values, ...recentErrors.map((value) => `复查近期错误：${value}`)], 5)
}

function troubleshootingFocusFor(
  barriers: Array<{ barrier: LearningBarrier; count: number }>,
  recentErrors: string[],
): string[] {
  const values = barriers.flatMap((entry) => {
    switch (entry.barrier) {
      case "debugging": return ["检查报错位置、输入类型与变量状态"]
      case "boundary_condition": return ["检查空值、端点和极端输入"]
      case "code_translation": return ["逐步核对题意、算法步骤和代码语句"]
      case "problem_understanding": return ["重新核对输入、输出和限制条件"]
      case "concept_recall": return ["回看当前目标引用的核心事实"]
      case "unknown": return []
    }
  })
  return sanitizeExpressionList([...values, ...recentErrors], 5)
}

function neutralExpressionContext(profile: LearnerProfileV2): RoleCExpressionContext {
  return {
    schema_version: "expression-context.v1",
    enabled: false,
    source_profile: sourceProfile(profile),
    discipline_family: "unspecified",
    audience_register: "neutral",
    explanation_frame: "balanced",
    terminology_bridge: "balanced",
    comparison_style: "neutral",
    analogy_domains: [],
    task_contexts: [],
    declared_prior_anchors: [],
    hint_emphasis: [],
    troubleshooting_focus: [],
    guardrails: guardrails(),
    rationale: ["学习者关闭了个性化，使用中性表达合同。", "事实、目标、难度、答案和评分保持不变。"],
  }
}

function sourceProfile(profile: LearnerProfileV2): RoleCExpressionContext["source_profile"] {
  return { profile_id: profile.profile_id, profile_version: profile.profile_version, revision: profile.revision }
}

function guardrails(): RoleCExpressionContext["guardrails"] {
  return {
    preserve_facts: true,
    preserve_objectives: true,
    preserve_difficulty: true,
    preserve_answers: true,
    preserve_scoring: true,
    omit_raw_background: true,
    forbid_ability_inference: true,
    require_evidence_for_technical_comparisons: true,
    hide_profile_labels_in_public_content: true,
    explicit_preferences_take_priority: true,
  }
}

function sanitizeExpressionList(values: string[], limit: number): string[] {
  const sanitized = sanitizeFreeTextList(values)
    .map(redactDirectIdentifiers)
    .map((value) => value.slice(0, 160))
  return [...new Set(sanitized)].slice(0, limit)
}
