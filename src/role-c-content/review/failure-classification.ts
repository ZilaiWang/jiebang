import type {
  ContentReviewFinding,
  ContentRecoveryAction,
  ReviewFixScope,
} from "./types"

export type ReviewFailureCategory =
  | "citation_missing"
  | "citation_not_in_evidence"
  | "statement_not_supported"
  | "evidence_insufficient"
  | "difficulty_misaligned"
  | "prerequisite_missing"
  | "target_misaligned"
  | "content_incomplete"
  | "review_surface_missing"

export interface ClassifiedReviewFailure {
  category: ReviewFailureCategory
  owner: "role_a" | "role_b" | "role_c"
  fix_scope: ReviewFixScope
  action: ContentRecoveryAction
}

/** Stable routing semantics shared by reports, recovery logs and UI diagnostics. */
export function classifyReviewFinding(
  finding: ContentReviewFinding,
): ClassifiedReviewFailure {
  if (finding.source === "teaching_audit") {
    if (finding.code === "difficulty_alignment") {
      return bFailure("difficulty_misaligned", finding.fix_scope)
    }
    if (finding.code === "prerequisite_coverage") {
      return bFailure("prerequisite_missing", finding.fix_scope)
    }
    if (finding.code === "goal_alignment") {
      return bFailure("target_misaligned", finding.fix_scope)
    }
    return bFailure("content_incomplete", finding.fix_scope)
  }
  if (finding.code === "missing_citation") {
    return cFailure("citation_missing", finding.fix_scope)
  }
  if (finding.code === "unsupported_citation") {
    return aFailure("citation_not_in_evidence", finding.fix_scope)
  }
  if (finding.code === "external_knowledge") {
    return aFailure("evidence_insufficient", finding.fix_scope)
  }
  if ([
    "unsupported",
    "semantic_unsupported",
    "semantic_uncertain",
    "missing_evidence_anchor",
  ].includes(finding.code)) {
    return cFailure("statement_not_supported", finding.fix_scope)
  }
  return cFailure("review_surface_missing", finding.fix_scope)
}

function cFailure(
  category: ReviewFailureCategory,
  fixScope: ReviewFixScope,
): ClassifiedReviewFailure {
  return {
    category,
    owner: "role_c",
    fix_scope: fixScope,
    action: fixScope === "new_evidence"
      ? "request_new_evidence"
      : fixScope === "new_spec"
        ? "replan_path"
        : "adjust_content",
  }
}

function aFailure(
  category: ReviewFailureCategory,
  fixScope: ReviewFixScope,
): ClassifiedReviewFailure {
  return {
    category,
    owner: fixScope === "new_evidence" ? "role_a" : "role_c",
    fix_scope: fixScope,
    action: fixScope === "new_evidence"
      ? "request_new_evidence"
      : "adjust_content",
  }
}

function bFailure(
  category: ReviewFailureCategory,
  fixScope: ReviewFixScope,
): ClassifiedReviewFailure {
  return {
    category,
    owner: "role_b",
    fix_scope: fixScope,
    action: fixScope === "new_spec" ? "replan_path" : "adjust_content",
  }
}
