import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PathRegistryStore } from "../src/orchestration/path-registry-store"

describe("durable path registry", () => {
  test("persists goal changes and restores paused paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "knowbalance-paths-"))
    try {
      const store = new PathRegistryStore(root)
      await store.save({
        learner_id: "learner-store",
        active_path: {
          path_id: "PATH-OLD",
          goal_profile: "coursework",
          goal: "课程作业",
          level: "intermediate",
          current_node_id: "NODE-1",
          status: "active",
          mastery: { O1: 0.8 },
        },
        paths: [],
      })
      const changed = await store.changeGoal("learner-store", {
        path_id: "PATH-NEW",
        goal_profile: "algorithm_competition",
        goal: "算法竞赛",
      })
      expect(changed.active_path).toMatchObject({ path_id: "PATH-NEW", level: "beginner", status: "active" })

      const restored = await new PathRegistryStore(root).load("learner-store")
      expect(restored.paths.find((path) => path.path_id === "PATH-OLD")).toMatchObject({
        status: "paused",
        pause_reason: "goal_changed",
        current_node_id: "NODE-1",
        mastery: { O1: 0.8 },
      })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("creates a registry from an existing session snapshot only once", async () => {
    const root = await mkdtemp(join(tmpdir(), "knowbalance-paths-"))
    try {
      const store = new PathRegistryStore(root)
      const first = await store.ensureFromSession("learner-store", {
        path_id: "PATH-SESSION",
        goal_profile: "coursework",
        goal: "课程作业",
        level: "basic",
        current_node_id: "NODE-2",
      })
      const second = await store.ensureFromSession("learner-store", {
        path_id: "PATH-OTHER",
        goal_profile: "job_interview",
        goal: "面试",
        level: "integrated",
        current_node_id: "NODE-9",
      })
      expect(first.active_path).toMatchObject({ path_id: "PATH-SESSION", level: "basic" })
      expect(second.active_path).toMatchObject({ path_id: "PATH-SESSION", level: "basic" })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
