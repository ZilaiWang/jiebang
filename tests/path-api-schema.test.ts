import { describe, expect, test } from "bun:test"
import { validatePathChangeBody, validatePathResumeBody } from "../src/orchestration/path-api-schema"

describe("path lifecycle API schema", () => {
  test("accepts a goal change with one supported main goal", () => {
    const result = validatePathChangeBody({
      path_id: "PATH-NEW",
      goal: "算法竞赛",
      goal_profile: "algorithm_competition",
    })
    expect(result).toEqual({
      ok: true,
      value: { path_id: "PATH-NEW", goal: "算法竞赛", goal_profile: "algorithm_competition" },
    })
  })

  test("rejects unsafe or unsupported path changes", () => {
    expect(validatePathChangeBody({ path_id: "../bad", goal: "新目标", goal_profile: "coursework" }).ok).toBe(false)
    expect(validatePathChangeBody({ path_id: "PATH-2", goal: "新目标", goal_profile: "other" }).ok).toBe(false)
  })

  test("resume request only accepts a safe paused path id", () => {
    expect(validatePathResumeBody({ path_id: "PATH-OLD" })).toEqual({ ok: true, value: { path_id: "PATH-OLD" } })
    expect(validatePathResumeBody({ path_id: "" }).ok).toBe(false)
  })
})
