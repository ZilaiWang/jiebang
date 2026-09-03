import type { KnowledgeBase, KnowledgeItem } from "../../knowledge/types"
import { contentHash } from "../../role-c-content/contracts/common"
import {
  ARTIFACT_KINDS,
  type ArtifactKind,
  type Difficulty,
  type CompetitionCaseExpectation,
} from "../competition-metrics"
import {
  COMPETITION_CASES_V2,
  type CompetitionEvaluationCaseV2,
} from "./competition-cases.v2"
import { COMPETITION_PROFILE_FIXTURES_V2 } from "./competition-profiles.v2"
import {
  buildArtifactTaskContractsV2,
  type ArtifactTaskContractsV2,
} from "./artifact-task-contract.v2"
import { COMPETITION_DYNAMIC_TRAJECTORIES_V2 } from "./competition-dynamic-trajectories.v2"

export interface FrozenObjectiveV2 {
  source_id: string
  observable_behavior: CompetitionEvaluationCaseV2["objectives"][number]["observable_behavior"]
  required_fact_ids: string[]
  source_contract_hash: string
}
export interface FrozenCompetitionCaseV2 {
  case_id: string
  case_contract_hash: string
  profile_fixture_id: string
  profile_contract_hash: string
  query_hash: string
  target_source_ids: string[]
  objectives: FrozenObjectiveV2[]
  artifact_tasks: ArtifactTaskContractsV2
  assessment_blueprint: CompetitionEvaluationCaseV2["artifact_plan"]["assessment"]["blueprint"]
  expected_difficulty: Record<ArtifactKind, Difficulty>
  expected_difficulty_basis: Record<ArtifactKind, string>
  counterfactual_group_id?: string
  dynamic_trajectory_hash?: string
}
export interface FrozenCompetitionManifestV2 {
  manifest_version: "competition-v2"
  catalog_version: "competition-main-v2"
  knowledge_base_version: string
  knowledge_base_contract_hash: string
  total_cases: 60
  expected_artifacts: 180
  semantic_contract_hash: string
  cases: FrozenCompetitionCaseV2[]
}
export interface ManifestReviewRowV2 {
  case_id: string
  artifact_kind: ArtifactKind
  candidate_hash: string
  reviewer_1: string
  reviewer_1_decision: Difficulty
  review_mode?: "dual" | "single_agent"
  review_status?: "accepted" | "changes_requested"
  reviewer_2?: string
  reviewer_2_decision?: Difficulty
  adjudicator?: string
  adjudication?: Difficulty
  rationale: string
}
export interface ManifestApprovalV2 {
  version: "manifest-approval.v2"
  candidate_hash: string
  review_hash: string
  approved_at: string
  approved_by: string
  review_mode?: "dual" | "single_agent"
  authorization?: string
}
export function sourceContractHash(item: KnowledgeItem): string {
  return contentHash({
    ...item,
    facts: [...item.facts].sort((a, b) => a.factId.localeCompare(b.factId)),
  })
}

