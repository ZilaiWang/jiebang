import { createCodeLabAgent } from "./agents/code-lab"
import { createConceptTutorAgent } from "./agents/concept-tutor"
import { createTieredEvaluatorAgent } from "./agents/tiered-evaluator"
import type { GeneratedContentVerifiers, RoleCAgents, RoleCContentProvider } from "./agents/types"

export * from "./agents"
export * from "./contracts"
export * from "./context"
export * from "./grading"
export * from "./mastery"
export * from "./orchestrator"
export * from "./prompts/index"
export * from "./providers"
export * from "./reliability"
export * from "./review"
export * from "./security"
export * from "./validators"

export function createRoleCAgents(
  provider: RoleCContentProvider,
  verifiers: GeneratedContentVerifiers = {},
): RoleCAgents {
  return {
    concept_tutor: createConceptTutorAgent(provider),
    code_lab: createCodeLabAgent(provider, verifiers.code_lab),
    tiered_evaluator: createTieredEvaluatorAgent(provider, verifiers.assessment),
  }
}
