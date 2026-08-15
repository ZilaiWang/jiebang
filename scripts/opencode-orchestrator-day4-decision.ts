import { resolve } from "node:path"
import { exportDay4DecisionLedger } from "../src/orchestration/day4-decision-ledger"

const args = process.argv.slice(2)
const runDirectory = option(args, "--run-dir")
if (!runDirectory) throw new Error("--run-dir is required")
const outputFile = resolve(option(args, "--output")
  ?? ".tmp/competition-sprint/day4-dynamic-decision/decision-ledger.jsonl")
const result = await exportDay4DecisionLedger({
  run_directory: resolve(runDirectory),
  output_file: outputFile,
})
console.log(JSON.stringify({ output_file: outputFile, entry: result.entry }, null, 2))

function option(args: string[], name: string): string | undefined {
  return args.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1)
}
