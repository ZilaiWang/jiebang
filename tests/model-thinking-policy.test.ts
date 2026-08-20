import { describe, expect, test } from "bun:test"
import { modelBackedProviderOptionsFromEnv } from "../src/role-c-content/providers/model-backed-provider-env"
import { fastModelPolicy, modelCallPolicy } from "../src/model-runtime"

describe("model thinking and concurrency policy", () => {
  test("uses bounded two-way concept concurrency by default and permits an explicit override", () => {
    expect(modelBackedProviderOptionsFromEnv({ ROLE_C_MODEL_CONCEPT_CONCURRENCY: undefined }).concept_concurrency).toBe(2)
    expect(modelBackedProviderOptionsFromEnv({ ROLE_C_MODEL_CONCEPT_CONCURRENCY: "3" }).concept_concurrency).toBe(3)
  })

  test("uses explicit FAST/QUALITY/OFFLINE_MAX provider semantics", () => {
    expect(fastModelPolicy("TEST", 2_000).thinking).toBe("disabled")
    expect(modelCallPolicy("quality").reasoning_effort).toBe("high")
    expect(modelCallPolicy("offline_max").reasoning_effort).toBe("max")
  })
})
