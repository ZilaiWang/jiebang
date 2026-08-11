import { CODE_LAB_SYSTEM_PROMPT } from "./system.prompt"

export function codeLabRepairPrompt(issues: string[]): string {
  const issueList = issues.map((issue, index) => `${index + 1}. ${issue}`).join("\n")
  return `${CODE_LAB_SYSTEM_PROMPT}

上一次 Draft 未通过确定性结构/语义预检。只修复下列失败项，不扩大知识和权限范围：
${issueList}

修复策略：
- 如涉及 hidden_test_expected_leak：不要改写公开提示文字，而是更换隐藏测试的 input 值（改变后重新计算 expected），确保新的 expected 值不在公开文字中出现
- 如涉及隐藏测试输入泄漏：必须更换重复的 hidden input，并同步重算 expected
- 如涉及 reference_solution_leak：重写公开示例代码，不使用参考实现的同一逻辑
- 如涉及 starter_equals_reference：在 starter_code 中移除完整实现，保留函数签名和 TODO`
}
