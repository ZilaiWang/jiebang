import type { AssessmentItemPublic } from "../contracts/artifacts"
import { contentHash, stableId, type CitationRef } from "../contracts/common"
import type { RagEvidencePack } from "../contracts/evidence-pack"
import type { GenerationSpec } from "../contracts/generation-spec"
import {
  buildAssessmentItemPlan,
  buildCodeLabObjectivePlan,
  buildCodeLabSecurePlan,
  buildLabIdentity,
  type AssessmentItemPlan,
  type CodeLabObjectivePlan,
  type CodeLabSecurePlan,
} from "../providers/staged-generation"

export interface ResourceBlueprintObjective {
  objective_id: string
  source_id: string
  observable_behavior: GenerationSpec["targets"][number]["observable_behavior"]
  importance: GenerationSpec["targets"][number]["importance"]
  required_fact_ids: string[]
  citations: CitationRef[]
  concept: {
    /** Stable objective order. Provider-specific batching is intentionally separate. */
    sequence_index: number
    required_parts: Array<"explanation" | "worked_example" | "misconception" | "micro_check" | "hints" | "summary">
    prerequisite_source_ids: string[]
  }
  code_lab: {
    instruction_block_id: string
    public_test_id: string
    hidden_test_ids: string[]
    practice_behavior: "guided_implementation"
  }
  assessment: Array<{
    item_id: string
    tier: 1 | 2 | 3
    modality: AssessmentItemPublic["modality"]
    max_score: number
    cognitive_operation: string
  }>
}

/**
 * One deterministic teaching decision shared by all three Role C agents.
 * The model authors explanations and tasks; this blueprint owns identities,
 * evidence bindings, coverage, assessment modality and score allocation.
 */
export interface ResourceBlueprint {
  schema_version: "1.0"
  blueprint_id: string
  spec_id: string
  evidence_ref: string
  evidence_content_hash: string
  objectives: ResourceBlueprintObjective[]
  code_lab: {
    lab_id: string
    test_suite_id: string
    objective_plan: CodeLabObjectivePlan[]
    secure_plan: CodeLabSecurePlan
  }
  assessment: {
    item_plan: AssessmentItemPlan[]
    total_items: number
    total_score: number
  }
}

export function buildResourceBlueprint(
  spec: GenerationSpec,
  evidence: RagEvidencePack,
): ResourceBlueprint {
  const evidenceHash = contentHash(evidence)
  if (evidence.retrieval_id !== spec.evidence_ref
    || evidenceHash !== spec.evidence_content_hash) {
    throw new Error("RESOURCE_BLUEPRINT_EVIDENCE_IDENTITY_MISMATCH")
  }
  const identity = buildLabIdentity(spec)
  const codeObjectivePlan = buildCodeLabObjectivePlan(spec)
  const codeSecurePlan = buildCodeLabSecurePlan(spec, identity.test_suite_id)
  const assessmentPlan = buildAssessmentItemPlan(spec)
  const objectives = spec.targets.map((target, index) => {
    const code = codeObjectivePlan.find((entry) =>
      entry.objective_id === target.objective_id)!
    return {
      objective_id: target.objective_id,
      source_id: target.source_id,
      observable_behavior: target.observable_behavior,
      importance: target.importance,
      required_fact_ids: [...target.required_fact_ids],
      citations: target.required_fact_ids.map((factId) => ({
        source_id: target.source_id,
        fact_id: factId,
        relation: "derived_from" as const,
      })),
      concept: {
        sequence_index: index,
        required_parts: [
          "explanation" as const,
          "worked_example" as const,
          "misconception" as const,
          "micro_check" as const,
          "hints" as const,
          "summary" as const,
        ],
        prerequisite_source_ids: index === 0
          ? [...spec.path_node.prerequisite_source_ids]
          : [],
      },
      code_lab: {
        instruction_block_id: code.instruction_block_id,
        public_test_id: code.public_test_id,
        hidden_test_ids: codeSecurePlan.hidden_tests
          .filter((test) => test.objective_id === target.objective_id)
          .map((test) => test.test_id),
        practice_behavior: "guided_implementation" as const,
      },
      assessment: assessmentPlan
        .filter((item) => item.objective_id === target.objective_id)
        .map((item) => ({
          item_id: item.item_id,
          tier: item.tier,
          modality: item.modality,
          max_score: item.max_score,
          cognitive_operation: item.cognitive_operation,
        })),
    }
  })
  const blueprintIdentity = {
    spec_id: spec.spec_id,
    evidence_ref: evidence.retrieval_id,
    evidence_content_hash: evidenceHash,
    objectives,
    code_lab: {
      lab_id: identity.lab_id,
      test_suite_id: identity.test_suite_id,
      objective_plan: codeObjectivePlan,
      secure_plan: codeSecurePlan,
    },
    assessment: assessmentPlan,
  }
  return deepFreeze({
    schema_version: "1.0",
    blueprint_id: stableId("RESOURCE-BLUEPRINT", blueprintIdentity),
    spec_id: spec.spec_id,
    evidence_ref: evidence.retrieval_id,
    evidence_content_hash: evidenceHash,
    objectives,
    code_lab: {
      lab_id: identity.lab_id,
      test_suite_id: identity.test_suite_id,
      objective_plan: codeObjectivePlan,
      secure_plan: codeSecurePlan,
    },
    assessment: {
      item_plan: assessmentPlan,
      total_items: assessmentPlan.length,
      total_score: assessmentPlan.reduce((sum, item) => sum + item.max_score, 0),
    },
  })
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value
  Object.values(value as Record<string, unknown>).forEach(deepFreeze)
  return Object.freeze(value)
}
