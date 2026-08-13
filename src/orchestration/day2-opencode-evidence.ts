import { mkdir, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import type { InteractiveSessionRecord, LedgerRef, WorkerLedgerHistoryEntry } from "./interactive-session"

export interface Day2WorkerEnvelope {
  schema_version: "1.0"
  entry_id: string
  session_id: string
  run_id: string
  round_no: number
  step_index: number
  attempt_no: number
  orchestrator: "learning-orchestrator"
  unit_name: string
  execution_type: WorkerLedgerHistoryEntry["execution_type"]
  status: WorkerLedgerHistoryEntry["status"]
  stage: string
  started_at: string
  finished_at: string | null
  input_refs: LedgerRef[]
  output_refs: LedgerRef[]
  evidence_refs: LedgerRef[]
  execution_ref: LedgerRef | null
  errors: WorkerLedgerHistoryEntry["errors"]
  retry: WorkerLedgerHistoryEntry["retry"]
  manual_intervention: WorkerLedgerHistoryEntry["manual_intervention"]
  observability: WorkerLedgerHistoryEntry["observability"]
}

export interface Day2OpenCodeRun {
  schema_version: "1.0"
  main_agent: "learning-orchestrator"
  session_id: string
  run_id: string
  session_status: string
  current_stage: string
  generated_at: string
  source_session_ref: string
  runtime_truth: {
    opencode_registry_present: true
    opencode_task_execution_observed: boolean
    execution_types_observed: WorkerLedgerHistoryEntry["execution_type"][]
    statement: string
  }
  call_sequence: Array<{
    sequence_index: number
    entry_id: string
    unit_name: string
    execution_type: WorkerLedgerHistoryEntry["execution_type"]
    status: WorkerLedgerHistoryEntry["status"]
    stage: string
    attempt_no: number
    output_ref_ids: string[]
    error_codes: string[]
    manual_intervention: boolean
  }>
  checks: {
    append_only_history_present: boolean
    all_entries_have_execution_ref: boolean
    completed_entries_have_verified_output: boolean
    blocked_or_failed_entries_preserved: number
    opencode_subagent_claims_without_observed_task: number
  }
}

export async function exportDay2OpenCodeEvidence(input: {
  record: InteractiveSessionRecord
  source_session_ref: string
  output_directory: string
  now?: () => string
}): Promise<{ run: Day2OpenCodeRun; envelopes: Day2WorkerEnvelope[] }> {
  const history = input.record.worker_ledger_history ?? []
  if (history.length === 0) throw new Error("worker_ledger_history is empty; Day 2 requires append-only runtime evidence")

  const envelopes = history.map(toEnvelope)
  const executionTypes = [...new Set(history.map((entry) => entry.execution_type))]
  const opencodeTaskObserved = history.some((entry) => entry.execution_type === "opencode_subagent")
  const run: Day2OpenCodeRun = {
    schema_version: "1.0",
    main_agent: "learning-orchestrator",
    session_id: input.record.session_id,
    run_id: input.record.run_id,
    session_status: input.record.status,
    current_stage: input.record.current_stage,
    generated_at: (input.now ?? (() => new Date().toISOString()))(),
    source_session_ref: input.source_session_ref,
    runtime_truth: {
      opencode_registry_present: true,
      opencode_task_execution_observed: opencodeTaskObserved,
      execution_types_observed: executionTypes,
      statement: opencodeTaskObserved
        ? "本次运行包含可观测的 OpenCode task/subagent 执行。"
        : "本次运行使用 OpenCode 风格 envelope 与主 Agent 调度记录；未观测到 OpenCode task ID，所有执行单元按 ledger 的真实 execution_type 标注。",
    },
    call_sequence: history.map((entry, sequenceIndex) => ({
      sequence_index: sequenceIndex + 1,
      entry_id: entry.entry_id,
      unit_name: entry.unit_name,
      execution_type: entry.execution_type,
      status: entry.status,
      stage: entry.stage,
      attempt_no: entry.attempt_no,
      output_ref_ids: entry.output_refs.map((ref) => ref.ref_id),
      error_codes: entry.errors.map((error) => error.code ?? "UNSPECIFIED"),
      manual_intervention: entry.manual_intervention.occurred,
    })),
    checks: {
      append_only_history_present: true,
      all_entries_have_execution_ref: history.every((entry) => entry.execution_ref?.verified_exists === true),
      completed_entries_have_verified_output: history
        .filter((entry) => entry.status === "completed")
        .every((entry) => entry.output_refs.some((ref) => ref.verified_exists)),
      blocked_or_failed_entries_preserved: history.filter((entry) => entry.status === "blocked" || entry.status === "failed").length,
      opencode_subagent_claims_without_observed_task: history.filter((entry) =>
        entry.execution_type === "opencode_subagent" && entry.execution_ref?.source !== "opencode"
      ).length,
    },
  }

  const outputDirectory = resolve(input.output_directory)
  await mkdir(outputDirectory, { recursive: true })
  await writeFile(resolve(outputDirectory, "opencode-run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8")
  await writeFile(
    resolve(outputDirectory, "worker-envelopes.jsonl"),
    `${envelopes.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
    "utf8",
  )
  return { run, envelopes }
}

function toEnvelope(entry: WorkerLedgerHistoryEntry): Day2WorkerEnvelope {
  return {
    schema_version: "1.0",
    entry_id: entry.entry_id,
    session_id: entry.session_id,
    run_id: entry.run_id,
    round_no: entry.round_no,
    step_index: entry.step_index,
    attempt_no: entry.attempt_no,
    orchestrator: entry.orchestrator,
    unit_name: entry.unit_name,
    execution_type: entry.execution_type,
    status: entry.status,
    stage: entry.stage,
    started_at: entry.started_at,
    finished_at: entry.finished_at,
    input_refs: entry.input_refs,
    output_refs: entry.output_refs,
    evidence_refs: entry.evidence_refs,
    execution_ref: entry.execution_ref,
    errors: entry.errors,
    retry: entry.retry,
    manual_intervention: entry.manual_intervention,
    observability: entry.observability,
  }
}
