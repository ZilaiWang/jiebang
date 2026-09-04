import { describe, expect, test } from "bun:test"
import {
  auditResourceFit,
  buildResourceFitReport,
} from "../src/role-c-content/review/resource-fit-audit"
import type { ResourceDifficultyPlanEntry } from "../src/role-c-content/planning/resource-blueprint"

const TARGET_BASIC: ResourceDifficultyPlanEntry = {
  challenge_target: {
    domain_complexity: 2, cognitive_demand: 2, reasoning_steps: 2,
    code_complexity: 1, prerequisite_load: 1,
  },
  support_target: {
    scaffold_strength: 3, reading_density: "low", hint_strength: 3, starter_support: 1,
  },
}

const TARGET_ASSESSMENT: ResourceDifficultyPlanEntry = {
  challenge_target: {
    domain_complexity: 2, cognitive_demand: 2, reasoning_steps: 2,
    code_complexity: 1, prerequisite_load: 1,
  },
  support_target: {
    scaffold_strength: 0, reading_density: "high", hint_strength: 0, starter_support: 0,
  },
}

describe("resource-fit-audit：生成后实际难度估计与匹配判定", () => {
  test("讲义：observed 由结构特征估计，fit 判定与 target 对比", () => {
    const entry = auditResourceFit({
      artifact_id: "lesson-1",
      kind: "concept_lesson",
      target: TARGET_BASIC,
      payload: {
        title: "变量", objective_ids: ["O1"],
        prerequisite_bridge: [{ block_id: "b1", block_type: "paragraph", text: "先修", citations: [] }],
        explanation_blocks: [
          { block_id: "b2", block_type: "paragraph", text: "概念", citations: [] },
          { block_id: "b3", block_type: "code", language: "python", code: "x = 1", caption: "", citations: [] },
        ],
        worked_examples: [{ block_id: "w1", block_type: "code", language: "python", code: "y = x + 1", caption: "", citations: [] }],
        misconceptions: [{ misconception_tag: "m1", explanation: "e", objective_id: "O1", citations: [] }],
        micro_checks: [{ block_id: "q1", block_type: "quiz", item_id: "i1", prompt: "p", citations: [] }],
        hint_ladders: [{ objective_id: "O1", hints: [{ hint_level: 1, text: "h", citations: [] }, { hint_level: 2, text: "h2", citations: [] }] }],
        summary: [{ block_id: "s1", block_type: "paragraph", text: "总结", citations: [] }],
        objective_coverage: [], used_evidence: [],
      } as never,
    })
    expect(entry.kind).toBe("concept_lesson")
    expect(entry.observed.confidence).toBeGreaterThan(0.5)
    // 有 code 块 → code_complexity > 0
    expect(entry.observed.challenge.code_complexity).toBeGreaterThan(0)
    // 有 hint → 支持侧 > 0
    expect(entry.observed.support.scaffold_strength).toBeGreaterThan(0)
    // verdict 只能是合法值之一
    expect(["fit", "too_easy", "too_hard", "uncertain"]).toContain(entry.fit.verdict)
  })

  test("多个简单示例属于脚手架，不会被累加成高代码复杂度和远迁移", () => {
    const entry = auditResourceFit({
      artifact_id: "lesson-guided-examples",
      kind: "concept_lesson",
      target: {
        challenge_target: {
          domain_complexity: 1, cognitive_demand: 1, reasoning_steps: 1,
          code_complexity: 0, prerequisite_load: 0, transfer_distance: 0,
          boundary_condition_density: 0, task_composition: 0,
        },
        support_target: {
          scaffold_strength: 4, reading_density: "low", hint_strength: 4, starter_support: 0,
        },
      },
      payload: {
        title: "认识 Python", objective_ids: ["O1"], prerequisite_bridge: [],
        explanation_blocks: [{ block_id: "e", block_type: "paragraph", text: "直接解释核心事实。", citations: [] }],
        worked_examples: [1, 2, 3].map((index) => ({
          block_id: `w${index}`, block_type: "code", language: "python",
          code: `print(\"示例 ${index}\")`, caption: `示例 ${index}`, citations: [],
        })).concat([{
          block_id: "trace", block_type: "paragraph",
          text: "1. 编写代码\n2. 解释器接收代码\n3. 产生输出", citations: [],
        }] as never),
        misconceptions: [{ misconception_tag: "m", explanation: "辨析一个常见误区", objective_id: "O1", citations: [] }],
        micro_checks: [{ block_id: "q", block_type: "quiz", item_id: "i", prompt: "判断", citations: [] }],
        hint_ladders: [{ objective_id: "O1", hints: [1, 2, 3].map((level) => ({ hint_level: level, text: `提示 ${level}`, citations: [] })) }],
        summary: [{ block_id: "s", block_type: "paragraph", text: "总结", citations: [] }],
        objective_coverage: [], used_evidence: [],
      } as never,
    })

    expect(entry.observed.challenge.reasoning_steps).toBe(1)
    expect(entry.observed.challenge.code_complexity).toBeLessThanOrEqual(1)
    expect(entry.observed.challenge.transfer_distance).toBe(0)
    expect(entry.fit.score).toBeGreaterThanOrEqual(0.85)
    expect(entry.fit.verdict).toBe("fit")
  })

  test("测评：挑战高（tier3+code 题）时判 too_hard；支架应为 0", () => {
    const entry = auditResourceFit({
      artifact_id: "assess-1",
      kind: "assessment",
      target: TARGET_ASSESSMENT,
      payload: {
        form_id: "f1", title: "t", objective_ids: ["O1"],
        items: Array.from({ length: 6 }, (_, i) => ({
          item_id: `item-${i}`, family_id: "fam", variant_id: "v", display_no: i + 1,
          objective_id: "O1", tier: (3 as 1 | 2 | 3), modality: ("code" as const),
          prompt: `写出实现 ${i}`, max_score: 10, citations: [],
          structure_meta: { operation: "compose", reasoning_pattern: "multi_step", representation: "code", context_family: "score", answer_form: "code" },
        })),
        submission_policy: { max_attempts: 1, formative: false },
        routing: { anchor_item_ids: [], rules: [] },
        objective_coverage: [], used_evidence: [],
      } as never,
    })
    expect(entry.observed.support.scaffold_strength).toBe(0)
    expect(entry.fit.verdict).toBe("too_hard")
  })

  test("整卷情境多样性不累计为单题迁移负荷", () => {
    const entry = auditResourceFit({
      artifact_id: "assess-varied-contexts",
      kind: "assessment",
      target: {
        ...TARGET_ASSESSMENT,
        challenge_target: {
          ...TARGET_ASSESSMENT.challenge_target,
          cognitive_demand: 3,
          transfer_distance: 2,
        },
      },
      payload: {
        form_id: "f-varied", title: "t", objective_ids: ["O1"],
        items: [1, 2, 3, 4, 5].map((displayNo) => ({
          item_id: `item-${displayNo}`, family_id: "fam", variant_id: "v",
          display_no: displayNo, objective_id: "O1",
          tier: displayNo === 5 ? 3 : displayNo > 2 ? 2 : 1,
          modality: "mcq", prompt: `题目 ${displayNo}`, max_score: 10,
          citations: [],
          structure_meta: {
            operation: "recognize_fact", reasoning_pattern: "direct_identification",
            representation: "text", context_family: `context-${displayNo}`,
            answer_form: "single_choice",
          },
        })),
        submission_policy: { max_attempts: 1, formative: false },
        routing: { anchor_item_ids: [], rules: [] },
        objective_coverage: [], used_evidence: [],
      } as never,
    })
    expect(entry.observed.challenge.transfer_distance).toBe(1)
    expect(entry.fit.mismatched_dimensions).not.toContain("transfer_distance")
  })

  test("相同 Tier 规划下，直接识别题与构造题产生不同的实际认知观测", () => {
    const payload = (prompt: string, modality: "mcq" | "code", operation: string) => ({
      form_id: `f-${operation}`, title: "t", objective_ids: ["O1"],
      items: [{
        item_id: `item-${operation}`, family_id: "fam", variant_id: "v",
        display_no: 1, objective_id: "O1", tier: 2 as const, modality,
        prompt, max_score: 10, citations: [],
        structure_meta: {
          operation,
          reasoning_pattern: operation === "construct_solution" ? "multi_step" : "direct_identification",
          representation: modality === "code" ? "code" : "text",
          context_family: "direct",
          answer_form: modality === "code" ? "code" : "single_choice",
        },
      }],
      submission_policy: { max_attempts: 1, formative: false },
      routing: { anchor_item_ids: [], rules: [] },
      objective_coverage: [], used_evidence: [],
    })
    const direct = auditResourceFit({
      artifact_id: "direct", kind: "assessment", target: TARGET_ASSESSMENT,
      payload: payload("直接识别正确事实", "mcq", "recognize_fact") as never,
    })
    const construction = auditResourceFit({
      artifact_id: "construction", kind: "assessment", target: TARGET_ASSESSMENT,
      payload: payload("编写代码完成程序", "code", "construct_solution") as never,
    })
    expect(construction.observed.challenge.cognitive_demand)
      .toBeGreaterThan(direct.observed.challenge.cognitive_demand)
    expect(construction.observed.challenge.reasoning_steps)
      .toBeGreaterThan(direct.observed.challenge.reasoning_steps)
  })

  test("题干提到‘编写脚本’不会把识别题误判成代码构造题", () => {
    const entry = auditResourceFit({
      artifact_id: "recognize-python",
      kind: "assessment",
      target: TARGET_ASSESSMENT,
      payload: {
        form_id: "f", title: "t", objective_ids: ["O1"],
        items: [{
          item_id: "i", family_id: "fam", variant_id: "v", display_no: 1,
          objective_id: "O1", tier: 3, modality: "mcq", max_score: 4,
          prompt: "Python 适合编写脚本。以下判断哪项正确？", citations: [],
          structure_meta: {
            operation: "recognize_fact",
            reasoning_pattern: "single_direct_match",
            representation: "declarative_statement",
            context_family: "direct",
            answer_form: "single_choice",
          },
        }],
        submission_policy: { max_attempts: 1, formative: false },
        routing: { anchor_item_ids: [], rules: [] },
        objective_coverage: [], used_evidence: [],
      } as never,
    })
    expect(entry.observed.challenge.cognitive_demand).toBe(1)
    expect(entry.observed.challenge.reasoning_steps).toBe(1)
  })

  test("整卷观测按题目分值加权，不由单道高阶题最大值代表", () => {
    const items = [1, 2, 3, 4, 5].map((displayNo) => ({
      item_id: `i${displayNo}`, family_id: "fam", variant_id: "v", display_no: displayNo,
      objective_id: "O1", tier: displayNo === 5 ? 3 as const : 1 as const,
      modality: "mcq" as const, max_score: displayNo === 5 ? 4 : 1,
      prompt: "判断事实", citations: [],
      structure_meta: displayNo === 5
        ? { operation: "recognize_fact", reasoning_pattern: "integrate_multiple_constraints", representation: "text", context_family: "direct", answer_form: "single_choice" }
        : { operation: "recognize_fact", reasoning_pattern: "single_direct_match", representation: "text", context_family: "direct", answer_form: "single_choice" },
    }))
    const entry = auditResourceFit({
      artifact_id: "weighted-assessment", kind: "assessment", target: TARGET_ASSESSMENT,
      payload: {
        form_id: "f", title: "t", objective_ids: ["O1"], items,
        submission_policy: { max_attempts: 1, formative: false },
        routing: { anchor_item_ids: [], rules: [] }, objective_coverage: [], used_evidence: [],
      } as never,
    })
    expect(entry.observed.challenge.reasoning_steps).toBe(2)
    expect(entry.observed.challenge.reasoning_steps).toBeLessThan(3)
  })

  test("支持明显不足时按具体维度判偏难，不再被挑战侧最大值掩盖", () => {
    const entry = auditResourceFit({
      artifact_id: "lesson-under-supported",
      kind: "concept_lesson",
      target: {
        ...TARGET_BASIC,
        support_target: { scaffold_strength: 5, reading_density: "low", hint_strength: 5, starter_support: 0 },
      },
      payload: {
        title: "x", objective_ids: ["O1"], prerequisite_bridge: [], explanation_blocks: [],
        worked_examples: [], misconceptions: [], micro_checks: [], hint_ladders: [], summary: [],
        objective_coverage: [], used_evidence: [],
      } as never,
    })
    expect(entry.fit.verdict).not.toBe("fit")
    expect(entry.fit.mismatched_dimensions).toContain("scaffold_strength")
    expect(entry.fit.mismatched_dimensions).not.toContain("hint_strength")
    expect(entry.fit.dimensions.find((item) => item.name === "hint_strength")?.applicable).toBe(false)
  })

  test("代码实验：按需三级提示和注释不会被重复算成已给予的强支架", () => {
    const entry = auditResourceFit({
      artifact_id: "lab-progressive-hints",
      kind: "code_lab",
      target: {
        challenge_target: {
          domain_complexity: 1.5, cognitive_demand: 1.5, reasoning_steps: 2,
          code_complexity: 2, prerequisite_load: 0, transfer_distance: 0.5,
          boundary_condition_density: 0, task_composition: 0,
        },
        support_target: {
          scaffold_strength: 2, reading_density: "medium", hint_strength: 2, starter_support: 2,
        },
      },
      payload: {
        lab_id: "lab", title: "遍历列表", objective_ids: ["O1"],
        instructions: [{ block_id: "i", block_type: "paragraph", text: "遍历并输出。", citations: [] }],
        execution_contract: {},
        starter_code: "# 已给出任务数据\nrecords = [1, 2, 3]\n# TODO: 编写循环\n# 输出当前元素",
        public_tests: [{ test_id: "t", description: "输出三个元素", input: "" }],
        hint_ladders: [{ objective_id: "O1", hints: [
          { hint_level: 1, text: "先确定遍历对象。", citations: [] },
          { hint_level: 2, text: "循环变量依次绑定元素。", citations: [] },
          { hint_level: 3, text: "在循环体输出当前元素。", citations: [] },
        ] }],
        reflection_questions: ["循环变量如何变化？"], objective_coverage: [], used_evidence: [],
      } as never,
    })
    expect(entry.observed.support.starter_support).toBeLessThanOrEqual(2)
    expect(entry.fit.dimensions.find((item) => item.name === "hint_strength")?.applicable).toBe(false)
    expect(entry.fit.mismatched_dimensions).not.toContain("hint_strength")
    expect(entry.fit.mismatched_dimensions).not.toContain("reading_density")
    expect(entry.fit.score).toBeGreaterThanOrEqual(0.85)
  })

  test("测评：不适用的提示与支架差异不改变 fit verdict", () => {
    const entry = auditResourceFit({
      artifact_id: "assessment-no-support",
      kind: "assessment",
      target: {
        challenge_target: {
          domain_complexity: 1.5, cognitive_demand: 1, reasoning_steps: 1,
          code_complexity: 0, prerequisite_load: 0, transfer_distance: 0,
          boundary_condition_density: 0, task_composition: 0,
        },
        support_target: {
          scaffold_strength: 5, reading_density: "high", hint_strength: 5, starter_support: 5,
        },
      },
      payload: {
        form_id: "f", title: "直接识别", objective_ids: ["O1"],
        items: [{
          item_id: "i", family_id: "fam", variant_id: "v", display_no: 1,
          objective_id: "O1", tier: 1, modality: "mcq", prompt: "识别事实", max_score: 1,
          citations: [], structure_meta: {
            operation: "recognize_fact", reasoning_pattern: "single_direct_match",
            representation: "text", context_family: "direct", answer_form: "single_choice",
          },
        }],
        submission_policy: { max_attempts: 1, formative: false },
        routing: { anchor_item_ids: [], rules: [] }, objective_coverage: [], used_evidence: [],
      } as never,
    })
    expect(entry.fit.verdict).toBe("fit")
    expect(entry.fit.mismatched_dimensions).not.toContain("scaffold_strength")
    expect(entry.fit.mismatched_dimensions).not.toContain("hint_strength")
  })

  test("buildResourceFitReport 聚合 overall verdict 与 score", () => {
    const entries = [
      auditResourceFit({
        artifact_id: "a1", kind: "concept_lesson", target: TARGET_BASIC,
        payload: { title: "x", objective_ids: [], prerequisite_bridge: [], explanation_blocks: [], worked_examples: [], misconceptions: [], micro_checks: [], hint_ladders: [], summary: [], objective_coverage: [], used_evidence: [] } as never,
      }),
      auditResourceFit({
        artifact_id: "a2", kind: "code_lab", target: TARGET_BASIC,
        payload: { lab_id: "l", title: "x", objective_ids: [], instructions: [], execution_contract: {}, starter_code: "", public_tests: [], hint_ladders: [], reflection_questions: [], objective_coverage: [], used_evidence: [] } as never,
      }),
      auditResourceFit({
        artifact_id: "a3", kind: "assessment", target: TARGET_ASSESSMENT,
        payload: { form_id: "f", title: "x", objective_ids: [], items: [], submission_policy: { max_attempts: 1, formative: false }, routing: { anchor_item_ids: [], rules: [] }, objective_coverage: [], used_evidence: [] } as never,
      }),
    ]
    const report = buildResourceFitReport({
      run_id: "R1", spec_id: "S1",
      profile_ref: { profile_id: "p1", profile_version: "v1", profile_content_hash: "h1" },
      entries,
    })
    expect(report.resources).toHaveLength(3)
    expect(report.overall.score).toBeGreaterThanOrEqual(0)
    expect(report.overall.score).toBeLessThanOrEqual(1)
    expect(["fit", "too_easy", "too_hard", "uncertain"]).toContain(report.overall.verdict)
  })
})

