import { describe, expect, test } from "bun:test"
import { profileConfidenceEvidenceFromProfile, profileConfidenceStateFromProfile } from "../src/role-b-profile/profile-confidence"

test("derives confidence evidence from an existing learner profile", () => {
  const state = profileConfidenceStateFromProfile({
    learner_id: "learner-1",
    level: "basic",
    known_concepts: ["数组"],
    weak_concepts: ["链表"],
    goal: "学习数据结构",
    goal_profile: "coursework",
  })
  expect(profileConfidenceEvidenceFromProfile({
    learner_id: "learner-1",
    level: "basic",
    known_concepts: ["数组"],
    weak_concepts: ["链表"],
    goal: "学习数据结构",
    goal_profile: "coursework",
  }).has_explicit_goal).toBe(true)
  expect(state.fields.goal_profile.confidence).toBeGreaterThan(0.7)
  expect(state.fields.learning_barrier.confidence).toBeLessThan(0.6)
})
