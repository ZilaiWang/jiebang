import { describe, expect, test } from "bun:test"
import { assessmentCompositionForBehavior } from "../src/role-c-content/providers/staged-generation"

describe("formal assessment composition", () => {
  test("varies cognitive operations instead of forcing every behavior into one recipe", () => {
    expect(assessmentCompositionForBehavior("apply")).toEqual(["mcq", "true_false", "trace", "short_answer", "code"])
    expect(assessmentCompositionForBehavior("recognize")).toEqual(["mcq", "true_false", "mcq", "true_false", "mcq"])
    expect(assessmentCompositionForBehavior("create")).toEqual(["mcq", "short_answer", "code", "code", "code"])
  })
})
