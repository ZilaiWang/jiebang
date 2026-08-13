export interface RoleCGenerationBudgets {
  outer_attempts: number
  inner_attempts: number
}

export function shouldRetryWholeGenerationReason(reason: string): boolean {
  const normalized = reason.normalize("NFKC").toLocaleLowerCase()
  if (/(?:invalid_expected_type|invalid_output_contract_type|no_repair_progress|starter_code.*完整答案|明确未完成的函数 starter_code)/u.test(normalized)) return false
  if (/(?:http\s*40[123]|余额|额度|billing|payment|required|rag 仅弱匹配|证据不足|缺少.*证据|配置缺失|provider.*配置|unsupported|不支持目标)/u.test(normalized)) return false
  return /(?:未在有限修复次数内通过校验|隐藏测试|reference|secure|execution|模型输出|审核.*驳回)/u.test(normalized)
}

/**
 * Full-pipeline rebuild budgets. Stage-level schema repair and reviewed recovery
 * remain active inside each attempt; these caps prevent multiplicative 6×5 waits.
 */
export function roleCGenerationBudgets(): RoleCGenerationBudgets {
  return { outer_attempts: 2, inner_attempts: 2 }
}
