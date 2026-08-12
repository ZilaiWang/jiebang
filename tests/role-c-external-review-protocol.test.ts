import { describe, expect, test } from "bun:test"
import { ROLE_C_COMMON_SYSTEM_POLICY } from "../src/role-c-content/prompts/common-policy"
import { stagedRepairPrompt } from "../src/role-c-content/prompts/staged-repair.prompt"
import { toAlignmentObjections } from "../src/role-c-content/review/revision-mapper"
import type { ContentRevisionInstruction } from "../src/role-c-content/review/types"

describe("Role C external review revision protocol", () => {
  test("preserves A/B review ownership, scope, decision and locator for the target agent", () => {
    const instruction: ContentRevisionInstruction = {
      instruction_id: "REV-FACT-1",
      source: "fact_audit",
      source_decision: "reject",
      code: "unsupported_claim",
      artifact_kind: "concept",
      artifact_id: "LESSON-1",
      target_agent: "concept-tutor",
      target_artifact_id: "LESSON-1",
      objective_id: "OBJ-K007",
      message: "该结论超出当前冻结事实",
      proposed_action: "删除结论，或仅依据当前事实重写",
      fix_scope: "artifact",
      locator: {
        field: "claim",
        ref_id: "CLAIM-2",
        parent_block_id: "BLOCK-1",
        objective_id: "OBJ-K007",
      },
      evidence_refs: ["K007:F001"],
    }

    expect(toAlignmentObjections([instruction])[0]).toMatchObject({
      from_agent: "cross-artifact-gate",
      target_artifact_id: "LESSON-1",
      objective_id: "OBJ-K007",
      severity: "critical",
      review_instruction_id: "REV-FACT-1",
      review_source: "fact_audit",
      review_code: "unsupported_claim",
      review_message: "该结论超出当前冻结事实",
      review_decision: "reject",
      fix_scope: "artifact",
      target_agent: "concept-tutor",
      locator: { field: "claim", ref_id: "CLAIM-2" },
    })
  })

  test("tells every generation and repair stage how to consume objections without treating them as evidence", () => {
    expect(ROLE_C_COMMON_SYSTEM_POLICY).toContain("外审修订协议")
    expect(ROLE_C_COMMON_SYSTEM_POLICY).toContain("review_instruction_id")
    expect(ROLE_C_COMMON_SYSTEM_POLICY).toContain("fix_scope=artifact")
    expect(ROLE_C_COMMON_SYSTEM_POLICY).toContain("不是知识证据")
    expect(stagedRepairPrompt("base", ["schema issue"])).toContain("不得撤销已经完成的外审修订")
  })
})
