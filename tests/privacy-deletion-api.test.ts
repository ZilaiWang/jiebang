import { describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { createLearningOrchestratorApiHandler } from "../src/orchestration/learning-orchestrator-api"

describe("privacy deletion API", () => {
  test("requires the authenticated learner identity", async () => {
    const root = await mkdtemp(join(process.env.TEMP ?? process.env.TMP ?? ".", "knowbalance-privacy-api-"))
    try {
      const handler = createLearningOrchestratorApiHandler({ data_root: root, server_hostname: "127.0.0.1", provider_environment: {} })
      const response = await handler(new Request("http://127.0.0.1/orchestrator/privacy/learner-data", { method: "DELETE" }))
      expect(response.status).toBe(401)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("deletes only the authenticated learner's persisted data", async () => {
    const root = await mkdtemp(join(process.env.TEMP ?? process.env.TMP ?? ".", "knowbalance-privacy-api-"))
    try {
      await mkdir(join(root, "sessions"), { recursive: true })
      await writeFile(join(root, "sessions", "a.json"), JSON.stringify({ owner_id: "learner-a", learner_request: { learner_id: "learner-a" } }))
      await writeFile(join(root, "sessions", "b.json"), JSON.stringify({ owner_id: "learner-b", learner_request: { learner_id: "learner-b" } }))
      const handler = createLearningOrchestratorApiHandler({ data_root: root, server_hostname: "127.0.0.1", provider_environment: {} })
      const response = await handler(new Request("http://127.0.0.1/orchestrator/privacy/learner-data", {
        method: "DELETE",
        headers: { authorization: "Bearer learner-a" },
      }))
      expect(response.status).toBe(200)
      expect(await readFile(join(root, "sessions", "b.json"), "utf8")).toContain("learner-b")
      await expect(readFile(join(root, "sessions", "a.json"))).rejects.toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
