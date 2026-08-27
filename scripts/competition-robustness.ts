import { resolve } from "node:path"

interface RobustnessCase {
  case_id: string
  category: "hallucination_induction" | "evidence_anomaly" | "dynamic_feedback" | "engineering_recovery"
  purpose: string
  test_file: string
  test_name: string
}

interface RobustnessManifest {
  manifest_version: "competition-robustness-v1"
  total_cases: 12
  cases: RobustnessCase[]
}

const root = resolve(process.cwd())
const manifest = await Bun.file(resolve(root, "evaluation/robustness-manifest.v1.json")).json() as RobustnessManifest
if (manifest.manifest_version !== "competition-robustness-v1"
  || manifest.total_cases !== 12
  || manifest.cases.length !== 12
  || new Set(manifest.cases.map((entry) => entry.case_id)).size !== 12) {
  throw new Error("COMPETITION_ROBUSTNESS_MANIFEST_INVALID")
}

const results = [] as Array<RobustnessCase & {
  status: "passed" | "failed"
  duration_ms: number
  exit_code: number
}>

for (const evaluationCase of manifest.cases) {
  const started = Date.now()
  const child = Bun.spawnSync([
    "bun", "test", "--isolate", evaluationCase.test_file,
    "--test-name-pattern", evaluationCase.test_name,
  ], { cwd: root, stdout: "pipe", stderr: "pipe" })
  results.push({
    ...evaluationCase,
    status: child.exitCode === 0 ? "passed" : "failed",
    duration_ms: Date.now() - started,
    exit_code: child.exitCode,
  })
  console.error(`[robustness] ${evaluationCase.case_id}: ${child.exitCode === 0 ? "passed" : "failed"}`)
}

const categorySummary = Object.fromEntries(
  ["hallucination_induction", "evidence_anomaly", "dynamic_feedback", "engineering_recovery"].map((category) => {
    const selected = results.filter((entry) => entry.category === category)
    return [category, { passed: selected.filter((entry) => entry.status === "passed").length, total: selected.length }]
  }),
)
const report = {
  report_version: "competition-robustness-report-v1",
  generated_at: new Date().toISOString(),
  manifest_version: manifest.manifest_version,
  total: results.length,
  passed: results.filter((entry) => entry.status === "passed").length,
  failed: results.filter((entry) => entry.status === "failed").length,
  category_summary: categorySummary,
  cases: results,
}
const outputDirectory = resolve(root, "evaluation/results")
await Bun.write(resolve(outputDirectory, "robustness-latest.json"), `${JSON.stringify(report, null, 2)}\n`)
const lines = [
  "# 12 例辅助鲁棒性验收", "",
  `- 通过：${report.passed} / ${report.total}`,
  `- 生成时间：${report.generated_at}`, "",
  "| 案例 | 类别 | 验证目标 | 结果 |",
  "| --- | --- | --- | --- |",
  ...results.map((entry) => `| ${entry.case_id} | ${entry.category} | ${entry.purpose} | ${entry.status} |`),
  "",
  "这 12 例是正式三项指标之外的异常与恢复验收，不进入 60 例正式指标分子分母。", "",
]
await Bun.write(resolve(outputDirectory, "robustness-latest.md"), `${lines.join("\n")}\n`)
console.log(lines.join("\n"))
if (report.failed > 0) process.exitCode = 1
