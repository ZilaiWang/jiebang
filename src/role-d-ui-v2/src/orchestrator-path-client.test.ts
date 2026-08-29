import { describe, expect, test } from "bun:test"
import { changeGoalPath, requestResumePath } from "./orchestrator-client"

function fakeFetch() {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    return new Response(JSON.stringify({ status: "short_diagnosis_required" }), { status: 202 })
  }
  return { calls, fetcher }
}

describe("orchestrator path lifecycle client", () => {
  test("changes the goal through the authenticated session boundary", async () => {
    const { calls, fetcher } = fakeFetch()
    await changeGoalPath("SESSION-1", "learner-1", {
      pathId: "PATH-NEW",
      goal: "算法竞赛",
      goalProfile: "algorithm_competition",
    }, fetcher)
    expect(calls[0]?.url).toBe("/orchestrator/sessions/SESSION-1/path/change-goal")
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      path_id: "PATH-NEW",
      goal: "算法竞赛",
      goal_profile: "algorithm_competition",
    })
  })

  test("requests resume without accepting a caller-supplied level", async () => {
    const { calls, fetcher } = fakeFetch()
    await requestResumePath("SESSION-1", "learner-1", "PATH-OLD", fetcher)
    expect(calls[0]?.url).toBe("/orchestrator/sessions/SESSION-1/path/resume")
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ path_id: "PATH-OLD" })
  })
})
