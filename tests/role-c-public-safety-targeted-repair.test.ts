import { describe, expect, test } from "bun:test"
import {
  conservativeAssessmentPublicSafetyRepair,
  conservativeCodeLabPublicSafetyPatch,
  shouldUseDeterministicPublicSafetyRepair,
} from "../src/role-c-content/providers/model-backed-provider"

describe("Role C targeted public-safety repair", () => {
  test("uses deterministic compression for reference solution leaks", () => {
    expect(shouldUseDeterministicPublicSafetyRepair(["reference_solution_leak"])).toBe(true)
    expect(shouldUseDeterministicPublicSafetyRepair(["starter_equals_reference"])).toBe(true)
    expect(shouldUseDeterministicPublicSafetyRepair(["hidden_test_id_leak"])).toBe(false)
  })

  test("shortens starter, public tests and hints while preserving array identities", () => {
    const patch = conservativeCodeLabPublicSafetyPatch({
      starter_code: "def solve(values):\n    result = list(values)\n    result.append(4)\n    return result\n",
      execution_contract: { execution_mode: "function", entry_point: "solve" },
      instructions: [{ block_id: "B1" }],
      public_tests: [{ test_id: "P1" }],
      hint_ladders: [{ objective_id: "O1", hints: [{}, {}, {}] }],
      reflection_questions: ["完整写出 solve 的实现"],
    } as any)
    expect(patch.starter_code).toContain("NotImplementedError")
    expect(patch.starter_code).not.toContain("append(4)")
    expect(patch.public_test_descriptions).toHaveLength(1)
    expect(patch.public_test_expected_behaviors).toEqual(["结果应符合执行合同和题目中的输出约束。"])
    expect(patch.hint_texts).toHaveLength(1)
    expect(patch.hint_texts[0]).toHaveLength(3)
    expect(JSON.stringify(patch)).not.toContain("append(4)")
  })

  test("compresses assessment code public fields when secure reference leaks", () => {
    const repaired = conservativeAssessmentPublicSafetyRepair({
      form_id: "FORM-1",
      title: "测评",
      objective_ids: ["O1"],
      items: [{
        item_id: "I1",
        family_id: "F1",
        variant_id: "V1",
        display_no: 1,
        objective_id: "O1",
        tier: 2,
        modality: "code",
        prompt: "写出完整实现：result=list(values); result.append(4); return result",
        starter_code: "def solve(values):\n    result = list(values)\n    result.append(4)\n    return result\n",
        max_score: 1,
      }],
      submission_policy: { max_attempts: 2, formative: true },
      routing: { anchor_item_ids: [], rules: [] },
      objective_coverage: [],
      used_evidence: [],
    } as any)
    expect(repaired.items[0].prompt).not.toContain("append(4)")
    expect(repaired.items[0].starter_code).toContain("TODO")
    expect(repaired.items[0].starter_code).not.toContain("append(4)")
  })
})
