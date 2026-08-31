import type {
  LearnerProfileV2,
  LearningGoalUseCase,
} from "./learner-profile-v2"

export type LessonOpening =
  | "analogy_then_definition"
  | "principle_then_example"
  | "example_then_rule"
  | "task_then_explanation"
  | "balanced"

export type PracticeShape =
  | "short_checks"
  | "guided_coding"
  | "project_milestone"
  | "mixed"

export type TransferDistance = "near" | "medium" | "far"
export type ScaffoldStrength = 1 | 2 | 3 | 4
export type LearningTimeHorizon = "unspecified" | "urgent" | "near_term" | "long_term"

/**
 * A deterministic, answer-free contract between Role B and Role C.
 *
 * It changes presentation, pacing and practice shape. It never changes the
 * locked professional facts, objective identities, expected answers, scoring
 * criteria, safety constraints or evidence requirements.
 */
export interface RoleCPedagogyContract {
  schema_version: "1.0"
  source_profile: {
    profile_id: string
    profile_version: string
    revision: number
  }
  locked_core: {
    preserve_facts: true
    preserve_objectives: true
    preserve_answers: true
    preserve_scoring: true
    preserve_safety: true
  }
  learner_state: {
    level: LearnerProfileV2["level"]
    known_concepts: string[]
    weak_concepts: string[]
    mastery_by_source_id: Record<string, number>
  }
  lesson: {
    opening: LessonOpening
    scaffold_strength: ScaffoldStrength
    terminology_density: "low" | "medium" | "high"
    worked_example_count: 1 | 2 | 3
    require_step_trace: boolean
    require_prerequisite_checkpoint: boolean
    require_debugging_clinic: boolean
    visible_contexts: string[]
  }
  practice: {
    shape: PracticeShape
    guided_to_independent_sequence: boolean
    hint_levels: 2 | 3
    transfer_distance: TransferDistance
    require_acceptance_criteria: true
    require_expected_output: true
    require_troubleshooting: boolean
  }
  assessment: {
    emphasis: {
      recall: number
      understanding: number
      application: number
      analysis: number
      creation: number
    }
    preferred_modalities: Array<"mcq" | "true_false" | "trace" | "short_answer" | "code">
    require_direct_core_measurement: true
  }
  pacing: {
    weekly_minutes: number
    session_minutes: number
    recommended_chunks: number
    checkpoint_interval_minutes: number
    deadline: string | null
    time_horizon: LearningTimeHorizon
  }
  constraints: {
    tool_constraints: string[]
    accommodations: string[]
  }
  rationale: string[]
}