/** Historical ID-set comparison only: v1 did not freeze fact text or metadata. */
export function legacyCoreFactDriftV2(
  legacy: { cases: Array<{ case_id: string; required_fact_ids: string[] }> },
  kb: KnowledgeBase,
) {
  const rows = legacy.cases.map((c) => {
    const sourceIds = [
      ...new Set(c.required_fact_ids.map((f) => f.split(":")[0]!)),
    ]
    const current = sourceIds.flatMap(
      (id) =>
        kb.items
          .find((i) => i.sourceId === id)
          ?.coreFactIds?.map((f) => `${id}:${f}`) ?? [],
    )
    return {
      case_id: c.case_id,
      previous_fact_ids: c.required_fact_ids,
      current_fact_ids: current,
      added: current.filter((f) => !c.required_fact_ids.includes(f)),
      removed: c.required_fact_ids.filter((f) => !current.includes(f)),
    }
  })
  return {
    kind: "legacy-core-fact-id-drift.v2",
    legacy_cases: rows.length,
    changed_cases: rows.filter((r) => r.added.length || r.removed.length)
      .length,
    old_case_fact_units: rows.reduce(
      (n, r) => n + r.previous_fact_ids.length,
      0,
    ),
    current_case_fact_units: rows.reduce(
      (n, r) => n + r.current_fact_ids.length,
      0,
    ),
    fact_text_comparison_available: false,
    rows,
  }
}
export function buildCompetitionManifestCandidateV2(
  kb: KnowledgeBase,
): FrozenCompetitionManifestV2 {
  const byId = new Map(kb.items.map((i) => [i.sourceId, i]))
  const cases = COMPETITION_CASES_V2.map((c) => {
    const profile = COMPETITION_PROFILE_FIXTURES_V2[c.profile_fixture_id]
    const objectives = c.objectives.map((o) => {
      const item = byId.get(o.source_id)
      if (!item?.coreFactIds?.length)
        throw new Error(`TARGET_WITHOUT_CORE_FACTS:${o.source_id}`)
      if (
        item.coreFactIds.some((id) => !item.facts.some((f) => f.factId === id))
      )
        throw new Error(`DANGLING_CORE_FACT:${o.source_id}`)
      return {
        source_id: o.source_id,
        observable_behavior: o.observable_behavior,
        required_fact_ids: [...item.coreFactIds].sort(),
        source_contract_hash: sourceContractHash(item),
      }
    })
    const artifact_tasks = buildArtifactTaskContractsV2({
      evaluationCase: c,
      profile,
    })
    const basis = (kind: ArtifactKind) =>
      `behavior=${c.objectives[0]!.observable_behavior};targets=${c.target_source_ids.length};shape=${c.artifact_plan[kind].shape};task=${contentHash(artifact_tasks[kind === "lesson" ? "concept_lesson" : kind === "lab" ? "code_lab" : "assessment"])}`
    const trajectory = COMPETITION_DYNAMIC_TRAJECTORIES_V2.find(
      (t) => t.case_id === c.case_id,
    )
    const payload = {
      case_id: c.case_id,
      profile_fixture_id: c.profile_fixture_id,
      profile_contract_hash: contentHash(profile),
      query_hash: contentHash(c.query),
      target_source_ids: [...c.target_source_ids],
      objectives,
      artifact_tasks,
      assessment_blueprint: structuredClone(
        c.artifact_plan.assessment.blueprint,
      ),
      expected_difficulty: {
        lesson: c.artifact_plan.lesson.expected_difficulty,
        lab: c.artifact_plan.lab.expected_difficulty,
        assessment: c.artifact_plan.assessment.expected_difficulty,
      },
      expected_difficulty_basis: {
        lesson: basis("lesson"),
        lab: basis("lab"),
        assessment: basis("assessment"),
      },
      ...(c.counterfactual_group_id
        ? { counterfactual_group_id: c.counterfactual_group_id }
        : {}),
      ...(trajectory
        ? { dynamic_trajectory_hash: contentHash(trajectory) }
        : {}),
    }
    return { ...payload, case_contract_hash: contentHash(payload) }
  })
  const payload = {
    manifest_version: "competition-v2" as const,
    catalog_version: "competition-main-v2" as const,
    knowledge_base_version: kb.version,
    knowledge_base_contract_hash: contentHash(
      [...kb.items]
        .sort((a, b) => a.sourceId.localeCompare(b.sourceId))
        .map(sourceContractHash),
    ),
    total_cases: 60 as const,
    expected_artifacts: 180 as const,
    cases,
  }
  return { ...payload, semantic_contract_hash: contentHash(payload) }
}
export function assertManifestIntegrityV2(
  frozen: FrozenCompetitionManifestV2,
): void {
  const { semantic_contract_hash, ...payload } = frozen
  if (contentHash(payload) !== semantic_contract_hash)
    throw new Error("MANIFEST_CONTENT_HASH_MISMATCH")
  if (
    frozen.cases.length !== 60 ||
    new Set(frozen.cases.map((c) => c.case_id)).size !== 60
  )
    throw new Error("MANIFEST_CASE_COUNT")
  for (const c of frozen.cases) {
    const { case_contract_hash, ...body } = c
    if (contentHash(body) !== case_contract_hash)
      throw new Error(`MANIFEST_CASE_HASH_MISMATCH:${c.case_id}`)
  }
}
export function assertFrozenManifestMatchesCurrentV2(input: {
  frozen: FrozenCompetitionManifestV2
  knowledgeBase: KnowledgeBase
}): void {
  assertManifestIntegrityV2(input.frozen)
  const current = buildCompetitionManifestCandidateV2(input.knowledgeBase)
  if (current.semantic_contract_hash === input.frozen.semantic_contract_hash)
    return
  const old = new Map(input.frozen.cases.map((c) => [c.case_id, c]))
  const changed = current.cases
    .filter(
      (c) => old.get(c.case_id)?.case_contract_hash !== c.case_contract_hash,
    )
    .map((c) => ({
      case_id: c.case_id,
      changed_fields: Object.keys(c).filter(
        (key) =>
          contentHash(c[key as keyof typeof c] ?? null) !==
          contentHash(old.get(c.case_id)?.[key as keyof typeof c] ?? null),
      ),
      previous_fact_ids: old
        .get(c.case_id)
        ?.objectives.flatMap((o) =>
          o.required_fact_ids.map((f) => `${o.source_id}:${f}`),
        ),
      current_fact_ids: c.objectives.flatMap((o) =>
        o.required_fact_ids.map((f) => `${o.source_id}:${f}`),
      ),
    }))
  throw new Error(
    `COMPETITION_MANIFEST_SEMANTIC_DRIFT:${JSON.stringify({ changed, kb_changed: current.knowledge_base_contract_hash !== input.frozen.knowledge_base_contract_hash })}`,
  )
}
export function assertManifestReviewCompleteV2(
  rows: ManifestReviewRowV2[],
  manifest: FrozenCompetitionManifestV2,
  mode: "dual" | "single_agent" = "dual",
): void {
  assertManifestIntegrityV2(manifest)
  if (rows.length !== 180)
    throw new Error(`MANIFEST_REVIEW_ROW_COUNT:${rows.length}`)
  const seen = new Set<string>(),
    allowed = new Set(["beginner", "basic", "intermediate", "integrated"])
  for (const row of rows) {
    const key = `${row.case_id}:${row.artifact_kind}`,
      expected = manifest.cases.find((c) => c.case_id === row.case_id)
    if (
      !expected ||
      !ARTIFACT_KINDS.includes(row.artifact_kind) ||
      seen.has(key)
    )
      throw new Error(`MANIFEST_REVIEW_IDENTITY:${key}`)
    seen.add(key)
    if (row.candidate_hash !== manifest.semantic_contract_hash)
      throw new Error(`MANIFEST_REVIEW_STALE:${key}`)
    if ((row.review_mode ?? "dual") !== mode)
      throw new Error(`MANIFEST_REVIEW_MODE_MISMATCH:${key}`)
    if (row.review_status === "changes_requested")
      throw new Error(`MANIFEST_REVIEW_CHANGES_REQUESTED:${key}`)
    if (!row.reviewer_1?.trim() || !row.rationale?.trim())
      throw new Error(`MANIFEST_REVIEW_INCOMPLETE:${key}`)
    if (!allowed.has(row.reviewer_1_decision))
      throw new Error(`MANIFEST_REVIEW_INVALID_DECISION:${key}`)
    if (mode === "single_agent") {
      if (
        row.reviewer_2?.trim() ||
        row.reviewer_2_decision ||
        row.adjudicator ||
        row.adjudication
      )
        throw new Error(`SINGLE_REVIEW_HAS_EXTRA_REVIEWER:${key}`)
      if (row.review_status !== "accepted")
        throw new Error(`MANIFEST_REVIEW_INCOMPLETE:${key}`)
      if (
        row.reviewer_1_decision !==
        expected.expected_difficulty[row.artifact_kind]
      )
        throw new Error(`MANIFEST_REVIEW_REVISE_CANDIDATE:${key}`)
      continue
    }
    if (
      !row.reviewer_2?.trim() ||
      row.reviewer_1.trim() === row.reviewer_2.trim()
    )
      throw new Error(`MANIFEST_REVIEW_INCOMPLETE:${key}`)
    if (!row.reviewer_2_decision || !allowed.has(row.reviewer_2_decision))
      throw new Error(`MANIFEST_REVIEW_INVALID_DECISION:${key}`)
    const disagree = row.reviewer_1_decision !== row.reviewer_2_decision
    if (
      disagree &&
      (!row.adjudicator?.trim() ||
        !row.adjudication ||
        !allowed.has(row.adjudication))
    )
      throw new Error(`MANIFEST_REVIEW_ADJUDICATION_REQUIRED:${key}`)
    if (
      (disagree ? row.adjudication : row.reviewer_1_decision) !==
      expected.expected_difficulty[row.artifact_kind]
    )
      throw new Error(`MANIFEST_REVIEW_REVISE_CANDIDATE:${key}`)
  }
}
export function assertManifestApprovedV2(
  manifest: FrozenCompetitionManifestV2,
  rows: ManifestReviewRowV2[],
  approval: ManifestApprovalV2,
): void {
  const mode = approval.review_mode ?? "dual"
  if (mode !== "dual" && mode !== "single_agent")
    throw new Error("MANIFEST_REVIEW_MODE_INVALID")
  if (mode === "single_agent" && !approval.authorization?.trim())
    throw new Error("MANIFEST_SINGLE_REVIEW_AUTHORIZATION_REQUIRED")
  assertManifestReviewCompleteV2(rows, manifest, mode)
  if (
    approval.version !== "manifest-approval.v2" ||
    approval.candidate_hash !== manifest.semantic_contract_hash ||
    approval.review_hash !== contentHash(rows) ||
    !approval.approved_by?.trim() ||
    !Number.isFinite(Date.parse(approval.approved_at))
  )
    throw new Error("MANIFEST_APPROVAL_INVALID")
}
export function competitionExpectationsV2(
  manifest: FrozenCompetitionManifestV2,
): CompetitionCaseExpectation[] {
  return manifest.cases.map((c) => ({
    case_id: c.case_id,
    expected_difficulty: c.expected_difficulty,
    expected_difficulty_basis: c.expected_difficulty_basis,
    required_fact_ids: c.objectives.flatMap((o) =>
      o.required_fact_ids.map((f) => `${o.source_id}:${f}`),
    ),
  }))
}
