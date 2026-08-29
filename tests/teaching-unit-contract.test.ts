import { describe, expect, test } from "bun:test"
import { buildTeachingUnitContract } from "../src/role-c-content/planning/teaching-unit-contract"
import { buildRoleCPedagogyContract } from "../src/role-b-profile/pedagogy-contract"
import type { LearnerProfileV2 } from "../src/role-b-profile/learner-profile-v2"

const profile = {
  schema_version: "2.0",
  profile_id: "P1",
  profile_version: "P1-v1",
  revision: 1,
  learner_id: "L1",
  level: "basic",
  known_concepts: [],
  weak_concepts: ["循环"],
  goal: "参加算法竞赛",
  ability_dimensions: [],
  background_context: { summary: null, education_stage: null, discipline_background: [], role_context: null, prior_languages: [], prior_topics: [] },
  goal_context: { use_case: "competition", desired_outcome: null, deadline: null },
  self_assessment: { reported_level: "basic" },
  learning_preferences: { explanation: "step_by_step", practice: "coding", pace: "steady", preferred_contexts: [] },
  learning_constraints: { weekly_time_budget_minutes: 240, session_time_budget_minutes: 40, tool_constraints: [], accommodations: [] },
  progress: { mastery_by_source_id: {}, completed_session_ids: [], recent_error_patterns: [], last_observation_id: null, last_observed_at: null, last_assessment_accuracy: null },
  privacy: { personalization_enabled: true, retention: "session_only", allow_profile_display: true },
  provenance: { field_sources: [] },
  created_at: "2026-08-28T00:00:00.000Z",
  updated_at: "2026-08-28T00:00:00.000Z",
} satisfies LearnerProfileV2

describe("learnable teaching unit", () => {
  test("requires an actual learning cycle when evidence supports it", () => {
    const contract = buildTeachingUnitContract({
      objective_id: "OBJ-K007-1",
      pedagogy: buildRoleCPedagogyContract(profile),
      evidence: {
        fact_ids: ["F001", "F002"],
        prerequisite_fact_ids: ["F900"],
        example_fact_ids: ["F003"],
        misconception_fact_ids: ["F004"],
        procedure_fact_ids: ["F005"],
        supports_executable_code: true,
      },
    })
    const required = contract.slots.filter((slot) => slot.required).map((slot) => slot.kind)
    expect(required).toContain("mental_model")
    expect(required).toContain("worked_example")
    expect(required).toContain("guided_practice")
    expect(required).toContain("independent_practice")
    expect(required).toContain("debugging_clinic")
    expect(required).toContain("transfer_task")
    expect(contract.required_visible_fact_ids).toContain("F900")
  })

  test("fails before generation when no facts exist", () => {
    expect(() => buildTeachingUnitContract({
      objective_id: "OBJ-EMPTY",
      pedagogy: buildRoleCPedagogyContract(profile),
      evidence: {
        fact_ids: [],
        prerequisite_fact_ids: [],
        example_fact_ids: [],
        misconception_fact_ids: [],
        procedure_fact_ids: [],
        supports_executable_code: false,
      },
    })).toThrow("TEACHING_UNIT_FACTS_MISSING")
  })
})
