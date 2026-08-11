import { EVALUATOR_AUTHOR_SYSTEM_PROMPT } from "./author-system.prompt"

export function evaluatorAuthorRepairPrompt(issues: string[]): string {
  const issueList = issues.map((issue, index) => `${index + 1}. ${issue}`).join("\n")
  return `${EVALUATOR_AUTHOR_SYSTEM_PROMPT}

上一次 Draft 未通过确定性结构/语义预检。只修复下列失败项，不改变已冻结的事实、答案语义和安全边界：
${issueList}

修复策略：
- 如涉及 hidden_test_expected_leak：不要改写公开提示文字，更换隐藏答案的选项分布或预期值，确保不在公开文字中出现
- 如涉及 hidden_answer_leak：重排选项顺序以改变正确选项位置，不改变题目语义
- 如涉及 reference_solution_leak：重写公开示例，不使用参考答案的同一逻辑`
}
