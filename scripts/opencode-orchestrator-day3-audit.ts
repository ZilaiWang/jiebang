import { resolve } from "node:path"
import { exportDay3AuditWorkerLedger } from "../src/orchestration/day3-audit-worker-ledger"

const values = process.argv.slice(2)
const runDirectories = values
  .filter((value) => value.startsWith("--run-dir="))
  .map((value) => value.slice("--run-dir=".length))
const outputFile = resolve(
  process.cwd(),
  option(values, "--output")
    ?? ".tmp/competition-sprint/day3-anti-hallucination/audit-worker-ledger.jsonl",
)
const result = await exportDay3AuditWorkerLedger({
  run_directories: runDirectories,
  output_file: outputFile,
})

console.log(JSON.stringify({
  output_file: outputFile,
  ...result.summary,
}, null, 2))

function option(args: string[], name: string): string | undefined {
  return args.find((value) => value.startsWith(`${name}=`))
    ?.slice(name.length + 1)
}