export function buildRoleCPedagogyContract(profile: LearnerProfileV2): RoleCPedagogyContract {
  if (!profile.privacy.personalization_enabled) {
    return genericContract(profile)
  }

  const goalPolicy = policyForGoal(profile.goal_context.use_case)
  const opening = openingForPreference(profile.learning_preferences.explanation)
  const practiceShape = practiceForPreference(profile.learning_preferences.practice)
  const sessionMinutes = clamp(
    profile.learning_constraints.session_time_budget_minutes
      ?? Math.min(45, Math.max(15, Math.round(profile.learning_constraints.weekly_time_budget_minutes / 4))),
    10,
    120,
  )
  const scaffoldStrength = scaffoldForLevelAndPace(profile.level, profile.learning_preferences.pace)
  const terminologyDensity = profile.level === "beginner"
    ? "low"
    : profile.level === "integrated"
      ? "high"
      : "medium"
  const workedExampleCount: 1 | 2 | 3 = scaffoldStrength >= 4 ? 3 : scaffoldStrength >= 2 ? 2 : 1
  const contexts = unique([
    ...profile.learning_preferences.preferred_contexts,
    ...goalPolicy.contexts,
  ]).slice(0, 6)
  const accommodations = unique([
    ...profile.learning_constraints.accommodations,
    ...goalPolicy.accommodations,
  ])
  const timeHorizon = classifyTimeHorizon(profile.goal_context.deadline, profile.updated_at)

  return {
    schema_version: "1.0",
    source_profile: {
      profile_id: profile.profile_id,
      profile_version: profile.profile_version,
      revision: profile.revision,
    },
    locked_core: {
      preserve_facts: true,
      preserve_objectives: true,
      preserve_answers: true,
      preserve_scoring: true,
      preserve_safety: true,
    },
    learner_state: {
      level: profile.level,
      known_concepts: [...profile.known_concepts],
      weak_concepts: [...profile.weak_concepts],
      mastery_by_source_id: { ...profile.progress.mastery_by_source_id },
    },
    lesson: {
      opening,
      scaffold_strength: scaffoldStrength,
      terminology_density: terminologyDensity,
      worked_example_count: workedExampleCount,
      require_step_trace: scaffoldStrength >= 2 || goalPolicy.require_trace,
      require_prerequisite_checkpoint: profile.level !== "integrated",
      require_debugging_clinic: goalPolicy.require_debugging,
      visible_contexts: contexts,
    },
    practice: {
      shape: goalPolicy.practice_override ?? practiceShape,
      guided_to_independent_sequence: scaffoldStrength >= 2,
      hint_levels: scaffoldStrength >= 3 ? 3 : 2,
      transfer_distance: transferForLevel(profile.level, goalPolicy.transfer_distance),
      require_acceptance_criteria: true,
      require_expected_output: true,
      require_troubleshooting: goalPolicy.require_troubleshooting,
    },
    assessment: {
      emphasis: { ...goalPolicy.assessment_emphasis },
      preferred_modalities: [...goalPolicy.modalities],
      require_direct_core_measurement: true,
    },
    pacing: {
      weekly_minutes: profile.learning_constraints.weekly_time_budget_minutes,
      session_minutes: sessionMinutes,
      recommended_chunks: Math.max(1, Math.ceil(profile.learning_constraints.weekly_time_budget_minutes / sessionMinutes)),
      checkpoint_interval_minutes: Math.min(20, Math.max(8, Math.round(sessionMinutes / 2))),
      deadline: profile.goal_context.deadline,
      time_horizon: timeHorizon,
    },
    constraints: {
      tool_constraints: [...profile.learning_constraints.tool_constraints],
      accommodations,
    },
    rationale: [
      `难度由客观画像 level=${profile.level} 和后续学习证据决定，背景不用于推断能力。`,
      `讲解顺序来自学习者明确选择的 explanation=${profile.learning_preferences.explanation}。`,
      `练习形态结合 practice=${profile.learning_preferences.practice} 与 goal_use_case=${profile.goal_context.use_case}。`,
      `每周时间预算 ${profile.learning_constraints.weekly_time_budget_minutes} 分钟被转换为可完成的学习单元。`,
      `deadline 仅形成 pacing.time_horizon=${timeHorizon}，不改变目标、难度或评分。`,
      "事实、目标、答案、评分和安全边界保持不变。",
    ],
  }
}

interface GoalPolicy {
  contexts: string[]
  accommodations: string[]
  practice_override?: PracticeShape
  modalities: RoleCPedagogyContract["assessment"]["preferred_modalities"]
  assessment_emphasis: RoleCPedagogyContract["assessment"]["emphasis"]
  transfer_distance: TransferDistance
  require_trace: boolean
  require_debugging: boolean
  require_troubleshooting: boolean
}

function policyForGoal(goal: LearningGoalUseCase): GoalPolicy {
  switch (goal) {
    case "coursework":
      return {
        contexts: ["教材式例题", "课程作业"],
        accommodations: ["先覆盖课程核心知识，再做低跨度变式"],
        modalities: ["mcq", "true_false", "trace", "short_answer"],
        assessment_emphasis: { recall: 0.2, understanding: 0.3, application: 0.3, analysis: 0.15, creation: 0.05 },
        transfer_distance: "near",
        require_trace: true,
        require_debugging: false,
        require_troubleshooting: false,
      }
    case "competition":
      return {
        contexts: ["算法竞赛", "边界样例", "复杂度意识"],
        accommodations: ["突出输入输出、边界条件、独立编码与反例检查"],
        practice_override: "guided_coding",
        modalities: ["trace", "short_answer", "code"],
        assessment_emphasis: { recall: 0.05, understanding: 0.15, application: 0.35, analysis: 0.3, creation: 0.15 },
        transfer_distance: "far",
        require_trace: true,
        require_debugging: true,
        require_troubleshooting: true,
      }
    case "job":
      return {
        contexts: ["岗位任务", "调试过程", "工程验收"],
        accommodations: ["突出可维护代码、错误定位、验收标准和技术复述"],
        practice_override: "mixed",
        modalities: ["trace", "short_answer", "code"],
        assessment_emphasis: { recall: 0.05, understanding: 0.2, application: 0.35, analysis: 0.25, creation: 0.15 },
        transfer_distance: "medium",
        require_trace: true,
        require_debugging: true,
        require_troubleshooting: true,
      }
    case "project":
      return {
        contexts: ["项目交付", "工具链", "可验收产物"],
        accommodations: ["按任务拆解、实现、验证、排错和复盘组织学习"],
        practice_override: "project_milestone",
        modalities: ["short_answer", "code"],
        assessment_emphasis: { recall: 0.05, understanding: 0.15, application: 0.3, analysis: 0.25, creation: 0.25 },
        transfer_distance: "far",
        require_trace: true,
        require_debugging: true,
        require_troubleshooting: true,
      }
    case "certification":
      return {
        contexts: ["考试题型", "易错点"],
        accommodations: ["覆盖考纲核心点并安排限时检查"],
        modalities: ["mcq", "true_false", "trace", "short_answer"],
        assessment_emphasis: { recall: 0.2, understanding: 0.3, application: 0.3, analysis: 0.15, creation: 0.05 },
        transfer_distance: "near",
        require_trace: true,
        require_debugging: false,
        require_troubleshooting: false,
      }
    case "interest":
    case "other":
      return {
        contexts: ["通用学习场景"],
        accommodations: ["保持概念、示例、练习和反馈均衡"],
        modalities: ["mcq", "trace", "short_answer", "code"],
        assessment_emphasis: { recall: 0.1, understanding: 0.25, application: 0.35, analysis: 0.2, creation: 0.1 },
        transfer_distance: "medium",
        require_trace: true,
        require_debugging: false,
        require_troubleshooting: false,
      }
  }
}

