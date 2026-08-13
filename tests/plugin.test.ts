import { describe, expect, test } from "bun:test"
import type { Config } from "@opencode-ai/plugin"
import pluginModule, { PLUGIN_ID } from "../src/index"

describe("OpenCode plugin", () => {
  test("exports the V1 plugin module shape", () => {
    expect(pluginModule.id).toBe(PLUGIN_ID)
    expect(typeof pluginModule.server).toBe("function")
  })

  test("injects workflow agents without removing existing agents", async () => {
    const hooks = await pluginModule.server({} as never)
    const config = {
      agent: {
        existing: {
          description: "Existing user agent",
          mode: "subagent",
        },
      },
    } as Config

    await hooks.config?.(config)

    expect(config.agent?.existing).toBeDefined()
    expect(config.agent?.["learning-orchestrator"]?.mode).toBe("primary")
    expect(config.agent?.["tiered-evaluator"]?.mode).toBe("subagent")
  })
})
