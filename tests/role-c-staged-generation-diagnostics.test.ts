import { describe, expect, test } from "bun:test"
import { sanitizeStageFailureDiagnostic } from "../src/role-c-content/providers/model-backed-provider"

describe("Role C staged secure author diagnostics", () => {
  test("keeps validator paths and hashes but removes private payload values", () => {
    expect(sanitizeStageFailureDiagnostic({
      task: "role-c.code-lab.secure",
      attempt: 2,
      max_repairs: 2,
      output_schema_id: "secure-schema",
      issues: ["[reference_solution_leak] $.public: 公开产物包含完整参考实现内容", "reference_solution: SECRET-SOURCE"],
      output_hash: "sha256:abc",
    })).toEqual({
      task: "role-c.code-lab.secure",
      attempt: 2,
      max_repairs: 2,
      output_schema_id: "secure-schema",
      issue_codes: ["reference_solution_leak", "reference_solution"],
      issue_count: 2,
      output_hash: "sha256:abc",
    })
  })
})
