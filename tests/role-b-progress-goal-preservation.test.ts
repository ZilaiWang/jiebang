import { describe, expect, test } from "bun:test"
import { applyProgressObservation } from "../src/role-b-profile/teaching-audit/progress-receiver"
import type { LearnerProfile } from "../src/role-b-profile/types"

function profile(): LearnerProfile {
  return {
    learner_id: "learner-goal-preserve",
    level: "basic",
    known_concepts: ["变量"],
    weak_concepts: ["列表"],
    goal: "学习数据结构",
    goal_profile: "algorithm_competition",
  }
}

describe("B progress update preserves the single main goal", () => {
  test("updated snapshot keeps goal_profile for the next personalized round", () => {
    const result = applyProgressObservation({
      currentProfile: profile(),
      profileVersion: "profile-v2",
      observation: {
        observationId: "OBS-1",
        action: "reinforce",
        overallAccuracy: 0.7,
        mastery: [{ objectiveId: "O1", mastery: 0.7, evidenceBatches: 1 }],
        conceptEvidence: [],
      },
    })

    expect(result.profile.goal_profile).toBe("algorithm_competition")
    expect(result.snapshot.goal_profile).toBe("algorithm_competition")
  })
})
