import { describe, expect, test } from "bun:test"
import { planNavSection } from "./plan-navigation"

describe("plan navigation", () => {
  test("keeps the collaboration history navigation item active on its own page", () => {
    expect(planNavSection("history")).toBe("history")
  })

  test("groups only subordinate flow pages under their parent navigation item", () => {
    expect(planNavSection("diagnosis")).toBe("goal")
    expect(planNavSection("feedback")).toBe("assessment")
  })
})
