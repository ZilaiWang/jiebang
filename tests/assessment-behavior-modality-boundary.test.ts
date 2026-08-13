import { describe, expect, test } from "bun:test"
import { modalityMeasuresBehavior } from "../src/role-c-content/contracts/assessment-measurement"

describe("assessment modality respects B observable behavior", () => {
  test("recognize targets may use scaffolded code items in the fixed formal composition", () => {
    expect(modalityMeasuresBehavior("recognize", "code")).toBe(true)
    expect(modalityMeasuresBehavior("recognize", "mcq")).toBe(true)
    expect(modalityMeasuresBehavior("apply", "code")).toBe(true)
  })
})
