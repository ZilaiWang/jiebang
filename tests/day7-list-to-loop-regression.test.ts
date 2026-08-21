import { describe, expect, test } from "bun:test"
import { validateAssessmentNovelty } from "../src/role-c-content/providers/staged-generation"
import { planAssessmentCapacity } from "../src/role-c-content/planning/assessment-capacity"
import { buildDifficultyPlan } from "../src/role-c-content/planning/resource-blueprint"
import { auditResourceFit, buildResourceFitReport } from "../src/role-c-content/review/resource-fit-audit"

/**
 * Day7 核心回归：队友发现的「列表 → 循环共享前置知识点」E2E 场景。
 * 验收（对应《改进方案3》第二十四节 7 条）：
 *   1. 原题不能重新出现；
 *   2. 允许重新测量同一个基础能力（纵向复测）；
 *   3. 新题必须有真正的结构变化（同 observation 最近窗口）；
 *   4. 事实不足时少出题而不是 blocked；
 *   5. 三类资源各返回 target/observed/fit；
 *   6. resource_fit 可聚合为可复现的报告；
 *   7. 换 profile（level）后 resource target 发生可解释变化。
 */

const META_TRAVERSE = {
  operation: "traverse", reasoning_pattern: "single_step",
  representation: "code", context_family: "list", answer_form: "mcq",
}

function histItem(objectiveId: string, prompt: string, meta?: typeof META_TRAVERSE) {
  return {
    form_id: `FORM-${objectiveId}`, item_id: `ITEM-${objectiveId}-${prompt.length}`,
    objective_id: objectiveId, observation_key: objectiveId,
    modality: "mcq" as const, prompt, options: ["a", "b"],
    ...(meta ? { structure_meta: meta } : {}),
  }
}

function assessmentItem(objectiveId: string, prompt: string, meta?: typeof META_TRAVERSE) {
  return {
    item_id: `NEW-${objectiveId}-${prompt.length}`, display_no: 1, family_id: "F", variant_id: "V",
    objective_id: objectiveId, tier: 1 as const, modality: "mcq" as const, max_score: 1,
    prompt, options: [{ option_id: "a", label: "A", text: "x" }, { option_id: "b", label: "B", text: "y" }],
    citations: [], ...(meta ? { structure_meta: meta } : {}),
  }
}

