import { mkdir, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

type JsonObject = Record<string, unknown>

const args = process.argv.slice(2)
const baseUrl = (option(args, "--base-url") ?? "http://127.0.0.1:8787").replace(/\/$/u, "")
const learnerId = option(args, "--learner-id") ?? `day4-learner-${Date.now()}`
const sessionId = option(args, "--session-id") ?? `SESSION-DAY4-${crypto.randomUUID()}`
const runId = option(args, "--run-id") ?? `RUN-DAY4-${crypto.randomUUID()}`
const outputDirectory = resolve(option(args, "--output-dir")
  ?? `.tmp/competition-sprint/day4-dynamic-decision/runs/${sessionId}`)
const timeoutMs = positiveInteger(option(args, "--timeout-ms") ?? "300000", "--timeout-ms")
const headers = { authorization: `Bearer ${learnerId}`, "content-type": "application/json" }

await request("/health")
let session = await request("/orchestrator/sessions", {
  method: "POST",
  headers,
  body: JSON.stringify({
    session_id: sessionId,
    run_id: runId,
    mode: "deterministic",
    learner_request: {
      learner_id: learnerId,
      goal: option(args, "--goal") ?? "学习 Python 条件判断并完成基础练习",
      background: option(args, "--background") ?? "零基础，正在学习基础语法",
      self_rating: option(args, "--self-rating") ?? "beginner",
    },
  }),
})

session = await pollUntil(session, (value) => waitingType(value) === "diagnosis_answers" || isTerminal(value))
assertWaiting(session, "diagnosis_answers", "session did not reach diagnosis after asynchronous creation")
session = await submitDiagnosis(session, "CMD-DAY4-DIAG-1")
session = await pollUntil(session, (value) => waitingType(value) === "assessment_answers" || isTerminal(value))
assertWaiting(session, "assessment_answers", "first-round content generation did not reach assessment")

const assessmentResponse = await command("CMD-DAY4-ASSESS-1", "submit_assessment_answers", {
  answers: assessmentAnswers(waitingItems(session)),
})
const decisionSession = await pollUntil(assessmentResponse, (value) => Boolean(value.next_round_action) || isTerminal(value))
if (!decisionSession.next_round_action || !isObject(decisionSession.feedback)) {
  throw new Error("the real assessment did not produce feedback and next_round_action")
}

let finalSession = decisionSession
if (waitingType(finalSession) === "diagnosis_answers") {
  finalSession = await submitDiagnosis(finalSession, "CMD-DAY4-DIAG-2")
}
finalSession = await pollUntil(finalSession, (value) =>
  isTerminal(value)
  || waitingType(value) === "assessment_answers"
  || (waitingType(value) === "diagnosis_answers" && value !== decisionSession))
const events = await request(`/orchestrator/sessions/${sessionId}/events`, { headers })

await mkdir(outputDirectory, { recursive: true })
await Promise.all([
  writeJson("decision-session.json", decisionSession),
  writeJson("final-session.json", finalSession),
  writeJson("events.json", events),
  writeJson("run-summary.json", {
    schema_version: "1.0",
    session_id: sessionId,
    run_id: runId,
    action: nestedString(decisionSession, "next_round_action", "action"),
    feedback_id: nestedString(decisionSession, "feedback", "feedback_id"),
    decision_status: stringValue(decisionSession.status),
    final_status: stringValue(finalSession.status),
    final_stage: stringValue(finalSession.current_stage),
    evidence_files: ["decision-session.json", "final-session.json", "events.json"],
  }),
])

console.log(JSON.stringify({
  output_directory: outputDirectory,
  session_id: sessionId,
  run_id: runId,
  action: nestedString(decisionSession, "next_round_action", "action"),
  final_status: finalSession.status,
  final_stage: finalSession.current_stage,
}, null, 2))

async function submitDiagnosis(current: JsonObject, commandId: string): Promise<JsonObject> {
  assertWaiting(current, "diagnosis_answers", "session is not waiting for diagnosis answers")
  const answers = Object.fromEntries(waitingItems(current).map((item) => {
    const itemId = stringValue(item.item_id)
    const options = Array.isArray(item.options) ? item.options : []
    const first = options[0]
    const answer = typeof first === "string" ? first : stringValue(isObject(first) ? first.option_id ?? first.value : "")
    if (!itemId || !answer) throw new Error("diagnosis item lacks a usable public option")
    return [itemId, answer]
  }))
  return command(commandId, "submit_diagnosis_answers", { answers })
}

function assessmentAnswers(items: JsonObject[]): JsonObject[] {
  return items.map((item) => {
    const itemId = stringValue(item.item_id)
    const modality = stringValue(item.modality)
    if (!itemId) throw new Error("assessment item lacks item_id")
    if (modality === "mcq" || modality === "true_false") {
      const options = Array.isArray(item.options) ? item.options : []
      const first = options[0]
      const optionId = stringValue(isObject(first) ? first.option_id ?? first.id : first)
      if (!optionId) throw new Error(`${itemId} lacks a public option_id`)
      return { item_id: itemId, selected_option_id: optionId, hint_level_used: 0 }
    }
    if (modality === "code") return { item_id: itemId, code_response: "# intentionally unanswered for acceptance routing", hint_level_used: 0 }
    return { item_id: itemId, text_response: "暂不确定", hint_level_used: 0 }
  })
}

async function command(commandId: string, type: string, payload: JsonObject): Promise<JsonObject> {
  return request(`/orchestrator/sessions/${sessionId}/commands`, {
    method: "POST", headers, body: JSON.stringify({ command_id: commandId, type, payload }),
  })
}

async function pollUntil(_initial: JsonObject, predicate: (value: JsonObject) => boolean): Promise<JsonObject> {
  const deadline = Date.now() + timeoutMs
  // Session creation and commands are durable asynchronous jobs. Their HTTP
  // response may describe an accepted/intermediate job rather than the latest
  // persisted session, so always begin polling from the canonical GET endpoint.
  let current = await request(`/orchestrator/sessions/${sessionId}`, { headers })
  while (!predicate(current)) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for session ${sessionId}`)
    await Bun.sleep(1000)
    current = await request(`/orchestrator/sessions/${sessionId}`, { headers })
  }
  return current
}

async function request(path: string, init: RequestInit = {}): Promise<JsonObject> {
  const response = await fetch(`${baseUrl}${path}`, init)
  const body = await response.json() as JsonObject
  if (!response.ok) throw new Error(`${response.status} ${path}: ${JSON.stringify(body)}`)
  return body
}

function waitingItems(sessionValue: JsonObject): JsonObject[] {
  const waiting = isObject(sessionValue.waiting_for) ? sessionValue.waiting_for : {}
  return Array.isArray(waiting.items) ? waiting.items.filter(isObject) : []
}

function waitingType(sessionValue: JsonObject): string {
  return isObject(sessionValue.waiting_for) ? stringValue(sessionValue.waiting_for.type) : ""
}

function isTerminal(sessionValue: JsonObject): boolean {
  const status = stringValue(sessionValue.status)
  return status === "blocked"
    || status === "failed"
    || (status === "completed" && stringValue(sessionValue.current_stage) === "completed")
}

function assertWaiting(sessionValue: JsonObject, expected: string, message: string): void {
  if (waitingType(sessionValue) !== expected) throw new Error(`${message}; status=${sessionValue.status}, stage=${sessionValue.current_stage}`)
}

async function writeJson(name: string, value: unknown): Promise<void> {
  await writeFile(resolve(outputDirectory, name), `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

function nestedString(value: JsonObject, parent: string, child: string): string | null {
  return isObject(value[parent]) ? stringValue(value[parent][child]) || null : null
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function option(values: string[], name: string): string | undefined {
  return values.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1)
}

function positiveInteger(value: string, name: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`)
  return parsed
}
