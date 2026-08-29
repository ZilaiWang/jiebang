import { describe, expect, test } from "bun:test"
import {
  changeLearnerGoal,
  createPathRegistry,
  resumePathAfterDiagnosis,
  type GoalPathRegistry,
} from "../src/orchestration/path-registry"

describe("orchestrator path registry", () => {
  function registry(): GoalPathRegistry {
    return createPathRegistry({
      learner_id: "learner-registry",
      active_path: {
        path_id: "PATH-OLD",
        goal_profile: "coursework",
        goal: "完成数据结构课程作业",
        level: "intermediate",
        current_node_id: "NODE-LIST",
        status: "active",
        mastery: { O1: 0.82 },
      },
    })
  }

  test("changing goal pauses old path and creates a beginner active path", () => {
    const result = changeLearnerGoal(registry(), {
      path_id: "PATH-NEW",
      goal_profile: "algorithm_competition",
      goal: "参加算法竞赛",
    })

    expect(result.active_path).toMatchObject({
      path_id: "PATH-NEW",
      status: "active",
      level: "beginner",
      goal_profile: "algorithm_competition",
    })
    expect(result.paths.find((path) => path.path_id === "PATH-OLD")).toMatchObject({
      status: "paused",
      pause_reason: "goal_changed",
      level: "intermediate",
      mastery: { O1: 0.82 },
    })
  })

  test("resuming a paused path requires diagnosis and preserves its node", () => {
    const changed = changeLearnerGoal(registry(), {
      path_id: "PATH-NEW",
      goal_profile: "job_interview",
      goal: "准备求职面试",
    })
    const pending = resumePathAfterDiagnosis(changed, "PATH-OLD")
    expect(pending.active_path.path_id).toBe("PATH-OLD")
    expect(pending.active_path.status).toBe("paused")
    expect(pending.pending_resume?.path_id).toBe("PATH-OLD")

    const resumed = resumePathAfterDiagnosis(pending, "PATH-OLD", { level: "basic" })
    expect(resumed.active_path).toMatchObject({
      path_id: "PATH-OLD",
      status: "active",
      level: "basic",
      current_node_id: "NODE-LIST",
    })
    expect(resumed.pending_resume).toBeUndefined()
  })
})
