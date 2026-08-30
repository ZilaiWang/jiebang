import type { RenderBlock } from "../../role-c-content/contracts/artifacts"

export interface Citation {
  source_id: string
  fact_id: string
  relation?: string
}

export interface LessonPayload {
  title: string
  objective_ids: string[]
  prerequisite_bridge: RenderBlock[]
  explanation_blocks: RenderBlock[]
  worked_examples: RenderBlock[]
  misconceptions: Array<{
    misconception_tag: string
    explanation: string
    objective_id: string
    citations: Citation[]
  }>
  micro_checks: Array<{
    block_id: string
    item_id: string
    prompt: string
    options?: Array<{ option_id: string; label: string; text: string }>
    answer_option_id?: string
    answer_explanation?: string
    citations: Citation[]
  }>
  hint_ladders: Array<{
    objective_id: string
    hints: Array<{ hint_level: 1 | 2 | 3; text: string; citations: Citation[] }>
  }>
  summary: RenderBlock[]
  used_evidence: Citation[]
}

export interface CodeLabPayload {
  lab_id: string
  title: string
  objective_ids: string[]
  instructions: RenderBlock[]
  execution_contract: {
    language: "python"
    execution_mode: "function" | "stdin_stdout"
    entry_point?: string
    allowed_imports: string[]
    resource_limits: { timeout_ms: number; memory_mb: number; max_output_bytes: number }
  }
  starter_code: string
  public_tests: Array<{
    test_id: string
    objective_id: string
    description: string
    input: unknown
    expected_behavior: string
    citations: Citation[]
  }>
  hint_ladders: LessonPayload["hint_ladders"]
  reflection_questions: string[]
  programming_task?: {
    schema_version: "programming-task.v1"
    task_id: string
    blueprint_id: string
    task_kind: "code_completion" | "function_implementation" | "stdin_stdout_program" | "debugging_repair"
    submission_mode: "full_code" | "gap_answers"
    statement: string
    input_description: string
    output_description: string
    constraints: string[]
    starter_code?: string
    gap_template?: {
      schema_version: "code-gap-template.v1"
      template_code: string
      gaps: Array<{ gap_id: string; label: string; kind: string; answer_format?: "python_string_literal" | "python_expression" | "python_statement" | "python_identifier"; max_chars: number; max_lines: number; placeholder?: string }>
    }
    public_examples: Array<{ case_id: string; description: string; input: unknown; expected_behavior: string }>
      hint_ladders: Array<{ level: 1 | 2 | 3; text: string }>
    }
    practical_guide?: {
      schema_version: "practical-guide.v1"
      guide_id: string
      plan_id: string
      lab_id: string
      practice_goal: string
      deliverable: string
      estimated_minutes: number
      environment: { language: string; execution_mode: string; entry_point: string | null; input_type: string; output_type: string; allowed_imports: string[]; tool_constraints: string[] }
      readiness_checks: Array<{ title: string; check: string; ready_when: string }>
      steps: Array<{ sequence: number; title: string; action: string; input: string; expected_result: string; verification: string }>
      acceptance_criteria: Array<{ criterion_id: string; public_test_id: string; objective_id: string; description: string; expected_behavior: string }>
      troubleshooting: Array<{ symptom: string; likely_cause: string; recovery_steps: string[]; verification: string }>
      extension_task: { task: string; changed_dimension: string; verification: string }
    }
    used_evidence: Citation[]
}

export interface AssessmentPayload {
  title: string
  items: Array<{
    item_id: string
    display_no: number
    objective_id: string
    tier: 1 | 2 | 3
    difficulty_band?: "foundation" | "improvement" | "integration" | "extension"
    cognitive_level?: "remember" | "understand" | "apply" | "analyze" | "create"
    modality: "mcq" | "true_false" | "trace" | "short_answer" | "code"
    prompt: string
    options?: Array<{ option_id: string; label: string; text: string }>
    starter_code?: string
    max_score: number
    citations: Citation[]
  }>
}

