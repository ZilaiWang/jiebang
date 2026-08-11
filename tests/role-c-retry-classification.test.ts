import { describe, expect, test } from "bun:test"
import { shouldRetryWholeGenerationReason } from "../src/role-d-integration/generation-budget"

describe("Role C whole-generation retry classification", () => {
  test("fails fast for billing, evidence and configuration errors", () => {
    expect(shouldRetryWholeGenerationReason("模型服务返回 HTTP 402")).toBe(false)
    expect(shouldRetryWholeGenerationReason("RAG 仅弱匹配，当前证据不足")).toBe(false)
    expect(shouldRetryWholeGenerationReason("模型配置缺失")).toBe(false)
  })
  test("retries bounded stochastic authoring and trusted execution failures", () => {
    expect(shouldRetryWholeGenerationReason("role-c.code-lab.secure 未在有限修复次数内通过校验")).toBe(true)
    expect(shouldRetryWholeGenerationReason("reference 未通过全部隐藏测试")).toBe(true)
  })
  test("does not rebuild the whole round for deterministic contract failures", () => {
    expect(shouldRetryWholeGenerationReason("[invalid_expected_type] expected 类型不匹配")).toBe(false)
    expect(shouldRetryWholeGenerationReason("[NO_REPAIR_PROGRESS] staged repair output is identical")).toBe(false)
    expect(shouldRetryWholeGenerationReason("items[4] 代码题必须提供明确未完成的函数 starter_code")).toBe(false)
  })
})
