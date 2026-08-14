import type { TieredEvaluatorRequest } from "../agents/types"
import type { CitationRef } from "../contracts/common"
import type { EvidenceFact } from "../contracts/evidence-pack"
import { projectNextRoundContext } from "./next-round-context"

export interface AssessmentAuthorModelInput {
  contract: {
    spec_id: string
    run_id: string
    path_node: TieredEvaluatorRequest["generation_spec"]["path_node"]
    targets: TieredEvaluatorRequest["generation_spec"]["targets"]
    learner_adaptation: TieredEvaluatorRequest["generation_spec"]["learner_adaptation"]
    difficulty: TieredEvaluatorRequest["generation_spec"]["difficulty"]
    assessment_blueprint: TieredEvaluatorRequest["generation_spec"]["assessment_blueprint"]
    policies: TieredEvaluatorRequest["generation_spec"]["policies"]
  }
  evidence: Array<{
    source_id: string
    title: string
    facts: EvidenceFact[]
  }>
  upstream: {
    concept_artifact_id: string
    objective_summaries: Array<{
      objective_id: string
      texts: string[]
      citations: CitationRef[]
    }>
    misconceptions: NonNullable<TieredEvaluatorRequest["concept_artifact"]["payload"]>["misconceptions"]
    code_lab_summary?: TieredEvaluatorRequest["code_lab_summary"]
    next_round_context?: TieredEvaluatorRequest["next_round_context"]
    prior_assessment_items?: TieredEvaluatorRequest["prior_assessment_items"]
    novelty_brief?: {
      history_count: number
      variant_id: string
      required_design_moves: string[]
    }
  }
  revision_objections?: TieredEvaluatorRequest["revision_objections"]
  external_revision_round?: TieredEvaluatorRequest["external_revision_round"]
  resource_blueprint?: {
    blueprint_id: string
    spec_id: string
    assessment: NonNullable<TieredEvaluatorRequest["resource_blueprint"]>["assessment"]
    objectives: Array<Pick<
      NonNullable<TieredEvaluatorRequest["resource_blueprint"]>["objectives"][number],
      "objective_id" | "source_id" | "observable_behavior" | "required_fact_ids" | "assessment"
    >>
  }
  generation_recovery?: TieredEvaluatorRequest["generation_recovery"]
}

/** Keeps authoring context high-signal and excludes learner identity and quiz answers. */
export function buildAssessmentAuthorModelInput(
  request: TieredEvaluatorRequest,
): AssessmentAuthorModelInput {
  const nextRoundContext = projectNextRoundContext(
    request.next_round_context,
    request.generation_spec.targets.map((target) => target.objective_id),
  )
  const sourceIds = new Set(request.generation_spec.path_node.target_source_ids)
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
      assessment_blueprint: structuredClone(request.generation_spec.assessment_blueprint),
      policies: structuredClone(request.generation_spec.policies),
    },
    evidence: request.evidence_pack.results
      .filter((item) => sourceIds.has(item.source_id))
      .map((item) => ({
        source_id: item.source_id,
        title: item.title,
        facts: item.facts.map((fact) => ({ ...fact })),
      })),
    upstream: {
      concept_artifact_id: request.concept_artifact.artifact_id,
      objective_summaries: objectiveSummaries,
      misconceptions: structuredClone(payload?.misconceptions ?? []),
      code_lab_summary: request.code_lab_summary
        ? structuredClone(request.code_lab_summary)
        : undefined,
      next_round_context: nextRoundContext,
      prior_assessment_items: request.prior_assessment_items
        ? structuredClone(request.prior_assessment_items.slice(-200))
        : undefined,
      novelty_brief: request.prior_assessment_items?.length
        ? {
            history_count: request.prior_assessment_items.length,
            variant_id: `${request.generation_spec.spec_id}-NOVEL-${request.prior_assessment_items.length}`,
            required_design_moves: [
              "选择或判断题使用新的判断角度与具体情境",
              "追踪题改变控制流或数据流结构，不只替换数值",
              "简答题改用错误诊断、比较或迁移任务",
              "代码题改变函数任务、参数组织和输出行为",
            ],
          }
        : undefined,
    },
    revision_objections: request.revision_objections
      ? structuredClone(request.revision_objections)
      : undefined,
    external_revision_round: request.external_revision_round,
    resource_blueprint: request.resource_blueprint
      ? {
          blueprint_id: request.resource_blueprint.blueprint_id,
          spec_id: request.resource_blueprint.spec_id,
          assessment: structuredClone(request.resource_blueprint.assessment),
          objectives: request.resource_blueprint.objectives.map((objective) => ({
            objective_id: objective.objective_id,
            source_id: objective.source_id,
            observable_behavior: objective.observable_behavior,
            required_fact_ids: [...objective.required_fact_ids],
            assessment: structuredClone(objective.assessment),
          })),
        }
      : undefined,
    generation_recovery: request.generation_recovery
      ? structuredClone(request.generation_recovery)
      : undefined,
  }
}

function deduplicate(citations: CitationRef[]): CitationRef[] {
  return [...new Map(citations.map((entry) => [
    `${entry.source_id}:${entry.fact_id}:${entry.relation}`,
    { ...entry },
  ])).values()]
}
