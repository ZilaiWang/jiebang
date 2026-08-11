import { describe, expect, test } from "bun:test"
import { roleCGenerationBudgets } from "../src/role-d-integration/generation-budget"

describe("main Agent Role C generation budgets", () => {
  test("uses bounded retry budgets instead of multiplying six outer by five inner full pipelines", () => {
    expect(roleCGenerationBudgets()).toEqual({ outer_attempts: 2, inner_attempts: 2 })
  })
})
