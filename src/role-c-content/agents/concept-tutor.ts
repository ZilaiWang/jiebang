import { ModelOutputValidationError, ModelProviderUnavailableError } from "../contracts/model-gateway"
import { validateConceptLesson } from "../validators/concept-validator"
import { finalizeDraft, invalidOutputEnvelope, providerBlockedEnvelope } from "./harness"
import type { ConceptTutorAgent, ConceptTutorRequest, RoleCContentProvider } from "./types"

export function generateConceptLesson(request: ConceptTutorRequest, provider: RoleCContentProvider) {
  return createConceptTutorAgent(provider).generate(request)
}

export function createConceptTutorAgent(provider: RoleCContentProvider): ConceptTutorAgent {
  return {
    async generate(request) {
      try {
        const draft = await provider.generateConceptLesson(request)
        const validation = validateConceptLesson({
          payload: draft.payload,
          spec: request.generation_spec,
          evidence: request.evidence_pack,
        })
        if (!validation.ok) {
          const details = validation.issues.map(
            (issue) => `${issue.code} @ ${issue.path}: ${issue.message}`,
          )
          const issueLocations = validation.issues
            .slice(0, 3)
            .map((issue) => `${issue.code}@${issue.path}`)
            .join("；")
          return invalidOutputEnvelope({
            spec: request.generation_spec,
            evidence: request.evidence_pack,
            agent: "concept-tutor",
            artifact_type: "concept_lesson",
            input_refs: [request.generation_spec.spec_id, request.evidence_pack.retrieval_id],
            message: `concept-tutor Draft 未通过结构、引用或目标覆盖门禁：${issueLocations}`,
            details,
          })
        }
        return finalizeDraft({
          spec: request.generation_spec,
          evidence: request.evidence_pack,
          agent: "concept-tutor",
          artifact_type: "concept_lesson",
          draft,
          input_refs: [request.generation_spec.spec_id, request.evidence_pack.retrieval_id],
          public_payload: true,
          objective_ids: draft.payload.objective_ids,
          trusted_citations: validation.citations,
          trusted_objective_coverage: validation.objective_coverage,
        })
      } catch (error) {
        if (error instanceof ModelOutputValidationError) {
          return invalidOutputEnvelope({
            spec: request.generation_spec,
            evidence: request.evidence_pack,
            agent: "concept-tutor",
            artifact_type: "concept_lesson",
            input_refs: [request.generation_spec.spec_id, request.evidence_pack.retrieval_id],
            message: `${error.stage} 未在有限修复次数内通过校验`,
            details: error.issues,
          })
        }
        if (!(error instanceof ModelProviderUnavailableError)) throw error
        return providerBlockedEnvelope({
          spec: request.generation_spec,
          evidence: request.evidence_pack,
          agent: "concept-tutor",
          artifact_type: "concept_lesson",
          input_refs: [request.generation_spec.spec_id, request.evidence_pack.retrieval_id],
          message: error.message,
        })
      }
    },
  }
}
