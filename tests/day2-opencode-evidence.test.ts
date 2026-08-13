import { expect, test } from "bun:test"
import { mkdtemp, readFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { exportDay2OpenCodeEvidence } from "../src/orchestration/day2-opencode-evidence"
import type { InteractiveSessionRecord, WorkerLedgerHistoryEntry } from "../src/orchestration/interactive-session"

function ledger(status: WorkerLedgerHistoryEntry["status"], index: number): WorkerLedgerHistoryEntry {
  return {
    schema_version: "1.0", entry_id: `ENTRY-${index}`, run_id: "RUN-DAY2", session_id: "SESSION-DAY2",
    round_no: 1, step_index: index, attempt_no: 1, parent_entry_id: null, orchestrator: "learning-orchestrator",
    unit_name: index === 1 ? "profile-builder" : "tiered-evaluator", execution_type: index === 1 ? "deterministic_adapter" : "reviewed_pipeline",
    stage: "assessment", status, started_at: "2026-08-13T00:00:00.000Z", finished_at: status === "running" ? null : "2026-08-13T00:00:01.000Z",
    duration_ms: 1000, input_refs: [], output_refs: status === "completed" ? [{ ref_id: `ART-${index}`, kind: "artifact", source: "C", locator: `sessions/SESSION-DAY2.json#/artifact-${index}`, visibility: "internal", verified_exists: true }] : [], evidence_refs: [],
    execution_ref: { ref_id: `TRACE-${index}`, kind: "trace", source: "orchestrator", locator: "sessions/SESSION-DAY2.json#/worker_ledger_history", visibility: "internal", verified_exists: true },
    summary: status, next_action: null, decision_source: "orchestrator", errors: status === "blocked" ? [{ code: "CODE_RUNNER_UNAVAILABLE", message: "runner unavailable", severity: "recoverable", source: "C" }] : [], retry: null,
    manual_intervention: { occurred: false, kind: null, reason: null, occurred_at: null, evidence_ref: null },
    observability: { execution_observed: true, input_observed: true, output_observed: status === "completed", artifact_verified: status === "completed", evidence_level: "E3", source_event_ids: [], limitations: [] },
  }
}

test("exports truthful Day 2 envelopes without inventing OpenCode task execution", async () => {
  const output = await mkdtemp(join(tmpdir(), "day2-evidence-"))
  const record = {
    session_id: "SESSION-DAY2", run_id: "RUN-DAY2", status: "waiting_for_user", current_stage: "assessment",
    worker_ledger_history: [ledger("blocked", 2), ledger("completed", 1), ledger("completed", 2)],
  } as unknown as InteractiveSessionRecord
  const result = await exportDay2OpenCodeEvidence({ record, source_session_ref: "session-public.json", output_directory: output, now: () => "2026-08-13T01:00:00.000Z" })
  expect(result.run.runtime_truth.opencode_task_execution_observed).toBe(false)
  expect(result.run.checks.blocked_or_failed_entries_preserved).toBe(1)
  expect(result.run.checks.opencode_subagent_claims_without_observed_task).toBe(0)
  expect(result.envelopes).toHaveLength(3)
  expect((await readFile(join(output, "worker-envelopes.jsonl"), "utf8")).trim().split("\n")).toHaveLength(3)
  expect(JSON.parse(await readFile(join(output, "opencode-run.json"), "utf8"))).toEqual(result.run)
})

test("rejects a session without append-only runtime evidence", async () => {
  const output = await mkdtemp(join(tmpdir(), "day2-evidence-empty-"))
  const record = { session_id: "EMPTY", run_id: "EMPTY", worker_ledger_history: [] } as unknown as InteractiveSessionRecord
  await expect(exportDay2OpenCodeEvidence({ record, source_session_ref: "empty.json", output_directory: output })).rejects.toThrow("worker_ledger_history is empty")
})
