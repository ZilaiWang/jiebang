import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { readFile, rm } from "node:fs/promises"
import { join } from "node:path"

const ROOT = process.cwd()
const OUTPUT_ROOT = join(ROOT, ".tmp", "orchestrator-demo-test")

describe("learning orchestrator demo script", () => {
  test("runs scaffold demo and writes latest JSON/Markdown evidence", async () => {
    await rm(OUTPUT_ROOT, { recursive: true, force: true })

    const proc = Bun.spawnSync({
      cmd: [
        "bun",
        "scripts/learning-orchestrator-demo.ts",
        "--mode",
        "scaffold",
        "--root",
        OUTPUT_ROOT,
        "--run-id",
        "RUN-DEMO-TEST-001",
        "--session-id",
        "SESSION-DEMO-TEST-001",
      ],
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
    })

    expect(proc.exitCode).toBe(0)
    const stdout = proc.stdout.toString()
    expect(stdout).toContain("RUN-DEMO-TEST-001")
    expect(stdout).toContain("completed")

    const latestJsonPath = join(OUTPUT_ROOT, "latest.json")
    const latestMdPath = join(OUTPUT_ROOT, "latest.md")
    expect(existsSync(latestJsonPath)).toBe(true)
    expect(existsSync(latestMdPath)).toBe(true)

    const latest = JSON.parse(await readFile(latestJsonPath, "utf8")) as {
      run_id: string
      status: string
      completed_steps: number
    }
    expect(latest.run_id).toBe("RUN-DEMO-TEST-001")
    expect(latest.status).toBe("completed")
    expect(latest.completed_steps).toBe(8)

    const report = await readFile(latestMdPath, "utf8")
    expect(report).toContain("Learning Orchestrator Run Summary")
    expect(report).toContain("tiered-evaluator")
  })
})
