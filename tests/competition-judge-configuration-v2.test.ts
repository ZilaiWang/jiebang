import { expect, test } from "bun:test"
import { evaluationJudgeModeV2, resolveEvaluationJudgeEnvV2 } from "../src/evaluation/v2/judge-configuration.v2"
import { loadKnowledgeBase } from "../src/knowledge/loader"

test("same-model evaluation requires an explicit choice, also in full runs", () => {
  const env = { ROLE_C_MODEL_ID: "glm", ROLE_C_MODEL_API_KEY: "test-key" }
  expect(() => resolveEvaluationJudgeEnvV2(env, { development: false, sameModel: false })).toThrow("EVALUATION_JUDGE_REQUIRED")
  expect(resolveEvaluationJudgeEnvV2(env, { development: true, sameModel: false })).toBeUndefined()
  expect(resolveEvaluationJudgeEnvV2(env, { development: false, sameModel: true })).toEqual(env)
  expect(evaluationJudgeModeV2("glm", "glm")).toBe("same_model_separate_calls")
  expect(evaluationJudgeModeV2("glm", "other")).toBe("cross_model")
  expect(evaluationJudgeModeV2("glm")).toBe("not_configured")
})

test("incomplete external judge config does not silently use generation credentials", () => {
  expect(() => resolveEvaluationJudgeEnvV2({ COMPETITION_JUDGE_MODEL_ID: "other" }, { development: true, sameModel: false })).toThrow("INCOMPLETE")
  const result = resolveEvaluationJudgeEnvV2({ ROLE_C_MODEL_API_KEY: "generation", COMPETITION_JUDGE_MODEL_ID: "other", COMPETITION_JUDGE_API_KEY: "review", COMPETITION_JUDGE_ENDPOINT: "https://example.test" }, { development: false, sameModel: false })!
  expect(result.ROLE_C_MODEL_API_KEY).toBe("review")
  expect(result.MODEL_RUNTIME_MODEL_ID).toBe("other")
})

test("core facts permit break termination and distinguish string method return types", async () => {
  const kb = await loadKnowledgeBase()
  const fact = (source: string, id: string) => kb.items.find(i => i.sourceId === source)!.facts.find(f => f.factId === id)!.content
  expect(fact("K008", "F002")).toContain("break")
  expect(fact("K008", "F002")).toContain("需要结束")
  expect(fact("K012", "F004")).not.toContain("任何操作")
  expect(fact("K012", "F004")).toContain("返回类型")
})
