import type { AgentConfig } from "@opencode-ai/sdk/v2"

export type WorkflowAgentName =
  | "learning-orchestrator"
  | "background-collector"
  | "self-assessor"
  | "objective-diagnostician"
  | "profile-builder"
  | "path-planner"
  | "concept-tutor"
  | "code-lab"
  | "tiered-evaluator"

export type WorkflowAgentRegistry = Record<WorkflowAgentName, AgentConfig>

export interface WorkerDefinition {
  name: Exclude<WorkflowAgentName, "learning-orchestrator">
  stage: string
  description: string
  responsibility: string
  next: string
}
