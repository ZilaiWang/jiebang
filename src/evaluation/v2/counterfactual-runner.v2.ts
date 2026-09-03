import type { KnowledgeBase } from "../../knowledge/types"
import { contentHash } from "../../role-c-content/contracts/common"
import {
  generateRoleCForRoleDWithRuntime,
  type RoleCForRoleDRuntimeOptions,
} from "../../role-d-integration/role-c-service"
import { COMPETITION_CASES_V2 } from "./competition-cases.v2"
import { COMPETITION_PROFILE_FIXTURES_V2 } from "./competition-profiles.v2"
import { prepareCompetitionV2Input } from "./competition-runner.v2"
import type { FrozenCompetitionManifestV2 } from "./competition-manifest.v2"
import { createAtomicRoleCLearningPersistence } from "../../role-d-integration/role-c-service"

/** Separate experiment: only discipline changes; level, goals, tasks and evidence stay fixed. */
export async function prepareControlledPairV2(
  groupId: string,
  kb: KnowledgeBase,
  manifest: FrozenCompetitionManifestV2,
) {
  const pair = COMPETITION_CASES_V2.filter(
    (c) => c.counterfactual_group_id === groupId,
  )
  if (pair.length !== 2)
    throw new Error("COUNTERFACTUAL_GROUP_REQUIRES_TWO_CASES")
  const anchor = pair[0]!
  const prepared = await prepareCompetitionV2Input({
    evaluationCase: anchor,
    expectation: manifest.cases.find((c) => c.case_id === anchor.case_id)!,
    knowledgeBase: kb,
  })
  const alternate = structuredClone(prepared.profile)
  alternate.background_context.discipline_background = [
    ...COMPETITION_PROFILE_FIXTURES_V2[pair[1]!.profile_fixture_id]
      .background_context.discipline_background,
  ]
  // Free-text discipline labels would contradict the changed structured field.
  // Neutralize the same fields on BOTH sides, not just on the alternate side.
  for (const profile of [prepared.profile, alternate]) {
    profile.background_context.summary =
      "学习者已通过诊断，按结构化学科背景组织表达。"
    profile.background_context.role_context = "学习者"
  }
  return {
    group_id: groupId,
    anchor_case_id: anchor.case_id,
    changed_fields: ["background_context.discipline_background"],
    prepared,
    alternate_profile: alternate,
    curriculum_hash: contentHash({
      path: prepared.pathNode,
      evidence: prepared.ragResult.results,
      tasks: prepared.artifactTaskContracts,
    }),
  }
}

export async function runControlledPairV2(input: {
  groupId: string
  kb: KnowledgeBase
  manifest: FrozenCompetitionManifestV2
  runtime: RoleCForRoleDRuntimeOptions
  directory: string
}) {
  const pair = await prepareControlledPairV2(
    input.groupId,
    input.kb,
    input.manifest,
  )
  const arms = []
  for (const [label, profile] of [
    ["anchor", pair.prepared.profile],
    ["alternate", pair.alternate_profile],
  ] as const) {
    const directory = `${input.directory}/${label}`
    const runId = `RUN-CF-V2-${input.groupId}-${label}-${contentHash(input.directory).slice(-12)}`
    const start = performance.now()
    const result = await generateRoleCForRoleDWithRuntime(
      { ...pair.prepared, profile, runId },
      { ...input.runtime, providerMode: "model", dataDirectory: directory },
    )
    const stored =
      result.status === "ready"
        ? await createAtomicRoleCLearningPersistence(
            directory,
          ).cycleStore.loadRun(result.runId)
        : undefined
    const spec = stored?.pipeline_input.generation_spec
    arms.push({
      label,
      status: result.status,
      duration_ms: performance.now() - start,
      reason: result.status === "ready" ? undefined : result.reason,
      invariant_hash: spec
        ? contentHash({
            targets: spec.targets,
            tasks: spec.artifact_tasks,
            blueprint: spec.assessment_blueprint,
            evidence: spec.evidence_ref,
          })
        : null,
      release: result.status === "ready" ? result.reviewedRelease : undefined,
    })
  }
  return {
    suite: "controlled-expression.v2",
    group_id: pair.group_id,
    changed_fields: pair.changed_fields,
    curriculum_hash: pair.curriculum_hash,
    arms,
    complete: arms.every((a) => a.status === "ready"),
    facts_and_tasks_preserved:
      arms.every((a) => a.invariant_hash) &&
      arms[0]!.invariant_hash === arms[1]!.invariant_hash,
    personalization_review: {
      reviewer: "",
      perceptible: null,
      grounded_examples: [],
    },
  }
}
