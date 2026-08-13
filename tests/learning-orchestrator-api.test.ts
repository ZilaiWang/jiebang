import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createLearningOrchestratorApiHandler, handleLearningOrchestratorApiRequest } from "../src/orchestration/learning-orchestrator-api"
// 真实模型 + Docker 代码执行依赖：默认跳过，RUN_INTEGRATION_TESTS=1 时运行。
const runIntegration = process.env.RUN_INTEGRATION_TESTS === "1"

const tempRoots: string[] = []

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "learning-orchestrator-api-"))
  tempRoots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

test("requires an authenticated learner bound to runs", async () => {
  const root = await makeRoot()
  const handle = createLearningOrchestratorApiHandler({ data_root: root })
  const body = {
    run_id: "RUN-AUTH-001",
    session_id: "SESSION-AUTH-001",
    mode: "deterministic",
    learner_request: { learner_id: "learner-auth-001", goal: "学习 Python 循环" },
  }

  const unauthenticated = await handle(new Request("http://localhost/orchestrator/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }))
  expect(unauthenticated.status).toBe(401)

  const mismatched = await handle(new Request("http://localhost/orchestrator/runs", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer other-learner" },
    body: JSON.stringify(body),
  }))
  expect(mismatched.status).toBe(403)
})

describe.skipIf(!runIntegration)("learning orchestrator HTTP API", () => {
  test("reports health for external callers", async () => {
    const response = await handleLearningOrchestratorApiRequest(new Request("http://localhost/health"))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      service: "learning-orchestrator",
    })
  })

  test("runs deterministic orchestration from a POST request and returns audit locations", async () => {
    const root = await makeRoot()
    const response = await handleLearningOrchestratorApiRequest(new Request("http://localhost/orchestrator/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        root_dir: root,
        run_id: "RUN-HTTP-TEST-001",
        session_id: "SESSION-HTTP-TEST-001",
        mode: "deterministic",
        learner_request: {
          learner_id: "api-learner-001",
          goal: "学习 Python 循环并完成成绩统计",
          background: "零基础学习者，需要个性化教学路径",
          self_rating: "beginner",
          diagnostic_seed: "解释 for 循环什么时候适合遍历一组数据",
        },
      }),
    }))

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      run_id: "RUN-HTTP-TEST-001",
      session_id: "SESSION-HTTP-TEST-001",
      mode: "deterministic",
      status: "completed",
      completed_steps: 8,
      total_steps: 8,
    })
    expect(body.summary_json).toContain("RUN-HTTP-TEST-001")
    expect(body.summary_md).toContain("RUN-HTTP-TEST-001")
  })

  test("rejects invalid requests without starting orchestration", async () => {
    const response = await handleLearningOrchestratorApiRequest(new Request("http://localhost/orchestrator/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "deterministic" }),
    }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "INVALID_ORCHESTRATOR_REQUEST",
      },
    })
  })
})