function genericContract(profile: LearnerProfileV2): RoleCPedagogyContract {
  const minutes = clamp(profile.learning_constraints.session_time_budget_minutes ?? 30, 10, 120)
  return {
    schema_version: "1.0",
    source_profile: {
      profile_id: profile.profile_id,
      profile_version: profile.profile_version,
      revision: profile.revision,
    },
    locked_core: {
      preserve_facts: true,
      preserve_objectives: true,
      preserve_answers: true,
      preserve_scoring: true,
      preserve_safety: true,
    },
    learner_state: {
      level: profile.level,
      known_concepts: [],
      weak_concepts: [],
      mastery_by_source_id: {},
    },
    lesson: {
      opening: "balanced",
      scaffold_strength: 2,
      terminology_density: "medium",
      worked_example_count: 2,
      require_step_trace: true,
      require_prerequisite_checkpoint: true,
      require_debugging_clinic: false,
      visible_contexts: [],
    },
    practice: {
      shape: "mixed",
      guided_to_independent_sequence: true,
      hint_levels: 2,
      transfer_distance: "medium",
      require_acceptance_criteria: true,
      require_expected_output: true,
      require_troubleshooting: false,
    },
    assessment: {
      emphasis: { recall: 0.1, understanding: 0.25, application: 0.35, analysis: 0.2, creation: 0.1 },
      preferred_modalities: ["mcq", "trace", "short_answer", "code"],
      require_direct_core_measurement: true,
    },
    pacing: {
      weekly_minutes: profile.learning_constraints.weekly_time_budget_minutes,
      session_minutes: minutes,
      recommended_chunks: 1,
      checkpoint_interval_minutes: 15,
      deadline: null,
      time_horizon: "unspecified",
    },
    constraints: { tool_constraints: [], accommodations: [] },
    rationale: ["学习者关闭了个性化，返回通用均衡教学合同。", "Locked Core 保持不变。"],
  }
}

function openingForPreference(value: LearnerProfileV2["learning_preferences"]["explanation"]): LessonOpening {
  switch (value) {
    case "analogy_first": return "analogy_then_definition"
    case "principle_first": return "principle_then_example"
    case "example_first": return "example_then_rule"
    case "step_by_step": return "task_then_explanation"
    case "balanced": return "balanced"
  }
}

function practiceForPreference(value: LearnerProfileV2["learning_preferences"]["practice"]): PracticeShape {
  switch (value) {
    case "quiz": return "short_checks"
    case "coding": return "guided_coding"
    case "project": return "project_milestone"
    case "mixed": return "mixed"
  }
}

function scaffoldForLevelAndPace(
  level: LearnerProfileV2["level"],
  pace: LearnerProfileV2["learning_preferences"]["pace"],
): ScaffoldStrength {
  const base = level === "beginner" ? 4 : level === "basic" ? 3 : level === "intermediate" ? 2 : 1
  const adjusted = base + (pace === "slow" ? 1 : pace === "fast" ? -1 : 0)
  return clamp(adjusted, 1, 4) as ScaffoldStrength
}

function transferForLevel(level: LearnerProfileV2["level"], requested: TransferDistance): TransferDistance {
  if (level === "beginner" && requested === "far") return "medium"
  if (level === "basic" && requested === "far") return "medium"
  return requested
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function classifyTimeHorizon(deadline: string | null, observedAt: string): LearningTimeHorizon {
  if (!deadline) return "unspecified"
  const deadlineMs = Date.parse(deadline)
  const observedMs = Date.parse(observedAt)
  if (!Number.isFinite(deadlineMs) || !Number.isFinite(observedMs)) return "unspecified"
  const days = Math.ceil((deadlineMs - observedMs) / 86_400_000)
  if (days <= 7) return "urgent"
  if (days <= 30) return "near_term"
  return "long_term"
}
