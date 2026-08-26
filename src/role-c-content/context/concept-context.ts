import type { ConceptTutorRequest } from "../agents/types"
import type { EvidenceFact } from "../contracts/evidence-pack"
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
    examples: Array<{
      title: string
      code: string
      explanation: string
      fact_refs: Array<{ source_id: string; fact_id: string }>
    }>
    practice_tasks: Array<{
      text: string
      fact_refs: Array<{ source_id: string; fact_id: string }>
    }>
  }>
  upstream: {
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
        // 改进方案6 第六/七节：examples / practice_tasks 此前被整段丢弃，
        // 讲义模型只能反复改写 facts。这里按引用绑定投影，只有能绑定到
        // required fact 的 example / practice 才进入可信生成；绑定不上的
        // 只作候选，不进公开讲义 prompt。quiz_seeds.answer 仍绝不投影。
        examples: (item.examples ?? [])
          .map((example) => ({
            title: example.title,
            code: example.code,
            explanation: example.explanation,
            fact_refs: inferFactRefs(
              `${example.title}\n${example.code}\n${example.explanation}`,
              boundFacts,
            ),
          }))
          .filter((example) => example.fact_refs.length > 0),
        practice_tasks: (item.practice_tasks ?? [])
          .map((text) => ({
            text,
            fact_refs: inferFactRefs(text, boundFacts),
          }))
          .filter((task) => task.fact_refs.length > 0),
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

/**
 * 提取事实的核心词，用于 example / practice task 的引用绑定：
 * 中文用 2 字滑动窗口切出实义片段（中文无空格分词，整段匹配过严），
 * 英文/数字取 >= 3 字符的 token。绑定只用于过滤完全无关的 example，
 * 最终事实正确性仍由下游 fact audit 把关。
 */
function factContentWords(content: string): string[] {
  const words: string[] = []
  words.push(...(content.match(/[a-z0-9_]{3,}/gi) ?? []))
  const cnRuns = content.match(/[\u4e00-\u9fa5]{2,}/g) ?? []
  for (const run of cnRuns) {
    for (let i = 0; i + 2 <= run.length; i += 1) {
      words.push(run.slice(i, i + 2))
    }
  }
  return words
}

/**
 * 推断一段 example / practice 文本绑定到哪些 required fact。
 * 只有文本命中某条 fact 的至少一个核心词时才绑定；绑定不上的内容
 * 不进入可信生成（改进方案6 第七节：无引用的旧例子先作候选）。
 */
function inferFactRefs(
  text: string,
  facts: EvidenceFact[],
): Array<{ source_id: string; fact_id: string }> {
  return facts
    .filter((fact) => {
      const words = factContentWords(fact.content)
      if (words.length === 0) return false
      return words.some((word) => text.includes(word))
    })
    .map((fact) => ({ source_id: fact.source_id, fact_id: fact.fact_id }))
}
