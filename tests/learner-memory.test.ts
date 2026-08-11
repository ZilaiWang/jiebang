import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  appendPersistenceEvents,
  loadLearnerMemory,
  memorySummaryForProfile,
  saveLearnerMemory,
} from "../src/orchestration/learner-memory"

const temporaryRoots: string[] = []

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    await rm(root, { recursive: true, force: true })
  }
})

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "knowbalance-memory-"))
  temporaryRoots.push(root)
  return root
}

describe("learner memory store", () => {
  test("creates an empty snapshot and persists mastery/weakness updates", async () => {
    const root = await tempRoot()
    const empty = await loadLearnerMemory(root, "learner-001")

    expect(empty).toMatchObject({
      learner_id: "learner-001",
      mastered_source_ids: [],
      weak_source_ids: [],
      completed_sessions: [],
    })

    const updated = appendPersistenceEvents(empty, [
      {
        event_type: "mastery_update",
        source: "objective-diagnostician",
        source_id: "K007",
        mastery: 0.25,
        evidence: "diagnostic incorrect",
      },
      {
        event_type: "mastery_update",
        source: "tiered-evaluator",
        source_id: "K009",
        mastery: 0.86,
        evidence: "assessment passed",
      },
      {
        event_type: "session_completed",
        source: "learning-orchestrator",
        session_id: "SESSION-001",
        summary: "finished first loop lesson",
      },
    ], "2026-08-04T00:00:00.000Z")

    await saveLearnerMemory(root, updated)
    const reloaded = await loadLearnerMemory(root, "learner-001")
    expect(reloaded.mastery_by_source_id).toEqual({ K007: 0.25, K009: 0.86 })
    expect(reloaded.weak_source_ids).toEqual(["K007"])
    expect(reloaded.mastered_source_ids).toEqual(["K009"])
    expect(reloaded.completed_sessions).toEqual(["SESSION-001"])

    const raw = await readFile(join(root, "learner-memory", "learner-001.json"), "utf8")
    expect(JSON.parse(raw).learner_id).toBe("learner-001")
  })

  test("summarizes memory for profile synthesis without user manual input", async () => {
    const summary = memorySummaryForProfile({
      schema_version: "1.0",
      learner_id: "learner-002",
      mastery_by_source_id: { K002: 0.9, K007: 0.2 },
      mastered_source_ids: ["K002"],
      weak_source_ids: ["K007"],
      completed_sessions: ["SESSION-OLD"],
      recent_errors: [{ source_id: "K007", pattern: "loop_boundary", count: 2 }],
      updated_at: "2026-08-04T00:00:00.000Z",
    })

    expect(summary.claimed_known).toContain("K002")
    expect(summary.claimed_weak).toContain("K007")
    expect(summary.quotes[0]?.text).toContain("learner memory")
  })

  test("does not silently replace corrupted persisted memory with an empty snapshot", async () => {
    const root = await tempRoot()
    await mkdir(join(root, "learner-memory"), { recursive: true })
    await Bun.write(join(root, "learner-memory", "learner-corrupt.json"), "{not-json")

    await expect(loadLearnerMemory(root, "learner-corrupt")).rejects.toThrow()
  })

  test("writes learner memory through an atomic temporary file", async () => {
    const root = await tempRoot()
    const path = join(root, "learner-memory", "learner-atomic.json")
    const snapshot = appendPersistenceEvents(await loadLearnerMemory(root, "learner-atomic"), [
      { event_type: "mastery_update", source: "learning-orchestrator", source_id: "K001", mastery: 0.9, evidence: "test" },
    ])
    await saveLearnerMemory(root, snapshot)
    await saveLearnerMemory(root, { ...snapshot, completed_sessions: ["SESSION-ATOMIC"] })
    const persisted = JSON.parse(await readFile(path, "utf8"))
    expect(persisted.completed_sessions).toEqual(["SESSION-ATOMIC"])
    expect(await Array.fromAsync(new Bun.Glob("*.tmp").scan({ cwd: join(root, "learner-memory") }))).toEqual([])
  })
})
