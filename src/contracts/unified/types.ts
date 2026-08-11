import type {
  Difficulty,
  LearningArtifactView,
  LearningPathNodeView,
  RetrievalItemView,
  RoleDSession,
  WorkflowEventView,
} from "./legacy-role-d-types"

export type LooseRecord = Record<string, any>
export const UNIFIED_SCHEMA_VERSION = "1.0" as const
export interface UnifiedObservedSegments { profile: boolean; retrieval: boolean; content: boolean }
export interface UnifiedHandoff extends RoleDSession { schemaVersion: typeof UNIFIED_SCHEMA_VERSION; observedSegments: UnifiedObservedSegments }
export interface UnifiedRagResult { query: string; topK: number; results: RetrievalItemView[] }
export type UnifiedCitation = { sourceId: string; factId: string }
export type UnifiedContractBoundary = "B_PROFILE_TO_A_RAG_REQUEST" | "A_RAG_RESULT_TO_C_CONTENT" | "C_ARTIFACTS_TO_D_SESSION" | "A_B_C_D_FULL_HANDOFF"
export interface UnifiedBoundaryReport { boundary: UnifiedContractBoundary; schemaVersion: typeof UNIFIED_SCHEMA_VERSION; canonicalFields: string[]; evidenceGaps: string[] }
export type { Difficulty, LearningArtifactView, LearningPathNodeView, RetrievalItemView, RoleDSession, WorkflowEventView }
