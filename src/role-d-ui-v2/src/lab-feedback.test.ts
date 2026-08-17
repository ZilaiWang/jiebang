import { describe, expect, test } from "bun:test"
import {
  codeLabFailureLabel,
  codeSubmissionHint,
  labFeedbackExplanations,
  publicTestChecklist,
} from "./lab-feedback"

describe("lab-feedback：代码实验反馈解释层（方案 B'）", () => {
  test("失败码 → 中文标签", () => {
    expect(codeLabFailureLabel("assertion_failed")).toBe("断言未通过")
    expect(codeLabFailureLabel("syntax_error")).toBe("语法错误")
    expect(codeLabFailureLabel("execution_timeout")).toBe("运行超时")
    expect(codeLabFailureLabel("unknown_code")).toBe("未通过检查")
  })

  test("后端公开反馈条目 → 标签 + 说明列表", () => {
    const explanations = labFeedbackExplanations([
      { code: "assertion_failed", message: "代码已运行，但部分检查结果不符合要求。" },
      { code: "syntax_error", message: "代码存在语法错误。" },
    ])
    expect(explanations).toHaveLength(2)
    expect(explanations[0]).toEqual({
      code: "assertion_failed",
      label: "断言未通过",
      message: "代码已运行，但部分检查结果不符合要求。",
    })
    expect(explanations[1]!.label).toBe("语法错误")
  })

  test("空/无反馈 → 空列表，不抛错", () => {
    expect(labFeedbackExplanations(undefined)).toEqual([])
    expect(labFeedbackExplanations(null)).toEqual([])
    expect(labFeedbackExplanations([])).toEqual([])
  })

  test("public_test 自查清单只透传公开字段", () => {
    const checklist = publicTestChecklist([
      { test_id: "T1", description: "基础输入", expected_behavior: "输出平均分" },
      { test_id: "T2", description: "边界输入", expected_behavior: "输出 0" },
    ])
    expect(checklist).toHaveLength(2)
    expect(checklist[0]!.expected_behavior).toBe("输出平均分")
    expect(publicTestChecklist(undefined)).toEqual([])
    expect(publicTestChecklist(null)).toEqual([])
  })

  test("编辑器提示与公开 execution_mode 一致", () => {
    expect(codeSubmissionHint("function")).toContain("完整函数定义")
    expect(codeSubmissionHint("stdin_stdout")).toContain("标准输入")
    expect(codeSubmissionHint()).toBe("请按题目公开要求提交完整代码。")
  })
})
