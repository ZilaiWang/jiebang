import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createLearningOrchestratorApiHandler } from "../src/orchestration/learning-orchestrator-api"
// 真实模型 + Docker 代码执行依赖：默认跳过，RUN_INTEGRATION_TESTS=1 时运行。
const runIntegration = process.env.RUN_INTEGRATION_TESTS === "1"

const roots: string[] = []

async function fixture() {
  const data_root = await mkdtemp(join(tmpdir(), "orchestrator-session-api-"))
  roots.push(data_root)
  return {
    data_root,
    handle: createLearningOrchestratorApiHandler({ data_root }),
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function json(response: Response): Promise<any> {
  expect(response.headers.get("content-type")).toContain("application/json")
  return response.json()
}

function ownerRequest(url: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers)
  headers.set("authorization", "Bearer learner-interactive-001")
  return new Request(url, { ...init, headers })
}

async function createSession(handle: (request: Request) => Promise<Response>) {
  const response = await handle(new Request("http://localhost/orchestrator/sessions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer learner-interactive-001" },
    body: JSON.stringify({
      session_id: "SESSION-INTERACTIVE-001",
      mode: "deterministic",
      learner_request: {
        learner_id: "learner-interactive-001",
        goal: "学习 Python 循环并完成成绩统计",
        background: "零基础学习者",
        self_rating: "beginner",
      },
      root_dir: "C:/browser-must-not-control-this",
    }),
  }))
  return { response, body: await json(response) }
}

