import type { LearnerProfile } from "../../role-b-profile/types"
import type { LearnerLevel, SchemaVersion } from "./common"
import { C_SCHEMA_VERSION, stableId } from "./canonical"

export type ObservableBehavior = "recognize" | "explain" | "trace" | "apply" | "debug" | "create"

export interface AssessmentBlueprint {
  tier_1_count: number
  tier_2_count: number
  tier_3_count: number
  required_modalities: Array<"mcq" | "true_false" | "trace" | "short_answer" | "code">
}

export interface LearnerProfileSnapshot {
  schema_version: SchemaVersion
  profile_id: string
  profile_version: string
  learner_id: string
  level: LearnerLevel
  known_concepts: string[]
  weak_concepts: string[]
  goal: string
  preferred_contexts: string[]
  accommodations: string[]
  provenance_ref?: string
}

export interface LearningObjective {
  objective_id: string
  source_id: string
  required_fact_ids: string[]
  observable_behavior: ObservableBehavior
  importance: "core" | "supporting"
}

/** Formal B/path → C generation contract. */
export interface LearningPathNode {
  schema_version: SchemaVersion
  node_id: string
  target_source_ids: string[]
  prerequisite_source_ids: string[]
  goal: string
  objectives: LearningObjective[]
  /** Upstream course/path policy. Role C consumes this verbatim and does not choose a product-wide quota. */
  assessment_blueprint: AssessmentBlueprint
}

export interface ProfileSnapshotOptions {
  profile_version: string
  profile_id?: string
  preferred_contexts?: string[]
  accommodations?: string[]
  provenance_ref?: string
}

export function adaptLearnerProfile(
  profile: LearnerProfile,
  options: ProfileSnapshotOptions,
): LearnerProfileSnapshot {
  return {
    schema_version: C_SCHEMA_VERSION,
    profile_id: options.profile_id ?? stableId("PROFILE", { learner_id: profile.learner_id, version: options.profile_version }),
    profile_version: options.profile_version,
    learner_id: profile.learner_id,
    level: profile.level,
    known_concepts: [...profile.known_concepts],
    weak_concepts: [...profile.weak_concepts],
    goal: profile.goal,
    preferred_contexts: [...(options.preferred_contexts ?? [])],
    accommodations: [...(options.accommodations ?? [])],
    provenance_ref: options.provenance_ref,
  }
}

export function defineLearningPathNode(
  input: Omit<LearningPathNode, "schema_version">,
): LearningPathNode {
  return { schema_version: C_SCHEMA_VERSION, ...input }
}
