import { readFile, writeFile } from "node:fs/promises"
import { COMPETITION_CASES_V2 as cases } from "../src/evaluation/v2/competition-cases.v2"
import { COMPETITION_PROFILE_FIXTURES_V2 as profiles } from "../src/evaluation/v2/competition-profiles.v2"
import { buildCompetitionManifestCandidateV2 } from "../src/evaluation/v2/competition-manifest.v2"
import { loadKnowledgeBase } from "../src/knowledge/loader"
import { ARTIFACT_KINDS } from "../src/evaluation/competition-metrics"

const kb = await loadKnowledgeBase()
const manifest = buildCompetitionManifestCandidateV2(kb)
const byId = new Map(kb.items.map((i) => [i.sourceId, i.title]))
const count = (values: string[]) =>
  Object.fromEntries(
    [...new Set(values)].map((v) => [v, values.filter((x) => x === v).length]),
  )
const csv = (rows: unknown[][]) =>
  "\uFEFF" +
  rows
    .map((row) =>
      row
        .map((value) => {
          const text = String(value ?? "")
          return /[",\r\n]/u.test(text)
            ? `"${text.replaceAll('"', '""')}"`
            : text
        })
        .join(","),
    )
    .join("\r\n") +
  "\r\n"
const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n"
const files = {
  "evaluation/case-catalog.v2.json": json({
    catalog_version: "competition-main-v2",
    profiles,
    cases,
  }),
  "evaluation/catalog-summary.v2.json": json({
    total_cases: cases.length,
    profile_distribution: count(cases.map((c) => c.profile_fixture_id)),
    behavior_distribution: count(
      cases.map((c) => c.objectives[0].observable_behavior),
    ),
    difficulty_distribution: count(
      cases.flatMap((c) =>
        ARTIFACT_KINDS.map((k) => c.artifact_plan[k].expected_difficulty),
      ),
    ),
    query_style_distribution: count(cases.map((c) => c.query.style)),
    manual_review_focus_distribution: count(
      cases.map((c) => c.manual_review_focus),
    ),
    single_target_cases: cases.filter((c) => c.target_source_ids.length === 1)
      .length,
    multi_target_cases: cases.filter((c) => c.target_source_ids.length > 1)
      .length,
    counterfactual_groups: new Set(
      cases.flatMap((c) =>
        "counterfactual_group_id" in c ? [c.counterfactual_group_id] : [],
      ),
    ).size,
    dynamic_distribution: count(
      cases.flatMap((c) =>
        c.dynamic_trajectory ? [c.dynamic_trajectory.expected_action] : [],
      ),
    ),
    review_rows: 180,
  }),
  "evaluation/evaluation-case-matrix-v2.csv": csv([
    [
      "case_id",
      "profile_fixture_id",
      "profile_archetype_id",
      "behavior",
      "target_source_ids",
      "target_titles",
      "query_style",
      "raw_query",
      "lesson_difficulty",
      "lab_difficulty",
      "assessment_difficulty",
      "assessment_blueprint",
      "lab_shape",
      "counterfactual_group_id",
      "dynamic_action",
      "manual_review_focus",
      "tags",
    ],
    ...cases.map((c) => [
      c.case_id,
      c.profile_fixture_id,
      c.profile_archetype_id,
      c.objectives[0].observable_behavior,
      c.target_source_ids.join("|"),
      c.target_source_ids.map((id) => byId.get(id)).join("|"),
      c.query.style,
      c.query.raw,
      c.artifact_plan.lesson.expected_difficulty,
      c.artifact_plan.lab.expected_difficulty,
      c.artifact_plan.assessment.expected_difficulty,
      JSON.stringify(c.artifact_plan.assessment.blueprint),
      c.artifact_plan.lab.shape,
      "counterfactual_group_id" in c ? c.counterfactual_group_id : "",
      c.dynamic_trajectory ? c.dynamic_trajectory.expected_action : "",
      c.manual_review_focus,
      c.tags.join("|"),
    ]),
  ]),
  "evaluation/manifest-review-template-v2.csv": csv([
    [
      "case_id",
      "artifact_kind",
      "candidate_hash",
      "expected_difficulty",
      "basis",
      "reviewer_1",
      "reviewer_1_decision",
      "reviewer_2",
      "reviewer_2_decision",
      "adjudicator",
      "adjudication",
      "rationale",
    ],
    ...manifest.cases.flatMap((c) =>
      ARTIFACT_KINDS.map((kind) => [
        c.case_id,
        kind,
        manifest.semantic_contract_hash,
        c.expected_difficulty[kind],
        c.expected_difficulty_basis[kind],
        "",
        "",
        "",
        "",
        "",
        "",
        "",
      ]),
    ),
  ]),
}
for (const [path, value] of Object.entries(files)) {
  if (process.argv.includes("--check")) {
    if ((await readFile(path, "utf8")) !== value)
      throw new Error(`CATALOG_EXPORT_STALE:${path}`)
  } else await writeFile(path, value)
}
console.log(
  `Evaluation v2: ${Object.keys(files).length} catalog views ${process.argv.includes("--check") ? "verified" : "exported"}; no completed reviews were changed.`,
)
