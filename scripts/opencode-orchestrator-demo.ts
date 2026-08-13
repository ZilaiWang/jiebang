import { readFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { exportSessionArtifactMap } from "../src/orchestration/artifact-map"
import { exportDay2OpenCodeEvidence } from "../src/orchestration/day2-opencode-evidence"
import type { InteractiveSessionRecord } from "../src/orchestration/interactive-session"

function option(name: string, fallback?: string): string {
  const index = Bun.argv.indexOf(name)
  const value = index >= 0 ? Bun.argv[index + 1] : fallback
  if (!value) throw new Error(`${name} requires a value`)
  return resolve(value)
}

const sessionPath = option("--session")
const outputDirectory = option("--output", join(process.cwd(), ".tmp", "competition-sprint", "day2-opencode-ledger"))
const record = JSON.parse(await readFile(sessionPath, "utf8")) as InteractiveSessionRecord

const artifactMap = await exportSessionArtifactMap({
  record,
  source_session_path: sessionPath,
  output_directory: outputDirectory,
})
const evidence = await exportDay2OpenCodeEvidence({
  record,
  source_session_ref: artifactMap.source_session,
  output_directory: outputDirectory,
})

console.log(JSON.stringify({
  session_id: evidence.run.session_id,
  run_id: evidence.run.run_id,
  session_status: evidence.run.session_status,
  ledger_entries: evidence.envelopes.length,
  verified_artifacts: artifactMap.agents.flatMap((entry) => entry.artifact_refs).length,
  opencode_task_execution_observed: evidence.run.runtime_truth.opencode_task_execution_observed,
  output_directory: outputDirectory,
}, null, 2))
