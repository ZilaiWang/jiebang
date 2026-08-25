import { describe, expect, test } from "bun:test"
import { materializeConceptSegmentAuthorPayload } from "../src/role-c-content/providers/staged-generation"
import {
  claimTextMatchesFact,
  visibleTeachingTextExpressesFact,
} from "../src/role-c-content/validators/claim-grounding"

describe("concept lesson grounded materialization", () => {
  test("只对教学叙述允许有限语序重组，严格 Claim 仍不接受自由改写", () => {
    const fact = "Python 程序通常由解释器执行。"
    const teachingText = "写好 Python 程序后，它的运行通常离不开解释器。"
    expect(visibleTeachingTextExpressesFact(teachingText, fact)).toBe(true)
    expect(claimTextMatchesFact(teachingText, fact)).toBe(false)
    expect(visibleTeachingTextExpressesFact("今天开始学习 Python 基础知识。", fact)).toBe(false)
  })

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
    // 改进方案5：模型写的 misconception 通过定向校验后被保留，不再被统一 fallback 覆盖。
    expect(factualText).toContain("所有任务只能使用 Python")
    expect(factualText).toContain("‘通用编程语言’与给出的事实一致")
    expect(factualText).toContain("Python 是一种通用编程语言")
    expect(factualText).toContain("Python 程序通常由解释器执行")
    const explanation = lesson.explanation_blocks[0]
    expect(explanation && "claims" in explanation ? explanation.claims : []).toEqual([
      expect.objectContaining({ text: "Python 是一种通用编程语言。" }),
      expect.objectContaining({ text: "Python 程序通常由解释器执行。" }),
    ])
  })

  test("keeps a single-fact misconception inside the frozen evidence boundary", () => {
    const lesson = materializeConceptSegmentAuthorPayload({
      generation_spec: {
        spec_id: "SPEC-SPARSE",
        path_node: { goal: "Python 是什么" },
        targets: [{
          objective_id: "OBJ-K001",
          source_id: "K001",
          required_fact_ids: ["F001"],
        }],
      },
      evidence_pack: {
        results: [{
          source_id: "K001",
          facts: [{ source_id: "K001", fact_id: "F001", content: "Python 是一种通用编程语言。" }],
          examples: [],
        }],
      },
    } as never, {
      title: "Python 是什么",
      objectives: [{
        explanation: "认识 Python。",
        worked_example: "辨认这条定义。",
        misconception: "Python 只用于数据分析或网页开发。",
        micro_check_prompt: "哪项符合证据？",
        micro_check_options: ["Python 是通用编程语言", "Python 不是编程语言"],
        micro_check_answer: "Python 是通用编程语言",
        micro_check_explanation: "第一项与证据一致。",
        hints: ["查看事实", "核对定义", "选择一致项"],
        summary: "Python 是通用编程语言。",
      }],
    })

    // 改进方案5：单条事实不再触发固定模板覆盖，模型写的 explanation/worked_example/summary 被保留。
    expect(lesson.misconceptions[0]?.explanation).toContain("Python 只用于数据分析")
    expect(lesson.explanation_blocks[0] && "text" in lesson.explanation_blocks[0]
      ? lesson.explanation_blocks[0].text
      : "").toContain("认识 Python")
    expect(lesson.worked_examples[0] && "text" in lesson.worked_examples[0]
      ? lesson.worked_examples[0].text
      : "").toContain("辨认这条定义")
    // factual claims 仍然被程序冻结为事实原文。
    expect(lesson.summary[0] && "text" in lesson.summary[0]
      ? lesson.summary[0].text
      : "").toContain("Python 是通用编程语言")
  })
})
