import { describe, expect, test } from "bun:test"

import {
  alignPracticalGuideWithGapTemplate,
  normalizePracticalGuideLearnerVocabulary,
  type CodeLabPublicAuthorPayload,
} from "../src/role-c-content/providers/staged-generation"
import type { PracticalGuideAuthorPayload } from "../src/role-c-content/planning/practical-guide-plan"

const guide: PracticalGuideAuthorPayload = {
  practice_goal: "填写事实文本并运行",
  deliverable: "一个已补全 TODO 的可运行程序",
  readiness_checks: [{ title: "定位", check: "找到 starter_code 中的 TODO", ready_when: "已找到" }],
  steps: [{
    title: "填写",
    action: "查看 starter_code 中带有 TODO 标记的赋值行",
    input: "无输入",
    expected_result: 'message = "Python 是一种通用编程语言。"',
    verification: "确认 print(message) 保持不变",
  }],
  troubleshooting: [{
    symptom: "输出不正确",
    likely_cause: "message = 的文本有误",
    recovery_steps: ["检查 print(message)"],
    verification: "重新运行",
  }],
  extension_task: { task: "更换文本", changed_dimension: "文本", verification: "重新运行" },
}

const task: NonNullable<CodeLabPublicAuthorPayload["programming_task"]> = {
  statement: "填写一段文本",
  input_description: "无输入",
  output_description: "输出文本",
  constraints: ["只填写一个字符串"],
  gap_template: {
    schema_version: "code-gap-template.v1",
    template_code: "fact_text = {{gap:fact_text}}\nprint(fact_text)\n",
    gaps: [{
      gap_id: "fact_text",
      label: "事实文本",
      kind: "expression",
      answer_format: "python_string_literal",
      max_chars: 100,
      max_lines: 1,
    }],
  },
}

describe("practical guide and executable gap alignment", () => {
  test("uses the template variable everywhere and removes invisible TODO wording", () => {
    const aligned = alignPracticalGuideWithGapTemplate(guide, task)
    const serialized = JSON.stringify(aligned)

    expect(serialized).not.toContain("message")
    expect(serialized).not.toContain("starter_code")
    expect(serialized).not.toContain("TODO")
    expect(aligned.steps[0]?.expected_result).toContain("fact_text =")
    expect(aligned.steps[0]?.verification).toContain("print(fact_text)")
    expect(aligned.steps[0]?.action).toContain("完整代码预览")
  })

  test("does not rewrite prose for tasks without exactly one gap", () => {
    const aligned = alignPracticalGuideWithGapTemplate(guide, undefined)
    expect(JSON.stringify(aligned)).not.toContain("starter_code")
    expect(JSON.stringify(aligned)).not.toContain("TODO")
    expect(aligned.readiness_checks[0]?.check).toContain("完整代码预览")
  })

  test("将所有实操指南内部字段统一投影为学习者界面用语", () => {
    const normalized = normalizePracticalGuideLearnerVocabulary({
      ...guide,
      deliverable: "阅读 starter 代码，运行 public_test 并核对 expected_behavior",
    })
    const serialized = JSON.stringify(normalized)
    expect(serialized).not.toMatch(/starter_code|expected_behavior|public_test|TODO/u)
    expect(serialized).not.toMatch(/\bstarter\b/u)
    expect(normalized.deliverable).toContain("程序骨架")
    expect(normalized.deliverable).toContain("公开样例")
    expect(normalized.deliverable).toContain("预期输出")
  })
})
