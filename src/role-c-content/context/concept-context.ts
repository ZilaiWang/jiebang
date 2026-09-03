import { artifactDifficulty, type ArtifactTaskContractV2 } from "../contracts/artifact-task"
import type { ConceptTutorRequest } from "../agents/types"
import type { EvidenceFact } from "../contracts/evidence-pack"
import { projectNextRoundContext } from "./next-round-context"

export interface ConceptTutorModelInput {
  contract: {
    artifact_task?: ArtifactTaskContractV2
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
    examples: Array<{
      title: string
      code: string
      explanation: string
      fact_refs: Array<{ source_id: string; fact_id: string }>
    }>
  }>
  upstream: {
    personalization_policy?: ConceptTutorRequest["generation_spec"]["personalization_policy"]
    resource_blueprint?: {
      blueprint_id: string
      spec_id: string
      cross_artifact_contract: NonNullable<ConceptTutorRequest["resource_blueprint"]>["cross_artifact_contract"]
      quality_requirement: NonNullable<ConceptTutorRequest["resource_blueprint"]>["quality_requirement"]
      objectives: Array<Pick<
        NonNullable<ConceptTutorRequest["resource_blueprint"]>["objectives"][number],
        "objective_id" | "source_id" | "observable_behavior" | "importance" | "required_fact_ids" | "concept"
      >>
    }
    round_semantic_plan?: ConceptTutorRequest["round_semantic_plan"]
    next_round_context?: ConceptTutorRequest["next_round_context"] & {
      teaching_strategy?: "reduce_load" | "same_difficulty_new_variant" | "hold_current_path"
    }
    revision_objections?: ConceptTutorRequest["revision_objections"]
    external_revision_round?: ConceptTutorRequest["external_revision_round"]
    generation_recovery?: ConceptTutorRequest["generation_recovery"]
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
      const boundFacts = item.facts
        .filter((fact) => !requiredFacts || requiredFacts.has(fact.fact_id))
      return {
        source_id: item.source_id,
        title: item.title,
        difficulty: item.difficulty,
        facts: boundFacts.map((fact) => ({ ...fact })),
        // Preserve A's full source-local reference closure. Similar wording
        // cannot create provenance for a missing fact or an unbound task.
        examples: (item.examples ?? [])
          .filter((example) => example.fact_refs?.length > 0 && example.fact_refs.every((ref) =>
            ref.source_id === item.source_id && boundFacts.some((fact) => fact.fact_id === ref.fact_id)))
          .map((example) => ({
            title: example.title,
            code: example.code,
            explanation: example.explanation,
            fact_refs: example.fact_refs.map((ref) => ({ ...ref })),
          })),
      }
    })

  return {
    contract: {
      spec_id: request.generation_spec.spec_id,
      run_id: request.generation_spec.run_id,
      path_node: structuredClone(request.generation_spec.path_node),
      targets: structuredClone(request.generation_spec.targets),
      learner_adaptation: structuredClone(request.generation_spec.learner_adaptation),
      difficulty: artifactDifficulty(request.generation_spec, "concept_lesson"),
      ...(request.generation_spec.artifact_tasks ? { artifact_task: structuredClone(request.generation_spec.artifact_tasks.concept_lesson) } : {}),
      policies: structuredClone(request.generation_spec.policies),
    },
    evidence,
    upstream: {
      ...(request.generation_spec.personalization_policy
        ? { personalization_policy: structuredClone(request.generation_spec.personalization_policy) }
        : {}),
      ...(request.resource_blueprint
        ? {
            resource_blueprint: {
              blueprint_id: request.resource_blueprint.blueprint_id,
              // Concept requests may be provider-created segments. The projected
              // contract follows that segment identity while blueprint_id keeps
              // every segment tied to the same root teaching decision.
              spec_id: request.generation_spec.spec_id,
              cross_artifact_contract: structuredClone(request.resource_blueprint.cross_artifact_contract),
              quality_requirement: structuredClone(request.resource_blueprint.quality_requirement),
              objectives: request.resource_blueprint.objectives
                .filter((objective) => targetObjectiveIds.includes(objective.objective_id))
                .map((objective) => ({
                  objective_id: objective.objective_id,
                  source_id: objective.source_id,
                  observable_behavior: objective.observable_behavior,
                  importance: objective.importance,
                  required_fact_ids: [...objective.required_fact_ids],
                  concept: structuredClone(objective.concept),
                })),
            },
          }
        : {}),
      ...(request.round_semantic_plan
        ? { round_semantic_plan: structuredClone(request.round_semantic_plan) }
        : {}),
      ...(nextRoundContext ? { next_round_context: nextRoundContext } : {}),
      ...(request.revision_objections ? { revision_objections: structuredClone(request.revision_objections) } : {}),
      ...(request.external_revision_round !== undefined
        ? { external_revision_round: request.external_revision_round }
        : {}),
      ...(request.generation_recovery
        ? { generation_recovery: structuredClone(request.generation_recovery) }
        : {}),
    },
  }
}
