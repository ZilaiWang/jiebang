import { describe, expect, test } from "bun:test"
import {
  ModelExecutionBudget,
  ModelExecutionBudgetExceededError,
  ROLE_C_CONTENT_MODEL_CALL_BUDGET,
  ROLE_C_DURABLE_JOB_DEADLINE_MS,
  ROLE_C_REVIEWED_WORKFLOW_HARD_DEADLINE_MS,
  classifyProviderFailure,
  modelCallPolicy,
  roleCContentModelCallBudget,
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

  test("fails closed after the workflow hard deadline", () => {
    const budget = new ModelExecutionBudget({
      soft_deadline_ms: 5,
      hard_deadline_ms: 10,
      max_model_calls: 10,
      max_transport_retries_total: 1,
    })
    expect(() => budget.consumeModelCall(budget.snapshot().deadline_at_ms + 1))
      .toThrow("MODEL_EXECUTION_BUDGET_EXCEEDED:DEADLINE")
  })

  test("default content budget covers three reviewed candidates", () => {
    const snapshot = new ModelExecutionBudget().snapshot()
    expect(snapshot.max_model_calls).toBe(
      ROLE_C_CONTENT_MODEL_CALL_BUDGET,
    )
    expect(snapshot.hard_deadline_ms).toBe(ROLE_C_REVIEWED_WORKFLOW_HARD_DEADLINE_MS)
    expect(ROLE_C_DURABLE_JOB_DEADLINE_MS).toBeGreaterThan(snapshot.hard_deadline_ms)
    expect(ROLE_C_CONTENT_MODEL_CALL_BUDGET).toBe(258)
  })

  test("sizes the content budget from objectives, items, and candidate count", () => {
    expect(roleCContentModelCallBudget({
      objective_count: 1,
      assessment_item_count: 5,
      public_candidate_count: 1,
    })).toBe(132)
    expect(roleCContentModelCallBudget({
      objective_count: 2,
      assessment_item_count: 6,
      public_candidate_count: 3,
      max_external_revisions: 0,
    })).toBe(106)
  })
})
