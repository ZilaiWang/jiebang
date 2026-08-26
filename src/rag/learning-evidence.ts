import type { KnowledgeBase, KnowledgeDifficulty } from "../knowledge/types"
import { loadKnowledgeBase } from "../knowledge/loader"
import type { LearningPathNode } from "../role-c-content/contracts/profile-adapter"
import { contentHash } from "../role-c-content/contracts/common"
import {
  retrieveKnowledge,
  type ObjectiveEvidenceCoverage,
  type RagResult,
  type RetrievalMode,
} from "./retriever"
import {
  retrieveStructuredEvidenceFromKnowledgeBase,
  type StructuredEvidenceRetrievalPort,
} from "./structured-evidence"

export interface LearningEvidenceRequest {
  schema_version: "1.0"
  request_id: string
  run_id: string
  retrieval_mode: RetrievalMode
  learner_profile: {
    profile_version: string
    level: KnowledgeDifficulty
    known_concepts: string[]
    weak_concepts: string[]
    goal: string
  }
  path_context?: Pick<LearningPathNode,
    "node_id" | "target_source_ids" | "prerequisite_source_ids" | "goal" | "objectives">
  planning_context?: {
    current_node_id: string
    current_goal: string
    observable_behaviors: string[]
    excluded_source_ids: string[]
  }
  learning_context?: {
    action: "remediate" | "reinforce" | "advance" | "reprofile"
    focus_objective_ids: string[]
    misconception_tags: string[]
    reason_codes: string[]
  }
  resource_needs: Array<"fact" | "prerequisite" | "example" | "practice_task">
  parent_retrieval_id?: string
  top_k: number
}

export function buildLearningEvidenceRequest(input: Omit<LearningEvidenceRequest, "schema_version" | "request_id">): LearningEvidenceRequest {
  const identity = {
    contract: "learning-evidence-request-1.0",
    ...input,
  }
  return {
    schema_version: "1.0",
    request_id: `LER-${contentHash(identity).slice("sha256:".length, "sha256:".length + 24)}`,
    ...structuredClone(input),
  }
}

export async function retrieveLearningEvidence(
  request: LearningEvidenceRequest,
  providedKnowledgeBase?: KnowledgeBase,
  structuredEvidencePort?: StructuredEvidenceRetrievalPort,
): Promise<RagResult> {
  const knowledgeBase = providedKnowledgeBase ?? await loadKnowledgeBase()
  if (request.retrieval_mode === "semantic_discovery") {
    const query = compileDiscoveryQuery(request)
    const discovered = await retrieveKnowledge({
      query,
      learnerLevel: request.learner_profile.level,
      topK: request.top_k + (request.planning_context?.excluded_source_ids.length ?? 0),
      knowledgeBase,
      intent: {
        target_source_ids: request.path_context?.target_source_ids,
        prerequisite_source_ids: request.path_context?.prerequisite_source_ids,
        required_fact_ids: request.path_context?.objectives.flatMap((objective) =>
          objective.required_fact_ids.map((fact_id) => ({ source_id: objective.source_id, fact_id }))),
        misconception_terms: request.learning_context?.misconception_tags,
        resource_needs: request.resource_needs,
        focus_terms: [
          ...request.learner_profile.weak_concepts,
          ...(request.planning_context ? [request.planning_context.current_goal] : []),
        ],
      },
    })
    const excluded = new Set(request.planning_context?.excluded_source_ids ?? [])
    const result: RagResult = {
      ...discovered,
      topK: request.top_k,
      results: discovered.results
        .filter((item) => !excluded.has(item.source_id ?? item.sourceId))
        .slice(0, request.top_k),
    }
    const coverage = request.path_context
      ? objectiveCoverage(request.path_context, result, request.resource_needs)
      : []
    return decorateResult(request, result, coverage, discoveryStatus(result, coverage))
  }

  if (!request.path_context) {
    return decorateResult(request, {
      query: "缺少路径上下文，无法按标识取证",
      learnerLevel: request.learner_profile.level,
      topK: request.top_k,
      results: [],
    }, [], "no_match")
  }

  const factIdsBySource: Record<string, string[]> = {}
  for (const objective of request.path_context.objectives) {
    if (objective.required_fact_ids.length === 0) continue
    factIdsBySource[objective.source_id] = [...new Set([
      ...(factIdsBySource[objective.source_id] ?? []),
      ...objective.required_fact_ids,
    ])]
  }
  const sourceIds = [...new Set([
    ...request.path_context.target_source_ids,
    ...request.path_context.prerequisite_source_ids,
  ])]
  const structuredRequest = {
    source_ids: sourceIds,
    fact_ids_by_source: factIdsBySource,
  }
  const structured = structuredEvidencePort
    ? await structuredEvidencePort.retrieveStructuredEvidence(structuredRequest)
    : retrieveStructuredEvidenceFromKnowledgeBase(structuredRequest, knowledgeBase)
  const base: RagResult = {
    query: compileHydrationQuery(request, sourceIds),
    learnerLevel: request.learner_profile.level,
    topK: Math.max(1, sourceIds.length),
    results: structured.results,
  }
  const coverage = objectiveCoverage(request.path_context, base, request.resource_needs)
  const hasMissingSource = structured.missing_source_ids.length > 0
  const hasMissingFact = structured.missing_fact_refs.length > 0
  const allCoverageReady = coverage.every((entry) => entry.status === "strong")
  const status = base.results.length === 0
    ? "no_match"
    : !hasMissingSource && !hasMissingFact && allCoverageReady
      ? "strong"
      : "weak"
  return decorateResult(request, base, coverage, status)
}

