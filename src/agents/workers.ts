import type { AgentConfig } from "@opencode-ai/sdk/v2"
import { buildWorkerStubPrompt } from "../prompts/worker-stub"
import type { WorkerDefinition, WorkflowAgentName } from "./types"

export const WORKER_DEFINITIONS = [
  {
    name: "background-collector",
    stage: "background_collection",
    description: "Extracts quote-grounded learner background, prior exposure, and goal evidence.",
    responsibility: "Extract quote-grounded background evidence for the learner profile.",
    next: "await_evidence",
  },
  {
    name: "self-assessor",
    stage: "self_assessment",
    description: "Extracts the learner's self-rated level and self-claimed strong/weak concepts.",
    responsibility: "Extract quote-grounded self-assessment evidence.",
    next: "await_evidence",
  },
  {
    name: "objective-diagnostician",
    stage: "objective_diagnosis",
    description: "Grades actual learner answers against knowledge-base quiz items with source_id traceability.",
    responsibility: "Produce objective diagnostic evidence tied to knowledge-base source_id.",
    next: "build_profile",
  },
  {
    name: "profile-builder",
    stage: "profile_building",
    description: "Merges background, self-assessment, and objective evidence into the standard learner profile.",
    responsibility: "Synthesize the standard learner profile plus a ready-to-send rag_request.",
    next: "plan_path",
  },
  {
    name: "path-planner",
    stage: "path_planning",
    description: "Plans a personalized learning path from the learner profile.",
    responsibility: "Acknowledge execution of learning-path planning.",
    next: "teach_concept",
  },
  {
    name: "concept-tutor",
    stage: "concept_instruction",
    description: "Produces evidence-constrained personalized instruction from a frozen GenerationSpec.",
    responsibility: "Generate the public concept lesson while preserving facts, objectives, prerequisites, and citations.",
    next: "run_code_lab",
  },
  {
    name: "code-lab",
    stage: "code_lab",
    description: "Designs a public code lab and a separately stored private verification artifact.",
    responsibility: "Generate an evidence-aligned lab without exposing reference solutions or hidden tests.",
    next: "run_assessment",
  },
  {
    name: "tiered-evaluator",
    stage: "tiered_assessment",
    description: "Authors tiered assessment items under a public/private answer-key boundary.",
    responsibility: "Generate objective-aligned public assessment items without exposing private grading material.",
    next: "continue",
  },
] as const satisfies readonly WorkerDefinition[]

export function createWorkerAgents(): Record<
  Exclude<WorkflowAgentName, "learning-orchestrator">,
  AgentConfig
> {
  return WORKER_DEFINITIONS.reduce(
    (agents, definition) => {
      agents[definition.name] = {
        description: definition.description,
        mode: "subagent",
        temperature: 0.1,
        tools: { "*": false },
        permission: { "*": "deny" },
        prompt: buildWorkerStubPrompt(definition),
      }
      return agents
    },
    {} as Record<Exclude<WorkflowAgentName, "learning-orchestrator">, AgentConfig>,
  )
}
