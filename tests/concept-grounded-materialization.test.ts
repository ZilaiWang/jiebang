import { describe, expect, test } from "bun:test"
import { materializeConceptSegmentAuthorPayload } from "../src/role-c-content/providers/staged-generation"

describe("concept lesson grounded materialization", () => {
  test("does not publish model-invented factual prose in factual lesson sections", () => {
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
        explanation: "某知名网站全部使用 Python。",
        worked_example: "编写一个大型网站。",
        misconception: "Python 在某行业占比 90%。",
        micro_check_prompt: "哪项符合证据？",
        micro_check_options: ["通用语言", "只是一种文档"],
        micro_check_answer: "通用语言",
        micro_check_explanation: "某公司已在生产环境大规模采用。",
        hints: ["查看第一条事实", "再看执行方式", "逐条核对"],
        summary: "某公司使用 Python。",
      }],
    })

    const factualText = JSON.stringify({
      explanation: lesson.explanation_blocks,
      examples: lesson.worked_examples,
      misconceptions: lesson.misconceptions,
      micro_checks: lesson.micro_checks,
      summary: lesson.summary,
    })
    expect(factualText).not.toContain("知名网站")
    expect(factualText).not.toContain("某行业")
    expect(factualText).not.toContain("某公司")
    expect(factualText).toContain("Python 是一种通用编程语言")
    expect(factualText).toContain("Python 程序通常由解释器执行")
    expect(factualText).toContain("基础示例")
  })
})
