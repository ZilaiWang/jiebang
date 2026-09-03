import { describe, expect, test } from "bun:test"
import { buildAssessmentEvidenceAuthoringBoundaries } from "../src/role-c-content/quality/assessment-validity"

describe("assessment evidence authoring boundary", () => {
  test("将确定性校验使用的允许与禁止机制在首次命题前显式交给模型", () => {
    const [boundary] = buildAssessmentEvidenceAuthoringBoundaries([{
      item_id: "I1",
      citations: [
        { source_id: "K001", fact_id: "F002", relation: "derived_from" },
        { source_id: "K001", fact_id: "F004", relation: "derived_from" },
      ],
    } as any], [
      { source_id: "K001", fact_id: "F002", content: "Python 程序通常由解释器执行。" },
      { source_id: "K001", fact_id: "F004", content: "Python 用缩进表示代码块。" },
      { source_id: "K001", fact_id: "F005", content: "变量可以重新赋值。" },
    ])
    expect(boundary?.cited_fact_statements).toEqual([
      "Python 程序通常由解释器执行。",
      "Python 用缩进表示代码块。",
    ])
    expect(boundary?.allowed_mechanism_terms).toEqual(expect.arrayContaining([
      "解释器", "缩进", "代码块",
    ]))
    expect(boundary?.forbidden_mechanism_terms).toEqual(expect.arrayContaining([
      "编译器", "重新赋值",
    ]))
  })
})
