import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { renderTraceSummaryMarkdown } from "./report"
import type { OrchestrationRunSummary, TraceEvent } from "./types"

export interface CreateTraceLedgerInput {
  root_dir: string
  run_id: string
}

export interface TraceLedger {
  run_id: string
  root_dir: string
  run_dir: string
  trace_path: string
  summary_json_path: string
  summary_md_path: string
  latest_json_path: string
  latest_md_path: string
}

export async function createTraceLedger(
  input: CreateTraceLedgerInput,
): Promise<TraceLedger> {
  const runDir = join(input.root_dir, "runs", input.run_id)
  await mkdir(runDir, { recursive: true })

  return {
    run_id: input.run_id,
    root_dir: input.root_dir,
    run_dir: runDir,
    trace_path: join(runDir, "trace.jsonl"),
    summary_json_path: join(runDir, "summary.json"),
    summary_md_path: join(runDir, "summary.md"),
    latest_json_path: join(input.root_dir, "latest.json"),
    latest_md_path: join(input.root_dir, "latest.md"),
  }
}

export async function appendTraceEvent(
  ledger: TraceLedger,
  event: TraceEvent,
): Promise<void> {
  await mkdir(ledger.run_dir, { recursive: true })
  await appendFile(ledger.trace_path, `${JSON.stringify(event)}\n`, "utf8")
}

export async function readTraceEvents(ledger: TraceLedger): Promise<TraceEvent[]> {
  const raw = await readFile(ledger.trace_path, "utf8")
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as TraceEvent)
}

export async function writeTraceSummary(
  ledger: TraceLedger,
  summary: OrchestrationRunSummary,
): Promise<void> {
  await mkdir(ledger.run_dir, { recursive: true })
  const json = `${JSON.stringify(summary, null, 2)}\n`
  const markdown = renderTraceSummaryMarkdown(summary)

  await writeFile(ledger.summary_json_path, json, "utf8")
  await writeFile(ledger.summary_md_path, markdown, "utf8")
  await writeFile(ledger.latest_json_path, json, "utf8")
  await writeFile(ledger.latest_md_path, markdown, "utf8")
}
