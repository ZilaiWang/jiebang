/**
 * 代码实验运行反馈解释层（Day6 方案 B'）。
 *
 * 后端链路已脱敏：原始失败码（含 test_id / expected / actual）经
 * publicCodeLabFeedbackCodes 映射为纯类别码（assertion_failed 等），再经
 * codeLabFeedbackMessage 映射为中文 message。本模块只做前端展示增强：
 * 1) 失败码 → 中文标签（更细，如 "断言未通过"）；
 * 2) 失败时联动展示 public_tests 的 description + expected_behavior 自查清单。
 *
 * 安全约束：本模块绝不接触 hidden_tests / expected / actual；
 * 只消费后端已公开的 feedback 类别码与公开测试字段。
 */

export interface CodeLabFeedbackEntry {
  code: string
  message: string
}

export interface LabFeedbackExplanation {
  code: string
  label: string
  message: string
}

const FAILURE_LABELS: Record<string, string> = {
  assertion_failed: "断言未通过",
  syntax_error: "语法错误",
  runtime_error: "运行时错误",
  output_limit: "输出超限",
  non_json_output: "返回值不符合约定",
  forbidden_import: "使用了不允许的导入",
  forbidden_syntax: "使用了不允许的语法",
  resource_limit_exceeded: "超出运行资源限制",
  execution_timeout: "运行超时",
  execution_failed: "未通过全部检查",
}

export function codeLabFailureLabel(code: string): string {
  return FAILURE_LABELS[code] ?? "未通过检查"
}

/** 把后端公开反馈条目渲染为「标签 + 说明」列表；空输入返回空数组。 */
export function labFeedbackExplanations(
  feedback: CodeLabFeedbackEntry[] | undefined | null,
): LabFeedbackExplanation[] {
  if (!Array.isArray(feedback) || feedback.length === 0) return []
  return feedback.map((entry) => ({
    code: entry.code,
    label: codeLabFailureLabel(entry.code),
    message: entry.message ?? "",
  }))
}

export interface PublicTestChecklistItem {
  test_id: string
  description: string
  expected_behavior: string
}

/** 失败时生成公开测试自查清单（只用公开字段，帮助学习者对照期望行为）。 */
export function publicTestChecklist(
  tests: PublicTestChecklistItem[] | undefined | null,
): PublicTestChecklistItem[] {
  return Array.isArray(tests) ? tests : []
}

export function codeSubmissionHint(executionMode?: string): string {
  return executionMode === "function"
    ? "请提交完整函数定义（含 def 行），不要只贴函数体。"
    : executionMode === "stdin_stdout"
      ? "请提交完整程序，并按题目要求从标准输入读取、向标准输出写出结果。"
      : "请按题目公开要求提交完整代码。"
}
