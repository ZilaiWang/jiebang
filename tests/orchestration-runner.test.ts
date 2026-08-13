import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  runLearningOrchestrator,
} from "../src/orchestration/learning-orchestrator-runner"

// 真实模型 + Docker 代码执行依赖：默认跳过，RUN_INTEGRATION_TESTS=1 时运行。
const runIntegration = process.env.RUN_INTEGRATION_TESTS === "1"

const temporaryRoots: string[] = []

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    await rm(root, { recursive: true, force: true })
  }
})

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "knowbalance-orch-runner-"))
  temporaryRoots.push(root)
  return root
}

describe.skipIf(!runIntegration)("learning orchestrator runner", () => {
  test("runs the full scaffold workflow through eight workers and writes audit artifacts", async () => {
    const root = await tempRoot()

    const result = await runLearningOrchestrator({
      root_dir: root,
      run_id: "RUN-SCAFFOLD-001",
      session_id: "SESSION-SCAFFOLD-001",
      mode: "scaffold",
      learner_request: {
        goal: "学习 Python 循环并完成成绩统计",
        background: "零基础",
        self_rating: "beginner",
      },
      now: () => "2026-08-04T10:40:00.000Z",
    })

    expect(result.summary.status).toBe("completed")
    expect(result.summary.completed_steps).toBe(8)
    expect(result.summary.total_steps).toBe(8)
    expect(result.summary.events.map((event) => event.event_type)).toContain("session_started")
    expect(result.summary.events.filter((event) => event.event_type === "worker_completed")).toHaveLength(8)
    expect(result.summary.events.at(-1)?.event_type).toBe("session_completed")

    const workers = result.summary.events
      .filter((event) => event.event_type === "worker_completed")
      .map((event) => event.worker)
    expect(workers).toEqual([
      "background-collector",
      "self-assessor",
      "objective-diagnostician",
      "profile-builder",
      "path-planner",
      "concept-tutor",
      "code-lab",
      "tiered-evaluator",
    ])

    const traceRaw = await readFile(result.ledger.trace_path, "utf8")
    expect(traceRaw.trim().split("\n").length).toBe(result.summary.events.length)

    const report = await readFile(result.ledger.summary_md_path, "utf8")
    expect(report).toContain("Status: completed")
    expect(report).toContain("background-collector")
    expect(report).toContain("tiered-evaluator")

    const latest = JSON.parse(await readFile(result.ledger.latest_json_path, "utf8")) as { run_id: string; status: string }
    expect(latest).toEqual({
      ...latest,
      run_id: "RUN-SCAFFOLD-001",
      status: "completed",
    })
  })

  test("deterministic mode completes all eight workers and writes completed audit evidence", async () => {
    const root = await tempRoot()

    const result = await runLearningOrchestrator({
      root_dir: root,
      run_id: "RUN-DETERMINISTIC-001",
      session_id: "SESSION-DETERMINISTIC-001",
      mode: "deterministic",
      learner_request: {
        goal: "学习 Python 循环",
      },
      now: () => "2026-08-04T10:41:00.000Z",
    })

    expect(result.summary.status).toBe("completed")
    expect(result.summary.completed_steps).toBe(8)
    expect(result.summary.failed_stage).toBeUndefined()
    expect(result.summary.events.some((event) => event.event_type === "worker_failed")).toBe(false)
    expect(result.summary.events.at(-1)?.event_type).toBe("session_completed")

    const report = await readFile(result.ledger.summary_md_path, "utf8")
    expect(report).toContain("Status: completed")
    expect(report).toContain("Completed steps: 8/8")
    expect(report).toContain("tiered-evaluator")
    expect(report).toContain("Generated deterministic Role C assessment artifacts")
  })

  test("deterministic mode loads learner memory and persists worker callback updates", async () => {
    const root = await tempRoot()

    const result = await runLearningOrchestrator({
      root_dir: root,
      run_id: "RUN-PHASE-7-001",
      session_id: "SESSION-PHASE-7-001",
      mode: "deterministic",
      learner_request: {
        goal: "学习 Python 循环并完成成绩统计",
        learner_id: "phase7-learner",
        learning_goal_spec: {
          mode: "curriculum_node",
          selected_node_ids: ["PY-CH04-S03"],
        },
      },
      now: () => "2026-08-04T10:42:00.000Z",
    })

    expect(result.summary.status).toBe("completed")
    expect(result.summary.completed_steps).toBe(8)
    expect(result.summary.persistence_events.length).toBeGreaterThan(0)
    expect(result.summary.clarification_requests.length).toBeGreaterThan(0)
    expect(result.summary.learner_memory_ref).toContain("phase7-learner.json")

    const memory = JSON.parse(await readFile(result.summary.learner_memory_ref!, "utf8")) as {
      learner_id: string
      mastery_by_source_id: Record<string, number>
      completed_sessions: string[]
    }
    expect(memory.learner_id).toBe("phase7-learner")
    expect(Object.keys(memory.mastery_by_source_id)).toEqual(expect.arrayContaining(["K007", "K009", "K018"]))
    expect(memory.completed_sessions).toContain("SESSION-PHASE-7-001")

    const report = await readFile(result.ledger.summary_md_path, "utf8")
    expect(report).toContain("Learner memory")
    expect(report).toContain("Clarification requests")
    expect(report).toContain("你是否学过函数定义与调用")
  })
})
