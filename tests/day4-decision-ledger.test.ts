import { expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { exportDay4DecisionLedger } from "../src/orchestration/day4-decision-ledger"

async function makeEvidence(root: string, mismatch = false): Promise<string> {
  const directory = join(root, "run")
  await mkdir(directory, { recursive: true })
  const decision = {
    session_id: "SESSION-DAY4-1", run_id: "RUN-DAY4-1", round_no: 1,
    status: "waiting_for_user", current_stage: "objective_diagnosis",
    feedback: {
      feedback_id: "FB-1", round_score: { raw_score: 2, max_score: 10, accuracy: 0.2, evidence_score: 0.2 },
      final_decision: { action: "reprofile", reason_codes: ["profile_drift"], target_objective_ids: ["O1"], confidence: 0.9, basis: "profile_drift", policy_ref: "role-c-round-accuracy-v1" },
    },
    next_round_action: { action: mismatch ? "advance" : "reprofile", round_no: 1, target_node_id: "NODE-1", feedback_id: "FB-1", status: "waiting_for_reprofile" },
    worker_ledger_history: [{ entry_id: "W0", round_no: 1, step_index: 5, unit_name: "tiered-evaluator", execution_type: "reviewed_pipeline", stage: "assessment", status: "completed", output_refs: [] }],
  }
  const final = {
    ...decision,
    status: "blocked",
    current_stage: "objective_diagnosis",
    worker_ledger_history: [
      ...decision.worker_ledger_history,
      { entry_id: "W1", round_no: 1, step_index: 6, unit_name: "objective-diagnostician", execution_type: "model_backed_adapter", stage: "objective_diagnosis", status: "completed", summary: "prepared next diagnosis", output_refs: [{ ref_id: "diagnosis:next" }], evidence_refs: [] },
    ],
  }
  const events = {
    session_id: "SESSION-DAY4-1",
    events: [
      { event_id: "E1", event_type: "command_received", stage: "assessment", message: "assessment accepted" },
      { event_id: "E2", event_type: "worker_invoked", stage: "objective_diagnosis", message: "objective-diagnostician prepared next diagnosis" },
      { event_id: "E3", event_type: "session_blocked", stage: "objective_diagnosis", message: "next round blocked" },
    ],
  }
  await Promise.all([
    writeFile(join(directory, "decision-session.json"), JSON.stringify(decision)),
    writeFile(join(directory, "final-session.json"), JSON.stringify(final)),
    writeFile(join(directory, "events.json"), JSON.stringify(events)),
  ])
  return directory
}

test("exports a real decision and observed next-round execution", async () => {
  const root = await mkdtemp(join(tmpdir(), "day4-ledger-"))
  const run = await makeEvidence(root)
  const output = join(root, "out", "decision-ledger.jsonl")
  const { entry } = await exportDay4DecisionLedger({ run_directory: run, output_file: output })
  expect(entry).toMatchObject({
    session_id: "SESSION-DAY4-1",
    decision: { action: "reprofile", target_node_id: "NODE-1" },
    state_transition: { from_stage: "assessment", to_stage: "objective_diagnosis" },
    next_round_execution: { observed: true, final_status: "blocked", units: [{ unit_name: "objective-diagnostician", execution_type: "model_backed_adapter", output_refs: ["diagnosis:next"] }] },
    observability: { evidence_level: "E3", limitations: [expect.any(String)] },
  })
  expect(entry.evidence_refs.every((ref) => !ref.startsWith("/") && !/^[A-Za-z]:[\\/]/u.test(ref))).toBe(true)
  expect((await readFile(output, "utf8")).trim().split("\n")).toHaveLength(1)
})

test("rejects a hand-edited action mismatch", async () => {
  const root = await mkdtemp(join(tmpdir(), "day4-ledger-mismatch-"))
  const run = await makeEvidence(root, true)
  await expect(exportDay4DecisionLedger({ run_directory: run, output_file: join(root, "out.jsonl") }))
    .rejects.toThrow("actions do not match")
})

test("accepts a reviewed next round waiting for assessment in the same public round number", async () => {
  const root = await mkdtemp(join(tmpdir(), "day4-ledger-ready-"))
  const run = await makeEvidence(root)
  const finalPath = join(run, "final-session.json")
  const final = JSON.parse(await readFile(finalPath, "utf8"))
  final.status = "waiting_for_user"
  final.current_stage = "assessment"
  final.waiting_for = { type: "assessment_answers", items: [] }
  final.next_round_action = null
  await writeFile(finalPath, JSON.stringify(final))
  const { entry } = await exportDay4DecisionLedger({ run_directory: run, output_file: join(root, "out.jsonl") })
  expect(entry.next_round_execution).toMatchObject({ observed: true, final_status: "waiting_for_user", final_stage: "assessment" })
  expect(entry.observability.limitations).toEqual([])
})
