import { describe, expect, test } from "bun:test"
import { chooseDistinctFunctionInput } from "../src/role-c-content/providers/staged-generation"

// 原 code-lab-public-scalar-disjoint / code-lab-deterministic-hidden-input-repair /
// code-lab-bare-failed-id-fallback 合并而来。
// 主题：隐藏测试输入与公开输入的去重，避免隐藏输入复用公开标量。

describe("hidden input must not reuse any public scalar", () => {
  test("即使完整封装不同，也会移动复用标量", () => {
    const result = chooseDistinctFunctionInput({ args: [10], kwargs: {} }, [{ args: [10, 20], kwargs: {} }])
    expect(result).toEqual({ args: [11], kwargs: {} })
  })
})

describe("deterministic distinct hidden input repair", () => {
  test("模型照抄公开输入时，确定性生成不同封装", () => {
    const result = chooseDistinctFunctionInput({ args: [10], kwargs: {} }, [{ args: [10], kwargs: {} }])
    expect(JSON.stringify(result)).not.toBe(JSON.stringify({ args: [10], kwargs: {} }))
    expect(result).toEqual({ args: [11], kwargs: {} })
  })
})

describe("bare failed hidden id fallback", () => {
  test("可确定性扰动失败的隐藏测试输入", () => {
    const prior = { args: [1], kwargs: {} }
    const changed = chooseDistinctFunctionInput(prior, [prior]) as { args: unknown[]; kwargs: Record<string, unknown> }
    expect(changed).not.toEqual(prior)
    expect(Array.isArray(changed.args)).toBe(true)
  })
})
