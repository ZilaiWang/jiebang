import { describe, test, expect } from "bun:test"
import { loadKnowledgeBase } from "../src/knowledge/loader"
import {
  buildCompetitionManifestCandidateV2,
  assertFrozenManifestMatchesCurrentV2,
  assertManifestIntegrityV2,
  assertManifestReviewCompleteV2,
  assertManifestApprovedV2,
  type ManifestReviewRowV2,
  legacyCoreFactDriftV2,
} from "../src/evaluation/v2/competition-manifest.v2"
import { contentHash } from "../src/role-c-content/contracts/common"
import { preflightCompetitionV2 } from "../src/evaluation/v2/preflight.v2"
import {
  planArtifactTasks,
  aggregateArtifactDifficulty,
  projectAssessmentTask,
  tasksForNextPath,
} from "../src/role-c-content/contracts/artifact-task"
import {
  buildDifficultyPlan,
  parameterizeArtifactTask,
} from "../src/role-c-content/planning/resource-blueprint"
import { ARTIFACT_KINDS } from "../src/evaluation/competition-metrics"
import { runQueryRobustnessV2 } from "../src/evaluation/v2/supplemental.v2"
import { syntheticAnswersV2 } from "../src/evaluation/v2/dynamic-runner.v2"
import type { AssessmentSecurePayload } from "../src/role-c-content/contracts/artifacts"
import { buildAssessmentTaxonomyPlan } from "../src/role-c-content/planning/assessment-taxonomy"
import { normalizeEvidenceBoundedAssessmentChoices } from "../src/role-c-content/providers/model-backed-provider"
import { conceptOwnedTeachingContract } from "../src/role-c-content/planning/teaching-unit-contract"

