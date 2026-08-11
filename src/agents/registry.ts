import { createOrchestratorAgent } from "./orchestrator"
import type { WorkflowAgentRegistry } from "./types"
import { createWorkerAgents } from "./workers"

export function createWorkflowAgents(): WorkflowAgentRegistry {
  return {
    "learning-orchestrator": createOrchestratorAgent(),
    ...createWorkerAgents(),
  }
}
