export interface NextActionDecision {
  action: "remediate" | "reinforce" | "advance" | "reprofile"
  confidence: number
  reason_codes: string[]
}

/** Explainable MVP thresholds. They are engineering defaults and must be calibrated with eval data. */
export function decideNextAction(input: {
  mastery: number
  sufficient_modalities: boolean
  profile_conflict_count?: number
  previous_action?: NextActionDecision["action"]
}): NextActionDecision {
  if ((input.profile_conflict_count ?? 0) >= 2) {
    return { action: "reprofile", confidence: 0.8, reason_codes: ["repeated_profile_evidence_conflict"] }
  }
  // Hysteresis prevents a learner oscillating at a single threshold after each answer.
  if (input.previous_action === "advance" && input.mastery >= 0.74 && input.sufficient_modalities) {
    return { action: "advance", confidence: 0.72, reason_codes: ["advance_hysteresis_retained"] }
  }
  if (input.previous_action === "remediate" && input.mastery < 0.66) {
    return { action: "remediate", confidence: 0.72, reason_codes: ["remediate_hysteresis_retained"] }
  }
  if (input.mastery < 0.58) {
    return { action: "remediate", confidence: 0.85, reason_codes: ["mastery_below_0_60"] }
  }
  if (input.mastery < 0.82 || !input.sufficient_modalities) {
    return {
      action: "reinforce",
      confidence: 0.75,
      reason_codes: [input.mastery < 0.82 ? "mastery_in_reinforcement_band" : "insufficient_evidence_modalities"],
    }
  }
  return { action: "advance", confidence: 0.85, reason_codes: ["mastery_at_least_0_82", "evidence_sufficient"] }
}
