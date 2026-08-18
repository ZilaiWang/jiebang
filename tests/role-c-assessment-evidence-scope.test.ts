import { describe, expect, test } from "bun:test"
import {
  validateAssessmentPublicAuthorAgainstPlan,
  type AssessmentItemPlan,
  type AssessmentPublicAuthorPayload,
} from "../src/role-c-content/providers/staged-generation"

const plan: AssessmentItemPlan[] = [{
  item_id: "ITEM-1",
  family_id: "FAMILY-1",
  variant_id: "VARIANT-1",
  display_no: 1,
  objective_id: "OBJ-K001",
  tier: 2,
  modality: "short_answer",
  max_score: 2,
  citations: [{ source_id: "K001", fact_id: "F001", relation: "derived_from" }],
  cognitive_operation: "explain_reasoning",
  context_strategy: { kind: "neutral_context" },
}]

function payload(prompt: string): AssessmentPublicAuthorPayload {
  return {
    title: "Python 基础概念测评",
    items: [{
      prompt,
      options: null,
      starter_code: null,
      structure_meta: {
        operation: "explain_fact",
        reasoning_pattern: "direct_explanation",
        representation: "short_text",
        context_family: "language_definition",
        answer_form: "short_answer",
      },
    }],
  }
}

describe("Role C assessment evidence scope", () => {
  test("rejects asking for concrete manifestations beyond a cited definition", () => {
    const issues = validateAssessmentPublicAuthorAgainstPlan(
      payload("解释‘Python 是通用编程语言’的含义，并说明通用体现在哪些方面。"),
      plan,
    )
    expect(issues).toContain("items[0] 事实识别/解释题不得要求补充 evidence 未提供的例子、用途或具体体现")
  })

  test("allows a direct restatement of the cited definition", () => {
    expect(validateAssessmentPublicAuthorAgainstPlan(
      payload("请用自己的话复述：Python 是一种什么类型的编程语言？"),
      plan,
    )).toEqual([])
  })
})
