import { describe, expect, test } from "bun:test"
import { chooseDistinctFunctionInput } from "../src/role-c-content/providers/staged-generation"

describe("bare failed hidden id fallback", () => {
  test("can perturb a failed hidden test input deterministically", () => {
    const prior = { args: [1], kwargs: {} }
    const changed = chooseDistinctFunctionInput(prior, [prior]) as { args: unknown[]; kwargs: Record<string, unknown> }
    expect(changed).not.toEqual(prior)
    expect(Array.isArray(changed.args)).toBe(true)
  })
})
