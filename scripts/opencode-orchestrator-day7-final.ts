import { mkdir, readFile, writeFile } from "node:fs/promises"
import { basename, join, resolve } from "node:path"
import { exportSessionArtifactMap } from "../src/orchestration/artifact-map"
import { exportDay2OpenCodeEvidence, type Day2OpenCodeRun, type Day2WorkerEnvelope } from "../src/orchestration/day2-opencode-evidence"
import { exportDay5CollaborationMetrics } from "../src/orchestration/day5-collaboration-metrics"
import type { InteractiveSessionRecord } from "../src/orchestration/interactive-session"

const args = Bun.argv.slice(2)
const sessionFiles = args.filter((value) => value.startsWith("--session="))
  .map((value) => resolve(value.slice("--session=".length)))
const outputDirectory = resolve(option("--output") ?? ".tmp/competition-sprint/day7-final-check")

if (sessionFiles.length < 3) throw new Error("Day 7 final evidence requires at least three session files")

await mkdir(outputDirectory, { recursive: true })
const metrics = await exportDay5CollaborationMetrics({
  session_files: sessionFiles,
  output_file: join(outputDirectory, "agent-collaboration-metrics-final.json"),
})

const runs: Day2OpenCodeRun[] = []
const envelopes: Day2WorkerEnvelope[] = []
const artifactMaps = []
for (const sessionFile of sessionFiles) {
  const record = JSON.parse(await readFile(sessionFile, "utf8")) as InteractiveSessionRecord
  const runDirectory = join(outputDirectory, "final-runs", record.session_id)
  const publicSessionPath = join(runDirectory, "session-public.json")
  const artifactMap = await exportSessionArtifactMap({
    record,
    source_session_path: publicSessionPath,
    output_directory: runDirectory,
  })
  const evidence = await exportDay2OpenCodeEvidence({
    record,
    source_session_ref: `final-runs/${record.session_id}/session-public.json`,
    output_directory: runDirectory,
  })
  await writeFile(join(runDirectory, "events-public.json"), `${JSON.stringify(record.events, null, 2)}\n`, "utf8")
  runs.push(evidence.run)
  envelopes.push(...evidence.envelopes)
  artifactMaps.push(artifactMap)
}

const finalLedger = {
  schema_version: "1.0",
  generated_at: new Date().toISOString(),
  baseline: option("--baseline") ?? "unknown",
  main_agent: "learning-orchestrator",
  sample_count: metrics.sample_count,
  complete_session_count: metrics.complete_session_count,
  collaboration_chain_complete_count: metrics.collaboration_chain_complete_count,
  collaboration_completion_rate: metrics.collaboration_completion_rate,
  runtime_truth: {
    opencode_task_execution_observed: runs.some((run) => run.runtime_truth.opencode_task_execution_observed),
    statement: runs.some((run) => run.runtime_truth.opencode_task_execution_observed)
      ? "At least one final run observed an OpenCode task/subagent execution."
      : "Final runs use OpenCode-style envelopes; execution types remain exactly as recorded by each real ledger.",
  },
  runs,
  blocked_or_failed_runs_by_unit: metrics.blocked_or_failed_runs_by_unit,
}

await writeFile(join(outputDirectory, "opencode-ledger-final.json"), `${JSON.stringify(finalLedger, null, 2)}\n`, "utf8")
await writeFile(join(outputDirectory, "agent-envelope-final.jsonl"), `${envelopes.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8")
await writeFile(join(outputDirectory, "artifact-map-final.json"), `${JSON.stringify({ schema_version: "1.0", generated_at: finalLedger.generated_at, runs: artifactMaps }, null, 2)}\n`, "utf8")
await writeFile(join(outputDirectory, "multi-agent-collaboration-final.md"), report(finalLedger, metrics.runs), "utf8")

console.log(JSON.stringify({
  output_directory: outputDirectory,
  supplied_sessions: sessionFiles.length,
  complete_sessions: metrics.complete_session_count,
  complete_chains: metrics.collaboration_chain_complete_count,
  envelopes: envelopes.length,
  source_files: sessionFiles.map((file) => basename(file)),
}, null, 2))

function option(name: string): string | undefined {
  return args.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1)
}

function report(
  ledger: typeof finalLedger,
  runMetrics: Array<{ session_id: string; session_status: string; round_no: number; decision_action: string | null; blocked_or_failed_units: string[] }>,
): string {
  const rows = runMetrics.map((run) =>
    `| ${run.session_id} | ${run.session_status} | ${run.round_no} | ${run.decision_action ?? "-"} | ${run.blocked_or_failed_units.join(", ") || "-"} |`,
  ).join("\n")
  return `# Day 7 多 Agent 协同说明\n\n`
    + `- 基线：\`${ledger.baseline}\`\n`
    + `- 真实 session 总数：${ledger.sample_count}\n`
    + `- 完整 session：${ledger.complete_session_count}\n`
    + `- 严格协同链完成：${ledger.collaboration_chain_complete_count}\n`
    + `- 严格协同完成率：${(ledger.collaboration_completion_rate * 100).toFixed(2)}%\n`
    + `- OpenCode task/subagent 执行是否被观测：${ledger.runtime_truth.opencode_task_execution_observed ? "是" : "否"}\n\n`
    + `本证据包保留全部已创建 session，包括 blocked/failed/retry；不把 adapter、pipeline 或普通函数改写为 OpenCode subagent。\n\n`
    + `| session | 状态 | 轮次 | 决策 | 阻塞/失败单元 |\n|---|---:|---:|---|---|\n${rows}\n`
}
