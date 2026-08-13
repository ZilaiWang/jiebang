import { afterEach, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { InteractiveSessionStore } from "../src/orchestration/interactive-session"
import { saveLearnerMemory } from "../src/orchestration/learner-memory"

const roots: string[] = []
const diagnosticQuestionAuthor = {
  async author(input: any) {
    return input.targets.map((target: any, index: number) => ({
      source_id: target.source_id,
      fact_id: target.facts[0].fact_id,
      concept: target.concept,
      difficulty: target.difficulty,
      question: `根据知识事实，关于 ${target.concept} 的正确说法是什么？${index}`,
      options: [target.facts[0].content, "与该事实相反", "与该事实无关"],
      answer: target.facts[0].content,
      selection_reason: target.selection_reason,
    }))
  },
}

function interactiveStore(dataRoot: string) {
  return new InteractiveSessionStore(dataRoot, { diagnostic_question_author: diagnosticQuestionAuthor })
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const dataRoot = await mkdtemp(join(tmpdir(), "interactive-session-persistence-"))
  roots.push(dataRoot)
  const store = interactiveStore(dataRoot)
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
  const other = interactiveStore(dataRoot)
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

test("loads answer-free assessment history so later sessions receive new AI-authored forms", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "interactive-session-history-"))
  roots.push(dataRoot)
  await saveLearnerMemory(dataRoot, {
    schema_version: "1.0",
    learner_id: "learner-history-001",
    mastery_by_source_id: {},
    mastered_source_ids: [],
    weak_source_ids: [],
    completed_sessions: [],
    recent_errors: [],
    recent_assessment_items: [{
      form_id: "FORM-PREVIOUS",
      item_id: "ITEM-PREVIOUS",
      objective_id: "OBJ-K007",
      modality: "mcq",
      prompt: "for 循环会按什么顺序遍历列表？",
      options: ["按索引顺序", "随机顺序"],
    }],
    updated_at: "2026-08-11T00:00:00.000Z",
  })
  const record = await interactiveStore(dataRoot).create({
    session_id: "SESSION-HISTORY-001",
    run_id: "RUN-HISTORY-001",
    owner_id: "learner-history-001",
    mode: "deterministic",
    learner_request: { learner_id: "learner-history-001", goal: "学习 Python 循环" },
  })
  expect(record.private.assessment_history).toContainEqual(
    expect.objectContaining({ form_id: "FORM-PREVIOUS", item_id: "ITEM-PREVIOUS" }),
  )
  expect(record.private.assessment_history.some((item) => item.form_id === "DIAGFORM-SESSION-HISTORY-001")).toBe(true)
})
