import { readFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import {
  exportSessionArtifactMap,
  type ExportSessionArtifactMapInput,
} from "../src/orchestration/artifact-map"
import type { InteractiveSessionRecord } from "../src/orchestration/interactive-session"

interface CliOptions {
  sessionPath: string
  outputDirectory: string
  reviewPath?: string
}

function parseArgs(argv: string[]): CliOptions {
  let sessionPath = ""
  let outputDirectory = join(process.cwd(), ".tmp", "competition-sprint", "day2-opencode-ledger")
  let reviewPath: string | undefined
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    const value = argv[index + 1]
    if (argument === "--session") {
      if (!value) throw new Error("--session requires a file path")
      sessionPath = value
      index += 1
    } else if (argument === "--output") {
      if (!value) throw new Error("--output requires a directory")
      outputDirectory = value
      index += 1
    } else if (argument === "--review") {
      if (!value) throw new Error("--review requires a file path")
      reviewPath = value
      index += 1
    }
  }
  if (!sessionPath) throw new Error("Usage: bun run scripts/export-agent-artifact-map.ts --session <session.json> [--review <review.json>] [--output <directory>]")
  return { sessionPath: resolve(sessionPath), outputDirectory: resolve(outputDirectory), reviewPath: reviewPath ? resolve(reviewPath) : undefined }
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"))
}

const options = parseArgs(Bun.argv.slice(2))
const input: ExportSessionArtifactMapInput = {
  record: await readJson(options.sessionPath) as InteractiveSessionRecord,
  source_session_path: options.sessionPath,
  output_directory: options.outputDirectory,
  ...(options.reviewPath ? { review: await readJson(options.reviewPath) } : {}),
}
const artifactMap = await exportSessionArtifactMap(input)

console.log(JSON.stringify({
  artifact_map: join(options.outputDirectory, "artifact-map.json"),
  session_id: artifactMap.session_id,
  run_id: artifactMap.run_id,
  produced_agents: artifactMap.agents.filter((entry) => entry.artifact_refs.length > 0).length,
  verified_artifacts: artifactMap.agents.flatMap((entry) => entry.artifact_refs).length,
}, null, 2))
