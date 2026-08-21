import type { CodeLabRequest } from "../agents/types"
import type { CitationRef } from "../contracts/common"
import type { EvidenceFact } from "../contracts/evidence-pack"
import { projectNextRoundContext } from "./next-round-context"

export interface CodeLabModelInput {
  contract: {
    spec_id: string
    run_id: string
    path_node: CodeLabRequest["generation_spec"]["path_node"]
    targets: CodeLabRequest["generation_spec"]["targets"]
    learner_adaptation: CodeLabRequest["generation_spec"]["learner_adaptation"]
    difficulty: CodeLabRequest["generation_spec"]["difficulty"]
    policies: CodeLabRequest["generation_spec"]["policies"]
  }
  evidence: Array<{
    source_id: string
    title: string
    facts: EvidenceFact[]
  }>
  concept: {
    artifact_id: string
    objective_ids: string[]
    objective_summaries: Array<{
      objective_id: string
      texts: string[]
      citations: CitationRef[]
    }>
    misconceptions: NonNullable<CodeLabRequest["concept_artifact"]["payload"]>["misconceptions"]
  }
  upstream: {
    next_round_context?: CodeLabRequest["next_round_context"] & {
      teaching_strategy?: "reduce_load" | "same_difficulty_new_variant" | "hold_current_path"
    }
    revision_objections?: CodeLabRequest["revision_objections"]
    external_revision_round?: CodeLabRequest["external_revision_round"]
    resource_blueprint?: {
      blueprint_id: string
      spec_id: string
      cross_artifact_contract: NonNullable<CodeLabRequest["resource_blueprint"]>["cross_artifact_contract"]
      quality_requirement: NonNullable<CodeLabRequest["resource_blueprint"]>["quality_requirement"]
      code_lab: NonNullable<CodeLabRequest["resource_blueprint"]>["code_lab"]
      objectives: Array<Pick<
        NonNullable<CodeLabRequest["resource_blueprint"]>["objectives"][number],
        "objective_id" | "source_id" | "observable_behavior" | "required_fact_ids" | "code_lab"
      >>
    }
    round_semantic_plan?: CodeLabRequest["round_semantic_plan"]
    generation_recovery?: CodeLabRequest["generation_recovery"]
  }
}

/** Builds the model-visible lab context without learner identity or answer-bearing quiz seeds. */
export function buildCodeLabModelInput(request: CodeLabRequest): CodeLabModelInput {
  const nextRoundContext = projectNextRoundContext(
    request.next_round_context,
    request.generation_spec.targets.map((target) => target.objective_id),
  )
  const targetSources = new Set(request.generation_spec.path_node.target_source_ids)
  const requiredFactsBySource = new Map(
    request.generation_spec.targets.map((target) => [
      target.source_id,
      new Set(target.required_fact_ids),
    ] as const),
  )
  const evidence = request.evidence_pack.results
    .filter((item) => targetSources.has(item.source_id))
    .map((item) => ({
      source_id: item.source_id,
      title: item.title,
      facts: item.facts
        .filter((fact) => requiredFactsBySource.get(item.source_id)?.has(fact.fact_id))
        .map((fact) => ({ ...fact })),
    }))

  const payload = request.concept_artifact.payload
  const blocks = payload
    ? [...payload.explanation_blocks, ...payload.worked_examples, ...payload.summary]
    : []
  const blocksById = new Map(blocks.map((block) => [block.block_id, block]))
  const objectiveSummaries = request.generation_spec.targets.map((target) => {
    const coverage = payload?.objective_coverage.find((entry) => entry.objective_id === target.objective_id)
    const selected = (coverage?.block_ids ?? []).flatMap((blockId) => {
      const block = blocksById.get(blockId)
      if (!block) return []
      const texts = "text" in block
        ? [block.text]
        : "caption" in block && block.caption
          ? [block.caption]
          : []
      const citations = "claims" in block
        ? block.claims.flatMap((claim) => claim.citations)
        : "citations" in block
          ? block.citations
          : []
      return [{ texts, citations }]
    })
    return {
      objective_id: target.objective_id,
      texts: selected.flatMap((entry) => entry.texts).slice(0, 3),
      citations: deduplicate(selected.flatMap((entry) => entry.citations)),
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
    concept: {
      artifact_id: request.concept_artifact.artifact_id,
      objective_ids: [...(payload?.objective_ids ?? [])],
      objective_summaries: objectiveSummaries,
      misconceptions: structuredClone(payload?.misconceptions ?? []),
    },
    upstream: {
      next_round_context: nextRoundContext,
      revision_objections: request.revision_objections
        ? structuredClone(request.revision_objections)
        : undefined,
      external_revision_round: request.external_revision_round,
      resource_blueprint: request.resource_blueprint
        ? {
          blueprint_id: request.resource_blueprint.blueprint_id,
          spec_id: request.resource_blueprint.spec_id,
          cross_artifact_contract: structuredClone(request.resource_blueprint.cross_artifact_contract),
          quality_requirement: structuredClone(request.resource_blueprint.quality_requirement),
          code_lab: structuredClone(request.resource_blueprint.code_lab),
          objectives: request.resource_blueprint.objectives.map((objective) => ({
            objective_id: objective.objective_id,
            source_id: objective.source_id,
            observable_behavior: objective.observable_behavior,
            required_fact_ids: [...objective.required_fact_ids],
            code_lab: structuredClone(objective.code_lab),
          })),
          }
        : undefined,
      round_semantic_plan: request.round_semantic_plan
        ? structuredClone(request.round_semantic_plan)
        : undefined,
      generation_recovery: request.generation_recovery
        ? structuredClone(request.generation_recovery)
        : undefined,
    },
  }
}

function deduplicate(citations: CitationRef[]): CitationRef[] {
  return [...new Map(citations.map((entry) => [
    `${entry.source_id}:${entry.fact_id}:${entry.relation}`,
    { ...entry },
  ])).values()]
}
