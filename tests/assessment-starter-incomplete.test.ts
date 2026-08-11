import { describe, expect, test } from "bun:test"
import { assessmentStarterIsIncomplete } from "../src/role-c-content/providers/staged-generation"

describe("assessment code starter boundary", () => {
  test("rejects a complete print solution and accepts an explicit TODO function skeleton", () => {
    expect(assessmentStarterIsIncomplete('print("Python 是一种通用编程语言")\n')).toBe(false)
    expect(assessmentStarterIsIncomplete('def describe_python():\n    # TODO: 返回描述\n    raise NotImplementedError("TODO")\n')).toBe(true)
  })
})
