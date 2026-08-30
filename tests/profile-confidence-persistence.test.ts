import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { appendProfileObservation, loadLearnerMemory, saveLearnerMemory } from "../src/orchestration/learner-memory"
import { applyProfileConfidenceAnswer, buildProfileConfidenceState } from "../src/role-b-profile/profile-confidence"

describe("profile confidence persistence boundary", () => {
  test("persists confidence state and structured observations without raw answer", async () => {
    const root = await mkdtemp(join(tmpdir(), "profile-confidence-"))
    try {
      const state = buildProfileConfidenceState({
        has_explicit_goal: true, has_goal_profile: true, self_rating_present: true,
        objective_answered_count: 3, objective_consistency: 0.9, known_concept_count: 2,
        weak_concept_count: 1, barrier_observation_count: 0, task_ability_observation_count: 0,
        explanation_preference_confirmed: false, practice_preference_confirmed: false,
      })
      const nextState = applyProfileConfidenceAnswer(state, {
        question_id: "PROFILE-CONFIDENCE-task_ability",
        dimension: "task_ability",
        answer: "能完成基础题",
      })
      const memory = await loadLearnerMemory(root, "learner-1")
      const updated = appendProfileObservation({ ...memory, confidence_state: nextState }, { dimension: "task_ability", value: "basic_tasks" })
      await saveLearnerMemory(root, updated)
      const reloaded = await loadLearnerMemory(root, "learner-1")
      expect(reloaded.confidence_state?.fields.task_ability.confidence).toBeGreaterThan(0.7)
      expect(reloaded.profile_observations).toEqual([{ dimension: "task_ability", value: "basic_tasks", count: 1 }])
      expect(await readFile(join(root, "learner-memory", "learner-1.json"), "utf8")).not.toContain("能完成基础题")
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
