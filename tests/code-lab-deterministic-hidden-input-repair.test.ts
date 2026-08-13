import { describe, expect, test } from "bun:test"
import { chooseDistinctFunctionInput } from "../src/role-c-content/providers/staged-generation"

describe("deterministic distinct hidden input repair", () => {
  test("creates a distinct function envelope when the model copied public input", () => {
    const result = chooseDistinctFunctionInput({ args: [10], kwargs: {} }, [{ args: [10], kwargs: {} }])
    expect(JSON.stringify(result)).not.toBe(JSON.stringify({ args: [10], kwargs: {} }))
    expect(result).toEqual({ args: [11], kwargs: {} })
  })
})
