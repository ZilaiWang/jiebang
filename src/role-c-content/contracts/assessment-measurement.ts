import type {
  AssessmentBlueprint,
  LearningObjective,
  ObservableBehavior,
} from "./profile-adapter"

export type AssessmentModality = AssessmentBlueprint["required_modalities"][number]

const MEASURING_MODALITIES: Record<ObservableBehavior, AssessmentModality[]> = {
  recognize: ["mcq", "true_false", "trace", "short_answer", "code"],
  explain: ["short_answer"],
  trace: ["trace", "code"],
  apply: ["mcq", "true_false", "trace", "short_answer", "code"],
  debug: ["code"],
  create: ["code"],
}

export function modalityMeasuresBehavior(
  behavior: ObservableBehavior,
  modality: AssessmentModality,
): boolean {
  return MEASURING_MODALITIES[behavior].includes(modality)
}

export function preferredModalityForBehavior(
  behavior: ObservableBehavior,
): AssessmentModality {
  const preferred: Record<ObservableBehavior, AssessmentModality> = {
    recognize: "mcq",
    explain: "short_answer",
    trace: "trace",
    apply: "trace",
    debug: "code",
    create: "code",
  }
  return preferred[behavior]
}

/**
 * Required modalities occupy fixed slots. Every remaining slot may be chosen
 * deterministically by C. This matching check proves that all core objectives
 * can still receive one directly measurable item before any model is called.
 */
export function assessmentBlueprintCanMeasureCoreObjectives(
  objectives: LearningObjective[],
  blueprint: AssessmentBlueprint,
): boolean {
  const core = objectives.filter((objective) => objective.importance === "core")
  const total = blueprint.tier_1_count
    + blueprint.tier_2_count
    + blueprint.tier_3_count
  const fixed = blueprint.required_modalities
  const flexibleSlots = total - fixed.length
  if (flexibleSlots < 0 || core.length > total) return false

  const objectiveByFixedSlot = new Map<number, number>()
  const tryMatch = (objectiveIndex: number, seen: Set<number>): boolean => {
    for (let slot = 0; slot < fixed.length; slot += 1) {
      if (seen.has(slot)
        || !modalityMeasuresBehavior(
          core[objectiveIndex]!.observable_behavior,
          fixed[slot]!,
        )) continue
      seen.add(slot)
      const current = objectiveByFixedSlot.get(slot)
      if (current === undefined || tryMatch(current, seen)) {
        objectiveByFixedSlot.set(slot, objectiveIndex)
        return true
      }
    }
    return false
  }

  let matchedByFixedSlots = 0
  for (let objectiveIndex = 0; objectiveIndex < core.length; objectiveIndex += 1) {
    if (tryMatch(objectiveIndex, new Set())) matchedByFixedSlots += 1
  }
  return core.length - matchedByFixedSlots <= flexibleSlots
}
