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

test("does not leave a ghost lock when an in-flight heartbeat overlaps command completion", async () => {
  const { dataRoot, store } = await fixture()
  const other = interactiveStore(dataRoot)
  let secondEntered = false
  await (store as any).withSessionLock("SESSION-LOCK-RELEASE", async () => {
    // Cross at least one heartbeat boundary before returning.
    await Bun.sleep(650)
  })
  await (other as any).withSessionLock("SESSION-LOCK-RELEASE", async () => {
    secondEntered = true
  })
  expect(secondEntered).toBe(true)
  await expect(readFile(join(dataRoot, "locks", "SESSION-LOCK-RELEASE.lock"), "utf8"))
    .rejects.toMatchObject({ code: "ENOENT" })
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

test("keeps append-only worker ledger history while retaining latest worker ledger view", async () => {
  const { store, record } = await fixture()
  expect(record.worker_ledger.filter((entry) => entry.worker === "objective-diagnostician")).toHaveLength(1)
  const initialDiagnosisEntries = record.worker_ledger_history?.filter((entry) => entry.unit_name === "objective-diagnostician") ?? []
  expect(initialDiagnosisEntries.map((entry) => entry.status)).toEqual(["waiting_for_user"])
  expect(initialDiagnosisEntries[0]).toMatchObject({
    schema_version: "1.0",
    session_id: record.session_id,
    run_id: record.run_id,
    round_no: 1,
    step_index: 3,
    attempt_no: 1,
    parent_entry_id: null,
    orchestrator: "learning-orchestrator",
    unit_name: "objective-diagnostician",
    execution_type: "session_logic",
    stage: "objective_diagnosis",
    status: "waiting_for_user",
    finished_at: null,
    input_refs: expect.arrayContaining([
      expect.objectContaining({ ref_id: "background-collector:session-input", verified_exists: true }),
      expect.objectContaining({ ref_id: "self-assessor:session-input", verified_exists: true }),
    ]),
    output_refs: expect.arrayContaining([
      expect.objectContaining({ ref_id: "objective-diagnostician:diagnosis-form", verified_exists: true }),
    ]),
    evidence_refs: [],
    execution_ref: expect.objectContaining({ kind: "trace", source: "orchestrator", verified_exists: true }),
    errors: [],
    retry: null,
    manual_intervention: expect.objectContaining({ occurred: true, kind: "user_input" }),
    observability: expect.objectContaining({ execution_observed: true, artifact_verified: true, evidence_level: "E3" }),
  })
  expect(initialDiagnosisEntries[0].entry_id).toStartWith(`${record.session_id}-objective-diagnostician-`)
  expect(initialDiagnosisEntries[0]).not.toHaveProperty("step_id")
  expect(initialDiagnosisEntries[0]).not.toHaveProperty("worker")
  expect(initialDiagnosisEntries[0]).not.toHaveProperty("ended_at")
  expect(initialDiagnosisEntries[0]).not.toHaveProperty("error")
  expect(initialDiagnosisEntries[0]).not.toHaveProperty("human_intervention")

  const answers = Object.fromEntries(record.waiting_for!.items.map((item: any) => [item.item_id, item.options?.[0] ?? "不知道"]))
  const continued = await store.command(record.session_id, {
    command_id: "CMD-HISTORY-DIAGNOSIS",
    type: "submit_diagnosis_answers",
    payload: { answers },
  })

  expect(continued.worker_ledger.filter((entry) => entry.worker === "objective-diagnostician")).toHaveLength(1)
  expect(continued.worker_ledger.find((entry) => entry.worker === "objective-diagnostician")?.status).toBe("completed")
  expect(continued.worker_ledger_history?.filter((entry) => entry.unit_name === "objective-diagnostician").map((entry) => entry.status)).toEqual(["waiting_for_user", "completed"])
  const profileEntries = continued.worker_ledger_history?.filter((entry) => entry.unit_name === "profile-builder") ?? []
  expect(profileEntries.map((entry) => entry.status)).toEqual(["running", "completed"])
  expect(profileEntries[0]).toMatchObject({
    execution_type: "deterministic_adapter",
    started_at: expect.any(String),
    finished_at: null,
    input_refs: expect.arrayContaining([expect.objectContaining({ kind: "evidence", source: "B" })]),
    output_refs: [],
    evidence_refs: [],
    errors: [],
    observability: expect.objectContaining({ input_observed: true, output_observed: false }),
  })
  expect(profileEntries[1]).toMatchObject({
    execution_type: "deterministic_adapter",
    started_at: profileEntries[0].started_at,
    finished_at: expect.any(String),
    output_refs: expect.arrayContaining([expect.objectContaining({ kind: "artifact", source: "B" })]),
    observability: expect.objectContaining({ output_observed: true }),
  })
})

test("exposes review state and withholds unpublished Role C artifacts while review is pending", async () => {
  const { store, record } = await fixture()
  const answers = Object.fromEntries(record.waiting_for!.items.map((item: any) => [item.item_id, item.options?.[0] ?? "不知道"]))

  const continued = await store.command(record.session_id, {
    command_id: "CMD-DAY3-REVIEW-PENDING",
    type: "submit_diagnosis_answers",
    payload: { answers },
  })

  expect(continued.status).toBe("running")
  expect(continued.current_stage).toBe("assessment")
  expect(continued.learning_resources).toEqual({ concept_lesson: null, code_lab: null })
  expect(continued.assessment).toBeNull()
  expect((continued as any).content_review).toMatchObject({
    overall_status: "reviewing",
    publish_allowed: false,
    blocked_or_degraded: false,
    round_no: 1,
    workers: {
      "concept-tutor": expect.objectContaining({ status: "reviewing", published: false }),
      "code-lab": expect.objectContaining({ status: "pending", published: false }),
      "tiered-evaluator": expect.objectContaining({ status: "pending", published: false }),
    },
  })
})

test("keeps failed review visible and blocks publication after Role C review exhaustion", async () => {
  const { store, record } = await fixture()
  const answers = Object.fromEntries(record.waiting_for!.items.map((item: any) => [item.item_id, item.options?.[0] ?? "不知道"]))
  const continued = await store.command(record.session_id, {
    command_id: "CMD-DAY3-REVIEW-FAIL-SEED",
    type: "submit_diagnosis_answers",
    payload: { answers },
  })
  const persisted = await store.load(record.session_id)
  persisted.private.role_c_failed_generations = 1
  persisted.next_round_action = {
    action: "remediate",
    round_no: 2,
    target_node_id: "NODE-1",
    feedback_id: "FB-1",
    status: "generating_next_round",
  }
  ;(await import("../src/orchestration/interactive-session") as any).__test_applyRoleCGenerationFailure(persisted, {
    ok: false,
    reason: "role-c.code-lab.secure 未在有限修复次数内通过校验；HIDDEN_TEST_EXPECTED_LEAK；NO_REPAIR_PROGRESS",
    failure: {
      code: "REVIEW_REJECTED",
      stage: "code_lab",
      issueCodes: ["HIDDEN_TEST_EXPECTED_LEAK", "NO_REPAIR_PROGRESS"],
      repairScope: "artifact",
      nextAction: "regenerate_code_lab",
      canRetry: true,
      message: "hidden expected leak",
      fingerprint: "FAIL-DAY3-CODE-LAB",
    },
  })

  expect(continued.learning_resources).toEqual({ concept_lesson: null, code_lab: null })
  expect(persisted.learning_resources).toEqual({ concept_lesson: null, code_lab: null })
  expect(persisted.assessment).toBeNull()
  expect(persisted.status).toBe("blocked")
  expect(persisted.next_round_action).toBeNull()
  expect(persisted.content_review).toMatchObject({
    overall_status: "blocked",
    publish_allowed: false,
    blocked_or_degraded: true,
    workers: {
      "code-lab": expect.objectContaining({
        status: "blocked",
        published: false,
        repair_attempt_no: 2,
        last_error: expect.stringContaining("HIDDEN_TEST_EXPECTED_LEAK"),
      }),
    },
  })
  expect(persisted.terminal_outcome?.generation_failure?.canRetry).toBe(false)
  expect(persisted.worker_ledger_history
    .filter((entry) => entry.unit_name === "code-lab" && entry.status === "blocked")
    .at(-1)).toMatchObject({
      attempt_no: 1,
      errors: [expect.objectContaining({ severity: "fatal" })],
      retry: { eligible: false, scheduled: false, next_attempt_no: null },
    })
})

test("records a recoverable Role C failure with an explicit next retry attempt", async () => {
  const { store, record } = await fixture()
  const persisted = await store.load(record.session_id)
  ;(await import("../src/orchestration/interactive-session")).__test_applyRoleCGenerationFailure(persisted, {
    ok: false,
    reason: "assessment needs a novel variant",
    failure: {
      code: "CONTENT_NOT_NOVEL",
      stage: "assessment",
      issueCodes: ["ASSESSMENT_DUPLICATE"],
      repairScope: "artifact",
      nextAction: "regenerate_assessment",
      canRetry: true,
      message: "assessment needs a novel variant",
      fingerprint: "FAIL-NOVELTY-1",
    },
  })
  expect(persisted.worker_ledger_history
    .filter((entry) => entry.unit_name === "tiered-evaluator" && entry.status === "failed")
    .at(-1)).toMatchObject({
      attempt_no: 1,
      errors: [expect.objectContaining({ severity: "recoverable" })],
      retry: { eligible: true, scheduled: true, reason: "regenerate_assessment", next_attempt_no: 2 },
    })
  expect(persisted.worker_ledger.find((entry) => entry.worker === "tiered-evaluator")).toMatchObject({
    status: "failed",
    summary: expect.stringContaining("等待修复后重审"),
  })
  expect(persisted.content_review?.workers["tiered-evaluator"]).toMatchObject({
    status: "failed",
    published: false,
  })
})

test("records a reprofile diagnosis-generation block in both current and append-only worker ledgers", async () => {
  const { store, record } = await fixture()
  const persisted = await store.load(record.session_id)
  const { __test_applyDiagnosticGenerationFailure } = await import("../src/orchestration/interactive-session")

  __test_applyDiagnosticGenerationFailure(persisted, new Error("new diagnosis duplicated a published item"))

  expect(persisted).toMatchObject({
    status: "blocked",
    current_stage: "blocked",
    waiting_for: null,
    blocked_reason: expect.stringContaining("DIAGNOSTIC_GENERATION_FAILED"),
  })
  expect(persisted.worker_ledger.find((entry) => entry.worker === "objective-diagnostician")).toMatchObject({
    status: "blocked",
    summary: expect.stringContaining("new diagnosis duplicated"),
  })
  expect(persisted.worker_ledger_history.filter((entry) => entry.unit_name === "objective-diagnostician").at(-1)).toMatchObject({
    status: "blocked",
    attempt_no: 2,
    execution_type: "session_logic",
    errors: [expect.objectContaining({ code: "DIAGNOSTIC_GENERATION_FAILED" })],
  })
  expect(persisted.events.at(-1)).toMatchObject({ event_type: "session_blocked", worker: "objective-diagnostician" })
})
