import { describe, expect, test } from "bun:test"
import {
  createOrchestratorSession,
  getOrchestratorEvents,
  getOrchestratorSession,
  getProviderConfiguration,
  saveProviderConfiguration,
  submitAssessmentAnswers,
  submitDiagnosisAnswers,
} from "./orchestrator-client"

const learnerId = "learner-ui-v2"

function fakeFetch(responses: unknown[]) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    const body = responses.shift()
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }
  return { calls, fetcher }
}

describe("orchestrator browser client", () => {
  test("creates a deterministic session through the main Agent boundary", async () => {
    const { calls, fetcher } = fakeFetch([{ session_id: "SESSION-1", status: "waiting_for_user" }])
    const result = await createOrchestratorSession({
      learnerId,
      goal: "学习 for 循环",
      background: "第一次使用",
      selfRating: "beginner",
      learningGoalSpec: { mode: "curriculum_node", selected_node_ids: ["PY-CH02-S02"] },
    }, fetcher)

    expect(result.session_id).toBe("SESSION-1")
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe("/orchestrator/sessions")
    expect(new Headers(calls[0]!.init?.headers).get("authorization")).toBe(`Bearer ${learnerId}`)
    expect(JSON.parse(String(calls[0]!.init?.body))).toMatchObject({
      mode: "deterministic",
      learner_request: {
        learner_id: learnerId,
        goal: "学习 for 循环",
        learning_goal_spec: { mode: "curriculum_node", selected_node_ids: ["PY-CH02-S02"] },
      },
    })
  })

  test("queries session and events using the same learner identity", async () => {
    const { calls, fetcher } = fakeFetch([
      { session_id: "SESSION-1", status: "waiting_for_user" },
      { session_id: "SESSION-1", events: [] },
    ])
    await getOrchestratorSession("SESSION-1", learnerId, fetcher)
    await getOrchestratorEvents("SESSION-1", learnerId, fetcher)
    expect(calls.map((call) => call.url)).toEqual([
      "/orchestrator/sessions/SESSION-1",
      "/orchestrator/sessions/SESSION-1/events",
    ])
    expect(calls.every((call) => new Headers(call.init?.headers).get("authorization") === `Bearer ${learnerId}`)).toBe(true)
  })

  test("submits diagnosis and assessment as idempotent commands", async () => {
    const { calls, fetcher } = fakeFetch([
      { session_id: "SESSION-1", current_stage: "assessment" },
      { session_id: "SESSION-1", feedback: { final_decision: { action: "remediate" } } },
    ])
    await submitDiagnosisAnswers("SESSION-1", learnerId, { "DIAG-1": "A" }, fetcher, "CMD-DIAG-1")
    await submitAssessmentAnswers("SESSION-1", learnerId, [{ item_id: "ITEM-1", selected_option_id: "A", hint_level_used: 0 }], fetcher, "CMD-ASSESS-1")
    expect(calls.map((call) => JSON.parse(String(call.init?.body)))).toEqual([
      { command_id: "CMD-DIAG-1", type: "submit_diagnosis_answers", payload: { answers: { "DIAG-1": "A" } } },
      { command_id: "CMD-ASSESS-1", type: "submit_assessment_answers", payload: { answers: [{ item_id: "ITEM-1", selected_option_id: "A", hint_level_used: 0 }] } },
    ])
  })

  test("reads and saves provider configuration without a learner authorization header", async () => {
    const { calls, fetcher } = fakeFetch([
      { configured: false, provider_mode: "model", endpoint: "", model_id: "" },
      { configured: true, provider_mode: "model", endpoint: "https://api.deepseek.com/chat/completions", model_id: "deepseek-chat" },
    ])
    await getProviderConfiguration(fetcher)
    await saveProviderConfiguration({
      endpoint: "https://api.deepseek.com/chat/completions",
      modelId: "deepseek-chat",
      apiKey: "secret",
    }, fetcher)
    expect(calls.map((call) => call.url)).toEqual([
      "/orchestrator/provider-config",
      "/orchestrator/provider-config",
    ])
    expect(new Headers(calls[0]!.init?.headers).has("authorization")).toBe(false)
    expect(JSON.parse(String(calls[1]!.init?.body))).toEqual({
      endpoint: "https://api.deepseek.com/chat/completions",
      model_id: "deepseek-chat",
      api_key: "secret",
    })
  })
})
