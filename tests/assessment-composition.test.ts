import { describe, expect, test } from "bun:test"
import { assessmentCompositionForBehavior } from "../src/role-c-content/providers/staged-generation"

describe("formal assessment composition", () => {
  test("uses two choices, one trace, and two code items for apply-capable targets", () => {
    expect(assessmentCompositionForBehavior("apply")).toEqual(["mcq", "mcq", "trace", "code", "code"])
  })
})
