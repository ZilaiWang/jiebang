import { describe, expect, test } from "bun:test"
import { validationIssueStrings } from "../src/role-c-content/providers/model-backed-provider"

describe("Role C validator diagnostics retain machine codes", () => {
  test("formats issue code separately from safe path and message", () => {
    expect(validationIssueStrings({ issues: [{ code: "reference_solution_leak", path: "$.public", message: "公开产物包含完整参考实现内容" }] })).toEqual([
      "[reference_solution_leak] $.public: 公开产物包含完整参考实现内容",
    ])
  })
})
