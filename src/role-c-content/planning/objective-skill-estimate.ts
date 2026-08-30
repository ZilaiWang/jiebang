export type SkillEvidenceBasis = "mastery_observation" | "known" | "weak" | "unobserved"

export type ObjectiveProgressBand =
  | "needs_reteach"
  | "developing"
  | "ready_for_transfer"
  | "mastered"

export interface ObjectiveSkillEstimate {
  source_id: string
  mean: number
  lower: number
  upper: number
  evidence_basis: SkillEvidenceBasis
  progress_band: ObjectiveProgressBand
}

/**
 * Convert real per-source mastery into the estimate consumed by all Role C
 * planners.  known/weak labels are retained only for profiles without an
 * observation for the current source.
 */
export function resolveObjectiveSkillEstimate(input: {
  source_id: string
  title?: string
  objective_id?: string
  mastery_by_source_id?: Record<string, number>
  known_concepts?: string[]
  weak_concepts?: string[]
}): ObjectiveSkillEstimate {
  const observed = input.mastery_by_source_id?.[input.source_id]
  if (typeof observed === "number" && Number.isFinite(observed) && observed >= 0 && observed <= 1) {
    const halfWidth = observed >= 0.82 || observed <= 0.3 ? 0.1 : 0.14
    return estimate(input.source_id, observed, halfWidth, "mastery_observation")
  }
  const identities = [input.source_id, input.objective_id ?? "", input.title ?? ""]
    .map(normalize)
    .filter(Boolean)
  const matches = (value: string): boolean => {
    const normalized = normalize(value)
    return identities.some((identity) =>
      identity === normalized || identity.includes(normalized) || normalized.includes(identity))
  }
  if ((input.known_concepts ?? []).some(matches)) {
    return estimate(input.source_id, 0.82, 0.18, "known")
  }
  if ((input.weak_concepts ?? []).some(matches)) {
    return estimate(input.source_id, 0.34, 0.2, "weak")
  }
  return estimate(input.source_id, 0.5, 0.28, "unobserved")
}

export function progressAdaptationActions(
  band: ObjectiveProgressBand,
  hasMisconception: boolean,
): Array<"brief_activate" | "reteach" | "contrast" | "guided_practice" | "transfer_challenge"> {
  if (band === "mastered") return ["brief_activate", "transfer_challenge"]
  if (band === "ready_for_transfer") return ["brief_activate", "guided_practice", "transfer_challenge"]
  if (band === "developing") return ["reteach", "guided_practice"]
  return ["reteach", ...(hasMisconception ? ["contrast" as const] : []), "guided_practice"]
}

function estimate(
  sourceId: string,
  mean: number,
  halfWidth: number,
  evidenceBasis: SkillEvidenceBasis,
): ObjectiveSkillEstimate {
  return {
    source_id: sourceId,
    mean,
    lower: clamp(mean - halfWidth),
    upper: clamp(mean + halfWidth),
    evidence_basis: evidenceBasis,
    progress_band: mean >= 0.82
      ? "mastered"
      : mean >= 0.65
        ? "ready_for_transfer"
        : mean >= 0.4
          ? "developing"
          : "needs_reteach",
  }
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function normalize(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase()
}
