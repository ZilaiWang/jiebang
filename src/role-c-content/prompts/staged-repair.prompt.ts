/**
 * 分阶段生成的通用修复提示词模板。
 * 用于 code-lab 和 evaluator 的分阶段校验失败重试。
 */
export function stagedRepairPrompt(basePrompt: string, issues: string[]): string {
  return `${basePrompt}

上一次本阶段输出未通过校验。保持冻结合同不变，只修复以下失败项：
${issues.map((issue, index) => `${index + 1}. ${issue}`).join("\n")}

若失败项包含 hidden_test_input_leak：重新设计所有重复的 hidden_tests.input，逐一与冻结 public payload 的 public_tests.input 做 JSON 全值比较，改用公开材料中从未出现的新结构和新标量组合，并同步重算对应 expected；不得删除或改写 public payload。
若失败项包含 hidden_test_expected_leak：不要改 public payload；改用不同隐藏输入并根据 reference_solution 重新计算 expected，确保 expected 的完整结构及非低熵文本不出现在公开说明、提示或测试描述中。
修复必须产生与 previous_output 不同的相关字段；若原隐藏输入是公开输入的轻微改写，不得只调整顺序或包装层。`
}
