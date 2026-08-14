import { describe, expect, test } from "bun:test"
import { classifyReviewFinding } from "../src/role-c-content/review/failure-classification"
import type { ContentReviewFinding } from "../src/role-c-content/review/types"

function finding(
  source: ContentReviewFinding["source"],
  code: string,
  fixScope: ContentReviewFinding["fix_scope"],
): ContentReviewFinding {
  return {
    source,
    code,
    artifact_kind: "concept",
    artifact_id: "LESSON-1",
    message: "issue",
    proposed_action: "fix",
    fix_scope: fixScope,
    evidence_refs: ["BLOCK-1"],
  }
}

describe("Role C review failure classification", () => {
  test("routes unsupported generated wording to a localized C rewrite", () => {
    expect(classifyReviewFinding(
      finding("fact_audit", "semantic_unsupported", "artifact"),
    )).toEqual({
      category: "statement_not_supported",
      owner: "role_c",
      fix_scope: "artifact",
      action: "adjust_content",
    })
  })

  test("routes an evidence gap to A without pretending C can rewrite it", () => {
    expect(classifyReviewFinding(
      finding("fact_audit", "external_knowledge", "new_evidence"),
    )).toMatchObject({ owner: "role_a", action: "request_new_evidence" })
  })

  test("routes prerequisite and difficulty failures to B path planning", () => {
    expect(classifyReviewFinding(
      finding("teaching_audit", "prerequisite_coverage", "new_spec"),
    )).toMatchObject({ owner: "role_b", action: "replan_path" })
    expect(classifyReviewFinding(
      finding("teaching_audit", "difficulty_alignment", "new_spec"),
    )).toMatchObject({ category: "difficulty_misaligned" })
  })
})