describe("Day7 回归：列表 → 循环共享前置知识点", () => {
  test("1+2：原题不重现，但跨 observation 允许结构复用（纵向复测）", () => {
    // Task 1（列表）发布过 for 遍历结构的题（objective=O-LIST）
    const history = [histItem("O-LIST", "for 循环如何遍历列表？", META_TRAVERSE)]
    // Task 2（循环）测同一能力但 objective 不同（O-LOOP）→ 结构复用合法
    const crossObservation = validateAssessmentNovelty({
      items: [assessmentItem("O-LOOP", "for 循环如何遍历一个可迭代对象？", META_TRAVERSE)],
    }, history)
    expect(crossObservation).toEqual([])

    // 但原题题干完全重现 → 仍 hard（永久，不受 objective 影响）
    const verbatim = validateAssessmentNovelty({
      items: [assessmentItem("O-LOOP", "for 循环如何遍历列表？")],
    }, history)
    expect(verbatim.length).toBeGreaterThan(0)
  })

  test("3：同 observation 最近窗口内必须真正改变结构（换数字不行）", () => {
    // 同一 objective（O-LIST）最近发布过 traverse 结构
    const history = [histItem("O-LIST", "遍历列表输出每个元素", META_TRAVERSE)]
    // 同结构（traverse）换个说法 → 结构重复 hard
    const sameStructure = validateAssessmentNovelty({
      items: [assessmentItem("O-LIST", "请遍历 scores 列表并输出", META_TRAVERSE)],
    }, history)
    expect(sameStructure.length).toBeGreaterThan(0)

    // 换结构（aggregate 而非 traverse）→ 合法变式
    const changedStructure = validateAssessmentNovelty({
      items: [assessmentItem("O-LIST", "请计算 scores 列表的总和", { ...META_TRAVERSE, operation: "aggregate" })],
    }, history)
    expect(changedStructure).toEqual([])
  })

  test("4：事实不足时少出题（REDUCE），而不是 blocked", () => {
    const plan = planAssessmentCapacity({
      requested: { tier_1_count: 2, tier_2_count: 2, tier_3_count: 2, required_modalities: ["mcq", "code"] },
      objectives: [
        { objective_id: "O-LOOP", observable_behavior: "apply", importance: "core", available_facts: 1, used_structures: 5 },
        { objective_id: "O-LIST", observable_behavior: "recognize", importance: "core", available_facts: 1, used_structures: 5 },
      ],
    })
    expect(plan.decision).toBe("REDUCE")
    expect(plan.feasible_items).toBeLessThan(6)
    expect(plan.feasible_items).toBeGreaterThanOrEqual(2) // core 覆盖保留
    expect(plan.adjusted_blueprint).toBeDefined()
  })

  test("5+6：三类资源各返回 target/observed/fit，且可聚合为报告", () => {
    const difficultyPlan = buildDifficultyPlan({
      learner_adaptation: { level: "basic", scaffold_level: 2 },
      difficulty: {
        domain_complexity: 2, cognitive_demand: 2, reasoning_steps: 2, code_complexity: 1,
        prerequisite_load: 1, scaffold_strength: 2,
      },
    } as never)

    const concept = auditResourceFit({
      artifact_id: "lesson-1", kind: "concept_lesson", target: difficultyPlan.concept_lesson,
      payload: {
        title: "x", objective_ids: ["O1"], prerequisite_bridge: [], explanation_blocks: [], worked_examples: [],
        misconceptions: [], micro_checks: [], hint_ladders: [{ objective_id: "O1", hints: [{ hint_level: 1, text: "h", citations: [] }, { hint_level: 2, text: "h2", citations: [] }] }],
        summary: [], objective_coverage: [], used_evidence: [],
      } as never,
    })
    const lab = auditResourceFit({
      artifact_id: "lab-1", kind: "code_lab", target: difficultyPlan.code_lab,
      payload: { lab_id: "l", title: "x", objective_ids: ["O1"], instructions: [], execution_contract: {}, starter_code: "def f():\n    # TODO", public_tests: [], hint_ladders: [], reflection_questions: [], objective_coverage: [], used_evidence: [] } as never,
    })
    const assessment = auditResourceFit({
      artifact_id: "assess-1", kind: "assessment", target: difficultyPlan.assessment,
      payload: { form_id: "f", title: "x", objective_ids: ["O1"], items: [], submission_policy: { max_attempts: 1, formative: false }, routing: { anchor_item_ids: [], rules: [] }, objective_coverage: [], used_evidence: [] } as never,
    })

    for (const entry of [concept, lab, assessment]) {
      expect(entry.target.challenge).toBeDefined()
      expect(entry.target.support).toBeDefined()
      expect(entry.observed.challenge).toBeDefined()
      expect(entry.observed.support).toBeDefined()
      expect(["fit", "too_easy", "too_hard", "uncertain"]).toContain(entry.fit.verdict)
      expect(entry.fit.score).toBeGreaterThanOrEqual(0)
      expect(entry.fit.score).toBeLessThanOrEqual(1)
    }

    const report = buildResourceFitReport({
      run_id: "R1", spec_id: "S1",
      profile_ref: { profile_id: "p1", profile_version: "v1", profile_content_hash: "h1" },
      entries: [concept, lab, assessment],
    })
    expect(report.resources).toHaveLength(3)
    expect(report.overall.verdict).toBeDefined()
  })

  test("7：换 profile level 后 resource target 发生可解释变化", () => {
    const beginner = buildDifficultyPlan({
      learner_adaptation: { level: "beginner", scaffold_level: 3 },
      difficulty: { domain_complexity: 1, cognitive_demand: 1, reasoning_steps: 1, code_complexity: 0, prerequisite_load: 0, scaffold_strength: 3 },
    } as never)
    const integrated = buildDifficultyPlan({
      learner_adaptation: { level: "integrated", scaffold_level: 0 },
      difficulty: { domain_complexity: 4, cognitive_demand: 4, reasoning_steps: 4, code_complexity: 3, prerequisite_load: 3, scaffold_strength: 0 },
    } as never)
    // beginner 挑战更低、支架更强；integrated 挑战更高、支架更低
    expect(beginner.concept_lesson.challenge_target.reasoning_steps)
      .toBeLessThan(integrated.concept_lesson.challenge_target.reasoning_steps)
    expect(beginner.concept_lesson.support_target.scaffold_strength)
      .toBeGreaterThan(integrated.concept_lesson.support_target.scaffold_strength)
    // 测评始终低支架
    expect(beginner.assessment.support_target.scaffold_strength).toBe(0)
    expect(integrated.assessment.support_target.scaffold_strength).toBe(0)
  })
})