function compileDiscoveryQuery(request: LearningEvidenceRequest): string {
  const path = request.path_context
  const planning = request.planning_context
  const learning = request.learning_context
  return [
    `学习目标：${path?.goal ?? request.learner_profile.goal}`,
    `学习者水平：${request.learner_profile.level}`,
    `已掌握：${request.learner_profile.known_concepts.join("、") || "无"}`,
    `薄弱点：${request.learner_profile.weak_concepts.join("、") || "无"}`,
    ...(path ? [`当前节点：${path.goal}`, `目标行为：${path.objectives.map((item) => item.observable_behavior).join("、")}`] : []),
    ...(planning ? [
      `当前节点：${planning.current_goal}`,
      `目标行为：${planning.observable_behaviors.join("、") || "未指定"}`,
    ] : []),
    ...(learning ? [`本轮动作：${learning.action}`, `误区：${learning.misconception_tags.join("、") || "无"}`] : []),
  ].join("；")
}

function compileHydrationQuery(request: LearningEvidenceRequest, sourceIds: string[]): string {
  const action = request.learning_context?.action ?? "advance"
  return `按路径标识取证；节点：${request.path_context?.node_id ?? "unknown"}；来源：${sourceIds.join("、")}；动作：${action}`
}

function objectiveCoverage(
  path: NonNullable<LearningEvidenceRequest["path_context"]>,
  result: RagResult,
  resourceNeeds: LearningEvidenceRequest["resource_needs"],
): ObjectiveEvidenceCoverage[] {
  const bySource = new Map(result.results.map((item) => [item.source_id ?? item.sourceId, item]))
  return path.objectives.map((objective) => {
    const item = bySource.get(objective.source_id)
    const available = (item?.facts ?? [])
      .map((fact) => fact.fact_id ?? fact.factId)
      .filter((factId): factId is string => Boolean(factId))
    const required = objective.required_fact_ids
    const missing = required.filter((factId) => !available.includes(factId))
    const missingResources = [
      ...(resourceNeeds.includes("example") && (item?.examples.length ?? 0) === 0 ? ["示例"] : []),
      ...(resourceNeeds.includes("practice_task") && (item?.practiceTasks.length ?? 0) === 0 ? ["练习任务"] : []),
    ]
    const status = !item
      ? "no_match" as const
      : available.length === 0 || missing.length > 0 || missingResources.length > 0
        ? "weak" as const
        : "strong" as const
    return {
      objective_id: objective.objective_id,
      source_id: objective.source_id,
      importance: objective.importance,
      status,
      required_fact_ids: [...required],
      available_fact_ids: available,
      missing_fact_ids: missing,
      reasons: !item
        ? ["目标来源不存在"]
        : available.length === 0
          ? ["目标来源没有可用事实"]
          : missing.length > 0
            ? [`缺少必要事实：${missing.join("、")}`]
            : missingResources.length > 0
              ? [`缺少本轮所需资源：${missingResources.join("、")}`]
            : ["目标来源与必要事实齐全"],
    }
  })
}

