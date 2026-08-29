import type { LearnerLevel } from "../contracts/common"

export type GoalProfile = "coursework" | "algorithm_competition" | "job_interview" | "general_learning"
export type ProgressState = "starting" | "building" | "stable" | "mastered" | "struggling"
export type ExplanationDepth = "introductory" | "standard" | "deep"
export type AbstractionOrder = "concrete_first" | "balanced" | "formal_first"
export type ExampleStyle = "textbook_context" | "technical_context" | "workplace_context" | "neutral"
export type PracticeMode = "recognition" | "guided_application" | "integrated_practice" | "project_practice"

export interface PersonalizationInput {
  path_id: string
  goal_profile: GoalProfile
  learner_level: LearnerLevel
  progress_state: ProgressState
  known_objective_count: number
  weak_objective_count: number
}

export interface PersonalizationPolicy {
  policy_version: "personalization.v1"
  path_id: string
  goal_profile: GoalProfile
  learner_level: LearnerLevel
  progress_state: ProgressState
  teaching_strategy: {
    explanation_depth: ExplanationDepth
    abstraction_order: AbstractionOrder
    example_style: ExampleStyle
    practice_mode: PracticeMode
    scaffold_level: 0 | 1 | 2 | 3
    reading_density: "low" | "medium" | "high"
    review_ratio: number
    challenge_ratio: number
    project_ratio: number
    extension_ratio: number
  }
  reasons: string[]
}

export function buildPersonalizationPolicy(input: PersonalizationInput): PersonalizationPolicy {
  const struggling = input.progress_state === "struggling"
  const mastered = input.progress_state === "mastered"
  const advanced = input.learner_level === "intermediate" || input.learner_level === "integrated"
  const defaults: Record<GoalProfile, Pick<PersonalizationPolicy["teaching_strategy"], "abstraction_order" | "example_style" | "practice_mode">> = {
    coursework: { abstraction_order: "concrete_first", example_style: "textbook_context", practice_mode: "guided_application" },
    algorithm_competition: { abstraction_order: "formal_first", example_style: "technical_context", practice_mode: "integrated_practice" },
    job_interview: { abstraction_order: "balanced", example_style: "workplace_context", practice_mode: "project_practice" },
    general_learning: { abstraction_order: "balanced", example_style: "neutral", practice_mode: "guided_application" },
  }
  const goal = defaults[input.goal_profile]
  let explanation_depth: ExplanationDepth = advanced ? "deep" : "standard"
  let scaffold_level: 0 | 1 | 2 | 3 = input.learner_level === "beginner" ? 3 : 2
  let reading_density: "low" | "medium" | "high" = "medium"
  let review_ratio = mastered ? 0.15 : 0.35
  let challenge_ratio = mastered ? 0.65 : 0.35
  let project_ratio = input.goal_profile === "job_interview" ? 0.35 : 0.15
  let extension_ratio = mastered ? 0.2 : 0.05
  let practice_mode = goal.practice_mode
  if (input.goal_profile === "algorithm_competition" && !struggling) {
    challenge_ratio = mastered ? 0.75 : 0.5
    review_ratio = mastered ? 0.1 : 0.25
  }
  if (struggling) {
    explanation_depth = "introductory"
    scaffold_level = 3
    reading_density = "low"
    practice_mode = "guided_application"
    review_ratio = 0.5
    challenge_ratio = 0.2
    project_ratio = 0.05
    extension_ratio = 0
  } else if (mastered) {
    scaffold_level = Math.min(scaffold_level, 1) as 0 | 1
    reading_density = advanced ? "high" : "medium"
    if (input.goal_profile === "coursework") practice_mode = "integrated_practice"
  }
  const total = review_ratio + challenge_ratio + project_ratio + extension_ratio
  const normalize = (value: number) => Math.round((value / total) * 100) / 100
  return {
    policy_version: "personalization.v1",
    path_id: input.path_id,
    goal_profile: input.goal_profile,
    learner_level: input.learner_level,
    progress_state: input.progress_state,
    teaching_strategy: {
      explanation_depth,
      abstraction_order: struggling ? "concrete_first" : goal.abstraction_order,
      example_style: goal.example_style,
      practice_mode,
      scaffold_level,
      reading_density,
      review_ratio: normalize(review_ratio),
      challenge_ratio: normalize(challenge_ratio),
      project_ratio: normalize(project_ratio),
      extension_ratio: normalize(extension_ratio),
    },
    reasons: [`goal_profile=${input.goal_profile}`, `learner_level=${input.learner_level}`, `progress_state=${input.progress_state}`, `known_objectives=${input.known_objective_count}`, `weak_objectives=${input.weak_objective_count}`],
  }
}
