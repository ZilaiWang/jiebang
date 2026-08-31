import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createLearningOrchestratorApiHandler } from "../src/orchestration/learning-orchestrator-api"
import { InteractiveSessionStore } from "../src/orchestration/interactive-session"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function request(url: string, learnerId: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers)
  headers.set("authorization", `Bearer ${learnerId}`)
  return new Request(url, { ...init, headers })
}

async function body(response: Response): Promise<any> {
  return response.json()
}

test("path HTTP API exposes a persisted path registry after goal change", async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), "path-api-integration-"))
  roots.push(dataRoot)
  const handle = createLearningOrchestratorApiHandler({ data_root: dataRoot })
  const learnerId = "learner-path-api"
  const sessionId = "SESSION-PATH-API"

  const created = await handle(request("http://localhost/orchestrator/sessions", learnerId, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      session_id: sessionId,
      mode: "deterministic",
      learner_request: {
        learner_id: learnerId,
        goal: "学习 Python 循环",
        profile_intake: {
          learner_id: learnerId,
          goal: "学习 Python 循环",
          self_rating: "beginner",
        },
      },
    }),
  }))
  expect(created.status).toBe(202)

  const persisted = await new InteractiveSessionStore(dataRoot).load(sessionId)
  persisted.status = "waiting_for_user"
  persisted.formal_path = {
    path_id: "FORMAL-PATH-1",
    learner_id: learnerId,
    original_goal: "学习 Python 循环",
    nodes: [],
    current_node_index: 0,
    profile_snapshot: {} as any,
    planning_outcome: { status: "ready", code: "PATH_READY", message: "ready", requested_source_ids: ["K-LOOP"], resolved_source_ids: ["K-LOOP"], unresolved_source_ids: [] },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  persisted.current_path_node = { node_id: "NODE-1", target_source_ids: ["K-LOOP"] }
  await new InteractiveSessionStore(dataRoot).save(persisted)

  const changed = await handle(request(`http://localhost/orchestrator/sessions/${sessionId}/path/change-goal`, learnerId, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path_id: "PATH-COMPETITION", goal_profile: "algorithm_competition", goal: "参加算法竞赛" }),
  }))
  expect(changed.status).toBe(200)
  expect(await body(changed)).toMatchObject({
    learner_id: learnerId,
    registry: { active_path: { path_id: "PATH-COMPETITION", status: "active", level: "beginner" } },
  })

  const queried = await handle(request(`http://localhost/orchestrator/sessions/${sessionId}/paths`, learnerId))
  expect(queried.status).toBe(200)
  expect(await body(queried)).toMatchObject({
    learner_id: learnerId,
    registry: {
      active_path: { path_id: "PATH-COMPETITION" },
      paths: [
        { path_id: "PATH-COMPETITION", status: "active" },
        { path_id: expect.any(String), status: "paused" },
      ],
    },
  })

  const oldPathId = (await body(await handle(request(`http://localhost/orchestrator/sessions/${sessionId}/paths`, learnerId)))).registry.paths.find((path: any) => path.status === "paused").path_id
  const resume = await handle(request(`http://localhost/orchestrator/sessions/${sessionId}/path/resume`, learnerId, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path_id: oldPathId }),
  }))
  expect(resume.status).toBe(202)
  const resumeBody = await body(resume)
  expect(resumeBody).toMatchObject({ status: "short_diagnosis_required" })
  expect(JSON.stringify(resumeBody)).not.toContain("answer_key")
  const diagnosisItems = resumeBody.registry.pending_resume.items
  const failedDiagnosis = await handle(request(`http://localhost/orchestrator/sessions/${sessionId}/path/resume/diagnosis`, learnerId, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path_id: oldPathId, answers: Object.fromEntries(diagnosisItems.map((item: any) => [item.item_id, "不太确定"])) }),
  }))
  expect(failedDiagnosis.status).toBe(200)
  expect(await body(failedDiagnosis)).toMatchObject({ status: "diagnosis_failed", evaluation: { passed: false } })

  const forbidden = await handle(request(`http://localhost/orchestrator/sessions/${sessionId}/paths`, "another-learner"))
  expect(forbidden.status).toBe(403)
})
