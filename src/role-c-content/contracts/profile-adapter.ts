import type { LearnerProfile } from "../../role-b-profile/types"
import type { RoleCPedagogyContract } from "../../role-b-profile/pedagogy-contract"
import type { RoleCExpressionContext } from "../../role-b-profile/expression-context-contract"
import type { ProfileConfidenceState } from "../../role-b-profile/profile-confidence"
import type { LearningBarrier } from "../../role-b-profile/profile-gap-questions"
import { redactDirectIdentifiers, sanitizeFreeTextList } from "../../privacy/privacy-boundary"
import type { GoalProfile } from "../planning/personalization-policy"
import type { LearnerLevel, SchemaVersion } from "./common"
import { C_SCHEMA_VERSION, stableId } from "./canonical"

export type ObservableBehavior = "recognize" | "explain" | "trace" | "apply" | "debug" | "create"

export const LEARNER_PROFILE_SNAPSHOT_CONTRACT_VERSION = "learner-profile-snapshot.v1.1" as const
export const LEARNER_PROFILE_SNAPSHOT_CONTRACT_KEYS = {
  root: [
    "schema_version", "profile_id", "profile_version", "learner_id", "level",
    "known_concepts", "weak_concepts", "goal", "goal_profile",
    "learning_barriers", "confidence_state", "preferred_contexts",
    "accommodations", "provenance_ref", "pedagogy_contract", "expression_context",
  ],
} as const

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
  goal_profile?: GoalProfile
  learning_barriers?: Array<{ source_id: string; barrier: LearningBarrier; count: number }>
  confidence_state?: ProfileConfidenceState
  preferred_contexts: string[]
  accommodations: string[]
  provenance_ref?: string
  /** Deterministic B-owned teaching policy. Facts, objectives and answers stay locked. */
  pedagogy_contract?: RoleCPedagogyContract
  /** B-owned, privacy-safe policy for examples, terminology and hints. */
  expression_context?: RoleCExpressionContext
}

export interface LearningObjective {
  objective_id: string
  source_id: string
  required_fact_ids: string[]
  observable_behavior: ObservableBehavior
  importance: "core" | "supporting"
  /**
   * 显式声明本节点的主要实验目标（由上游路径规划标记，不依赖数组顺序）。
   * code-lab 的执行契约（task_kind/execution_mode）由 primary objective 决定，
   * supporting objectives 只提供证据。缺省视为非 primary。
   */
  is_primary?: boolean
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
  goal_profile?: GoalProfile
  preferred_contexts?: string[]
  accommodations?: string[]
  learning_barriers?: Array<{ source_id: string; barrier: LearningBarrier; count: number }>
  confidence_state?: ProfileConfidenceState
  provenance_ref?: string
  pedagogy_contract?: RoleCPedagogyContract
  expression_context?: RoleCExpressionContext
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
    goal: redactDirectIdentifiers(profile.goal),
    ...(options.goal_profile ?? profile.goal_profile
      ? { goal_profile: options.goal_profile ?? profile.goal_profile }
      : {}),
    preferred_contexts: sanitizeFreeTextList(options.preferred_contexts ?? []),
    accommodations: sanitizeFreeTextList(options.accommodations ?? []),
    ...(options.provenance_ref ? { provenance_ref: options.provenance_ref } : {}),
    ...((options.learning_barriers ?? profile.learning_barriers)
      ? { learning_barriers: structuredClone(options.learning_barriers ?? profile.learning_barriers ?? []) }
      : {}),
    ...((options.confidence_state ?? profile.confidence_state)
      ? { confidence_state: structuredClone(options.confidence_state ?? profile.confidence_state) }
      : {}),
    ...(options.pedagogy_contract
      ? { pedagogy_contract: structuredClone(options.pedagogy_contract) }
      : {}),
    ...(options.expression_context
      ? { expression_context: structuredClone(options.expression_context) }
      : {}),
  }
}

export function defineLearningPathNode(
  input: Omit<LearningPathNode, "schema_version">,
): LearningPathNode {
  return { schema_version: C_SCHEMA_VERSION, ...input }
}
