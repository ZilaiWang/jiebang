import { describe, expect, test } from "bun:test"
import { modalityMeasuresBehavior } from "../src/role-c-content/contracts/assessment-measurement"

describe("assessment modality respects B observable behavior", () => {
  test("a modality must directly measure the requested observable behavior", () => {
    expect(modalityMeasuresBehavior("recognize", "code")).toBe(false)
    expect(modalityMeasuresBehavior("recognize", "mcq")).toBe(true)
    expect(modalityMeasuresBehavior("apply", "code")).toBe(true)
    expect(modalityMeasuresBehavior("create", "short_answer")).toBe(true)
  })
})
