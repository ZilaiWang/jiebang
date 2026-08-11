import { describe, expect, test } from "bun:test"
import { OpenAICompatibleModelGateway } from "../src/role-c-content/contracts/model-gateway"

const schema = { type: "object", properties: { ok: { type: "boolean" }, items: { type: "array" } }, required: ["ok"] }

describe("OpenAI-compatible model JSON extraction tolerance", () => {
  test("extracts a JSON object when provider wraps it in prose", async () => {
    const gateway = new OpenAICompatibleModelGateway({
      endpoint: "https://example.test/chat/completions",
      model: "probe",
      response_format: "text_json",
      fetch_impl: async () => new Response(JSON.stringify({
        choices: [{ message: { content: "这是结果：\n{\"ok\": true, \"items\": []}\n请查收。" }, finish_reason: "stop" }],
      }), { status: 200, headers: { "content-type": "application/json" } }),
    })

    await expect(gateway.generateStructured({
      task: "probe",
      system_prompt: "return JSON",
      input: {},
      output_schema_id: "probe_v1",
      output_schema: schema,
      temperature: 0,
      max_tokens: 100,
      idempotency_key: "probe-prose",
    })).resolves.toEqual({ ok: true, items: [] })
  })

  test("normalizes Python literals after extracting JSON from prose", async () => {
    const gateway = new OpenAICompatibleModelGateway({
      endpoint: "https://example.test/chat/completions",
      model: "probe",
      response_format: "text_json",
      fetch_impl: async () => new Response(JSON.stringify({
        choices: [{ message: { content: "结果如下：\n{\"ok\": True, \"items\": [False, None]}\n结束。" }, finish_reason: "stop" }],
      }), { status: 200, headers: { "content-type": "application/json" } }),
    })

    await expect(gateway.generateStructured({
      task: "probe-python-literals",
      system_prompt: "return JSON",
      input: {},
      output_schema_id: "probe_v1",
      output_schema: schema,
      temperature: 0,
      max_tokens: 100,
      idempotency_key: "probe-prose-python-literals",
    })).resolves.toEqual({ ok: true, items: [false, null] })
  })
})
