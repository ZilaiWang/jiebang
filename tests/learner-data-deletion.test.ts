import { describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { deleteLearnerData } from "../src/privacy/learner-data-deletion"

describe("learner data deletion", () => {
  test("deletes only the requested learner's stored data", async () => {
    const root = await mkdtemp(join(tmpdir(), "knowbalance-privacy-"))
    try {
      for (const path of [
        "sessions/session-a.json",
        "sessions/session-b.json",
        "learner-memory/learner-a.json",
        "learner-memory/learner-b.json",
        "paths/learner-a.json",
        "paths/learner-b.json",
        "mastery/learner-a.json",
        "mastery/learner-b.json",
      ]) {
        await mkdir(join(root, path, ".."), { recursive: true })
        await writeFile(join(root, path), JSON.stringify({ learner_id: path.includes("session-a") || path.includes("learner-a") ? "learner-a" : "learner-b" }))
      }

      const result = await deleteLearnerData(root, "learner-a")
      expect(result.deleted_files).toBe(4)
      await expect(readFile(join(root, "sessions/session-a.json"))).rejects.toThrow()
      await expect(readFile(join(root, "learner-memory/learner-a.json"))).rejects.toThrow()
      await expect(readFile(join(root, "paths/learner-a.json"))).rejects.toThrow()
      await expect(readFile(join(root, "mastery/learner-a.json"))).rejects.toThrow()
      expect(await readFile(join(root, "sessions/session-b.json"), "utf8")).toContain("learner-b")
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
