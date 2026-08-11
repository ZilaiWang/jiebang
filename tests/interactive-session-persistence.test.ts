import { afterEach, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { InteractiveSessionStore } from "../src/orchestration/interactive-session"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const dataRoot = await mkdtemp(join(tmpdir(), "interactive-session-persistence-"))
  roots.push(dataRoot)
  const store = new InteractiveSessionStore(dataRoot)
  const record = await store.create({
    session_id: "SESSION-PERSISTENCE-001",
    run_id: "RUN-PERSISTENCE-001",
    owner_id: "learner-persistence-001",
    mode: "deterministic",
    learner_request: { learner_id: "learner-persistence-001", goal: "学习 Python 循环" },
  })
  return { dataRoot, store, record }
}

test("persists session revisions and rejects stale compare-and-set saves", async () => {
  const { store, record } = await fixture()
  expect(record.revision).toBe(0)
  const stale = structuredClone(record)
  record.updated_at = new Date().toISOString()
  await store.save(record, 0)
  expect((await store.load(record.session_id)).revision).toBe(1)
  stale.updated_at = new Date().toISOString()
  await expect(store.save(stale, 0)).rejects.toMatchObject({ code: "SESSION_REVISION_CONFLICT" })
})

test("heartbeats a live lock so another process cannot steal it as stale", async () => {
  const { dataRoot, store } = await fixture()
  const other = new InteractiveSessionStore(dataRoot)
  const lockPath = join(dataRoot, "locks", "SESSION-LOCK-HEARTBEAT.lock")
  let entered = false
  const held = (store as any).withSessionLock("SESSION-LOCK-HEARTBEAT", async () => {
    entered = true
    await Bun.sleep(1_200)
  })
  while (!entered) await Bun.sleep(5)
  const initial = JSON.parse(await readFile(lockPath, "utf8"))
  await Bun.sleep(1_050)
  const refreshed = JSON.parse(await readFile(lockPath, "utf8"))
  expect(refreshed.owner_token).toBe(initial.owner_token)
  expect(refreshed.heartbeat_at).toBeGreaterThan(initial.heartbeat_at)
  let stolen = false
  const contender = (other as any).withSessionLock("SESSION-LOCK-HEARTBEAT", async () => { stolen = true })
  await Bun.sleep(100)
  expect(stolen).toBe(false)
  await held
  await contender
  expect(stolen).toBe(true)
})

test("only the current owner token may release a session lock", async () => {
  const { dataRoot, store } = await fixture()
  const lockPath = join(dataRoot, "locks", "SESSION-LOCK-OWNER.lock")
  let entered = false
  const held = (store as any).withSessionLock("SESSION-LOCK-OWNER", async () => {
    entered = true
    while (true) {
      try {
        if (JSON.parse(await readFile(lockPath, "utf8")).owner_token === "replacement-owner") break
      } catch {
        // External tools on Windows may briefly expose a partially-written file;
        // lock release must still be guarded by owner token, not by parse timing.
      }
      await Bun.sleep(5)
    }
  })
  while (!entered) await Bun.sleep(5)
  await writeFile(lockPath, JSON.stringify({ owner_token: "replacement-owner", heartbeat_at: Date.now() }))
  await held
  expect(JSON.parse(await readFile(lockPath, "utf8")).owner_token).toBe("replacement-owner")
})