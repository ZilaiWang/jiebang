import { join } from "node:path"
import { runLearningOrchestrator } from "../src/orchestration/learning-orchestrator-runner"
import type { OrchestrationMode } from "../src/orchestration/types"

interface CliOptions {
  mode: OrchestrationMode
  root: string
  runId?: string
  sessionId?: string
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    mode: "scaffold",
    root: join(process.cwd(), ".tmp", "orchestrator"),
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const value = argv[index + 1]
    if (arg === "--mode") {
      if (value !== "scaffold" && value !== "deterministic") {
        throw new Error(`Unsupported --mode ${value}`)
      }
      options.mode = value
      index += 1
    } else if (arg === "--root") {
      if (!value) throw new Error("--root requires a value")
      options.root = value
      index += 1
    } else if (arg === "--run-id") {
      if (!value) throw new Error("--run-id requires a value")
      options.runId = value
      index += 1
    } else if (arg === "--session-id") {
      if (!value) throw new Error("--session-id requires a value")
      options.sessionId = value
      index += 1
    }
  }

  return options
}

const options = parseArgs(Bun.argv.slice(2))
const result = await runLearningOrchestrator({
  root_dir: options.root,
  run_id: options.runId,
  session_id: options.sessionId,
  mode: options.mode,
  learner_request: {
    goal: "学习 Python 循环并完成成绩统计",
    background: "零基础学习者，需要个性化教学路径",
    self_rating: "beginner",
    diagnostic_seed: "解释 for 循环什么时候适合遍历一组数据",
  },
})

console.log(JSON.stringify({
  run_id: result.summary.run_id,
  session_id: result.summary.session_id,
  mode: result.summary.mode,
  status: result.summary.status,
  completed_steps: result.summary.completed_steps,
  total_steps: result.summary.total_steps,
  summary_json: result.ledger.summary_json_path,
  summary_md: result.ledger.summary_md_path,
  latest_json: result.ledger.latest_json_path,
  latest_md: result.ledger.latest_md_path,
}, null, 2))
