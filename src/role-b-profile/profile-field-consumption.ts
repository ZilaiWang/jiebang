export type ProfileFieldDisposition =
  | "raw_private_input"
  | "canonicalized"
  | "redacted_summary"
  | "enum"
  | "canonical_date"
  | "objective_evidence"
  | "memory_only"
  | "policy_input"

export const PROFILE_V2_FIELD_CONSUMPTION = [
  { field: "schema_version", owner: "contract_runtime", crosses_to_c: false, disposition: "enum" },
  { field: "profile_id", owner: "role_c_profile_ref", crosses_to_c: true, disposition: "canonicalized" },
  { field: "profile_version", owner: "role_c_profile_ref", crosses_to_c: true, disposition: "canonicalized" },
  { field: "revision", owner: "role_b_profile_lifecycle", crosses_to_c: true, disposition: "policy_input" },
  { field: "learner_id", owner: "orchestrator_auth", crosses_to_c: true, disposition: "canonicalized" },
  { field: "level", owner: "role_b_objective_profile", crosses_to_c: true, disposition: "objective_evidence" },
  { field: "known_concepts", owner: "role_b_objective_profile", crosses_to_c: true, disposition: "objective_evidence" },
  { field: "weak_concepts", owner: "role_b_objective_profile", crosses_to_c: true, disposition: "objective_evidence" },
  { field: "goal", owner: "role_b_path", crosses_to_c: true, disposition: "redacted_summary" },
  { field: "goal_profile", owner: "role_c_personalization", crosses_to_c: true, disposition: "enum" },
  { field: "learning_barriers", owner: "role_c_expression", crosses_to_c: true, disposition: "canonicalized" },
  { field: "confidence_state", owner: "role_b_active_questioning", crosses_to_c: false, disposition: "memory_only" },
  { field: "ability_dimensions", owner: "role_b_diagnosis", crosses_to_c: false, disposition: "objective_evidence" },
  { field: "background_context.summary", owner: "role_b_diagnosis", crosses_to_c: false, disposition: "raw_private_input" },
  { field: "background_context.education_stage", owner: "role_c_expression", crosses_to_c: true, disposition: "canonicalized" },
  { field: "background_context.discipline_background", owner: "role_c_expression", crosses_to_c: true, disposition: "canonicalized" },
  { field: "background_context.role_context", owner: "role_c_expression", crosses_to_c: true, disposition: "redacted_summary" },
  { field: "background_context.prior_languages", owner: "role_c_expression", crosses_to_c: true, disposition: "canonicalized" },
  { field: "background_context.prior_topics", owner: "role_c_expression", crosses_to_c: true, disposition: "canonicalized" },
  { field: "goal_context.use_case", owner: "role_c_pedagogy", crosses_to_c: true, disposition: "enum" },
  { field: "goal_context.desired_outcome", owner: "role_c_expression", crosses_to_c: true, disposition: "redacted_summary" },
  { field: "goal_context.deadline", owner: "role_c_pedagogy", crosses_to_c: true, disposition: "canonical_date" },
  { field: "self_assessment.reported_level", owner: "role_b_diagnosis", crosses_to_c: false, disposition: "objective_evidence" },
  { field: "learning_preferences.explanation", owner: "role_c_expression", crosses_to_c: true, disposition: "enum" },
  { field: "learning_preferences.practice", owner: "role_c_pedagogy", crosses_to_c: true, disposition: "enum" },
  { field: "learning_preferences.pace", owner: "role_c_pedagogy", crosses_to_c: true, disposition: "enum" },
  { field: "learning_preferences.preferred_contexts", owner: "role_c_expression", crosses_to_c: true, disposition: "redacted_summary" },
  { field: "learning_constraints.weekly_time_budget_minutes", owner: "role_c_pedagogy", crosses_to_c: true, disposition: "policy_input" },
  { field: "learning_constraints.session_time_budget_minutes", owner: "role_c_pedagogy", crosses_to_c: true, disposition: "policy_input" },
  { field: "learning_constraints.tool_constraints", owner: "role_c_pedagogy", crosses_to_c: true, disposition: "redacted_summary" },
  { field: "learning_constraints.accommodations", owner: "role_c_pedagogy", crosses_to_c: true, disposition: "redacted_summary" },
  { field: "progress.mastery_by_source_id", owner: "role_c_pedagogy", crosses_to_c: true, disposition: "objective_evidence" },
  { field: "progress.completed_session_ids", owner: "learner_memory", crosses_to_c: false, disposition: "memory_only" },
  { field: "progress.recent_error_patterns", owner: "role_c_expression", crosses_to_c: true, disposition: "canonicalized" },
  { field: "progress.last_observation_id", owner: "learner_memory", crosses_to_c: false, disposition: "memory_only" },
  { field: "progress.last_observed_at", owner: "learner_memory", crosses_to_c: false, disposition: "memory_only" },
  { field: "progress.last_assessment_accuracy", owner: "role_b_progress", crosses_to_c: false, disposition: "objective_evidence" },
  { field: "privacy.personalization_enabled", owner: "role_b_privacy", crosses_to_c: true, disposition: "policy_input" },
  { field: "privacy.retention", owner: "learner_memory", crosses_to_c: false, disposition: "memory_only" },
  { field: "privacy.allow_profile_display", owner: "role_d_ui", crosses_to_c: false, disposition: "policy_input" },
  { field: "provenance.field_sources", owner: "role_b_audit", crosses_to_c: false, disposition: "memory_only" },
  { field: "created_at", owner: "role_b_profile_lifecycle", crosses_to_c: false, disposition: "memory_only" },
  { field: "updated_at", owner: "role_b_profile_lifecycle", crosses_to_c: false, disposition: "memory_only" },
] as const satisfies ReadonlyArray<{
  field: string
  owner: string
  crosses_to_c: boolean
  disposition: ProfileFieldDisposition
}>

export const PROFILE_V2_CONSUMABLE_FIELDS = PROFILE_V2_FIELD_CONSUMPTION.map((entry) => entry.field)

/** Maintained beside LearnerProfileV2; adding a structured field requires assigning an owner here. */
export const PROFILE_V2_AUDITED_FIELDS = [
  "schema_version", "profile_id", "profile_version", "revision", "learner_id", "level",
  "known_concepts", "weak_concepts", "goal", "goal_profile", "learning_barriers",
  "confidence_state", "ability_dimensions", "background_context.summary",
  "background_context.education_stage", "background_context.discipline_background",
  "background_context.role_context", "background_context.prior_languages",
  "background_context.prior_topics", "goal_context.use_case", "goal_context.desired_outcome",
  "goal_context.deadline", "self_assessment.reported_level", "learning_preferences.explanation",
  "learning_preferences.practice", "learning_preferences.pace",
  "learning_preferences.preferred_contexts", "learning_constraints.weekly_time_budget_minutes",
  "learning_constraints.session_time_budget_minutes", "learning_constraints.tool_constraints",
  "learning_constraints.accommodations", "progress.mastery_by_source_id",
  "progress.completed_session_ids", "progress.recent_error_patterns", "progress.last_observation_id",
  "progress.last_observed_at", "progress.last_assessment_accuracy",
  "privacy.personalization_enabled", "privacy.retention", "privacy.allow_profile_display",
  "provenance.field_sources", "created_at", "updated_at",
] as const

export function unownedProfileV2Fields(expected: readonly string[] = PROFILE_V2_AUDITED_FIELDS): string[] {
  const owned = new Set<string>(PROFILE_V2_FIELD_CONSUMPTION.map((entry) => entry.field))
  return expected.filter((field) => !owned.has(field))
}
