import type { ExecutionContract } from "../contracts/artifacts"

export type ProgrammingTaskKind =
  | "code_completion"
  | "function_implementation"
  | "stdin_stdout_program"
  | "debugging_repair"

export type ProgrammingSubmissionMode = "full_code" | "gap_answers"

export type ProgrammingProgressBand =
  | "needs_reteach"
  | "developing"
  | "ready_for_transfer"
  | "mastered"

export type ProgrammingGoalProfile =
  | "coursework"
  | "algorithm_competition"
  | "job_interview"
  | "project"
  | "general_learning"

export type ProgrammingLearnerLevel = "beginner" | "basic" | "intermediate" | "integrated"

export interface TestPartitionPlan {
  partition_id: string
  label: string
  kind: "nominal" | "boundary" | "anti_hardcode" | "error_path"
  minimum_cases: number
  generation_instruction: string
}

export interface ProgrammingProblemBlueprint {
  schema_version: "programming-problem-blueprint.v1"
  blueprint_id: string
  objective_ids: string[]
  source_ids: string[]
  task_kind: ProgrammingTaskKind
  submission_mode: ProgrammingSubmissionMode
  goal_profile: ProgrammingGoalProfile
  learner_level: ProgrammingLearnerLevel
  progress_band: ProgrammingProgressBand
  title_brief: string
  scenario_brief: string
  learner_owned_behavior: string
  execution_contract: ExecutionContract
  test_partitions: TestPartitionPlan[]
  public_case_count: number
  hidden_case_count: number
  required_mutation_count: number
  require_secondary_oracle: boolean
  fact_refs: Array<{ source_id: string; fact_id: string }>
}

export type CodeGapKind = "identifier" | "literal" | "expression" | "statement" | "block"

export interface CodeGapSpec {
  gap_id: string
  label: string
  kind: CodeGapKind
  answer_format?: "python_string_literal" | "python_expression" | "python_statement" | "python_identifier"
  max_chars: number
  max_lines: number
  placeholder?: string
}

export interface CodeGapTemplate {
  schema_version: "code-gap-template.v1"
  template_code: string
  gaps: CodeGapSpec[]
}

export interface TestInputCandidate {
  case_id: string
  partition_id: string
  input: unknown
  note: string
}

export type JudgeVerdict =
  | "accepted"
  | "compile_error"
  | "wrong_answer"
  | "presentation_error"
  | "runtime_error"
  | "time_limit_exceeded"
  | "memory_limit_exceeded"
  | "output_limit_exceeded"
  | "security_violation"
  | "internal_error"
