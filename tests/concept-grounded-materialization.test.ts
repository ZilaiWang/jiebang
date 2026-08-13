import { describe, expect, test } from "bun:test"
import { materializeConceptSegmentAuthorPayload } from "../src/role-c-content/providers/staged-generation"

describe("concept lesson grounded materialization", () => {
  test("keeps authored teaching prose while freezing factual claims and citations", () => {
    const lesson = materializeConceptSegmentAuthorPayload({
      generation_spec: {
        spec_id: "SPEC-1",
        path_node: { goal: "Python 是什么" },
        targets: [{
          objective_id: "OBJ-K001",
          source_id: "K001",
          required_fact_ids: ["F001", "F002"],
        }],
      },
      evidence_pack: {
        results: [{
          source_id: "K001",
          facts: [
            { source_id: "K001", fact_id: "F001", content: "Python 是一种通用编程语言。" },
            { source_id: "K001", fact_id: "F002", content: "Python 程序通常由解释器执行。" },
          ],
          examples: [{ title: "基础示例", code: "print('Python')", explanation: "输出一段文本。" }],
        }],
      },
    } as never, {
      title: "Python 是什么",
      objectives: [{
        explanation: "可以把解释器想成逐条阅读指令的助手，再对照两条依据理解 Python。",
        worked_example: "先观察 print('Python')，再说明这条指令由解释器执行并输出文本。",
        misconception: "容易把‘通用’误解成‘所有任务只能使用 Python’；通用描述的是用途范围，不是排他性。",
        micro_check_prompt: "哪项符合证据？",
        micro_check_options: ["通用语言", "只是一种文档"],
        micro_check_answer: "通用语言",
        micro_check_explanation: "‘通用编程语言’与给出的事实一致，另一项把编程语言误说成了文档。",
        hints: ["查看第一条事实", "再看执行方式", "逐条核对"],
        summary: "记住两点：Python 是通用编程语言，程序通常由解释器执行。",
      }],
    })

    const factualText = JSON.stringify({
      explanation: lesson.explanation_blocks,
      examples: lesson.worked_examples,
      misconceptions: lesson.misconceptions,
      micro_checks: lesson.micro_checks,
      summary: lesson.summary,
    })
    expect(factualText).toContain("逐条阅读指令的助手")
    expect(factualText).toContain("容易把‘通用’误解")
    expect(factualText).toContain("‘通用编程语言’与给出的事实一致")
    expect(factualText).toContain("Python 是一种通用编程语言")
    expect(factualText).toContain("Python 程序通常由解释器执行")
    const explanation = lesson.explanation_blocks[0]
    expect(explanation && "claims" in explanation ? explanation.claims : []).toEqual([
      expect.objectContaining({ text: "Python 是一种通用编程语言。" }),
      expect.objectContaining({ text: "Python 程序通常由解释器执行。" }),
    ])
  })
})
