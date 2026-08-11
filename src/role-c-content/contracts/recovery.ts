import type { SchemaVersion } from "./common"
import type {
  LearnerProfileSnapshot,
  LearningObjective,
  LearningPathNode,
} from "./profile-adapter"

export interface RoleBPathDraftObjective
  extends Omit<LearningObjective, "required_fact_ids"> {
  /** Empty until C binds the objective to A's refreshed frozen evidence. */
  required_fact_ids: string[]
}

/** B planning result before C has completed evidence binding. */
export interface RoleBPathDraft
  extends Omit<LearningPathNode, "objectives"> {
  objectives: RoleBPathDraftObjective[]
}

export interface RoleBPathPlanningRequest {
  schema_version: SchemaVersion
  request_id: string
  run_id: string
  current_spec_id: string
  profile_snapshot: LearnerProfileSnapshot
  current_path_node: LearningPathNode
  failed_dimensions: string[]
  missing_prerequisite_source_ids: string[]
  required_action: "replan_path"
  fix_scope: "new_spec"
  recommended_level?: LearnerProfileSnapshot["level"]
  review_instruction_ids: string[]
}

export type RoleBPathPlanningResult =
  | {
      status: "ready"
      request_id: string
      path_draft: RoleBPathDraft
      /** B may return a newer profile together with the replanned node. */
      profile_snapshot?: LearnerProfileSnapshot
    }
  | {
      status: "blocked"
      request_id: string
      code: "BLOCKED" | "UNSUPPORTED_TARGET"
      reason: string
      failed_dimensions: string[]
      missing_prerequisite_source_ids: string[]
      recommended_level?: LearnerProfileSnapshot["level"]
      can_recover: false
    }

/** C-facing boundary; B may implement it locally, over HTTP, or through MCP. */
export interface RoleBPathPlanningPort {
  replanLearningPath(
    request: RoleBPathPlanningRequest,
  ): Promise<RoleBPathPlanningResult>
}
