import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  AtomicFileDurableJobStore,
  DurableJobRunner,
  createModelWorkflowJob,
} from "../src/model-runtime"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "knowbalance-jobs-"))
  roots.push(root)
  return { root, store: new AtomicFileDurableJobStore(root) }
}

describe("durable model workflow jobs", () => {
  test("recovers a running job only after its lease expires", async () => {
    const { store } = await fixture()
    const job = createModelWorkflowJob({
      job_id: "JOB-LEASE-1",
      session_id: "SESSION-1",
      run_id: "RUN-1",
      kind: "initial_content_round",
      current_stage: "planning",
      deadline_ms: 60_000,
    })
    await store.create(job)
    expect(await store.claim(job.job_id, "worker-a", 10_000, new Date("2026-08-20T00:00:00Z"))).toBeDefined()
    expect(await store.listRecoverable(new Date("2026-08-20T00:00:05Z"))).toHaveLength(0)
    expect((await store.listRecoverable(new Date("2026-08-20T00:00:11Z"))).map((entry) => entry.job_id)).toEqual([job.job_id])
  })

  test("runner retains execution, completes work, and stores no model reasoning", async () => {
    const { store } = await fixture()
    const runner = new DurableJobRunner(store, { max_in_flight: 1, lease_ms: 5_000 })
    let completed = false
    runner.register("diagnostic", async () => { completed = true })
    const job = createModelWorkflowJob({
      job_id: "JOB-DIAG-1",
      session_id: "SESSION-2",
      run_id: "RUN-2",
      kind: "diagnostic",
      current_stage: "diagnosis",
      deadline_ms: 60_000,
      policy_snapshot: { profile: "fast" },
    })
    await runner.enqueue(job)
    for (let index = 0; index < 100 && !completed; index += 1) await Bun.sleep(5)
    for (let index = 0; index < 100 && (await store.load(job.job_id))?.status !== "completed"; index += 1) await Bun.sleep(5)
    expect(completed).toBe(true)
    expect(await store.load(job.job_id)).toMatchObject({ status: "completed", attempt: 1 })
    expect(JSON.stringify(await store.load(job.job_id))).not.toContain("reasoning_content")
  })

  test("runner restores a future retry_wait job and wakes it when due", async () => {
    const { store } = await fixture()
    const job = createModelWorkflowJob({
      job_id: "JOB-RETRY-1",
      session_id: "SESSION-3",
      run_id: "RUN-3",
      kind: "diagnostic",
      current_stage: "diagnosis",
      deadline_ms: 60_000,
      max_attempts: 2,
    })
    await store.create(job)
    const claimed = await store.claim(job.job_id, "worker-before-restart", 5_000)
    expect(claimed).toBeDefined()
    await store.fail(job.job_id, "worker-before-restart", new Error("PROVIDER_BUSY"), 40)

    let completed = false
    const restartedRunner = new DurableJobRunner(store, { max_in_flight: 1, lease_ms: 5_000 })
    restartedRunner.register("diagnostic", async () => { completed = true })
    await restartedRunner.start()
    expect(completed).toBe(false)
    for (let index = 0; index < 100 && !completed; index += 1) await Bun.sleep(5)
    for (let index = 0; index < 100 && (await store.load(job.job_id))?.status !== "completed"; index += 1) await Bun.sleep(5)
    expect(completed).toBe(true)
    expect(await store.load(job.job_id)).toMatchObject({ status: "completed", attempt: 2 })
  }, 15_000)
})
