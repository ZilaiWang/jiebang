import type { AgentConfig } from "@opencode-ai/sdk/v2"
import { ORCHESTRATOR_PROMPT } from "../prompts/orchestration"
import { WORKER_DEFINITIONS } from "./workers"

export function createOrchestratorAgent(): AgentConfig {
  const allowedWorkers = Object.fromEntries(
    WORKER_DEFINITIONS.map((worker) => [worker.name, "allow" as const]),
  )

  return {
    description:
      "Orchestrates learner profiling, path planning, concept instruction, code labs, and tiered assessment.",
    mode: "primary",
    color: "primary",
    tools: {
      "*": false,
      task: true,
      question: true,
    },
    permission: {
      "*": "deny",
      task: {
        "*": "deny",
        ...allowedWorkers,
      },
      question: "allow",
    },
    prompt: ORCHESTRATOR_PROMPT,
  }
}
