import type { KnowledgeBase, KnowledgeItem } from "../../knowledge/types"
import { loadKnowledgeBase } from "../../knowledge/loader"
import { retrieveKnowledge, type RagResult } from "../../rag/retriever"
import { retrieveStructuredEvidenceFromKnowledgeBase } from "../../rag/structured-evidence"
import { defineLearningPathNode, stableId } from "../../role-c-content"
import { bindObjectiveEvidence } from "../../role-c-content/planning/objective-evidence-bundle"
import { contentHash } from "../../role-c-content/contracts/common"
import {
  generateRoleCForRoleDWithRuntime,
  type RoleCForRoleDRuntimeOptions,
} from "../../role-d-integration/role-c-service"
import { COMPETITION_PROFILE_FIXTURES_V2 } from "./competition-profiles.v2"
import type { CompetitionEvaluationCaseV2 } from "./competition-cases.v2"
import {
  sourceContractHash,
  type FrozenCompetitionCaseV2,
} from "./competition-manifest.v2"
import { buildArtifactTaskContractsV2 } from "./artifact-task-contract.v2"
import { inferFactCapabilities } from "../../knowledge/capabilities"
import { createEvaluationRunnerV2 } from "./runner-evidence.v2"

/** Frozen core facts remain the measurement denominator; authoring also receives capability support. */
export async function prepareCompetitionV2Input(input: {
  evaluationCase: CompetitionEvaluationCaseV2
  expectation: FrozenCompetitionCaseV2
  knowledgeBase?: KnowledgeBase
}) {
  const { evaluationCase: c, expectation: e } = input
  if (c.case_id !== e.case_id)
    throw new Error("COMPETITION_V2_CASE_EXPECTATION_MISMATCH")
  const knowledgeBase = input.knowledgeBase ?? (await loadKnowledgeBase())
  const byId = new Map(knowledgeBase.items.map((i) => [i.sourceId, i]))
  const profile = structuredClone(
    COMPETITION_PROFILE_FIXTURES_V2[c.profile_fixture_id],
  )
  const artifactTaskContracts = buildArtifactTaskContractsV2({
    evaluationCase: c,
    profile,
  })
  if (
    contentHash(profile) !== e.profile_contract_hash ||
    contentHash(c.query) !== e.query_hash ||
    contentHash(artifactTaskContracts) !== contentHash(e.artifact_tasks)
  )
    throw new Error("COMPETITION_V2_INPUT_DRIFT")
  const prerequisites = collectPrerequisites(c.target_source_ids, byId)
  const sourceIds = [...new Set([...c.target_source_ids, ...prerequisites])]
  const recalled = await retrieveKnowledge({
    query: c.query.raw,
    learnerLevel: profile.level,
    topK: knowledgeBase.items.length,
    knowledgeBase,
  })
  const structured = retrieveStructuredEvidenceFromKnowledgeBase(
    { source_ids: sourceIds },
    knowledgeBase,
  )
  if (structured.missing_source_ids.length)
    throw new Error(
      `COMPETITION_V2_MISSING_EVIDENCE:${structured.missing_source_ids.join(",")}`,
    )
  const recalledById = new Map(recalled.results.map((i) => [i.source_id, i]))
  const exact = structured.results.map((item) => {
    const trace = recalledById.get(item.source_id)
    return trace
      ? {
          ...item,
          score: trace.score,
          reason: trace.reason,
          retrievalTrace: trace.retrievalTrace,
          retrieval_trace: trace.retrieval_trace,
        }
      : item
  })
  const ragResult: RagResult = {
    query: c.query.raw,
    learnerLevel: profile.level,
    topK: exact.length,
    results: exact,
  }
  const objectives = e.objectives.map((o, index) => {
    const source = byId.get(o.source_id)
    if (!source || sourceContractHash(source) !== o.source_contract_hash)
      throw new Error(`COMPETITION_V2_SOURCE_DRIFT:${o.source_id}`)
    const binding = bindObjectiveEvidence(o, knowledgeBase.items)
    if (!binding.sufficient)
      throw new Error(
        `COMPETITION_V2_UNSUPPORTED_BEHAVIOR:${o.source_id}:${o.observable_behavior}:${binding.missing_capabilities.join(",")}`,
      )
    if (
      artifactTaskContracts.assessment.assessment
        ?.require_boundary_or_counterexample_item
    ) {
      const boundary = source.facts.find((f) =>
        (f.capabilities ?? inferFactCapabilities(f.content)).some(
          (c) => c === "boundary" || c === "contrast",
        ),
      )
      if (boundary && !binding.required_fact_ids.includes(boundary.factId))
        binding.required_fact_ids.push(boundary.factId)
    }
    return {
      objective_id: stableId("OBJECTIVE-COMP-V2", {
        source_id: o.source_id,
        behavior: o.observable_behavior,
      }),
      source_id: o.source_id,
      required_fact_ids: binding.required_fact_ids,
      observable_behavior: o.observable_behavior,
      importance: "core" as const,
      ...(index === 0 ? { is_primary: true as const } : {}),
    }
  })
  const pathNode = defineLearningPathNode({
    node_id: stableId("PATH-COMP-V2", {
      case_id: c.case_id,
      targets: c.target_source_ids,
    }),
    target_source_ids: [...c.target_source_ids],
    prerequisite_source_ids: prerequisites,
    goal: profile.goal,
    objectives,
    assessment_blueprint: structuredClone(e.assessment_blueprint),
  })
  return {
    profile,
    ragResult,
    pathNode,
    kbVersion: knowledgeBase.version,
    knowledgeBase,
    artifactTaskContracts,
  }
}
export async function runCompetitionV2Case(
  input: Parameters<typeof prepareCompetitionV2Input>[0] & {
    runId: string
    runtime: RoleCForRoleDRuntimeOptions
  },
) {
  const prepared = await prepareCompetitionV2Input(input)
  const started = performance.now()
  const runner =
    input.runtime.runner ??
    (input.runtime.dataDirectory
      ? await createEvaluationRunnerV2(
          input.runtime.dataDirectory,
          input.runtime.env,
        )
      : undefined)
  const result = await generateRoleCForRoleDWithRuntime(
    { ...prepared, runId: input.runId },
    { ...input.runtime, runner, providerMode: "model" },
  )
  return { result, duration_ms: performance.now() - started, prepared }
}
function collectPrerequisites(
  targets: string[],
  byId: Map<string, KnowledgeItem>,
): string[] {
  const targetSet = new Set(targets),
    visiting = new Set<string>(),
    visited = new Set<string>(),
    ordered: string[] = []
  const visit = (id: string) => {
    if (visited.has(id)) return
    if (visiting.has(id))
      throw new Error(`COMPETITION_V2_PREREQUISITE_CYCLE:${id}`)
    const item = byId.get(id)
    if (!item) throw new Error(`COMPETITION_V2_UNKNOWN_SOURCE:${id}`)
    visiting.add(id)
    for (const p of item.prerequisites) visit(p)
    visiting.delete(id)
    visited.add(id)
    if (!targetSet.has(id)) ordered.push(id)
  }
  targets.forEach(visit)
  return ordered
}
