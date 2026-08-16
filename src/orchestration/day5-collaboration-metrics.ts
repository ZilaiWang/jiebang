import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, relative, resolve } from "node:path"
import type { InteractiveSessionRecord, WorkerLedgerHistoryEntry } from "./interactive-session"

const EXPECTED_UNITS = [
  "background-collector",
  "self-assessor",
  "objective-diagnostician",
  "profile-builder",
  "path-planner",
  "concept-tutor",
  "code-lab",
  "tiered-evaluator",
] as const

export interface Day5RunMetric {
  session_id: string
  run_id: string
  source_session_ref: string
  session_status: string
  round_no: number
  decision_action: string | null
  observed_units: string[]
  missing_expected_units: string[]
  blocked_or_failed_entries: number
  error_codes: string[]
  retry_entries: number
  manual_intervention_entries: number
  completed_units_with_verified_output: string[]
  completed_units_without_verified_output: string[]
  unit_output_coverage_complete: boolean
  collaboration_chain_complete: boolean
}

export interface Day5CollaborationMetrics {
  schema_version: "1.0"
  generated_at: string
  expected_units: string[]
  sample_count: number
  complete_session_count: number
  collaboration_chain_complete_count: number
  collaboration_completion_rate: number
  runs_with_blocked_or_failed_entries: number
  runs: Day5RunMetric[]
  calculation: {
    denominator: "all supplied real session files"
    numerator: "non-blocked runs with a feedback decision, no blocked/failed ledger entry, and every expected unit completed with a verified output ref"
    artifact_rule: "only output_refs with verified_exists=true count as existing artifacts"
  }
}

export async function exportDay5CollaborationMetrics(input: {
  session_files: string[]
  output_file: string
  now?: () => string
}): Promise<Day5CollaborationMetrics> {
  if (input.session_files.length < 3) {
    throw new Error("Day 5 collaboration metrics require at least three session files")
  }
  const outputFile = resolve(input.output_file)
  const sessions = await Promise.all(input.session_files.map(async (file) => ({
    path: resolve(file),
    record: JSON.parse(await readFile(resolve(file), "utf8")) as InteractiveSessionRecord,
  })))
  const identities = new Set<string>()
  const runs = sessions.map(({ path, record }) => {
    validateSession(record, path)
    const identity = `${record.session_id}:${record.run_id}`
    if (identities.has(identity)) throw new Error(`duplicate Day 5 run identity: ${identity}`)
    identities.add(identity)
    return toRunMetric(record, relative(dirname(outputFile), path).replaceAll("\\", "/"))
  })
  const completeSessionCount = runs.filter((run) => isCompleteSession(run)).length
  if (completeSessionCount < 3) {
    throw new Error(`Day 5 requires at least three complete sessions; received ${completeSessionCount}`)
  }
  const completeChains = runs.filter((run) => run.collaboration_chain_complete).length
  const metrics: Day5CollaborationMetrics = {
    schema_version: "1.0",
    generated_at: (input.now ?? (() => new Date().toISOString()))(),
    expected_units: [...EXPECTED_UNITS],
    sample_count: runs.length,
    complete_session_count: completeSessionCount,
    collaboration_chain_complete_count: completeChains,
    collaboration_completion_rate: completeChains / runs.length,
    runs_with_blocked_or_failed_entries: runs.filter((run) => run.blocked_or_failed_entries > 0).length,
    runs,
    calculation: {
      denominator: "all supplied real session files",
      numerator: "non-blocked runs with a feedback decision, no blocked/failed ledger entry, and every expected unit completed with a verified output ref",
      artifact_rule: "only output_refs with verified_exists=true count as existing artifacts",
    },
  }
  await mkdir(dirname(outputFile), { recursive: true })
  await writeFile(outputFile, `${JSON.stringify(metrics, null, 2)}\n`, "utf8")
  return metrics
}

function validateSession(record: InteractiveSessionRecord, path: string): void {
  if (!record.session_id || !record.run_id) throw new Error(`session identity missing: ${path}`)
  if (!Array.isArray(record.events) || record.events.length === 0) throw new Error(`session events missing: ${path}`)
  if (!Array.isArray(record.worker_ledger_history) || record.worker_ledger_history.length === 0) {
    throw new Error(`worker_ledger_history missing: ${path}`)
  }
}

function toRunMetric(record: InteractiveSessionRecord, sourceRef: string): Day5RunMetric {
  const history = record.worker_ledger_history as WorkerLedgerHistoryEntry[]
  const observedUnits = unique(history.map((entry) => entry.unit_name))
  const completedEntries = history.filter((entry) => entry.status === "completed")
  const completedUnits = unique(completedEntries.map((entry) => entry.unit_name))
  const completedWithOutput = unique(completedEntries
    .filter((entry) => entry.output_refs.some((ref) => ref.verified_exists === true))
    .map((entry) => entry.unit_name))
  const missingExpected = EXPECTED_UNITS.filter((unit) => !observedUnits.includes(unit))
  const withoutOutput = completedUnits.filter((unit) => !completedWithOutput.includes(unit))
  const blockedOrFailedEntries = history.filter((entry) => entry.status === "blocked" || entry.status === "failed").length
  const action = decisionAction(record.feedback)
  const unitOutputCoverageComplete = missingExpected.length === 0
    && EXPECTED_UNITS.every((unit) => completedWithOutput.includes(unit))
  return {
    session_id: record.session_id,
    run_id: record.run_id,
    source_session_ref: sourceRef,
    session_status: record.status,
    round_no: record.round_no,
    decision_action: action,
    observed_units: observedUnits,
    missing_expected_units: missingExpected,
    blocked_or_failed_entries: blockedOrFailedEntries,
    error_codes: unique(history.flatMap((entry) => entry.errors.map((error) => error.code ?? "UNSPECIFIED"))),
    retry_entries: history.filter((entry) => entry.retry?.scheduled === true || entry.attempt_no > 1).length,
    manual_intervention_entries: history.filter((entry) => entry.manual_intervention.occurred).length,
    completed_units_with_verified_output: completedWithOutput,
    completed_units_without_verified_output: withoutOutput,
    unit_output_coverage_complete: unitOutputCoverageComplete,
    collaboration_chain_complete: record.status !== "blocked"
      && action !== null
      && blockedOrFailedEntries === 0
      && unitOutputCoverageComplete,
  }
}

function isCompleteSession(run: Day5RunMetric): boolean {
  return run.decision_action !== null && run.round_no >= 1 && run.session_status !== "blocked"
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort()
}

function decisionAction(feedback: unknown): string | null {
  if (!feedback || typeof feedback !== "object") return null
  const decision = (feedback as { final_decision?: unknown }).final_decision
  if (!decision || typeof decision !== "object") return null
  const action = (decision as { action?: unknown }).action
  return typeof action === "string" && action.length > 0 ? action : null
}
