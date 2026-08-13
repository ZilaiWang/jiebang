import { describe, expect, test } from "bun:test"
import { buildInvalidExpectedTypeIssue } from "../src/role-c-content/validators/code-lab-validator"

describe("Role C invalid_expected_type author diagnostics", () => {
  test("points repairs at author index instead of materialized test id", () => {
    expect(buildInvalidExpectedTypeIssue(
      { type: "list of numbers" },
      42,
      1,
      "OBJ-sum",
      "列表输出合同只允许数组 expected",
    )).toEqual({
      code: "invalid_expected_type",
      path: "$.hidden_tests[1].expected",
      message: "author_index=1; objective_id=OBJ-sum; required_kind=array; actual_kind=number; 列表输出合同只允许数组 expected",
      severity: "critical",
    })
  })
})