export interface PublicSessionFixture {
  session_id: string
  run_id: string
  status: string
  current_stage: string
  round_no: number
  revision?: number
  waiting_for?: null | { type: string; items: any[] }
  worker_ledger: Array<{
    worker: string
    status: string
    summary?: string
  }>
  worker_ledger_history?: Array<{
    entry_id: string
    round_no: number
    attempt_no: number
    unit_name: string
    execution_type: string
    stage: string
    status: "invoked" | "running" | "waiting_for_user" | "completed" | "blocked" | "failed" | "skipped"
    started_at: string
    finished_at: string | null
    duration_ms: number | null
    output_refs: Array<{
      ref_id: string
      kind: string
      locator: string | null
      visibility: "public" | "internal" | "secure"
      verified_exists: boolean
    }>
    summary: string
    next_action: string | null
    errors: Array<{ code?: string; message: string; severity: string; source: string }>
    retry: null | { eligible: boolean; scheduled: boolean; reason: string | null; next_attempt_no: number | null }
  }>
  content_review?: null | {
    overall_status: "pending" | "reviewing" | "repairing" | "passed" | "failed" | "degraded" | "blocked"
    publish_allowed: boolean
    blocked_or_degraded: boolean
    round_no: number
    policy: string
    workers: Record<string, {
      status: "pending" | "reviewing" | "repairing" | "passed" | "failed" | "degraded" | "blocked"
      published: boolean
      review_attempt_no: number
      repair_attempt_no: number
      last_error: string | null
      updated_at: string
    }>
  }
  profile?: {
    learner_id: string
    level: string
    known_concepts: string[]
    weak_concepts: string[]
    goal: string
  }
  formal_path?: unknown
  current_path_node?: {
    node_id: string
    goal: string
    objectives: Array<{
      objective_id: string
      source_id: string
      required_fact_ids: string[]
      observable_behavior: string
      importance: string
    }>
  }
  rag_result?: unknown
  learning_resources: {
    concept_lesson?: { artifact_id?: string; payload: LessonPayload; citations: Citation[]; status: string }
    code_lab?: { artifact_id?: string; payload: CodeLabPayload; citations: Citation[]; status: string }
  }
  adaptation?: {
    adaptation_action: "remediate" | "reinforce" | "advance"
    target_objective_ids: string[]
    addressed_misconception_tags: string[]
    adaptation_summary: string
    source_feedback_refs: string[]
  } | null
  next_round_action?: null | {
    action: "remediate" | "reinforce" | "advance" | "reprofile"
    round_no: number
    target_node_id: string | null
    feedback_id: string
    status: "generating_next_round" | "waiting_for_reprofile"
  }
  assessment?: { artifact_id?: string; payload: AssessmentPayload; citations: Citation[]; status: string }
  code_execution?: {
    status: "completed" | "passed" | "failed" | "timeout" | "blocked"
    itemId?: string
    labId?: string
    passedChecks?: number
    totalChecks?: number
    scoreRatio?: number
    verdict?: "accepted" | "compile_error" | "wrong_answer" | "presentation_error" | "runtime_error" | "time_limit_exceeded" | "memory_limit_exceeded" | "output_limit_exceeded" | "security_violation" | "internal_error"
    message?: string
    feedback?: Array<{ code: string; message: string }>
    mode?: "sample" | "custom"
    input?: unknown
    expectedBehavior?: string
    actual?: unknown
  } | null
  feedback?: unknown
  blocked_reason?: string | null
  terminal_outcome?: {
    kind: "completed_mastered" | "unsupported_goal" | "insufficient_evidence" | "planning_failed" | "learning_support_required"
    code: "PATH_MASTERED" | "UNSUPPORTED_GOAL" | "INSUFFICIENT_EVIDENCE" | "PATH_PLANNING_FAILED" | "LEARNING_SUPPORT_REQUIRED"
    message: string
    recommended_actions: string[]
    evidence_refs: string[]
  } | null
  /** 与后端 InteractiveEvent 对齐：event_id/event_type/stage/worker/message/timestamp。 */
  events: Array<{
    event_id: string
    event_type: "session_created" | "worker_completed" | "worker_invoked" | "waiting_for_user" | "command_received" | "session_updated" | "session_completed" | "session_blocked"
    stage: string
    worker?: string
    message: string
    timestamp: string
    seq?: number
    status?: string
    occurred_at?: string
    summary?: string
    agent?: string
  }>
  updated_at: string
}
