import { expect, test } from "bun:test"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { exportDay5CollaborationMetrics } from "../src/orchestration/day5-collaboration-metrics"

const units = ["background-collector", "self-assessor", "objective-diagnostician", "profile-builder", "path-planner", "concept-tutor", "code-lab", "tiered-evaluator"]

async function writeSession(root: string, index: number, options?: { missingLedger?: boolean; blocked?: boolean; missingOutput?: string }): Promise<string> {
  const path = join(root, `session-${index}.json`)
  const history = options?.missingLedger ? undefined : units.map((unit, step) => ({
    entry_id: `E-${index}-${step}`,
    session_id: `SESSION-${index}`,
    run_id: `RUN-${index}`,
    round_no: 1,
    step_index: step,
    attempt_no: 1,
    orchestrator: "learning-orchestrator",
    unit_name: unit,
    execution_type: unit === "tiered-evaluator" ? "reviewed_pipeline" : "deterministic_adapter",
    stage: unit === "tiered-evaluator" ? "assessment" : "objective_diagnosis",
    status: "completed",
    started_at: "2026-08-16T00:00:00.000Z",
    finished_at: "2026-08-16T00:00:01.000Z",
    input_refs: [],
    output_refs: [{ ref_id: `${unit}:artifact`, verified_exists: unit !== options?.missingOutput }],
    evidence_refs: [],
    execution_ref: { ref_id: `${unit}:execution`, verified_exists: true },
    errors: [],
    retry: { is_retry: false },
    manual_intervention: { occurred: false },
    observability: {},
  }))
  await writeFile(path, JSON.stringify({
    session_id: `SESSION-${index}`,
    run_id: `RUN-${index}`,
    status: options?.blocked ? "blocked" : "waiting_for_user",
    round_no: 2,
    events: [{ event_id: `EVENT-${index}` }],
    worker_ledger_history: history,
    feedback: options?.blocked ? null : { final_decision: { action: "advance" } },
  }))
  return path
}

test("exports collaboration metrics from three complete session ledgers", async () => {
  const root = await mkdtemp(join(tmpdir(), "day5-metrics-"))
  const sessions = await Promise.all([1, 2, 3].map((index) => writeSession(root, index)))
  const output = join(root, "out", "agent-collaboration-metrics.json")
  const metrics = await exportDay5CollaborationMetrics({ session_files: sessions, output_file: output, now: () => "2026-08-16T00:00:00.000Z" })
  expect(metrics).toMatchObject({ sample_count: 3, complete_session_count: 3, collaboration_chain_complete_count: 3, collaboration_completion_rate: 1 })
  expect(metrics.runs.every((run) => run.collaboration_chain_complete)).toBe(true)
  expect(metrics.runs.every((run) => !run.source_session_ref.startsWith("/"))).toBe(true)
  expect(JSON.parse(await readFile(output, "utf8"))).toEqual(metrics)
})

test("keeps a failed artifact check in the denominator", async () => {
  const root = await mkdtemp(join(tmpdir(), "day5-metrics-output-"))
  const sessions = await Promise.all([
    writeSession(root, 1),
    writeSession(root, 2),
    writeSession(root, 3, { missingOutput: "code-lab" }),
  ])
  const metrics = await exportDay5CollaborationMetrics({ session_files: sessions, output_file: join(root, "out.json") })
  expect(metrics.collaboration_chain_complete_count).toBe(2)
  expect(metrics.collaboration_completion_rate).toBeCloseTo(2 / 3)
  expect(metrics.runs[2].completed_units_without_verified_output).toContain("code-lab")
  expect(metrics.runs[2].unit_output_coverage_complete).toBe(false)
})

test("rejects summary files without append-only worker ledger", async () => {
  const root = await mkdtemp(join(tmpdir(), "day5-metrics-summary-"))
  const sessions = await Promise.all([1, 2, 3].map((index) => writeSession(root, index, { missingLedger: index === 1 })))
  await expect(exportDay5CollaborationMetrics({ session_files: sessions, output_file: join(root, "out.json") }))
    .rejects.toThrow("worker_ledger_history missing")
})

test("requires three complete sessions even when blocked runs are preserved", async () => {
  const root = await mkdtemp(join(tmpdir(), "day5-metrics-blocked-"))
  const sessions = await Promise.all([
    writeSession(root, 1),
    writeSession(root, 2),
    writeSession(root, 3, { blocked: true }),
  ])
  await expect(exportDay5CollaborationMetrics({ session_files: sessions, output_file: join(root, "out.json") }))
    .rejects.toThrow("at least three complete sessions; received 2")
})
