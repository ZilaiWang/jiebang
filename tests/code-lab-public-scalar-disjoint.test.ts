import { describe, expect, test } from "bun:test"
import { chooseDistinctFunctionInput } from "../src/role-c-content/providers/staged-generation"

describe("hidden input must not reuse any public scalar", () => {
  test("moves a scalar away even when the full envelope differs", () => {
    const result = chooseDistinctFunctionInput({ args: [10], kwargs: {} }, [{ args: [10, 20], kwargs: {} }])
    expect(result).toEqual({ args: [11], kwargs: {} })
  })
})
