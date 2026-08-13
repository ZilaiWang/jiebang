import { describe, expect, test } from "bun:test"
import { OpenAICompatibleModelGateway } from "../src/role-c-content/contracts/model-gateway"

describe("OpenAI-compatible model response format", () => {
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
