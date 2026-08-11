import { describe, expect, test } from "bun:test"
import { validateStageRepairProgress } from "../src/role-c-content/providers/model-backed-provider"

describe("Role C staged repair progress gate", () => {
  test("reports NO_REPAIR_PROGRESS when a repair returns the same output", () => {
    expect(validateStageRepairProgress({ answer: "unchanged" }, { answer: "unchanged" })).toEqual([
      "[NO_REPAIR_PROGRESS] staged repair output is identical to the previous attempt",
    ])
  })

  test("allows a changed repair output", () => {
    expect(validateStageRepairProgress({ answer: "old" }, { answer: "new" })).toEqual([])
    expect(validateStageRepairProgress(undefined, { answer: "first" })).toEqual([])
  })
})
