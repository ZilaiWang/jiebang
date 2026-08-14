import { expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { exportDay3AuditWorkerLedger } from "../src/orchestration/day3-audit-worker-ledger"

async function fixture(input: {
  root: string
  name: string
  status: "ready" | "blocked"
  review: "pass" | "not_reached"
}): Promise<string> {
  const directory = join(input.root, input.name)
  await mkdir(directory, { recursive: true })
  await Bun.write(join(directory, "fact-audit-report.json"), JSON.stringify({
    report_kind: "role_c_anti_hallucination_audit",
    generated_at: "2026-08-14T00:00:00.000Z",
    case_id: input.name,
    run_id: `RUN-${input.name}`,
    duration_ms: 100,
    status: input.status,
    final_review_decision: input.review,
    publishable: input.status === "ready",
    artifacts: input.status === "ready"
      ? [{ artifact_id: "ART-1", kind: "lesson", citation_count: 1, unknown_citations: [] }]
      : [],
    review_rounds: input.review === "pass"
      ? [{ revision_round: 0, decision: "pass", findings: [] }]
      : [],
    ...(input.status === "blocked" ? {
      failure: {
        code: "CONTENT_INVALID", stage: "code_lab", issueCodes: ["NO_REPAIR_PROGRESS"],
        repairScope: "artifact", nextAction: "regenerate_code_lab", canRetry: true,
        message: "blocked", fingerprint: "sha256:blocked",
      },
    } : {}),
  }))
  await writeFile(join(directory, "repair-and-downgrade-log.json"), JSON.stringify({
    log_kind: "role_c_repair_and_downgrade",
    run_id: `RUN-${input.name}`,
    external_revision_rounds: input.review === "pass"
      ? [{ spec_id: "SPEC-1", generation_spec_hash: "sha256:spec", revision_round: 0, decision: "pass", strategy: "initial_generation", issue_codes: [] }]
      : [],
    cross_spec_recovery: input.status === "blocked"
      ? { code: "BLOCKED", failedDimensions: ["BLOCKED_INVALID_OUTPUT"], missingPrerequisiteSourceIds: [], unknownPrerequisiteRefs: [], requiredAction: "none", fixScope: "none", canRecover: false, attempts: 0, message: "blocked" }
      : { code: "READY", failedDimensions: [], missingPrerequisiteSourceIds: [], unknownPrerequisiteRefs: [], requiredAction: "none", fixScope: "none", canRecover: false, attempts: 0, message: "ready" },
    final_status: input.status,
    terminal_action: "none",
  }))
  return directory
}

test("exports observed pass and pre-review blocked runs without inventing repair", async () => {
  const root = await mkdtemp(join(tmpdir(), "day3-ledger-"))
  const ready = await fixture({ root, name: "ready", status: "ready", review: "pass" })
  const blocked = await fixture({ root, name: "blocked", status: "blocked", review: "not_reached" })
  const output = join(root, "audit-worker-ledger.jsonl")
  const result = await exportDay3AuditWorkerLedger({ run_directories: [ready, blocked], output_file: output })

  expect(result.summary).toEqual({
    runs: 2, entries: 3, ready_runs: 1, blocked_or_failed_runs: 1,
    review_rounds_observed: 1, review_failure_observed: false,
    repair_or_recovery_observed: false, downgrade_or_blocked_observed: true,
    internally_closed_runs: 2, acceptance_chain_complete: false,
  })
  expect(result.entries.find((entry) => entry.run_id === "RUN-blocked")?.observability.limitations).toHaveLength(1)
  expect(result.entries.some((entry) => entry.unit_name === "content-recovery")).toBe(false)
  expect(result.entries.flatMap((entry) => entry.output_refs)
    .every((ref) => !ref.startsWith("/") && !/^[A-Za-z]:[\\/]/u.test(ref))).toBe(true)
  expect((await readFile(output, "utf8")).trim().split("\n")).toHaveLength(3)
})

test("rejects mismatched report and repair run ids", async () => {
  const root = await mkdtemp(join(tmpdir(), "day3-ledger-mismatch-"))
  const directory = await fixture({ root, name: "mismatch", status: "ready", review: "pass" })
  const repairPath = join(directory, "repair-and-downgrade-log.json")
  const repair = JSON.parse(await readFile(repairPath, "utf8"))
  repair.run_id = "RUN-other"
  await writeFile(repairPath, JSON.stringify(repair))
  await expect(exportDay3AuditWorkerLedger({
    run_directories: [directory],
    output_file: join(root, "ledger.jsonl"),
  })).rejects.toThrow("run_id mismatch")
})

test("records cross-spec recovery between repeated revision round zero reviews", async () => {
  const root = await mkdtemp(join(tmpdir(), "day3-ledger-cross-spec-"))
  const directory = await fixture({ root, name: "cross-spec", status: "ready", review: "pass" })
  const reportPath = join(directory, "fact-audit-report.json")
  const report = JSON.parse(await readFile(reportPath, "utf8"))
  report.review_rounds = [
    {
      revision_round: 0,
      decision: "reject",
      findings: [{
        code: "semantic_unsupported",
        artifact_id: "ART-REJECTED",
        evidence_refs: ["K005:F001"],
      }],
    },
    { revision_round: 0, decision: "pass", findings: [] },
  ]
  await writeFile(reportPath, JSON.stringify(report))
  const repairPath = join(directory, "repair-and-downgrade-log.json")
  const repair = JSON.parse(await readFile(repairPath, "utf8"))
  repair.external_revision_rounds = [
    {
      spec_id: "SPEC-OLD", generation_spec_hash: "sha256:old", revision_round: 0,
      decision: "reject", strategy: "initial_generation", issue_codes: ["semantic_unsupported"],
    },
    {
      spec_id: "SPEC-NEW", generation_spec_hash: "sha256:new", revision_round: 0,
      decision: "pass", strategy: "replanned_spec_generation", issue_codes: [],
    },
  ]
  repair.cross_spec_recovery = {
    code: "READY", failedDimensions: ["semantic_unsupported"], missingPrerequisiteSourceIds: [],
    unknownPrerequisiteRefs: [], requiredAction: "replan_path", fixScope: "new_spec",
    canRecover: true, attempts: 1, message: "recovered",
  }
  repair.terminal_action = "replan_path"
  await writeFile(repairPath, JSON.stringify(repair))

  const result = await exportDay3AuditWorkerLedger({
    run_directories: [directory],
    output_file: join(root, "ledger.jsonl"),
  })

  expect(result.entries.map((entry) => entry.entry_id)).toEqual([
    "RUN-cross-spec:pipeline",
    "RUN-cross-spec:review:1",
    "RUN-cross-spec:recovery:1",
    "RUN-cross-spec:review:2",
  ])
  expect(result.entries.map((entry) => entry.sequence_index)).toEqual([1, 2, 3, 4])
  expect(result.entries[1]?.artifact_refs).toEqual(["ART-REJECTED"])
  expect(result.entries[2]).toMatchObject({
    unit_name: "content-recovery",
    input_refs: ["SPEC-OLD"],
    output_refs: ["SPEC-NEW", expect.stringContaining("repair-and-downgrade-log.json")],
    error_codes: ["semantic_unsupported"],
    retry_or_recovery: { occurred: true, strategy: "replanned_spec_generation", terminal_action: "replan_path" },
    publishable: false,
  })
  expect(result.summary).toMatchObject({
    review_failure_observed: true,
    repair_or_recovery_observed: true,
    acceptance_chain_complete: true,
  })
})
