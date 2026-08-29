import { describe, expect, test } from "bun:test"
import {
  addPlan,
  addUser,
  createEmptyWorkspace,
  pausePlanForGoalChange,
  resumePlanAfterShortDiagnosis,
  selectPlan,
} from "../src/role-d-ui-v2/src/workspace"

describe("workspace path lifecycle", () => {
  function base() {
    let workspace = addUser(createEmptyWorkspace(), {
      id: "learner-path",
      name: "路径学习者",
      weeklyHours: 5,
      pythonLevel: "beginner",
      learningStyle: "balanced",
      background: "学生",
      priorLanguages: [],
    })
    workspace = addPlan(workspace, "learner-path", {
      id: "old-plan",
      name: "旧路径",
      goalProfile: "coursework",
    })
    return workspace
  }

  test("goal change pauses the old path but preserves its session and progress", () => {
    let workspace = base()
    workspace = pausePlanForGoalChange(workspace, "learner-path", "old-plan")
    const plan = workspace.users[0]!.plans[0]!

    expect(plan.status).toBe("paused")
    expect(plan.pauseReason).toBe("goal_changed")
    expect(plan.sessionId).toBeUndefined()
  })

  test("a new goal plan is active and starts at beginner", () => {
    let workspace = base()
    workspace = pausePlanForGoalChange(workspace, "learner-path", "old-plan")
    workspace = addPlan(workspace, "learner-path", {
      id: "new-plan",
      name: "新路径",
      goalProfile: "algorithm_competition",
      level: "beginner",
      status: "active",
    })

    expect(workspace.users[0]!.activePlanId).toBe("new-plan")
    expect(workspace.users[0]!.plans.find((plan) => plan.id === "old-plan")?.status).toBe("paused")
    expect(workspace.users[0]!.plans.find((plan) => plan.id === "new-plan")).toMatchObject({
      status: "active",
      level: "beginner",
      goalProfile: "algorithm_competition",
    })
  })

  test("resuming a paused path requires a short diagnosis before activation", () => {
    let workspace = base()
    workspace = pausePlanForGoalChange(workspace, "learner-path", "old-plan")
    workspace = addPlan(workspace, "learner-path", { id: "new-plan", name: "新路径" })
    workspace = selectPlan(workspace, "learner-path", "old-plan")

    expect(workspace.users[0]!.plans.find((plan) => plan.id === "old-plan")?.status).toBe("paused")
    expect(workspace.users[0]!.plans.find((plan) => plan.id === "old-plan")?.resumeDiagnosisRequired).toBe(true)

    workspace = resumePlanAfterShortDiagnosis(workspace, "learner-path", "old-plan", "intermediate")
    expect(workspace.users[0]!.activePlanId).toBe("old-plan")
    expect(workspace.users[0]!.plans.find((plan) => plan.id === "old-plan")).toMatchObject({
      status: "active",
      level: "intermediate",
      resumeDiagnosisRequired: false,
    })
  })
})
