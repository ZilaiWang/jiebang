import { describe, expect, test } from "bun:test"
import {
  assessmentPublicAuthorOutputSchema,
  buildAssessmentNoveltyDesignBrief,
} from "../src/role-c-content/providers/model-backed-provider"
import type {
  AssessmentItemPlan,
} from "../src/role-c-content/providers/staged-generation"

const plan: AssessmentItemPlan[] = [{
  item_id: "ITEM-1",
  family_id: "FAMILY-1",
  variant_id: "VARIANT-1",
  display_no: 1,
  objective_id: "OBJ-K001",
  observation_key: "OBS-K001-RECOGNIZE",
  tier: 1,
  modality: "mcq",
  max_score: 1,
  citations: [],
  cognitive_operation: "recognize_fact",
  context_strategy: { kind: "neutral_context" },
}]

describe("assessment novelty design brief", () => {
  test("只向每道题提供同目标同题型的相关历史", () => {
    const brief = buildAssessmentNoveltyDesignBrief(plan, [
      {
        form_id: "FORM-1",
        item_id: "OLD-1",
        objective_id: "OBJ-K001",
        modality: "mcq",
        prompt: "旧选择题",
        options: ["A", "B"],
        structure_meta: {
          operation: "识别事实",
          reasoning_pattern: "直接回忆",
          representation: "文字描述",
          context_family: "语言类型",
          answer_form: "单选",
        },
      },
      {
        form_id: "FORM-1",
        item_id: "OLD-2",
        objective_id: "OBJ-K001",
        modality: "true_false",
        prompt: "旧判断题",
        options: ["正确", "错误"],
      },
      {
        form_id: "FORM-1",
        item_id: "OLD-3",
        objective_id: "OBJ-K002",
        modality: "mcq",
        prompt: "其他目标",
        options: ["A", "B"],
      },
    ])

    expect(brief.history_count).toBe(3)
    expect(brief.items[0]?.forbidden_history).toHaveLength(1)
    expect(brief.items[0]?.forbidden_history[0]?.prompt).toBe("旧选择题")
    expect(brief.items[0]?.planned_cognitive_operation).toBe("recognize_fact")
    expect(brief.items[0]?.in_form_role).toBe("direct_foundation")
  })

  test("轮次和题号共同轮换需要变化的语义维度", () => {
    const twoItems = [plan[0]!, { ...plan[0]!, item_id: "ITEM-2", display_no: 2 }]
    const brief = buildAssessmentNoveltyDesignBrief(twoItems, [])
    expect(brief.items.map((item) => item.variation_axis)).toEqual([
      "operation",
      "reasoning_pattern",
    ])
  })

  test("题目在同一张卷内具有清晰且递进的职责", () => {
    const tieredPlan = [
      plan[0]!,
      { ...plan[0]!, item_id: "ITEM-2", display_no: 2, tier: 2 as const },
      { ...plan[0]!, item_id: "ITEM-3", display_no: 3, tier: 3 as const },
    ]
    expect(buildAssessmentNoveltyDesignBrief(tieredPlan, []).items.map((item) => item.in_form_role)).toEqual([
      "direct_foundation",
      "guided_application",
      "integrated_transfer",
    ])
  })

  test("同目标同题型在一张五题卷内不会因任务形状目录过短而回绕", () => {
    const shortAnswers = Array.from({ length: 5 }, (_, index) => ({
      ...plan[0]!,
      item_id: `ITEM-${index + 1}`,
      display_no: index + 1,
      modality: "short_answer" as const,
    }))
    const shapes = buildAssessmentNoveltyDesignBrief(shortAnswers, []).items
      .map((item) => item.planned_task_shape)
    expect(new Set(shapes).size).toBe(5)
  })

  test("同一目标同一题型跨轮继续轮换任务结构，不把固定题号写成固定题型模板", () => {
    const history = Array.from({ length: 3 }, (_, index) => ({
      form_id: `FORM-${index}`,
      item_id: `OLD-${index}`,
      objective_id: "OBJ-K001",
      modality: "mcq" as const,
      prompt: `历史题 ${index}`,
      options: ["A", "B"],
    }))
    const first = buildAssessmentNoveltyDesignBrief(plan, []).items[0]!
    const next = buildAssessmentNoveltyDesignBrief(plan, history).items[0]!
    expect(next.planned_task_shape).not.toBe(first.planned_task_shape)
    expect(next.planned_task_shape).toBe("identify_supported_relation")
  })

  test("选择题任务结构全部保持正向问法，不规划选择否定项或绝对范围", () => {
    const shapes = Array.from({ length: 4 }, (_, round) =>
      buildAssessmentNoveltyDesignBrief(plan, Array.from({ length: round }, (_, index) => ({
        form_id: `FORM-${index}`,
        item_id: `OLD-${index}`,
        objective_id: "OBJ-K001",
        modality: "mcq" as const,
        prompt: `历史题 ${index}`,
        options: ["A", "B"],
      }))).items[0]!.planned_task_shape)
    expect(shapes).toEqual([
      "select_one_supported_statement",
      "choose_best_fact_summary",
      "match_subject_to_supported_description",
      "identify_supported_relation",
    ])
  })

  test("单事实识别题的模型 Schema 与提示一致，只允许两个有证据的选项", () => {
    const schema = assessmentPublicAuthorOutputSchema([{
      ...plan[0]!,
      citations: [{ source_id: "K001", fact_id: "F001", relation: "supports" }],
    }]) as any
    const optionArray = schema.properties.items.items.properties.options.oneOf
      .find((entry: any) => entry.type === "array")
    expect(optionArray.minItems).toBe(2)
    expect(optionArray.maxItems).toBe(2)
  })
})
