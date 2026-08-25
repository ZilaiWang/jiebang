import type { LearningEvidenceEvent } from "../contracts/learning-evidence-event"
import type { NextActionDecision } from "./next-action-policy"

export interface PosteriorInterval {
  mean: number
  lower: number
  upper: number
  width: number
}

export interface NextActionDecisionV2 {
  action: "diagnose" | NextActionDecision["action"]
  confidence: number
  reason_codes: string[]
}

/** Normal approximation is stable, dependency-free and adequate for policy routing. */
export function betaPosteriorInterval(alpha: number, beta: number): PosteriorInterval {
  const total = alpha + beta
  const mean = total > 0 ? alpha / total : 0.5
  const variance = alpha > 0 && beta > 0
    ? alpha * beta / (total ** 2 * (total + 1))
    : 0.25
  const margin = 1.96 * Math.sqrt(variance)
  const lower = clamp01(mean - margin)
  const upper = clamp01(mean + margin)
  return {
    mean: round(mean),
    lower: round(lower),
    upper: round(upper),
    width: round(upper - lower),
  }
}

export function evidenceReliability(event: LearningEvidenceEvent): number {
  const modality: Record<LearningEvidenceEvent["evidence"]["modality"], number> = {
    mcq: 0.72,
    true_false: 0.62,
    trace: 0.88,
    short_answer: 0.82,
    code: 1,
  }
  const hintFactor = 1 - Math.min(0.45, event.evidence.hint_level * 0.12)
  const attemptFactor = 1 / Math.sqrt(Math.max(1, event.evidence.attempt_no))
  return round(clamp01(
    modality[event.evidence.modality]
      * clamp01(event.evidence.grader_confidence)
      * hintFactor
      * attemptFactor,
  ))
}

export function decideNextActionV2(input: {
  posterior: PosteriorInterval
  sufficient_modalities: boolean
  misconception_mass?: number
  profile_conflict_count?: number
  previous_action?: NextActionDecision["action"]
}): NextActionDecisionV2 {
  if ((input.profile_conflict_count ?? 0) >= 2) {
    return { action: "reprofile", confidence: 0.82, reason_codes: ["repeated_profile_evidence_conflict"] }
  }
  const misconceptionMass = input.misconception_mass ?? 0
  if (input.posterior.width >= 0.34 || (!input.sufficient_modalities && input.posterior.mean >= 0.72)) {
    return {
      action: "diagnose",
      confidence: round(Math.max(0.58, 1 - input.posterior.width / 2)),
      reason_codes: ["posterior_interval_too_wide", "high_discrimination_evidence_requested"],
    }
  }
  if (input.posterior.upper < 0.6 || misconceptionMass >= 0.62) {
    return {
      action: "remediate",
      confidence: 0.86,
      reason_codes: misconceptionMass >= 0.62
        ? ["misconception_mass_high", "posterior_below_target"]
        : ["posterior_upper_below_0_60"],
    }
  }
  if (input.posterior.lower >= 0.8 && input.sufficient_modalities) {
    return { action: "advance", confidence: 0.88, reason_codes: ["posterior_lower_at_least_0_80", "evidence_sufficient"] }
  }
  return {
    action: "reinforce",
    confidence: 0.76,
    reason_codes: ["posterior_overlaps_learning_band"],
  }
}

/** Current public contract has no diagnose action; preserve meaning through a reason-coded reinforce. */
export function toPublicNextAction(decision: NextActionDecisionV2): NextActionDecision {
  if (decision.action === "diagnose") {
    return {
      action: "reinforce",
      confidence: decision.confidence,
      reason_codes: [...decision.reason_codes, "diagnostic_variant_required"],
    }
  }
  return {
    action: decision.action,
    confidence: decision.confidence,
    reason_codes: [...decision.reason_codes],
  }
}

function clamp01(value: number): number { return Math.max(0, Math.min(1, value)) }
function round(value: number): number { return Math.round(value * 1_000_000) / 1_000_000 }
