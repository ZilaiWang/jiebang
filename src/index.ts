import type { Config, PluginModule } from "@opencode-ai/plugin"
import { createWorkflowAgents } from "./agents/registry"

export const PLUGIN_ID = "opencode-learning-workflow"

export const learningWorkflowPlugin: PluginModule["server"] = async () => ({
  config: async (config: Config) => {
    config.agent = {
      ...(config.agent ?? {}),
      ...createWorkflowAgents(),
    } as unknown as Config["agent"]
  },
})

const pluginModule: PluginModule = {
  id: PLUGIN_ID,
  server: learningWorkflowPlugin,
}

export default pluginModule

export { createWorkflowAgents } from "./agents/registry"
export type { WorkflowAgentName, WorkflowAgentRegistry } from "./agents/types"
export * from "./role-c-content"
