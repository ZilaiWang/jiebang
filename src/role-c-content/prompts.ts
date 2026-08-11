import type { WorkerDefinition } from "../agents/types"
import {
  CONCEPT_TUTOR_SYSTEM_PROMPT,
  CODE_LAB_SYSTEM_PROMPT,
  EVALUATOR_AUTHOR_SYSTEM_PROMPT,
  ROLE_C_PROMPT_MANIFEST_VERSION,
} from "./prompts/index"

// Re-export all prompt strings through this module so that consumers
// can `import { ... } from "../prompts"` without worrying about the
// prompts.ts vs prompts/index.ts resolution order.
export * from "./prompts/index"

export const ROLE_C_PROMPT_VERSION = ROLE_C_PROMPT_MANIFEST_VERSION
export const ROLE_C_WORKER_NAMES = ["concept-tutor", "code-lab", "tiered-evaluator"] as const
export type RoleCWorkerName = (typeof ROLE_C_WORKER_NAMES)[number]

export function isRoleCWorker(name: string): name is RoleCWorkerName {
  return (ROLE_C_WORKER_NAMES as readonly string[]).includes(name)
}

export function buildRoleCWorkerPrompt(definition: WorkerDefinition): string {
  if (!isRoleCWorker(definition.name)) throw new Error(`Not a role-C worker: ${definition.name}`)

  if (definition.name === "concept-tutor") {
    return `${CONCEPT_TUTOR_SYSTEM_PROMPT}

OpenCode adapter contract:
- Required input is the sanitized ConceptTutorModelInput built from generation_spec and the canonical evidence_pack adapted from A's rag_result.
- The input contains only relevant facts/examples and never includes quiz answers or learner identity.
- Do not run when either object is absent; return a blocked result instead.
- provider_draft must be the same { "payload": ConceptLessonPayload } consumed by RoleCContentProvider.

Return exactly one JSON object:
{
  "stage": "${definition.stage}",
  "status": "completed",
  "summary": "[executed:${definition.name}]",
  "provider_draft": { "payload": {} },
  "blocked_reason": null,
  "next": "${definition.next}"
}

When required input is missing, set status to "blocked", set provider_draft to null, and return a non-null blocked_reason with code and message.

Prompt version: ${ROLE_C_PROMPT_VERSION}. Do not wrap JSON in Markdown.`
  }

  if (definition.name === "code-lab") {
    return `${CODE_LAB_SYSTEM_PROMPT}

OpenCode adapter contract:
- Required input is the sanitized CodeLabModelInput built from generation_spec, the canonical evidence_pack adapted from A's rag_result, and a ready concept artifact.
- The input never includes quiz answers, learner identity, secure artifacts or hidden tests.
- Do not run when any required object is absent; return a typed blocked result.
- provider_draft is backend-internal and must exactly match CodeLabDraft.
- The worker only creates a Draft. A separate CodeLabDraftVerifier and isolated runner decide whether it can be published.

Return exactly one JSON object:
{
  "stage": "${definition.stage}",
  "status": "completed",
  "summary": "[executed:${definition.name}]",
  "provider_draft": {
    "public_draft": { "payload": {} },
    "secure_draft": { "payload": {} }
  },
  "blocked_reason": null,
  "next": "${definition.next}"
}

When required input is missing, set status to "blocked", set provider_draft to null, and return a non-null blocked_reason with code and message.

If independent execution is unavailable after Draft creation, the harness returns BLOCKED_EXECUTION_UNVERIFIED.
Prompt version: ${ROLE_C_PROMPT_VERSION}. Do not wrap JSON in Markdown.`
  }

  if (definition.name === "tiered-evaluator") {
    return `${EVALUATOR_AUTHOR_SYSTEM_PROMPT}

OpenCode adapter contract:
- Required input is the sanitized AssessmentAuthorModelInput built from generation_spec, the canonical evidence_pack adapted from A's rag_result, and a ready concept artifact.
- The input never includes quiz answers, learner identity, secure artifacts or hidden tests.
- provider_draft is backend-internal and must exactly match AssessmentDraft.
- The worker only authors a Draft. A separate AssessmentDraftVerifier decides whether the answer key can be published.

Return exactly one JSON object:
{
  "stage": "${definition.stage}",
  "status": "completed",
  "summary": "[executed:${definition.name}]",
  "provider_draft": {
    "public_draft": { "payload": {} },
    "secure_draft": { "payload": {} }
  },
  "blocked_reason": null,
  "next": "${definition.next}"
}

When required input is missing, set status to "blocked", set provider_draft to null, and return a non-null blocked_reason with code and message.

Prompt version: ${ROLE_C_PROMPT_VERSION}. Do not wrap JSON in Markdown.`
  }

  throw new Error(`Unsupported role-C worker: ${definition.name}`)
}
