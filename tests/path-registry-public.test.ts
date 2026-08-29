import { describe, expect, test } from "bun:test"
import { publicPathRegistry } from "../src/orchestration/path-registry"

describe("path registry public projection", () => {
  test("removes private resume answers from the public registry", () => {
    const view = publicPathRegistry({
      learner_id: "learner-public",
      active_path: {
        path_id: "PATH-NEW",
        goal_profile: "coursework",
        goal: "课程作业",
        level: "beginner",
        current_node_id: null,
        status: "active",
        mastery: {},
      },
      paths: [],
      pending_resume: {
        path_id: "PATH-OLD",
        items: [{ item_id: "R-1", objective_id: "O-1", source_id: "K-1", question: "题目", options: ["A", "B"] }],
        answer_key: { "R-1": "A" },
      },
    })

    expect(view.pending_resume).toMatchObject({ path_id: "PATH-OLD", items: [{ item_id: "R-1" }] })
    expect(view.pending_resume).not.toHaveProperty("answer_key")
  })
})