describe("resource_fit 进入 reviewed_release_delivery schema", () => {
  test("合法 ResourceFitReport 通过 outbound schema 校验", () => {
    const { validateRoleCSchemaFragment } = require("../src/role-c-content/validators/runtime-schema-validator") as typeof import("../src/role-c-content/validators/runtime-schema-validator")
    const report = {
      schema_version: "1.0",
      run_id: "R1",
      spec_id: "S1",
      profile_ref: { profile_id: "p1", profile_version: "v1", profile_content_hash: "h1" },
      policy_version: "resource-fit-v2",
      resources: ["concept_lesson", "code_lab", "assessment"].map((kind, index) => ({
        artifact_id: `a${index + 1}`,
        kind,
        target: {
          challenge: { domain_complexity: 2, cognitive_demand: 2, reasoning_steps: 2, code_complexity: 1, prerequisite_load: 1 },
          support: { scaffold_strength: 3, reading_density: "low", hint_strength: 3, starter_support: 1 },
        },
        observed: {
          challenge: { domain_complexity: 2, cognitive_demand: 2, reasoning_steps: 2, code_complexity: 1, prerequisite_load: 1 },
          support: { scaffold_strength: 2, reading_density: "low", hint_strength: 2, starter_support: 0 },
          confidence: 0.85,
        },
        fit: { verdict: "fit", score: 1, mismatched_dimensions: [], reason_codes: [], dimensions: [] },
      })),
      overall: {
        verdict: "fit",
        score: 1,
        aggregation: {
          policy: "bottleneck_cap",
          weighted_mean: 1,
          weakest_kind: "assessment",
          weakest_score: 1,
          bottleneck_margin: 0.08,
          final_score: 1,
        },
      },
    }
    const result = validateRoleCSchemaFragment(
      "reviewed_release_delivery.schema.json",
      "/properties/resource_fit",
      report,
    )
    expect(result.ok).toBe(true)
    expect(result.issues).toEqual([])
  })

  test("verdict 非法值时 resource_fit schema 拒绝", () => {
    const { validateRoleCSchemaFragment } = require("../src/role-c-content/validators/runtime-schema-validator") as typeof import("../src/role-c-content/validators/runtime-schema-validator")
    const result = validateRoleCSchemaFragment(
      "reviewed_release_delivery.schema.json",
      "/properties/resource_fit",
      {
        schema_version: "1.0", run_id: "R1", spec_id: "S1",
        profile_ref: { profile_id: "p1", profile_version: "v1", profile_content_hash: "h1" },
        policy_version: "v1", resources: [],
        overall: { verdict: "totally_wrong", score: 1 },
      },
    )
    expect(result.ok).toBe(false)
  })

  test("越界分数和未知字段不会穿过公开合同", () => {
    const { validateRoleCSchemaFragment } = require("../src/role-c-content/validators/runtime-schema-validator") as typeof import("../src/role-c-content/validators/runtime-schema-validator")
    const result = validateRoleCSchemaFragment(
      "reviewed_release_delivery.schema.json",
      "/properties/resource_fit",
      {
        schema_version: "1.0", run_id: "R1", spec_id: "S1",
        profile_ref: { profile_id: "p1", profile_version: "v1", profile_content_hash: "h1", leaked_level: "beginner" },
        policy_version: "v1", resources: [],
        overall: { verdict: "fit", score: 1.2 },
      },
    )
    expect(result.ok).toBe(false)
  })
})
