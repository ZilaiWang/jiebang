import type { LearnerProfileV2 } from "../../role-b-profile/learner-profile-v2"
import type { CompetitionEvaluationCaseV2 } from "./competition-cases.v2"
import { planArtifactTasks } from "../../role-c-content/contracts/artifact-task"
export type {
  ArtifactTaskContractV2,
  ArtifactTaskContractsV2,
} from "../../role-c-content/contracts/artifact-task"

/** Expected bands remain in the evaluator, never in the generation contract. */
export function buildArtifactTaskContractsV2(input: {
  evaluationCase: CompetitionEvaluationCaseV2
  profile: LearnerProfileV2
}) {
  const c = input.evaluationCase
  return planArtifactTasks({
    behavior:
      c.objectives.find((o) => o.is_primary)?.observable_behavior ??
      c.objectives[0]!.observable_behavior,
    target_count: c.target_source_ids.length,
    level: input.profile.level,
    blueprint: c.artifact_plan.assessment.blueprint,
    shapes: {
      concept_lesson: c.artifact_plan.lesson.shape,
      code_lab: c.artifact_plan.lab.shape,
      assessment: c.artifact_plan.assessment.shape,
    },
  })
}