function discoveryStatus(result: RagResult, coverage: ObjectiveEvidenceCoverage[]): "strong" | "weak" | "no_match" {
  if (result.results.length === 0) return "no_match"
  if (coverage.length === 0) return result.results[0]!.score >= 5 ? "strong" : "weak"
  return coverage.every((item) => item.status === "strong")
    ? "strong"
    : "weak"
}

function decorateResult(
  request: LearningEvidenceRequest,
  result: RagResult,
  coverage: ObjectiveEvidenceCoverage[],
  matchStatus: "strong" | "weak" | "no_match",
): RagResult {
  const retrievalId = `RAG-${contentHash({
    request_id: request.request_id,
    request_hash: contentHash(request),
    result_refs: result.results.map((item) => ({
      source_id: item.source_id ?? item.sourceId,
      fact_ids: item.facts.map((fact) => fact.fact_id ?? fact.factId),
    })),
  }).slice("sha256:".length, "sha256:".length + 24)}`
  return {
    ...result,
    retrieval_id: retrievalId,
    match_status: matchStatus,
    objective_coverage: coverage,
    evidence_sufficiency: evidenceSufficiency(request, result, coverage),
    retrieval_context: {
      request_id: request.request_id,
      request_hash: contentHash(request),
      retrieval_mode: request.retrieval_mode,
      parent_retrieval_id: request.parent_retrieval_id,
      action: request.learning_context?.action,
      focus_objective_ids: [...(request.learning_context?.focus_objective_ids ?? [])],
      resource_needs: [...request.resource_needs],
    },
  }
}

function evidenceSufficiency(
  request: LearningEvidenceRequest,
  result: RagResult,
  coverage: ObjectiveEvidenceCoverage[],
): NonNullable<RagResult["evidence_sufficiency"]> {
  const foundSources = new Set(result.results.map((item) => item.source_id ?? item.sourceId))
  const requestedSources = new Set([
    ...(request.path_context?.target_source_ids ?? []),
    ...(request.path_context?.prerequisite_source_ids ?? []),
  ])
  const missingSourceIds = [...requestedSources].filter((sourceId) => !foundSources.has(sourceId))
  const missingFactIds = coverage.flatMap((entry) =>
    entry.missing_fact_ids.map((factId) => `${entry.source_id}:${factId}`))
  const requestedMisconceptions = (request.learning_context?.misconception_tags ?? [])
    .filter((id) => id.startsWith("MIS-"))
  const availableMisconceptions = new Set(result.results.flatMap((item) =>
    (item.misconceptions ?? []).map((entry) => entry.misconceptionId)))
  const missingMisconceptionIds = requestedMisconceptions.filter((id) =>
    !availableMisconceptions.has(id))
  const workedExampleCount = result.results.reduce((sum, item) =>
    sum + (item.workedExamples?.length ? item.workedExamples.length : item.examples.length), 0)
  const counterexampleCount = result.results.reduce((sum, item) =>
    sum + (item.counterexamples?.length ?? 0), 0)
  return {
    ok: matchStatusReady(result, coverage)
      && missingSourceIds.length === 0
      && missingFactIds.length === 0
      && missingMisconceptionIds.length === 0
      && (!request.resource_needs.includes("example") || workedExampleCount > 0),
    missing_source_ids: missingSourceIds,
    missing_fact_ids: missingFactIds,
    missing_misconception_ids: missingMisconceptionIds,
    worked_example_count: workedExampleCount,
    counterexample_count: counterexampleCount,
  }
}

function matchStatusReady(result: RagResult, coverage: ObjectiveEvidenceCoverage[]): boolean {
  return result.results.length > 0 && coverage.every((entry) => entry.status === "strong")
}