const kb = await loadKnowledgeBase()
const candidate = buildCompetitionManifestCandidateV2(kb)
const blueprint = {
  tier_1_count: 1,
  tier_2_count: 2,
  tier_3_count: 3,
  required_modalities: ["code" as const, "trace" as const],
}
const tasks = planArtifactTasks({
  behavior: "create",
  target_count: 2,
  level: "integrated",
  blueprint,
})
describe("evaluation v2 production integration", () => {
  test("lecture critique does not demand another artifact's planned tasks", () => {
    const contract = {
      schema_version: "1.0",
      objective_id: "o",
      required_visible_fact_ids: ["F1"],
      forbidden_shortcuts: [],
      slots: [
        "worked_example",
        "step_trace",
        "guided_practice",
        "independent_practice",
        "transfer_task",
        "prerequisite_checkpoint",
      ].map((kind) => ({
        kind,
        required: true,
        fact_ids: ["F1"],
        minimum_count: 1,
        learner_visible_acceptance: "concrete",
      })),
    } as any
    expect(
      conceptOwnedTeachingContract(contract).slots.map((s) => s.kind),
    ).toEqual(["worked_example", "step_trace", "guided_practice"])
    expect(contract.slots).toHaveLength(6)
  })
  test("all 60 inputs pass real schemas, lesson plans, lab plans and assessment plans without models", async () => {
    const result = await preflightCompetitionV2(kb, candidate)
    expect(result.rows.filter((r) => !r.ok)).toEqual([])
    expect(result.total).toBe(60)
    expect(result.model_calls).toBe(0)
  }, 30_000)
  test("checks body integrity even when a caller retains the old hash", () => {
    const changed = structuredClone(candidate)
    changed.cases[0]!.expected_difficulty.lesson = "integrated"
    expect(() => assertManifestIntegrityV2(changed)).toThrow(
      "MANIFEST_CONTENT_HASH_MISMATCH",
    )
  })
  test("migration explicitly records changed facts instead of treating valid old IDs as current coverage", () => {
    const result = legacyCoreFactDriftV2(
      { cases: [{ case_id: "old", required_fact_ids: ["K001:REMOVED"] }] },
      kb,
    )
    expect(result.changed_cases).toBe(1)
    expect(result.rows[0]!.removed).toEqual(["K001:REMOVED"])
    expect(result.rows[0]!.added.length).toBeGreaterThan(0)
    expect(result.fact_text_comparison_available).toBe(false)
  })
  test("detects semantic drift in non-core facts and source metadata", () => {
    for (const field of ["fact", "title", "prerequisite"]) {
      const changed = structuredClone(kb),
        item = changed.items.find((i) => i.sourceId === "K007")!
      if (field === "fact") item.facts.at(-1)!.content += "（修订）"
      else if (field === "title") item.title += "（修订）"
      else item.prerequisites = []
      expect(() =>
        assertFrozenManifestMatchesCurrentV2({
          frozen: candidate,
          knowledgeBase: changed,
        }),
      ).toThrow("SEMANTIC_DRIFT")
    }
  })
  test("requires all 180 rows, distinct reviewers and hash-bound approval", () => {
    const rows: ManifestReviewRowV2[] = candidate.cases.flatMap((c) =>
      ARTIFACT_KINDS.map((artifact_kind) => ({
        case_id: c.case_id,
        artifact_kind,
        candidate_hash: candidate.semantic_contract_hash,
        reviewer_1: "test-only-reviewer-a",
        reviewer_2: "test-only-reviewer-b",
        reviewer_1_decision: c.expected_difficulty[artifact_kind],
        reviewer_2_decision: c.expected_difficulty[artifact_kind],
        rationale: "synthetic unit-test approval; never written as real review",
      })),
    )
    expect(() => assertManifestReviewCompleteV2(rows, candidate)).not.toThrow()
    expect(() =>
      assertManifestReviewCompleteV2(rows.slice(1), candidate),
    ).toThrow()
    const duplicate = structuredClone(rows)
    duplicate[1] = duplicate[0]!
    expect(() => assertManifestReviewCompleteV2(duplicate, candidate)).toThrow()
    const same = structuredClone(rows)
    same[0]!.reviewer_2 = same[0]!.reviewer_1
    expect(() => assertManifestReviewCompleteV2(same, candidate)).toThrow()
    expect(() =>
      assertManifestApprovedV2(candidate, rows, {
        version: "manifest-approval.v2",
        candidate_hash: candidate.semantic_contract_hash,
        review_hash: "old",
        approved_at: new Date().toISOString(),
        approved_by: "test",
      }),
    ).toThrow()
  })
  test("explicit single-agent review needs no second name and preserves requested changes", () => {
    const rows: ManifestReviewRowV2[] = candidate.cases.flatMap((c) =>
      ARTIFACT_KINDS.map((artifact_kind) => ({
        case_id: c.case_id,
        artifact_kind,
        candidate_hash: candidate.semantic_contract_hash,
        review_mode: "single_agent" as const,
        review_status: "accepted" as const,
        reviewer_1: "test-only AI reviewer",
        reviewer_1_decision: c.expected_difficulty[artifact_kind],
        rationale: "Synthetic unit-test review; not a real approval.",
      })),
    )
    const approval = {
      version: "manifest-approval.v2" as const,
      candidate_hash: candidate.semantic_contract_hash,
      review_hash: contentHash(rows),
      approved_at: "2026-09-03T00:00:00Z",
      approved_by: "test-only AI reviewer",
      review_mode: "single_agent" as const,
      authorization: "Test-only explicit single-review authorization",
    }
    expect(() =>
      assertManifestApprovedV2(candidate, rows, approval),
    ).not.toThrow()
    expect(() => assertManifestReviewCompleteV2(rows, candidate)).toThrow(
      "MODE_MISMATCH",
    )
    expect(() =>
      assertManifestApprovedV2(candidate, rows, {
        ...approval,
        authorization: "",
      }),
    ).toThrow("AUTHORIZATION")
    rows[0]!.review_status = "changes_requested"
    expect(() =>
      assertManifestApprovedV2(candidate, rows, {
        ...approval,
        review_hash: contentHash(rows),
      }),
    ).toThrow("CHANGES_REQUESTED")
    rows[0]!.review_status = "accepted"
    rows[0]!.reviewer_2 = "made-up second reviewer"
    expect(() =>
      assertManifestApprovedV2(candidate, rows, {
        ...approval,
        review_hash: contentHash(rows),
      }),
    ).toThrow("EXTRA_REVIEWER")
  })
  test("three independent challenge vectors survive blueprint construction", () => {
    const difficulty = aggregateArtifactDifficulty(tasks)
    const spec = { difficulty, artifact_tasks: tasks } as any
    const plan = buildDifficultyPlan(spec)
    expect(difficulty.cognitive_demand).toBe(4)
    expect(plan.concept_lesson.challenge_target.cognitive_demand).toBe(3)
    expect(plan.assessment.challenge_target.cognitive_demand).toBe(4)
    expect(plan.assessment.support_target).toEqual({
      scaffold_strength: 0,
      reading_density: "high",
      hint_strength: 0,
      starter_support: 0,
    })
    for (const task of Object.values(tasks))
      expect(task).not.toHaveProperty("expected_difficulty")
  })
  test("multiple test inputs are parameterized before authoring, with no changes to single fixed-data tasks", () => {
    const fixed = {
      input_form: "none",
      execution_mode: "stdin_stdout",
      primary_objective_id: "loop",
      task_kind: "stdin_stdout_program",
    } as any
    const variable = parameterizeArtifactTask(fixed, tasks.code_lab.lab)
    expect(variable.input_form).toBe("function_arguments")
    expect(variable.execution_mode).toBe("function")
    expect(variable.entry_point).toBe("solve")
    expect(variable.primary_objective_id).toBe("loop")
    expect(variable.output_constraint).toContain("starter")
    expect(
      parameterizeArtifactTask(fixed, {
        ...tasks.code_lab.lab!,
        public_test_minimum: 1,
        hidden_test_minimum: 1,
      }),
    ).toBe(fixed)
    const stdin = { ...fixed, input_form: "stdin_lines" }
    expect(parameterizeArtifactTask(stdin, tasks.code_lab.lab)).toBe(stdin)
  })
  test("single-item authoring receives only one requested item", () => {
    const item = projectAssessmentTask(tasks.assessment, {
      tier: 3,
      modality: "code",
    })!
    expect(item.target_count).toBe(1)
    expect(item.assessment!.tier_3_count).toBe(1)
    expect(
      item.assessment!.tier_1_count +
        item.assessment!.tier_2_count +
        item.assessment!.tier_3_count,
    ).toBe(1)
    expect(tasks.assessment.assessment!.tier_3_count).toBe(3)
  })
  test("same-node adaptation keeps facts/identity and separates support; new-node planning rebases tasks", () => {
    const targets = [
      {
        source_id: "K007",
        objective_id: "o1",
        observable_behavior: "create",
        required_fact_ids: ["F001"],
        importance: "core",
      },
      {
        source_id: "K009",
        objective_id: "o2",
        observable_behavior: "create",
        required_fact_ids: ["F001"],
        importance: "core",
      },
    ] as any
    const parent = { targets, artifact_tasks: tasks } as any
    const remediate = tasksForNextPath(
      parent,
      targets,
      blueprint,
      "integrated",
      "remediate",
    )!
    const reinforce = tasksForNextPath(
      parent,
      targets,
      blueprint,
      "integrated",
      "reinforce",
    )!
    expect(
      remediate.code_lab.difficulty_vector.scaffold_strength,
    ).toBeGreaterThan(reinforce.code_lab.difficulty_vector.scaffold_strength)
    expect(remediate.code_lab.behavior).toBe("create")
    const next = tasksForNextPath(
      parent,
      [{ ...targets[0], observable_behavior: "debug" }],
      blueprint,
      "intermediate",
    )!
    expect(next.code_lab.lab!.require_faulty_starter).toBe(true)
    expect(next.code_lab.target_count).toBe(1)
  })
  test("12 raw queries run A retrieval rather than exact-ID injection", async () => {
    const result = await runQueryRobustnessV2(kb)
    expect(result.rows).toHaveLength(12)
    expect(new Set(result.rows.map((r) => r.style)).size).toBe(6)
    expect(result.passed).toBe(true)
  })
  test("synthetic partial answers respect weakest-objective routing and never carry hidden data in reports", () => {
    const items = Array.from({ length: 6 }, (_, i) => ({
      item_id: `i${i}`,
      objective_id: `o${i % 3}`,
      max_score: 1,
      correct_option_id: "A",
      misconception_by_option: { B: "m" },
      answer_spec: { kind: "exact_set", accepted: ["A"], normalization: [] },
    }))
    const secure = {
      items,
      code_test_suites: [],
    } as unknown as AssessmentSecurePayload
    const answers = syntheticAnswersV2(
      secure,
      items.map((i) => i.item_id),
      "partial_60_percent",
      {},
    )
    const scores = [0, 1, 2].map(
      (o) =>
        answers.filter((a, i) => i % 3 === o && a.selected_option_id === "A")
          .length / 2,
    )
    expect(Math.min(...scores)).toBeGreaterThanOrEqual(0.4)
    expect(Math.min(...scores)).toBeLessThan(0.8)
  })
  test("taxonomy labels follow operations even for Tier 1 debugging or a pure explanation form", () => {
    const items = Array.from({ length: 5 }, (_, i) => ({
      item_id: `i${i}`,
      objective_id: "o",
      tier: (i < 3 ? 1 : 2) as 1 | 2,
      modality: "short_answer" as const,
      cognitive_operation: "explain_reasoning" as const,
    }))
    const emphasis = {
      recall: 0.2,
      understanding: 0.2,
      application: 0.2,
      analysis: 0.2,
      creation: 0.2,
    }
    expect(
      buildAssessmentTaxonomyPlan({ items, emphasis }).entries.every(
        (e) => e.cognitive_level === "understand",
      ),
    ).toBe(true)
    expect(
      buildAssessmentTaxonomyPlan({
        items: [{ ...items[0]!, cognitive_operation: "diagnose_error" }],
        emphasis,
      }).entries[0]!.cognitive_level,
    ).toBe("analyze")
  })
  test("ill-shaped options reach schema repair without throwing a TypeError", () => {
    expect(() =>
      normalizeEvidenceBoundedAssessmentChoices(
        {
          title: "x",
          items: [
            {
              prompt: "x",
              options: [{ text: "x" }] as any,
              starter_code: null,
              structure_meta: null as any,
            },
          ],
        },
        [],
        [],
      ),
    ).not.toThrow()
  })
})
