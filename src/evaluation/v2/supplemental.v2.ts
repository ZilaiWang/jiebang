import type { KnowledgeBase } from "../../knowledge/types"
import { retrieveKnowledge } from "../../rag/retriever"
import { COMPETITION_CASES_V2 } from "./competition-cases.v2"
import type { RoleCReviewedReleaseDelivery } from "../../role-c-content"
import { contentHash } from "../../role-c-content/contracts/common"
import { COMPETITION_PROFILE_FIXTURES_V2 } from "./competition-profiles.v2"
import { adaptLearnerProfile } from "../../role-c-content/contracts/profile-adapter"
import {
  buildRoleCProfileSnapshotOptions,
  assessProfileIntake,
} from "../../role-b-profile/learner-profile-v2"
import { buildFormalPath } from "../../role-b-profile/teaching-audit/formal-path"
import { retrieveStructuredEvidenceFromKnowledgeBase } from "../../rag/structured-evidence"
import { competitionArtifactViews } from "../competition-artifact-view"

/** Raw-query retrieval is measured separately; it never replaces main-suite exact evidence. */
export async function runQueryRobustnessV2(kb: KnowledgeBase) {
  const counts = new Map<string, number>()
  const selected = COMPETITION_CASES_V2.filter((c) => {
    const n = counts.get(c.query.style) ?? 0
    if (n === 2) return false
    counts.set(c.query.style, n + 1)
    return true
  })
  const rows = []
  for (const c of selected) {
    const profile = {
      ...structuredClone(COMPETITION_PROFILE_FIXTURES_V2[c.profile_fixture_id]),
      goal: c.query.raw,
    }
    const retrieval = await retrieveKnowledge({
      query: c.query.raw,
      learnerLevel: "basic",
      topK: 5,
      knowledgeBase: kb,
    })
    const ids = retrieval.results.map((r) => r.source_id),
      hits = c.target_source_ids.filter((id) => ids.includes(id))
    const path = buildFormalPath({
      learnerProfile: profile,
      knowledgeBase: kb,
      profileSnapshot: adaptLearnerProfile(
        profile,
        buildRoleCProfileSnapshotOptions(profile),
      ),
    })
    const plannedIds = [
      ...new Set(path.nodes.flatMap((n) => n.target_source_ids)),
    ]
    const hydration = retrieveStructuredEvidenceFromKnowledgeBase(
      { source_ids: plannedIds },
      kb,
    )
    const prerequisites = [
      ...new Set(
        c.target_source_ids.flatMap(
          (id) => kb.items.find((i) => i.sourceId === id)?.prerequisites ?? [],
        ),
      ),
    ]
    rows.push({
      case_id: `ROBUST-${c.case_id}`,
      source_case_id: c.case_id,
      style: c.query.style,
      raw_query: c.query.raw,
      expected_sources: c.target_source_ids,
      retrieved_sources: ids,
      target_recall: hits.length / c.target_source_ids.length,
      top_1_source_correct: c.target_source_ids.includes(ids[0] ?? ""),
      path_status: path.planning_outcome.status,
      planned_source_ids: plannedIds,
      prerequisite_recall: prerequisites.length
        ? prerequisites.filter(
            (id) =>
              plannedIds.includes(id) ||
              new Set<string>(profile.known_concepts).has(id),
          ).length / prerequisites.length
        : 1,
      hydration_missing: hydration.missing_source_ids,
      passed:
        hits.length === c.target_source_ids.length &&
        path.planning_outcome.status === "ready" &&
        c.target_source_ids.every((id) => plannedIds.includes(id)) &&
        hydration.missing_source_ids.length === 0,
    })
  }
  return {
    suite: "raw-query-robustness.v2",
    model_calls: 0,
    total: 12,
    passed: rows.length === 12 && rows.every((r) => r.passed),
    rows,
    missing_goal_clarification:
      assessProfileIntake({ learner_id: "eval-missing-goal" }).status ===
      "needs_clarification",
  }
}
export function compareCounterfactualsV2(
  records: Array<{
    case_id: string
    repeat_index: number
    public_release?: RoleCReviewedReleaseDelivery
  }>,
) {
  const groups = new Map<string, typeof COMPETITION_CASES_V2>()
  for (const c of COMPETITION_CASES_V2)
    if (c.counterfactual_group_id)
      groups.set(c.counterfactual_group_id, [
        ...(groups.get(c.counterfactual_group_id) ?? []),
        c,
      ])
  return [...groups].map(([group_id, cases]) => {
    const [a, b] = cases
    const sameTask =
      contentHash(
        a!.objectives.map((o) => [o.source_id, o.observable_behavior]),
      ) ===
        contentHash(
          b!.objectives.map((o) => [o.source_id, o.observable_behavior]),
        ) && contentHash(a!.artifact_plan) === contentHash(b!.artifact_plan)
    const pairs = [...new Set(records.map((r) => r.repeat_index))].map(
      (repeat) => {
        const x = records.find(
          (r) => r.case_id === a!.case_id && r.repeat_index === repeat,
        )?.public_release
        const y = records.find(
          (r) => r.case_id === b!.case_id && r.repeat_index === repeat,
        )?.public_release
        return {
          repeat_index: repeat,
          complete: !!x && !!y,
          visible_content_identical:
            x && y
              ? contentHash(
                  competitionArtifactViews(x).map((a) => [a.title, a.content]),
                ) ===
                contentHash(
                  competitionArtifactViews(y).map((a) => [a.title, a.content]),
                )
              : null,
          artifact_ids:
            x && y
              ? [
                  x.artifacts.map((a) => a.artifact_id),
                  y.artifacts.map((a) => a.artifact_id),
                ]
              : null,
        }
      },
    )
    return {
      group_id,
      case_ids: cases.map((c) => c.case_id),
      comparison_type: "cross_profile_curriculum_comparison",
      same_task: sameTask,
      controlled: false,
      pairs,
    }
  })
}

/** Only public teaching payloads are scanned, not authorized audit identities. */
export function publicEvaluationPrivacyIssues(
  release: RoleCReviewedReleaseDelivery,
): string[] {
  const payload = JSON.stringify(release.artifacts.map((a) => a.payload))
  return [
    "eval-p01",
    "eval-p02",
    "eval-p03",
    "eval-p04",
    "eval-p05",
    "eval-p06",
    "humanities_social_sciences",
    "science_engineering",
  ]
    .filter((token) => payload.includes(token))
    .map((token) => `PUBLIC_PROFILE_DISCLOSURE:${token}`)
}
