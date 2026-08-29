import { describe, expect, test } from "bun:test"
import {
  createOrchestratorSession,
  getOrchestratorEvents,
  getOrchestratorSession,
  getProviderConfiguration,
  runAssessmentCode,
  runCodeLab,
  saveProviderConfiguration,
  submitAssessmentAnswers,
  submitDiagnosisAnswers,
  submitProfileAnswers,
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

  test("sends profile v2 intake and structured clarification answers through the main Agent boundary", async () => {
    const profileIntake = {
      learner_id: learnerId,
      goal: "用 Python 完成循环题",
      background_summary: "学过变量",
      self_rating: "basic" as const,
      goal_use_case: "competition" as const,
      weekly_time_budget_minutes: 180,
    }
    const { calls, fetcher } = fakeFetch([
      { session_id: "SESSION-V2", status: "waiting_for_user" },
      { session_id: "SESSION-V2", current_stage: "objective_diagnosis" },
    ])

    await createOrchestratorSession({
      learnerId,
      goal: profileIntake.goal,
      profileIntake,
    }, fetcher)
    await submitProfileAnswers(
      "SESSION-V2",
      learnerId,
      [{ question_id: "profile.desired_outcome", value: "独立完成并调试程序" }],
      fetcher,
      "CMD-PROFILE-1",
    )

    expect(JSON.parse(String(calls[0]!.init?.body))).toMatchObject({
      learner_request: { profile_intake: profileIntake },
    })
    expect(JSON.parse(String(calls[1]!.init?.body))).toEqual({
      command_id: "CMD-PROFILE-1",
      type: "submit_profile_answers",
      payload: {
        answers: [{ question_id: "profile.desired_outcome", value: "独立完成并调试程序" }],
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

  test("runs a published assessment code item through the main Agent command", async () => {
    const { calls, fetcher } = fakeFetch([{ session_id: "SESSION-1", code_execution: { status: "passed" } }])
    await runAssessmentCode("SESSION-1", learnerId, "ITEM-CODE-1", "print(1)", fetcher, "CMD-RUN-1")

    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({
      command_id: "CMD-RUN-1",
      type: "run_assessment_code",
      payload: { item_id: "ITEM-CODE-1", code: "print(1)" },
    })
  })

  test("runs a published code lab through the main Agent command", async () => {
    const { calls, fetcher } = fakeFetch([{ session_id: "SESSION-1", code_execution: { status: "passed" } }])
    await runCodeLab("SESSION-1", learnerId, "LAB-1", "print(1)", fetcher, "CMD-LAB-1")

    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({
      command_id: "CMD-LAB-1",
      type: "run_code_lab",
      payload: { lab_id: "LAB-1", code: "print(1)" },
    })
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
