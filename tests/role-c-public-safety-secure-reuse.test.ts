import { describe, expect, test } from "bun:test"
import {
  applyCodeLabPublicSafetyPatch,
  conservativeCodeLabPublicSafetyPatch,
} from "../src/role-c-content/providers/model-backed-provider"

describe("Role C public-safety patch preserves secure identity", () => {
  test("changes only learner-visible public fields", () => {
    const prior: any = {
      lab_id: "LAB-1",
      objective_ids: ["O1"],
      execution_contract: { execution_mode: "function", entry_point: "solve" },
      starter_code: "def solve(x):\n    return x + 1\n",
      instructions: [{ block_id: "B1", block_type: "paragraph", text: "return x + 1", claims: [] }],
      public_tests: [{ test_id: "P1", objective_id: "O1", description: "返回 x+1", expected_behavior: "得到 x+1", citations: [] }],
      hint_ladders: [{ objective_id: "O1", hints: [{ hint_level: 1, text: "加1", citations: [] }, { hint_level: 2, text: "x+1", citations: [] }, { hint_level: 3, text: "return x+1", citations: [] }] }],
      reflection_questions: ["为什么 x+1"],
      stable_private_free_field: "keep",
    }
    const candidate: any = applyCodeLabPublicSafetyPatch(prior, conservativeCodeLabPublicSafetyPatch(prior))
    expect(candidate.lab_id).toBe(prior.lab_id)
    expect(candidate.objective_ids).toEqual(prior.objective_ids)
    expect(candidate.execution_contract).toEqual(prior.execution_contract)
    expect(candidate.public_tests[0].test_id).toBe("P1")
    expect(candidate.hint_ladders[0].objective_id).toBe("O1")
    expect(candidate.stable_private_free_field).toBe("keep")
    expect(candidate.starter_code).not.toContain("return x + 1")
  })
})
