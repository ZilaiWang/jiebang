import { resolve } from "node:path"
import { exportDay5CollaborationMetrics } from "../src/orchestration/day5-collaboration-metrics"

const args = process.argv.slice(2)
const sessionFiles = args.filter((value) => value.startsWith("--session="))
  .map((value) => resolve(value.slice("--session=".length)))
const outputFile = resolve(option(args, "--output")
  ?? ".tmp/competition-sprint/day5-metrics/agent-collaboration-metrics.json")
const metrics = await exportDay5CollaborationMetrics({ session_files: sessionFiles, output_file: outputFile })
console.log(JSON.stringify({ output_file: outputFile, metrics }, null, 2))

function option(args: string[], name: string): string | undefined {
  return args.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1)
}
