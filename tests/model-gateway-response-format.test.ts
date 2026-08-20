import { describe, expect, test } from "bun:test"
import { createRoleCModelGatewayFromEnv, OpenAICompatibleModelGateway } from "../src/role-c-content/contracts/model-gateway"

describe("OpenAI-compatible model response format", () => {
  test("defaults to the documented 120 second provider timeout", () => {
    const base = {
      endpoint: "https://api.example.test/chat/completions",
      model: "slow-structured-model",
    }
    const defaultGateway = new OpenAICompatibleModelGateway(base)
    const documentedGateway = new OpenAICompatibleModelGateway({ ...base, timeout_ms: 120_000 })
    const legacyGateway = new OpenAICompatibleModelGateway({ ...base, timeout_ms: 30_000 })

    expect(defaultGateway.model_config_hash).toBe(documentedGateway.model_config_hash)
    expect(defaultGateway.model_config_hash).not.toBe(legacyGateway.model_config_hash)
  })

  test("disables provider thinking by default for bounded structured authoring", async () => {
    let requestBody: Record<string, unknown> | undefined
    const gateway = createRoleCModelGatewayFromEnv({
      ROLE_C_MODEL_ENDPOINT: "https://api.example.test/chat/completions",
      ROLE_C_MODEL_ID: "reasoning-model",
      ROLE_C_MODEL_API_KEY: "test-key",
    }, {
      fetch_impl: async (_input, init) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
        return new Response(JSON.stringify({
          choices: [{ message: { content: "{\"ok\":true}" }, finish_reason: "stop" }],
        }), { status: 200, headers: { "content-type": "application/json" } })
      },
    })

    await gateway.generateStructured({
      task: "probe",
      system_prompt: "return JSON",
      input: {},
      output_schema_id: "probe_v1",
      output_schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
      temperature: 0,
      max_tokens: 100,
      idempotency_key: "probe-default-thinking",
    })

    expect(requestBody?.thinking).toEqual({ type: "disabled" })
  })

  test("allows a complex call to override the default and enable thinking", async () => {
    let requestBody: Record<string, unknown> | undefined
    const gateway = new OpenAICompatibleModelGateway({
      endpoint: "https://api.example.test/chat/completions",
      model: "reasoning-model",
      thinking: "disabled",
      fetch_impl: async (_input, init) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
        return new Response(JSON.stringify({
          choices: [{ message: { content: "{\"ok\":true}" }, finish_reason: "stop" }],
        }), { status: 200, headers: { "content-type": "application/json" } })
      },
    })

    await gateway.generateStructured({
      task: "semantic-repair",
      system_prompt: "return JSON",
      input: {},
      output_schema_id: "probe_v1",
      output_schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
      temperature: 0,
      max_tokens: 100,
      idempotency_key: "probe-thinking-override",
      thinking: "enabled",
    })

    expect(requestBody?.thinking).toEqual({ type: "enabled" })
  })

  test("uses json_object by default for providers that reject json_schema", async () => {
    let requestBody: Record<string, unknown> | undefined
    const gateway = new OpenAICompatibleModelGateway({
      endpoint: "https://api.deepseek.com/chat/completions",
      model: "deepseek-chat",
      fetch_impl: async (_input, init) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
        return new Response(JSON.stringify({
          choices: [{ message: { content: "{\"ok\":true}" }, finish_reason: "stop" }],
        }), { status: 200, headers: { "content-type": "application/json" } })
      },
    })

    await expect(gateway.generateStructured({
      task: "probe",
      system_prompt: "return JSON",
      input: { value: 1 },
      output_schema_id: "probe_v1",
      output_schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
      temperature: 0,
      max_tokens: 100,
      idempotency_key: "probe-1",
    })).resolves.toEqual({ ok: true })
    expect(requestBody?.response_format).toEqual({ type: "json_object" })
  })
})
