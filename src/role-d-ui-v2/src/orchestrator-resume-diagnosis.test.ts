import { describe, expect, test } from "bun:test"
import { submitResumeDiagnosisAnswers } from "./orchestrator-client"

test("resume diagnosis client submits only public answers", async () => {
  const calls: RequestInit[] = []
  const fetcher = async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(init ?? {})
    return new Response(JSON.stringify({ status: "resumed" }), { status: 200 })
  }
  await submitResumeDiagnosisAnswers("SESSION-1", "learner-1", "PATH-OLD", { "R-1": "A" }, fetcher)
  expect(JSON.parse(String(calls[0]?.body))).toEqual({ path_id: "PATH-OLD", answers: { "R-1": "A" } })
})
