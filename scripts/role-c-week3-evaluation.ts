import { mkdir } from "node:fs/promises"
import { resolve } from "node:path"
import { buildWeek3EvaluationCases } from "../src/evaluation/week3-evaluation"
import {
  buildRoleCWeek3Report,
  renderRoleCWeek3Report,
  runRoleCWeek3Case,
  type RoleCWeek3ExecutionMode,
} from "../src/role-c-content/evaluation"

const args = parseArgs(process.argv.slice(2))
const cases = selectCases(buildWeek3EvaluationCases(), args)
const env = args.mode === "model"
  ? { ...await readEnvFile(resolve(process.cwd(), ".env.role-c.local")), ...process.env }
  : process.env
const results = []
const evaluationRunId = `RUN-C-WEEK3-EVAL-${Date.now().toString(36).toUpperCase()}`

for (const [index, evaluationCase] of cases.entries()) {
  console.error(`[角色 C] ${index + 1}/${cases.length} ${evaluationCase.case_id} ${evaluationCase.target_source_ids.join("/")}`)
  results.push(await runRoleCWeek3Case(evaluationCase, {
    executionMode: args.mode,
    runId: `${evaluationRunId}-${index + 1}-${evaluationCase.case_id}`,
    runtime: {
      providerMode: args.mode,
      env,
    },
  }))
}

const report = buildRoleCWeek3Report(args.mode, results)
const markdown = renderRoleCWeek3Report(report)
const outputDirectory = resolve(process.cwd(), args.outputDirectory)
await mkdir(outputDirectory, { recursive: true })
await Bun.write(resolve(outputDirectory, "latest.json"), `${JSON.stringify(report, null, 2)}\n`)
await Bun.write(resolve(outputDirectory, "latest.md"), markdown)
console.log(markdown)
console.log(`JSON：${resolve(outputDirectory, "latest.json")}`)
console.log(`可读报告：${resolve(outputDirectory, "latest.md")}`)
if (report.summary.failed > 0) process.exitCode = 1

interface CliArgs {
  mode: RoleCWeek3ExecutionMode
  caseIds: string[]
  limit?: number
  all: boolean
  outputDirectory: string
}

function parseArgs(values: string[]): CliArgs {
  const mode = option(values, "--mode") ?? "model"
  if (mode !== "model") {
    throw new Error("--mode 只允许 model（确定性模板已删除）")
  }
  const caseIds = values
    .filter((value) => value.startsWith("--case-id="))
    .map((value) => value.slice("--case-id=".length))
  const limitText = option(values, "--limit")
  const limit = limitText === undefined ? undefined : Number(limitText)
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1)) {
    throw new Error("--limit 必须是正整数")
  }
  const all = values.includes("--all")
  if (mode === "model" && caseIds.length === 0 && limit === undefined && !all) {
    throw new Error("真实模型评测请显式传入 --case-id、--limit 或 --all，避免误发 60 条付费请求")
  }
  return {
    mode,
    caseIds,
    limit,
    all,
    outputDirectory: option(values, "--output-dir") ?? ".tmp/role-c-week3",
  }
}

function option(values: string[], name: string): string | undefined {
  return values.find((value) => value.startsWith(`${name}=`))
    ?.slice(name.length + 1)
}

function selectCases<T extends { case_id: string }>(
  cases: T[],
  args: CliArgs,
): T[] {
  const selected = args.caseIds.length > 0
    ? cases.filter((item) => args.caseIds.includes(item.case_id))
    : cases
  const unknown = args.caseIds.filter((caseId) =>
    !cases.some((item) => item.case_id === caseId))
  if (unknown.length > 0) throw new Error(`未知评测用例：${unknown.join("、")}`)
  return args.limit === undefined ? selected : selected.slice(0, args.limit)
}

async function readEnvFile(path: string): Promise<Record<string, string>> {
  const file = Bun.file(path)
  if (!await file.exists()) throw new Error(`找不到模型配置：${path}`)
  const parsed: Record<string, string> = {}
  for (const [lineNumber, sourceLine] of (await file.text()).split(/\r?\n/).entries()) {
    const line = sourceLine.trim()
    if (!line || line.startsWith("#")) continue
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/)
    if (!match) throw new Error(`模型配置第 ${lineNumber + 1} 行格式无效`)
    let value = match[2]!.trim()
    if ((value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    parsed[match[1]!] = value
  }
  return parsed
}
