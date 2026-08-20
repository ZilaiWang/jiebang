import { describe, expect, test } from "bun:test"
import { modelBackedProviderOptionsFromEnv } from "../src/role-c-content/providers/model-backed-provider-env"
import { repairNeedsThinking } from "../src/role-c-content/providers/model-backed-provider"

describe("model thinking and concurrency policy", () => {
  test("uses bounded two-way concept concurrency by default and permits an explicit override", () => {
    expect(modelBackedProviderOptionsFromEnv({}).concept_concurrency).toBe(2)
    expect(modelBackedProviderOptionsFromEnv({ ROLE_C_MODEL_CONCEPT_CONCURRENCY: "3" }).concept_concurrency).toBe(3)
  })

  test("enables thinking only for semantic or evidence repairs", () => {
    expect(repairNeedsThinking(["[SEMANTIC_UNSUPPORTED] claim lacks evidence"])).toBe(true)
    expect(repairNeedsThinking(["目标与代码实验未对齐"])).toBe(true)
    expect(repairNeedsThinking(["options: true_false 必须恰好有两个选项"])).toBe(false)
    expect(repairNeedsThinking(["模型输出格式错误：JSON 无法解析"])).toBe(false)
  })
})
