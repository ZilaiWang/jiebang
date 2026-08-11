import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  appendTraceEvent,
  createTraceLedger,
  readTraceEvents,
  writeTraceSummary,
} from "../src/orchestration/trace-ledger"
import type {
  OrchestrationRunSummary,
  TraceEvent,
} from "../src/orchestration/types"

const temporaryRoots: string[] = []

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    await rm(root, { recursive: true, force: true })
  }
})

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "knowbalance-orch-ledger-"))
  temporaryRoots.push(root)
  return root
}

function event(overrides: Partial<TraceEvent> = {}): TraceEvent {
  return {
    schema_version: "1.0",
    run_id: "RUN-TRACE-001",
    session_id: "SESSION-TRACE-001",
    step_index: 1,
    event_type: "orchestrator_decision",
    stage: "intake_ready",
    worker: "background-collector",
    message: "delegate background collection",
    input_refs: [],
    output_refs: [],
    evidence_refs: [],
    timestamp: "2026-08-04T10:20:00.000Z",
    ...overrides,
  }
}

function summary(overrides: Partial<OrchestrationRunSummary> = {}): OrchestrationRunSummary {
  return {
    schema_version: "1.0",
    run_id: "RUN-TRACE-001",
    session_id: "SESSION-TRACE-001",
    mode: "scaffold",
    status: "completed",
    started_at: "2026-08-04T10:20:00.000Z",
    finished_at: "2026-08-04T10:21:00.000Z",
    total_steps: 1,
    completed_steps: 1,
    blocked_stage: undefined,
    failed_stage: undefined,
    events: [event()],
    artifacts: {
      trace: "trace.jsonl",
    },
    persistence_events: [],
    clarification_requests: [],
    ...overrides,
  }
}

describe("orchestration trace ledger", () => {
  test("creates the run directory layout for one orchestrator run", async () => {
    const root = await tempRoot()
    const ledger = await createTraceLedger({
      root_dir: root,
      run_id: "RUN-TRACE-001",
    })

    expect(ledger.run_id).toBe("RUN-TRACE-001")
    expect(ledger.run_dir.endsWith("RUN-TRACE-001")).toBe(true)
    expect(ledger.trace_path.endsWith("trace.jsonl")).toBe(true)
    expect(ledger.summary_json_path.endsWith("summary.json")).toBe(true)
    expect(ledger.summary_md_path.endsWith("summary.md")).toBe(true)
    expect(ledger.latest_json_path.endsWith("latest.json")).toBe(true)
    expect(ledger.latest_md_path.endsWith("latest.md")).toBe(true)
  })

  test("appends JSONL trace events and reads them back in order", async () => {
    const root = await tempRoot()
    const ledger = await createTraceLedger({ root_dir: root, run_id: "RUN-TRACE-001" })

    await appendTraceEvent(ledger, event({ step_index: 1, message: "first" }))
    await appendTraceEvent(ledger, event({
      step_index: 2,
      event_type: "worker_completed",
      stage: "background_collected",
      message: "second",
      output_refs: ["background_evidence"],
    }))

    const raw = await readFile(ledger.trace_path, "utf8")
    expect(raw.trim().split("\n")).toHaveLength(2)

    const events = await readTraceEvents(ledger)
    expect(events.map((trace) => trace.message)).toEqual(["first", "second"])
    expect(events[1].output_refs).toEqual(["background_evidence"])
  })

  test("writes summary JSON, Markdown report, and latest pointers", async () => {
    const root = await tempRoot()
    const ledger = await createTraceLedger({ root_dir: root, run_id: "RUN-TRACE-001" })
    const runSummary = summary()

    await writeTraceSummary(ledger, runSummary)

    const summaryJson = JSON.parse(await readFile(ledger.summary_json_path, "utf8")) as OrchestrationRunSummary
    expect(summaryJson.status).toBe("completed")
    expect(summaryJson.events).toHaveLength(1)

    const latestJson = JSON.parse(await readFile(ledger.latest_json_path, "utf8")) as OrchestrationRunSummary
    expect(latestJson.run_id).toBe("RUN-TRACE-001")

    const report = await readFile(ledger.summary_md_path, "utf8")
    expect(report).toContain("# Learning Orchestrator Run Summary")
    expect(report).toContain("RUN-TRACE-001")
    expect(report).toContain("| 1 | intake_ready | background-collector | orchestrator_decision | delegate background collection |")

    const latestReport = await readFile(ledger.latest_md_path, "utf8")
    expect(latestReport).toBe(report)
  })

  test("reports blocked and failed stages explicitly", async () => {
    const root = await tempRoot()
    const ledger = await createTraceLedger({ root_dir: root, run_id: "RUN-BLOCKED-001" })
    const runSummary = summary({
      run_id: "RUN-BLOCKED-001",
      status: "blocked",
      completed_steps: 0,
      blocked_stage: "concept_ready",
      events: [event({
        run_id: "RUN-BLOCKED-001",
        step_index: 7,
        event_type: "worker_blocked",
        stage: "concept_ready",
        worker: "code-lab",
        message: "unsupported target set",
        error: {
          code: "UNSUPPORTED_TARGET",
          message: "offline code-lab does not support this target",
          severity: "recoverable",
        },
      })],
    })

    await writeTraceSummary(ledger, runSummary)

    const report = await readFile(ledger.summary_md_path, "utf8")
    expect(report).toContain("Status: blocked")
    expect(report).toContain("Blocked stage: concept_ready")
    expect(report).toContain("UNSUPPORTED_TARGET")
  })
})
