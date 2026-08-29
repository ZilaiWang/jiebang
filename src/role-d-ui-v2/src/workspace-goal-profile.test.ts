import { describe, expect, test } from "bun:test"
import { addPlan, addUser, createEmptyWorkspace, activePlan } from "./workspace"

describe("learning plan main goal persistence", () => {
  test("stores exactly one selected main goal on the plan", () => {
    let workspace = addUser(createEmptyWorkspace(), {
      id: "learner-goal-plan",
      name: "目标学习者",
      weeklyHours: 5,
      pythonLevel: "beginner",
      learningStyle: "balanced",
      background: "学生",
      priorLanguages: [],
    })
    workspace = addPlan(workspace, "learner-goal-plan", {
      id: "plan-competition",
      name: "数据结构",
      goalProfile: "algorithm_competition",
    })

    expect(activePlan(workspace)).toMatchObject({
      goalProfile: "algorithm_competition",
      status: "active",
    })
  })
})
