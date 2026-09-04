import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createLearningOrchestratorApiHandler } from "../src/orchestration/learning-orchestrator-api"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("local provider configuration API", () => {
  test("stores a local model configuration without ever returning the API key", async () => {
    const root = await mkdtemp(join(tmpdir(), "provider-config-"))
    roots.push(root)
    const environment: Record<string, string | undefined> = {}
    const handle = createLearningOrchestratorApiHandler({
      data_root: root,
      provider_environment: environment,
      provider_probe: async () => ({ ok: true, model_id: "deepseek-chat" }),
    })
    const initial = await handle(new Request("http://127.0.0.1/orchestrator/provider-config"))
    expect(initial.status).toBe(200)
    await expect(initial.json()).resolves.toEqual({
      configured: false,
      provider_mode: "model",
      provider: "",
      endpoint: "",
      model_id: "",
    })

    const saved = await handle(new Request("http://127.0.0.1/orchestrator/provider-config", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        origin: "http://127.0.0.1:4175",
      },
      body: JSON.stringify({
        provider: "deepseek",
        endpoint: "https://api.deepseek.com/chat/completions",
        model_id: "deepseek-chat",
        api_key: "test-secret-that-must-not-return",
      }),
    }))
    expect(saved.status).toBe(200)
    const savedBody = await saved.json() as Record<string, unknown>
    expect(savedBody).toEqual({
      configured: true,
      provider_mode: "model",
      provider: "deepseek",
      endpoint: "https://api.deepseek.com/chat/completions",
      model_id: "deepseek-chat",
    })
    expect(JSON.stringify(savedBody)).not.toContain("test-secret")
    expect(environment.ROLE_C_MODEL_API_KEY).toBe("test-secret-that-must-not-return")

    const persisted = await readFile(join(root, "provider-config.json"), "utf8")
    expect(persisted).toContain("test-secret-that-must-not-return")
  })

  test("does not persist a provider configuration when the real provider probe fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "provider-config-"))
    roots.push(root)
    const handle = createLearningOrchestratorApiHandler({
      data_root: root,
      provider_environment: {},
      provider_probe: async () => ({ ok: false, error: "API Key 认证失败（HTTP 401）" }),
    })

    const response = await handle(new Request("http://127.0.0.1/orchestrator/provider-config", {
      method: "PUT",
      headers: { "content-type": "application/json", origin: "http://127.0.0.1:4177" },
      body: JSON.stringify({
        provider: "deepseek",
        endpoint: "https://api.deepseek.com/chat/completions",
        model_id: "deepseek-chat",
        api_key: "invalid-key",
      }),
    }))

    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ error: { code: "PROVIDER_PROBE_FAILED" } })
    await expect(readFile(join(root, "provider-config.json"))).rejects.toMatchObject({ code: "ENOENT" })
  })


  test("reads the effective local env configuration when no provider-config file exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "provider-config-"))
    roots.push(root)
    const handle = createLearningOrchestratorApiHandler({
      data_root: root,
      provider_environment: {
        ROLE_C_MODEL_ENDPOINT: "https://api.moonshot.cn/v1/chat/completions",
        ROLE_C_MODEL_ID: "kimi-k2.5",
        ROLE_C_MODEL_API_KEY: "env-secret",
      },
    })

    const response = await handle(new Request("http://127.0.0.1/orchestrator/provider-config"))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      configured: true,
      provider_mode: "model",
      provider: "kimi",
      endpoint: "https://api.moonshot.cn/v1/chat/completions",
      model_id: "kimi-k2.5",
    })
  })

  test("normalizes a pasted Bearer prefix before probing and persisting a provider key", async () => {
    const root = await mkdtemp(join(tmpdir(), "provider-config-"))
    roots.push(root)
    let receivedKey = ""
    const handle = createLearningOrchestratorApiHandler({
      data_root: root,
      provider_environment: {},
      provider_probe: async (config) => {
        receivedKey = config.api_key
        return { ok: true, model_id: config.model_id }
      },
    })

    const response = await handle(new Request("http://127.0.0.1/orchestrator/provider-config", {
      method: "PUT",
      headers: { "content-type": "application/json", origin: "http://127.0.0.1:4177" },
      body: JSON.stringify({
        provider: "glm",
        endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
        model_id: "glm-5.2",
        api_key: "  Bearer test-glm-key  ",
      }),
    }))

    expect(response.status).toBe(200)
    expect(receivedKey).toBe("test-glm-key")
  })

  test("accepts a GLM 5.2 configuration when the probe budget has matching soft and hard deadlines", async () => {
    const root = await mkdtemp(join(tmpdir(), "provider-config-"))
    roots.push(root)
    let probedModel = ""
    const handle = createLearningOrchestratorApiHandler({
      data_root: root,
      provider_environment: {},
      provider_probe: async (config) => {
        probedModel = config.model_id
        return { ok: true, model_id: config.model_id }
      },
    })

    const response = await handle(new Request("http://127.0.0.1/orchestrator/provider-config", {
      method: "PUT",
      headers: { "content-type": "application/json", origin: "http://127.0.0.1:4177" },
      body: JSON.stringify({
        provider: "glm",
        endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
        model_id: "glm-5.2",
        api_key: "test-glm-key",
      }),
    }))

    expect(response.status).toBe(200)
    expect(probedModel).toBe("glm-5.2")
    expect(await response.json()).toMatchObject({ configured: true, provider: "glm", model_id: "glm-5.2" })
  })

  test("switching provider updates both legacy and runtime model environment values", async () => {
    const root = await mkdtemp(join(tmpdir(), "provider-config-"))
    roots.push(root)
    const environment: Record<string, string | undefined> = {
      ROLE_C_MODEL_ENDPOINT: "https://api.deepseek.com/v1/chat/completions",
      ROLE_C_MODEL_ID: "deepseek-chat",
      ROLE_C_MODEL_API_KEY: "old-secret",
      MODEL_RUNTIME_ENDPOINT: "https://api.deepseek.com/v1/chat/completions",
      MODEL_RUNTIME_MODEL_ID: "deepseek-chat",
      MODEL_RUNTIME_API_KEY: "old-secret",
    }
    const handle = createLearningOrchestratorApiHandler({
      data_root: root,
      provider_environment: environment,
      provider_probe: async (config) => ({ ok: true, model_id: config.model_id }),
    })

    const response = await handle(new Request("http://127.0.0.1/orchestrator/provider-config", {
      method: "PUT",
      headers: { "content-type": "application/json", origin: "http://127.0.0.1:4177" },
      body: JSON.stringify({
        provider: "glm",
        endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
        model_id: "glm-5.2",
        api_key: "new-glm-secret",
      }),
    }))

    expect(response.status).toBe(200)
    expect(environment).toMatchObject({
      ROLE_C_MODEL_ENDPOINT: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
      ROLE_C_MODEL_ID: "glm-5.2",
      ROLE_C_MODEL_API_KEY: "new-glm-secret",
      MODEL_RUNTIME_ENDPOINT: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
      MODEL_RUNTIME_MODEL_ID: "glm-5.2",
      MODEL_RUNTIME_API_KEY: "new-glm-secret",
    })
  })

  test("loads a persisted provider configuration into the runtime environment on restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "provider-config-"))
    roots.push(root)
    await writeFile(join(root, "provider-config.json"), JSON.stringify({
      provider_mode: "model",
      endpoint: "https://api.deepseek.com/chat/completions",
      model_id: "deepseek-chat",
      api_key: "persisted-secret",
    }))
    const environment: Record<string, string | undefined> = {}
    createLearningOrchestratorApiHandler({ data_root: root, provider_environment: environment })

    expect(environment).toMatchObject({
      ROLE_C_PROVIDER_MODE: "model",
      ROLE_C_MODEL_ENDPOINT: "https://api.deepseek.com/chat/completions",
      ROLE_C_MODEL_ID: "deepseek-chat",
      ROLE_C_MODEL_API_KEY: "persisted-secret",
    })
  })

  test("reads provider configuration even when Windows tooling writes a UTF-8 BOM", async () => {
    const root = await mkdtemp(join(tmpdir(), "provider-config-"))
    roots.push(root)
    await writeFile(join(root, "provider-config.json"), `\ufeff${JSON.stringify({
      provider_mode: "model",
      endpoint: "https://api.deepseek.com/chat/completions",
      model_id: "deepseek-chat",
      api_key: "bom-secret",
    })}`)
    const environment: Record<string, string | undefined> = {}
    const handle = createLearningOrchestratorApiHandler({ data_root: root, provider_environment: environment })
    const response = await handle(new Request("http://127.0.0.1/orchestrator/provider-config"))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      configured: true,
      provider_mode: "model",
      provider: "",
      endpoint: "https://api.deepseek.com/chat/completions",
      model_id: "deepseek-chat",
    })
    expect(environment.ROLE_C_MODEL_API_KEY).toBe("bom-secret")
  })

  test("rejects provider changes sent to a non-loopback host", async () => {
    const root = await mkdtemp(join(tmpdir(), "provider-config-"))
    roots.push(root)
    const handle = createLearningOrchestratorApiHandler({ data_root: root, provider_environment: {} })
    const response = await handle(new Request("http://example.com/orchestrator/provider-config", {
      method: "PUT",
      headers: { "content-type": "application/json", origin: "http://example.com" },
      body: JSON.stringify({ endpoint: "https://api.example.com/v1/chat/completions", model_id: "model", api_key: "secret" }),
    }))
    expect(response.status).toBe(403)
  })

  test("rejects cross-origin provider configuration writes even on loopback", async () => {
    const root = await mkdtemp(join(tmpdir(), "provider-config-"))
    roots.push(root)
    const handle = createLearningOrchestratorApiHandler({ data_root: root, provider_environment: {} })
    const response = await handle(new Request("http://127.0.0.1/orchestrator/provider-config", {
      method: "PUT",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ endpoint: "https://api.example.com/v1/chat/completions", model_id: "model", api_key: "secret" }),
    }))
    expect(response.status).toBe(403)
  })

  test("disables provider configuration writes when the server is bound to a non-loopback host", async () => {
    const root = await mkdtemp(join(tmpdir(), "provider-config-"))
    roots.push(root)
    const handle = createLearningOrchestratorApiHandler({
      data_root: root,
      provider_environment: {},
      server_hostname: "203.0.113.1", // TEST-NET-3: non-loopback, non-private
    })
    const response = await handle(new Request("http://127.0.0.1/orchestrator/provider-config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint: "https://api.example.com/v1/chat/completions", model_id: "model", api_key: "secret" }),
    }))
    expect(response.status).toBe(403)
  })
})
