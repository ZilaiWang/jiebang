import type { RoleCAgentName } from "../contracts/common"
import { stableId } from "../contracts/common"
import type { AlignmentObjection } from "../validators/alignment-validator"
import type {
  ContentRevisionInstruction,
  ReviewArtifactKind,
} from "./types"

export function agentForReviewArtifact(kind: ReviewArtifactKind): RoleCAgentName {
  if (kind === "concept") return "concept-tutor"
  if (kind === "code_lab") return "code-lab"
  return "tiered-evaluator"
}

export function toAlignmentObjections(
  instructions: readonly ContentRevisionInstruction[],
): AlignmentObjection[] {
  return instructions.map((instruction) => ({
    objection_id: stableId("OBJ-REVIEW", instruction),
    // Existing C agent requests accept AlignmentObjection. Keep the compatibility label
    // at the C gate instead of leaking A/B-specific types into those requests.
    from_agent: "cross-artifact-gate",
    target_artifact_id: instruction.target_artifact_id,
    objective_id: instruction.objective_id,
    issue_type: issueType(instruction),
    severity: "critical",
    evidence: instruction.evidence_refs.length > 0
      ? [...instruction.evidence_refs]
      : [instruction.locator?.ref_id ?? instruction.artifact_id],
    proposed_action: instruction.proposed_action,
  }))
}

function issueType(
  instruction: ContentRevisionInstruction,
): AlignmentObjection["issue_type"] {
  if (instruction.source === "fact_audit") return "unsupported_claim"
  if (instruction.code === "difficulty_alignment") return "difficulty_mismatch"
  if (instruction.code === "prerequisite_coverage") return "missing_prerequisite"
  if (instruction.code === "weak_concept_coverage") {
    if (instruction.artifact_kind === "concept") return "missing_instruction"
    if (instruction.artifact_kind === "code_lab") return "missing_practice"
    return "missing_assessment"
  }
  return "mapping_conflict"
}
