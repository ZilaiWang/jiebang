import { describe, expect, test } from "bun:test"
import {
  ModelExecutionBudget,
  ModelExecutionBudgetExceededError,
  classifyProviderFailure,
  modelCallPolicy,
} from "../src/model-runtime"
import { OpenAICompatibleModelGateway } from "../src/role-c-content/contracts/model-gateway"

describe("project model runtime", () => {
  test("maps QUALITY to official GLM-5.2 reasoning_effort=high", async () => {
    let body: Record<string, unknown> | undefined
    const gateway = new OpenAICompatibleModelGateway({
      endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
      model: "glm-5.2",
      fetch_impl: async (_input, init) => {
        body = JSON.parse(String(init?.body))
        return new Response(JSON.stringify({
          choices: [{ message: { content: "{\"ok\":true}" }, finish_reason: "stop" }],
        }), { status: 200, headers: { "content-type": "application/json" } })
      },
    })
    await gateway.generateStructured({
      task: "semantic-plan",
      system_prompt: "return JSON",
      input: {},
      output_schema_id: "probe-v1",
      output_schema: { type: "object" },
      temperature: 0,
      max_tokens: 1_000,
      idempotency_key: "quality-probe",
      policy: modelCallPolicy("quality", { max_tokens: 1_000 }),
    })
    expect(body?.thinking).toEqual({ type: "enabled" })
    expect(body?.reasoning_effort).toBe("high")
    expect(body?.do_sample).toBe(false)
  })

  test("classifies permanent GLM quota failures without retry", () => {
    expect(classifyProviderFailure(429, { error: { code: "1113" } })).toEqual({
      provider_code: "1113",
      retriable: false,
      category: "quota",
    })
    expect(classifyProviderFailure(429, { error: { code: "1302" } }).retriable).toBe(true)
  })

  test("enforces one shared workflow call budget", () => {
    const budget = new ModelExecutionBudget({
      soft_deadline_ms: 100,
      hard_deadline_ms: 1_000,
      max_model_calls: 1,
      max_transport_retries_total: 0,
    })
    budget.consumeModelCall()
    expect(() => budget.consumeModelCall()).toThrow(ModelExecutionBudgetExceededError)
  })
})
