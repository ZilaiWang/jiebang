import type { ConceptTutorRequest } from "../agents/types"
import type { EvidenceExample, EvidenceFact } from "../contracts/evidence-pack"
import { projectNextRoundContext } from "./next-round-context"

export interface ConceptTutorModelInput {
  contract: {
    spec_id: string
    run_id: string
    path_node: ConceptTutorRequest["generation_spec"]["path_node"]
    targets: ConceptTutorRequest["generation_spec"]["targets"]
    learner_adaptation: ConceptTutorRequest["generation_spec"]["learner_adaptation"]
    difficulty: ConceptTutorRequest["generation_spec"]["difficulty"]
    policies: ConceptTutorRequest["generation_spec"]["policies"]
  }
  evidence: Array<{
    source_id: string
    title: string
    difficulty: string
    facts: EvidenceFact[]
    examples: EvidenceExample[]
  }>
  upstream: {
    next_round_context?: ConceptTutorRequest["next_round_context"] & {
      teaching_strategy?: "reduce_load" | "same_difficulty_new_variant" | "hold_current_path"
    }
    revision_objections?: ConceptTutorRequest["revision_objections"]
    external_revision_round?: ConceptTutorRequest["external_revision_round"]
  }
}

/**
 * Builds the only model-visible input for concept-tutor. Answer-bearing quiz seeds,
 * unrelated top-k results, retrieval instructions, and learner identifiers are excluded.
 */
export function buildConceptTutorModelInput(
  request: ConceptTutorRequest,
): ConceptTutorModelInput {
  const targetObjectiveIds = request.generation_spec.targets.map((target) => target.objective_id)
  const nextRoundContext = projectNextRoundContext(
    request.next_round_context,
    targetObjectiveIds,
  )
  const requiredFactsBySource = new Map<string, Set<string>>()
  for (const target of request.generation_spec.targets) {
    const facts = requiredFactsBySource.get(target.source_id) ?? new Set<string>()
    target.required_fact_ids.forEach((factId) => facts.add(factId))
    requiredFactsBySource.set(target.source_id, facts)
  }

  const relevantSources = new Set([
    ...request.generation_spec.path_node.target_source_ids,
    ...request.generation_spec.path_node.prerequisite_source_ids,
  ])
  const evidence = request.evidence_pack.results
    .filter((item) => relevantSources.has(item.source_id))
    .map((item) => {
      const requiredFacts = requiredFactsBySource.get(item.source_id)
      return {
        source_id: item.source_id,
        title: item.title,
        difficulty: item.difficulty,
        facts: item.facts
          .filter((fact) => !requiredFacts || requiredFacts.has(fact.fact_id))
          .map((fact) => ({ ...fact })),
        examples: item.examples.slice(0, 2).map((example) => ({ ...example })),
      }
    })

  return {
    contract: {
      spec_id: request.generation_spec.spec_id,
      run_id: request.generation_spec.run_id,
      path_node: structuredClone(request.generation_spec.path_node),
      targets: structuredClone(request.generation_spec.targets),
      learner_adaptation: structuredClone(request.generation_spec.learner_adaptation),
      difficulty: structuredClone(request.generation_spec.difficulty),
      policies: structuredClone(request.generation_spec.policies),
    },
    evidence,
    upstream: {
      ...(nextRoundContext ? { next_round_context: nextRoundContext } : {}),
      ...(request.revision_objections ? { revision_objections: structuredClone(request.revision_objections) } : {}),
      ...(request.external_revision_round !== undefined
        ? { external_revision_round: request.external_revision_round }
        : {}),
    },
  }
}
