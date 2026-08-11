import { describe, expect, test } from "bun:test"
import {
  addPlan,
  addUser,
  createEmptyWorkspace,
  deletePlan,
  loadWorkspace,
  markPlanConceptMastered,
  masteredConceptsForUser,
  planNameFromGoal,
  recordPlanPublicState,
  renamePlan,
  selectUser,
} from "./workspace"

describe("Role D local workspace", () => {
  test("keeps plans isolated by learner and deletes only the selected plan", () => {
    let workspace = createEmptyWorkspace()
    workspace = addUser(workspace, {
      id: "learner-lin",
      name: "林晓",
      weeklyHours: 6,
      pythonLevel: "beginner",
      learningStyle: "practice",
      background: "高中生",
      priorLanguages: [],
    })
    workspace = addPlan(workspace, "learner-lin", { id: "plan-loop", name: "循环入门" })
    workspace = addPlan(workspace, "learner-lin", { id: "plan-list", name: "列表进阶" })
    workspace = addUser(workspace, {
      id: "learner-zhou",
      name: "周宁",
      weeklyHours: 3,
      pythonLevel: "intermediate",
      learningStyle: "concept",
      background: "大学生",
      priorLanguages: ["Java"],
    })
    workspace = addPlan(workspace, "learner-zhou", { id: "plan-function", name: "函数复习" })
    workspace = selectUser(workspace, "learner-lin")
    workspace = deletePlan(workspace, "learner-lin", "plan-loop")

    expect(workspace.activeUserId).toBe("learner-lin")
    expect(workspace.users.find((user) => user.id === "learner-lin")?.plans.map((plan) => plan.id)).toEqual(["plan-list"])
    expect(workspace.users.find((user) => user.id === "learner-zhou")?.plans.map((plan) => plan.id)).toEqual(["plan-function"])
  })

  test("falls back safely when browser workspace data is malformed", () => {
    expect(loadWorkspace("not-json")).toEqual(createEmptyWorkspace())
    expect(loadWorkspace(JSON.stringify({ version: 1, users: [{ id: 2 }] }))).toEqual(createEmptyWorkspace())
  })

  test("names a plan from the selected chapter or custom learning goal", () => {
    expect(planNameFromGoal({ mode: "catalog", chapterTitle: "for 循环" })).toBe("for 循环")
    expect(planNameFromGoal({ mode: "custom", customGoal: "  用 Python 做一个单词统计器  " })).toBe("用 Python 做一个单词统计器")
  })

  test("records profile-known concepts separately from formally mastered concepts", () => {
    let workspace = addUser(createEmptyWorkspace(), {
      id: "learner-lin",
      name: "林晓",
      weeklyHours: 6,
      pythonLevel: "beginner",
      learningStyle: "practice",
      background: "高中生",
      priorLanguages: [],
    })
    workspace = addPlan(workspace, "learner-lin", { id: "plan-loop", name: "待选择学习目标" })
    workspace = renamePlan(workspace, "learner-lin", "plan-loop", "for 循环")
    workspace = recordPlanPublicState(workspace, "learner-lin", "plan-loop", {
      sessionId: "SESSION-1",
      status: "waiting_for_user",
      stage: "assessment",
      knownConcepts: ["变量与赋值", "for 循环"],
    })
    expect(masteredConceptsForUser(workspace, "learner-lin")).toEqual([])
    workspace = markPlanConceptMastered(workspace, "learner-lin", "plan-loop", "for 循环")
    expect(masteredConceptsForUser(workspace, "learner-lin")).toEqual(["for 循环"])
  })
})
