import type { WorkflowAgentName } from "../agents/types"
import type { LearningGoalSpecInput } from "../knowledge/curriculum"
import type { PersistenceEvent } from "./learner-memory"

export type OrchestrationState =
  | "created"
  | "intake_ready"
  | "background_collected"
  | "self_assessed"
  | "objective_diagnosed"
  | "profile_built"
  | "path_planned"
  | "concept_ready"
  | "lab_ready"
  | "assessment_ready"
  | "completed"
  | "blocked"
  | "failed"

export type WorkerName = Exclude<WorkflowAgentName, "learning-orchestrator">

export type OrchestrationMode = "scaffold" | "deterministic"

export interface OrchestrationStepDefinition {
  from: OrchestrationState
  worker: WorkerName
  to: OrchestrationState
}

export interface OrchestrationTransitionError {
  code: "ILLEGAL_TRANSITION" | "WRONG_WORKER" | "TERMINAL_STATE"
  message: string
}

export type OrchestrationTransitionResult =
  | {
      ok: true
      state: OrchestrationState
      reason?: string
    }
  | {
      ok: false
      state: OrchestrationState
      error: OrchestrationTransitionError
    }

export type OrchestrationTransitionEvent =
  | { type: "intake_ready" }
  | { type: "worker_completed"; worker: WorkerName }
  | { type: "complete" }
  | { type: "block"; reason: string }
  | { type: "fail"; reason: string }

export interface LearnerRequest {
  learner_id?: string
  goal: string
  background?: string
  self_rating?: string
  diagnostic_seed?: string
  learning_goal_spec?: LearningGoalSpecInput
}

export interface MasteryUpdate {
  source_id: string
  mastery: number
  evidence: string
}

export interface LearnedUserFact {
  key: string
  value: string
  confidence: number
}

export interface ClarificationRequest {
  question: string
  reason: string
  expected_answer_type: "choice" | "text" | "scale"
  options?: string[]
}

export interface NextStepRecommendation {
  action: "continue" | "ask_clarification" | "remediate" | "reinforce" | "advance"
  reason: string
}

export interface EvidenceRef {
  ref_id: string
  kind: "profile" | "rag" | "generation_spec" | "artifact" | "review" | "assessment" | "trace"
  source: "A" | "B" | "C" | "D" | "orchestrator"
  content_hash?: string
  path?: string
}

export interface WorkerError {
  code: string
  message: string
  severity: "warning" | "recoverable" | "fatal"
  details?: Record<string, unknown>
}

export interface WorkerExecutionEnvelope {
  worker: WorkerName
  status: "completed" | "blocked" | "failed"
  execution_id: string
  marker: string
}

export interface WorkerInvocation {
  schema_version: "1.0"
  session_id: string
  run_id: string
  step_index: number
  stage: OrchestrationState
  worker: WorkerName
  learner_request: LearnerRequest
  upstream_artifacts: Record<string, unknown>
  input_refs: string[]
  evidence_refs: EvidenceRef[]
  retry_count: number
  mode: OrchestrationMode
}

export interface WorkerResult {
  schema_version: "1.0"
  run_id: string
  step_index: number
  worker: WorkerName
  stage: OrchestrationState
  status: "completed" | "blocked" | "failed"
  marker: string
  execution: WorkerExecutionEnvelope
  summary: string
  artifacts: Record<string, unknown>
  output_refs: string[]
  evidence_refs: EvidenceRef[]
  next: OrchestrationState | "complete" | "blocked" | "failed"
  errors: WorkerError[]
  persistence_events?: PersistenceEvent[]
  mastery_updates?: MasteryUpdate[]
  learned_facts_about_user?: LearnedUserFact[]
  clarification_requests?: ClarificationRequest[]
  next_step_recommendation?: NextStepRecommendation
}

export type TraceEventType =
  | "session_started"
  | "orchestrator_decision"
  | "worker_invoked"
  | "worker_completed"
  | "worker_blocked"
  | "worker_failed"
  | "state_transition"
  | "session_completed"
  | "session_blocked"
  | "session_failed"

export interface TraceEvent {
  schema_version: "1.0"
  run_id: string
  session_id: string
  step_index: number
  event_type: TraceEventType
  stage: OrchestrationState
  worker?: WorkerName
  message: string
  input_refs: string[]
  output_refs: string[]
  evidence_refs: EvidenceRef[]
  duration_ms?: number
  result_size_bytes?: number
  error?: WorkerError
  timestamp: string
}

export interface OrchestrationRunSummary {
  schema_version: "1.0"
  run_id: string
  session_id: string
  mode: OrchestrationMode
  status: "completed" | "blocked" | "failed"
  started_at: string
  finished_at: string
  total_steps: number
  completed_steps: number
  blocked_stage?: OrchestrationState
  failed_stage?: OrchestrationState
  events: TraceEvent[]
  artifacts: Record<string, string>
  persistence_events: PersistenceEvent[]
  clarification_requests: ClarificationRequest[]
  learner_memory_ref?: string
}