describe.skipIf(!runIntegration)("learning orchestrator persistent session HTTP API", () => {
  test("binds every session route to the authenticated learner", async () => {
    const { handle } = await fixture()
    const ownerHeaders = { "content-type": "application/json", authorization: "Bearer learner-interactive-001" }
    const foreignHeaders = { authorization: "Bearer another-learner" }
    const create = await handle(ownerRequest("http://localhost/orchestrator/sessions", {
      method: "POST",
      headers: ownerHeaders,
      body: JSON.stringify({
        session_id: "SESSION-AUTH-001",
        mode: "deterministic",
        learner_request: { learner_id: "learner-interactive-001", goal: "学习 Python 循环" },
      }),
    }))
    expect(create.status).toBe(201)

    const mismatchedCreate = await handle(new Request("http://localhost/orchestrator/sessions", {
      method: "POST",
      headers: ownerHeaders,
      body: JSON.stringify({
        session_id: "SESSION-AUTH-MISMATCH",
        mode: "deterministic",
        learner_request: { learner_id: "another-learner", goal: "学习 Python 循环" },
      }),
    }))
    expect(mismatchedCreate.status).toBe(403)

    expect((await handle(new Request("http://localhost/orchestrator/sessions/SESSION-AUTH-001"))).status).toBe(401)
    expect((await handle(new Request("http://localhost/orchestrator/sessions/SESSION-AUTH-001", { headers: foreignHeaders }))).status).toBe(403)
    expect((await handle(new Request("http://localhost/orchestrator/sessions/SESSION-AUTH-001/events", { headers: foreignHeaders }))).status).toBe(403)
    expect((await handle(new Request("http://localhost/orchestrator/sessions/SESSION-AUTH-001/commands", {
      method: "POST", headers: { ...foreignHeaders, "content-type": "application/json" },
      body: JSON.stringify({ command_id: "CMD-FOREIGN", type: "retry" }),
    }))).status).toBe(403)
    expect((await handle(new Request("http://localhost/orchestrator/sessions/SESSION-AUTH-001", { headers: { authorization: "Bearer learner-interactive-001" } }))).status).toBe(200)
  })

  test("serializes duplicate creation and commands across separate handlers", async () => {
    const data_root = await mkdtemp(join(tmpdir(), "orchestrator-cross-handler-"))
    roots.push(data_root)
    const left = createLearningOrchestratorApiHandler({ data_root })
    const right = createLearningOrchestratorApiHandler({ data_root })
    const createBody = {
      session_id: "SESSION-CROSS-HANDLER",
      mode: "deterministic",
      learner_request: { learner_id: "learner-interactive-001", goal: "学习 Python 循环" },
    }
    const createInit = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(createBody),
    }
    const [createdLeft, createdRight] = await Promise.all([
      left(ownerRequest("http://localhost/orchestrator/sessions", createInit)),
      right(ownerRequest("http://localhost/orchestrator/sessions", createInit)),
    ])
    expect([createdLeft.status, createdRight.status].sort()).toEqual([201, 409])

    const get = await left(ownerRequest("http://localhost/orchestrator/sessions/SESSION-CROSS-HANDLER"))
    const state = await json(get)
    const answers = Object.fromEntries(state.waiting_for.items.map((item: any) => [item.item_id, item.options?.[0] ?? "不知道"]))
    const command = {
      command_id: "CMD-CROSS-HANDLER",
      type: "submit_diagnosis_answers",
      payload: { answers },
    }
    const commandInit = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(command),
    }
    const [commandLeft, commandRight] = await Promise.all([
      left(ownerRequest("http://localhost/orchestrator/sessions/SESSION-CROSS-HANDLER/commands", commandInit)),
      right(ownerRequest("http://localhost/orchestrator/sessions/SESSION-CROSS-HANDLER/commands", commandInit)),
    ])
    expect(commandLeft.status).toBe(200)
    expect(commandRight.status).toBe(200)
    expect(await json(commandRight)).toEqual(await json(commandLeft))
  })

  test("uses collision-safe automatic session and run IDs", async () => {
    const { handle } = await fixture()
    const requests = Array.from({ length: 30 }, (_, index) => handle(ownerRequest("http://localhost/orchestrator/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "deterministic",
        learner_request: { learner_id: "learner-interactive-001", goal: `学习 Python 循环 ${index}` },
      }),
    })))
    const responses = await Promise.all(requests)
    expect(responses.every((response) => response.status === 201)).toBe(true)
    const bodies = await Promise.all(responses.map((response) => json(response)))
    expect(new Set(bodies.map((body) => body.session_id)).size).toBe(30)
    expect(new Set(bodies.map((body) => body.run_id)).size).toBe(30)
  })

  test("rejects retry at the diagnosis gate instead of fabricating correct learner answers", async () => {
    const { handle } = await fixture()
    await createSession(handle)
    const response = await handle(ownerRequest("http://localhost/orchestrator/sessions/SESSION-INTERACTIVE-001/commands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command_id: "CMD-RETRY-DIAGNOSIS", type: "retry" }),
    }))
    expect(response.status).toBe(409)
    const restored = await json(await handle(ownerRequest("http://localhost/orchestrator/sessions/SESSION-INTERACTIVE-001")))
    expect(restored).toMatchObject({ current_stage: "objective_diagnosis", waiting_for: { type: "diagnosis_answers" } })
    expect(restored.profile).toBeNull()
  })

  test("rejects unsafe HTTP bodies before orchestration starts", async () => {
    const { handle } = await fixture()
    const nullBody = await handle(ownerRequest("http://localhost/orchestrator/sessions", {
      method: "POST", headers: { "content-type": "application/json" }, body: "null",
    }))
    expect(nullBody.status).toBe(400)
    expect(await json(nullBody)).toMatchObject({ error: { code: "INVALID_SESSION_REQUEST" } })

    const wrongType = await handle(ownerRequest("http://localhost/orchestrator/sessions", {
      method: "POST", headers: { "content-type": "text/plain" }, body: "{}",
    }))
    expect(wrongType.status).toBe(415)

    const oversized = await handle(ownerRequest("http://localhost/orchestrator/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "deterministic", learner_request: { learner_id: "learner-interactive-001", goal: "x".repeat(1_100_000) } }),
    }))
    expect(oversized.status).toBe(413)
  })

  test("rejects scaffold mode for interactive sessions instead of returning incomplete public artifacts", async () => {
    const { handle } = await fixture()
    const response = await handle(ownerRequest("http://localhost/orchestrator/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "scaffold",
        learner_request: { goal: "学习 Python 循环" },
      }),
    }))
    expect(response.status).toBe(400)
    expect(await json(response)).toMatchObject({ error: { code: "INVALID_SESSION_REQUEST" } })
  })

  test("rejects a concurrent duplicate session creation instead of overwriting state", async () => {
    const { handle } = await fixture()
    const body = {
      session_id: "SESSION-INTERACTIVE-001",
      mode: "deterministic",
      learner_request: { learner_id: "learner-interactive-001", goal: "学习 Python 循环", background: "零基础", self_rating: "beginner" },
    }
    const [left, right] = await Promise.all([
      handle(ownerRequest("http://localhost/orchestrator/sessions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })),
      handle(ownerRequest("http://localhost/orchestrator/sessions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })),
    ])
    expect([left.status, right.status].sort()).toEqual([201, 409])
  })

  test("does not force a focused target to five unrelated diagnosis questions", async () => {
    const { handle } = await fixture()
    const response = await handle(ownerRequest("http://localhost/orchestrator/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        session_id: "SESSION-FOCUSED-DIAGNOSIS",
        mode: "deterministic",
        learner_request: {
          learner_id: "learner-interactive-001",
          goal: "学习 for 循环",
          learning_goal_spec: { mode: "curriculum_node", selected_node_ids: ["PY-CH02-S02"] },
        },
      }),
    }))
    const body = await json(response)

    expect(body.waiting_for.items.map((item: any) => item.source_id)).toEqual(["K007", "K002", "K003"])
  })

  test("creates a durable session, stops for diagnosis answers, and can query it", async () => {
    const { data_root, handle } = await fixture()
    const created = await createSession(handle)

    expect(created.response.status).toBe(201)
    expect(created.body).toMatchObject({
      session_id: "SESSION-INTERACTIVE-001",
      status: "waiting_for_user",
      current_stage: "objective_diagnosis",
      waiting_for: { type: "diagnosis_answers" },
      profile: null,
      formal_path: null,
      feedback: null,
    })
    expect(created.body.waiting_for.items.length).toBeGreaterThan(0)
    expect(created.body.waiting_for.items[0]).not.toHaveProperty("answer")
    expect(created.body.worker_ledger.map((event: any) => event.worker).filter(Boolean)).toEqual([
      "background-collector",
      "self-assessor",
      "objective-diagnostician",
    ])

    const queried = await handle(ownerRequest("http://localhost/orchestrator/sessions/SESSION-INTERACTIVE-001"))
    expect(queried.status).toBe(200)
    expect(await json(queried)).toEqual(created.body)

    const files = await Array.fromAsync(new Bun.Glob("sessions/*.json").scan({ cwd: data_root }))
    expect(files.map((path) => path.replaceAll("\\", "/"))).toEqual(["sessions/SESSION-INTERACTIVE-001.json"])
  })

  test("accepts diagnosis answers once and continues the same session to a public assessment", async () => {
    const { data_root, handle } = await fixture()
    const created = await createSession(handle)
    const answers = Object.fromEntries(created.body.waiting_for.items.map((item: any) => [item.item_id, item.options?.[0] ?? "不知道"]))

    const response = await handle(ownerRequest("http://localhost/orchestrator/sessions/SESSION-INTERACTIVE-001/commands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        command_id: "CMD-DIAGNOSIS-001",
        type: "submit_diagnosis_answers",
        payload: { answers },
      }),
    }))
    const body = await json(response)

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      session_id: "SESSION-INTERACTIVE-001",
      status: "waiting_for_user",
      current_stage: "assessment",
      waiting_for: { type: "assessment_answers" },
    })
    expect(body.profile.learner_id).toBe("learner-interactive-001")
    expect(body.worker_ledger.find((entry: any) => entry.worker === "objective-diagnostician").status).toBe("completed")
    expect(body.formal_path.nodes.length).toBeGreaterThan(0)
    expect(body.current_path_node.node_id).toBeTruthy()
    expect(body.rag_result.results.length).toBeGreaterThan(0)
    expect(body.learning_resources.concept_lesson.status).toBe("ready")
    expect(body.learning_resources.code_lab.status).toBe("ready")
    expect(body.assessment.status).toBe("ready")
    expect(body.assessment.payload.items.length).toBeGreaterThan(0)
    expect(JSON.stringify(body)).not.toContain("assessment_secure")
    expect(JSON.stringify(body)).not.toContain("correct_option_id")
    expect(JSON.stringify(body)).not.toContain("hidden_tests")
    expect(JSON.stringify(body)).not.toContain("reference_solution")
    const sessionFiles = await Array.fromAsync(new Bun.Glob("sessions/*.json").scan({ cwd: data_root }))
    const persistedText = await Bun.file(join(data_root, sessionFiles[0]!)).text()
    expect(persistedText).not.toContain("assessment_secure")
    expect(persistedText).not.toContain("hidden_tests")
    expect(persistedText).not.toContain("reference_solution")

    const replay = await handle(ownerRequest("http://localhost/orchestrator/sessions/SESSION-INTERACTIVE-001/commands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        command_id: "CMD-DIAGNOSIS-001",
        type: "submit_diagnosis_answers",
        payload: { answers },
      }),
    }))
    expect(await json(replay)).toEqual(body)
  })

  test("grades submitted assessment answers and dynamically opens the next round", async () => {
    const { data_root, handle } = await fixture()
    const created = await createSession(handle)
    const diagnosisAnswers = Object.fromEntries(created.body.waiting_for.items.map((item: any) => [item.item_id, item.options?.[0] ?? "不知道"]))
    const prepared = await json(await handle(ownerRequest("http://localhost/orchestrator/sessions/SESSION-INTERACTIVE-001/commands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command_id: "CMD-DIAGNOSIS-001", type: "submit_diagnosis_answers", payload: { answers: diagnosisAnswers } }),
    })))

    const assessmentAnswers = prepared.assessment.payload.items.map((item: any) => ({
      item_id: item.item_id,
      ...(item.modality === "mcq" || item.modality === "true_false"
        ? { selected_option_id: item.options[0].option_id }
        : item.modality === "code"
          ? { code_response: "return None" }
          : { text_response: "" }),
      hint_level_used: 0,
    }))
    const response = await handle(ownerRequest("http://localhost/orchestrator/sessions/SESSION-INTERACTIVE-001/commands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        command_id: "CMD-ASSESSMENT-001",
        type: "submit_assessment_answers",
        payload: { answers: assessmentAnswers },
      }),
    }))
    const body = await json(response)

    expect(response.status).toBe(200)
    expect(body.feedback.round_score.max_score).toBeGreaterThan(0)
    expect(["remediate", "reinforce", "advance"]).toContain(body.feedback.final_decision.action)
    expect(body.round_no).toBe(2)
    expect(body.status).toBe("waiting_for_user")
    expect(body.waiting_for.type).toBe("assessment_answers")
    expect(body.assessment.payload.items.length).toBeGreaterThan(0)

    const secondAnswers = body.assessment.payload.items.map((item: any) => ({
      item_id: item.item_id,
      ...(item.modality === "mcq" || item.modality === "true_false"
        ? { selected_option_id: item.options[0].option_id }
        : item.modality === "code"
          ? { code_response: "return None" }
          : { text_response: "" }),
      hint_level_used: 0,
    }))
    const secondResponse = await handle(ownerRequest("http://localhost/orchestrator/sessions/SESSION-INTERACTIVE-001/commands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command_id: "CMD-ASSESSMENT-002", type: "submit_assessment_answers", payload: { answers: secondAnswers } }),
    }))
    const secondBody = await json(secondResponse)
    expect(secondResponse.status).toBe(200)
    expect(secondBody.feedback.run_id).toBe(body.assessment.run_id)
    expect(secondBody.round_no).toBe(3)

    const reloadedHandler = createLearningOrchestratorApiHandler({ data_root })
    const restored = await reloadedHandler(ownerRequest("http://localhost/orchestrator/sessions/SESSION-INTERACTIVE-001"))
    expect(await json(restored)).toEqual(secondBody)
  })

  test("keeps a verified advance decision and persists a public blocked state when the next offline target is unsupported", async () => {
    const { handle } = await fixture()
    const created = await createSession(handle)
    const diagnosisAnswers = Object.fromEntries(created.body.waiting_for.items.map((item: any) => [item.item_id, item.options?.[0] ?? "不知道"]))
    const prepared = await json(await handle(ownerRequest("http://localhost/orchestrator/sessions/SESSION-INTERACTIVE-001/commands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command_id: "CMD-DIAGNOSIS-001", type: "submit_diagnosis_answers", payload: { answers: diagnosisAnswers } }),
    })))
    const correct: Record<string, Record<string, string>> = {
      "ITEM-O1-T1-MCQ": { selected_option_id: "opt_iterate" },
      "ITEM-O2-T1-TF": { selected_option_id: "opt_true" },
      "ITEM-O1-T2-TRACE": { text_response: "8" },
      "ITEM-O2-T2-SHORT": { text_response: "列表可用于保存多个有序元素，for 循环按顺序逐项处理一组成绩" },
      "ITEM-O3-T3-CODE": { code_response: "def average_score(scores):\n    return sum(scores) / len(scores)" },
    }
    const answers = prepared.assessment.payload.items.map((item: any) => ({
      item_id: item.item_id,
      ...correct[item.item_id],
      hint_level_used: 0,
    }))

    const response = await handle(ownerRequest("http://localhost/orchestrator/sessions/SESSION-INTERACTIVE-001/commands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command_id: "CMD-ASSESSMENT-HIGH", type: "submit_assessment_answers", payload: { answers } }),
    }))
    const body = await json(response)

    expect(response.status).toBe(200)
    expect(body.status).toBe("blocked")
    expect(body.feedback.final_decision.action).toBe("advance")
    expect(body.blocked_reason.length).toBeGreaterThan(0)
    const restored = await json(await handle(ownerRequest("http://localhost/orchestrator/sessions/SESSION-INTERACTIVE-001")))
    expect(restored).toEqual(body)

    const retried = await handle(ownerRequest("http://localhost/orchestrator/sessions/SESSION-INTERACTIVE-001/commands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command_id: "CMD-RETRY-UNSUPPORTED", type: "retry" }),
    }))
    const retryBody = await json(retried)
    expect(retried.status).toBe(200)
    expect(retryBody.status).toBe("blocked")
    expect(retryBody.feedback.final_decision.action).toBe("advance")
    expect(retryBody.waiting_for).toBeNull()
  })

  test("serializes concurrent duplicate commands and advances the session only once", async () => {
    const { handle } = await fixture()
    const created = await createSession(handle)
    const answers = Object.fromEntries(created.body.waiting_for.items.map((item: any) => [item.item_id, item.options?.[0] ?? "不知道"]))
    const command = {
      command_id: "CMD-CONCURRENT-DIAGNOSIS",
      type: "submit_diagnosis_answers",
      payload: { answers },
    }

    const [left, right] = await Promise.all([
      handle(ownerRequest("http://localhost/orchestrator/sessions/SESSION-INTERACTIVE-001/commands", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(command),
      })),
      handle(ownerRequest("http://localhost/orchestrator/sessions/SESSION-INTERACTIVE-001/commands", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(command),
      })),
    ])
    const leftBody = await json(left)
    const rightBody = await json(right)

    expect(left.status).toBe(200)
    expect(right.status).toBe(200)
    expect(rightBody).toEqual(leftBody)
    expect(leftBody.worker_ledger.filter((entry: any) => entry.worker === "profile-builder")).toHaveLength(1)
  })

  test("returns session events and rejects unknown or conflicting commands", async () => {
    const { handle } = await fixture()
    await createSession(handle)

    const eventsResponse = await handle(ownerRequest("http://localhost/orchestrator/sessions/SESSION-INTERACTIVE-001/events"))
    const events = await json(eventsResponse)
    expect(eventsResponse.status).toBe(200)
    expect(events.session_id).toBe("SESSION-INTERACTIVE-001")
    expect(events.events.length).toBeGreaterThan(0)
    expect(events.events.some((event: any) => event.event_type === "waiting_for_user")).toBe(true)

    const missing = await handle(ownerRequest("http://localhost/orchestrator/sessions/UNKNOWN"))
    expect(missing.status).toBe(404)

    const invalid = await handle(ownerRequest("http://localhost/orchestrator/sessions/SESSION-INTERACTIVE-001/commands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command_id: "CMD-BAD", type: "submit_assessment_answers", payload: { answers: [] } }),
    }))
    expect(invalid.status).toBe(409)
    expect(await json(invalid)).toMatchObject({ error: { code: "COMMAND_NOT_ALLOWED" } })
  })
})
