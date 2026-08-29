import { describe, expect, test } from "bun:test"
import { deleteMyLearnerData } from "./orchestrator-client"

test("privacy client deletes the authenticated learner data without a body", async () => {
  let seen: { url: string; init?: RequestInit } | undefined
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    seen = { url: String(input), init }
    return new Response(JSON.stringify({ status: "deleted", deleted_files: 3, deleted_paths: [] }), { status: 200 })
  }
  const result = await deleteMyLearnerData("learner-1", fetcher)
  expect(result.status).toBe("deleted")
  expect(seen?.url).toContain("/orchestrator/privacy/learner-data")
  expect(seen?.init?.method).toBe("DELETE")
  expect(seen?.init?.body).toBeUndefined()
})
