import { describe, expect, test } from "bun:test"
import {
  buildStabilityReportV2,
  buildDifficultyConfusionV2,
  buildManualAuditTemplateV2,
  summarizeModelUsageV2,
} from "../src/evaluation/v2/reporting.v2"
import { loadKnowledgeBase } from "../src/knowledge/loader"
import { buildCompetitionManifestCandidateV2 } from "../src/evaluation/v2/competition-manifest.v2"
import { prepareControlledPairV2 } from "../src/evaluation/v2/counterfactual-runner.v2"
import { COMPETITION_CASES_V2 } from "../src/evaluation/v2/competition-cases.v2"
import { competitionArtifactViews } from "../src/evaluation/competition-artifact-view"
import { extractCompetitionClaimCandidates } from "../src/evaluation/competition-claim-auditor"
import { compareCounterfactualsV2 } from "../src/evaluation/v2/supplemental.v2"
import {
  COMPETITION_DYNAMIC_TRAJECTORIES_V2,
  computeDynamicTrajectoryMetricsV2,
  type DynamicTrajectoryResultV2,
} from "../src/evaluation/v2/competition-dynamic-trajectories.v2"

const kb = await loadKnowledgeBase()
const manifest = buildCompetitionManifestCandidateV2(kb)
describe("v2 evidence denominators", () => {
  test("missing repeats are not counted as stable successful results", () => {
    const rows = [
      {
        case_id: "a",
        repeat_index: 1,
        status: "ready",
        duration_ms: 5,
        errors: [],
        difficulty: [],
      },
    ]
    expect(buildStabilityReportV2(rows, ["a", "b"], 2).status_stability).toBe(0)
    expect(buildStabilityReportV2(rows, ["a"], 1).status_stability).toBeNull()
  })
  test("confusion matrices retain all 360 expected resources when no audit exists", () => {
    const result = buildDifficultyConfusionV2(
      [],
      manifest,
      manifest.cases.map((c) => c.case_id),
      2,
    )
    expect(
      result
        .flatMap((r) => Object.values(r.matrix))
        .reduce((n, row) => n + row.not_audited!, 0),
    ).toBe(360)
  })
  test("manual selection is independent of success and includes 20 percent per repeat", () => {
    const rows = buildManualAuditTemplateV2(
      [],
      manifest.cases.map((c) => c.case_id),
      2,
    )
    expect(rows).toHaveLength(72)
    expect(rows.every((r) => r.reviewer === "" && r.status === "not_run")).toBe(
      true,
    )
  })
  test("a single successful dynamic run cannot become 100 percent", () => {
    const t = COMPETITION_DYNAMIC_TRAJECTORIES_V2[0]
    const row: DynamicTrajectoryResultV2 = {
      case_id: t.case_id,
      expected_action: t.expected_action,
      actual_action: t.expected_action,
      same_node_when_required: true,
      next_node_when_required: true,
      profile_version_transition_valid: true,
      target_fact_boundary_preserved: true,
      assessment_novelty_passed: true,
      follow_up_published: true,
    }
    expect(computeDynamicTrajectoryMetricsV2([row]).action_accuracy).toBe(
      1 / 12,
    )
    expect(() => computeDynamicTrajectoryMetricsV2([row, row])).toThrow(
      "IDENTITY",
    )
    expect(() =>
      computeDynamicTrajectoryMetricsV2([
        { ...row, expected_action: "reprofile" },
      ]),
    ).toThrow("IDENTITY")
  })
  test("dynamic policies share the same frozen source of truth", () => {
    for (const trajectory of COMPETITION_DYNAMIC_TRAJECTORIES_V2) {
      const { case_id, ...definition } = trajectory
      expect(definition).toEqual(
        COMPETITION_CASES_V2.find((c) => c.case_id === case_id)!
          .dynamic_trajectory!,
      )
    }
    expect(
      COMPETITION_DYNAMIC_TRAJECTORIES_V2.find(
        (t) => t.case_id === "KB26-M-P05-05",
      )!.expected_action,
    ).toBe("reprofile")
    expect(
      COMPETITION_DYNAMIC_TRAJECTORIES_V2.find(
        (t) => t.case_id === "KB26-M-P05-09",
      )!.expected_action,
    ).toBe("remediate")
  })
  test("independent review reads new programming surfaces and does not read Tier labels", () => {
    const citations = [{ source_id: "K007", fact_id: "F001" }]
    const release = {
      artifacts: [
        {
          artifact_id: "lesson1",
          payload: {
            title: "循环",
            prerequisite_bridge: [],
            explanation_blocks: [],
            worked_examples: [],
            summary: [],
            misconceptions: [],
            micro_checks: [],
            hint_ladders: [],
          },
        },
        {
          artifact_id: "lab1",
          payload: {
            title: "循环操作",
            instructions: [],
            execution_contract: { execution_mode: "function" },
            starter_code: "def solve(xs): pass",
            public_tests: [{ test_id: "T1", input: { args: [[1, 2], 3] }, description: "边界输入", expected_behavior: "返回两个元素", citations }],
            hint_ladders: [],
            reflection_questions: [],
            used_evidence: citations,
            programming_task: {
              task_kind: "debugging_repair",
              statement: "累加奇数位置元素",
              input_description: "一组整数",
              output_description: "总和",
              constraints: [],
              public_examples: [],
              hint_ladders: [{ level: 1, text: "先跟踪索引变化" }],
              gap_template: { template_code: "total = {{gap:init}}" },
            },
            practical_guide: {
              practice_goal: "掌握逐次更新",
              deliverable: "一个可运行函数",
              used_evidence: citations,
              readiness_checks: [],
              steps: [
                {
                  title: "更新",
                  action: "观察每次累加",
                  input: "数组",
                  expected_result: "总和改变",
                  verification: "对照中间值",
                  citations,
                },
              ],
              acceptance_criteria: [],
              troubleshooting: [{ symptom: "访问索引 2 时出错", likely_cause: "没有检查列表边界", recovery_steps: ["先检查范围"], verification: "重新运行样例", citations }],
              extension_task: {
                task: "改用另一组数据",
                changed_dimension: "输入",
                verification: "核验总和",
                citations,
              },
            },
          },
        },
        {
          artifact_id: "assessment1",
          payload: {
            title: "测评",
            items: [
              {
                item_id: "Q1",
                display_no: 1,
                tier: 3,
                modality: "trace",
                prompt: "跟踪循环输出",
                max_score: 40,
                citations,
              },
            ],
          },
        },
      ],
    } as any
    const views = competitionArtifactViews(release)
    expect(views[1]!.content).toContain("累加奇数位置元素")
    expect(views[1]!.content).toContain("观察每次累加")
    expect(views[1]!.content).toContain("{{gap:init}}")
    expect(views[2]!.content).not.toContain("Tier")
    const claims = extractCompetitionClaimCandidates(release)
    const symptom = claims.find(c => c.text === "访问索引 2 时出错")!
    expect(symptom.surface).toBe("guide-troubleshooting-0")
    expect(symptom.local_context).toContain('"kind":"troubleshooting"')
    expect(symptom.local_context).toContain("没有检查列表边界")
    expect(claims.find(c => c.surface === "public_test")!.local_context).toContain('"args":[[1,2],3]')
    expect(claims.find(c => c.surface === "public_test")!.local_context).toContain("task_kind=debugging_repair")
    expect(claims.find(c => c.surface === "public_test")!.local_context).toContain("累加奇数位置元素")
    expect(claims.some((c) => c.text.includes("累加奇数位置元素"))).toBe(true)
    expect(
      claims.some(
        (c) =>
          c.text.includes("观察每次累加") && c.citations[0]?.fact_id === "F001",
      ),
    ).toBe(true)
    const changedIds = structuredClone(release)
    changedIds.artifacts.forEach((a: any) => {
      a.artifact_id += "-new"
    })
    const pairCases = COMPETITION_CASES_V2.filter(
      (c) => c.counterfactual_group_id === "CF-K002",
    )
    const pair = compareCounterfactualsV2([
      {
        case_id: pairCases[0]!.case_id,
        repeat_index: 1,
        public_release: release,
      },
      {
        case_id: pairCases[1]!.case_id,
        repeat_index: 1,
        public_release: changedIds,
      },
    ]).find((p) => p.group_id === "CF-K002")!
    expect(pair.controlled).toBe(false)
    expect(pair.pairs[0]!.visible_content_identical).toBe(true)
  })
  test("usage reports expose counts without input content or credentials", () => {
    const result = summarizeModelUsageV2([
      {
        task: "author",
        total_ms: 5,
        total_tokens: 42,
        request: "private-input",
        api_key: "private-key",
      },
    ])
    expect(result.total_tokens).toBe(42)
    expect(JSON.stringify(result)).not.toContain("private-")
  })
  test("controlled expression pair holds every non-discipline field constant", async () => {
    const pair = await prepareControlledPairV2("CF-K002", kb, manifest)
    const a = structuredClone(pair.prepared.profile),
      b = structuredClone(pair.alternate_profile)
    expect(a.background_context.discipline_background).not.toEqual(
      b.background_context.discipline_background,
    )
    a.background_context.discipline_background = []
    b.background_context.discipline_background = []
    expect(a).toEqual(b)
    expect(pair.prepared.artifactTaskContracts.assessment.behavior).toBe(
      "explain",
    )
  })
})
