import { describe, expect, test } from "bun:test"
import { render, screen, fireEvent } from "@testing-library/react"
import { GoalPage, LiveContext, checkDockerReady, type LiveContextValue } from "./App"

function makeContext(overrides: Partial<LiveContextValue> = {}): LiveContextValue {
  return {
    session: null,
    isLive: false,
    learnerId: "L1",
    busy: "",
    error: "",
    dockerReady: true,
    diagnosisAnswers: {},
    assessmentAnswers: {},
    setDiagnosisAnswer: () => {},
    setAssessmentAnswer: () => {},
    clearAssessmentAnswers: () => {},
    create: async () => {},
    submitDiagnosis: async () => {},
    submitProfileClarification: async () => {},
    submitAssessment: async () => {},
    runPublishedCodeLab: async () => {},
    runAssessmentItemCode: async () => {},
    runExampleCode: async () => null,
    retry: async () => {},
    refreshEvents: async () => {},
    reset: () => {},
    ...overrides,
  }
}

function renderGoal(context: LiveContextValue) {
  return render(
    <LiveContext.Provider value={context}>
      <GoalPage onContinue={() => {}} />
    </LiveContext.Provider>,
  )
}

describe("GoalPage Docker 预检门禁", () => {
  test("dockerReady=false 时创建按钮禁用 + 提示可见", () => {
    renderGoal(makeContext({ dockerReady: false }))
    // 先选一个课程主题，排除"未选主题"导致的禁用
    fireEvent.click(screen.getByText(/for 循环/))
    const button = screen.getByText(/确认目标并创建主 Agent会话/)
    expect(button.closest("button")!.disabled).toBe(true)
    expect(screen.getByText(/Docker 代码沙箱/)).toBeTruthy()
  })

  test("dockerReady=true 且选中主题时按钮可用、无提示", () => {
    renderGoal(makeContext({ dockerReady: true }))
    fireEvent.click(screen.getByText(/for 循环/))
    const button = screen.getByText(/确认目标并创建主 Agent会话/)
    expect(button.closest("button")!.disabled).toBe(false)
    expect(screen.queryByText(/Docker 代码沙箱/)).toBeNull()
  })

  test("checkDockerReady 实时检查：缓存就绪但实际已关 → 返回未就绪（每次创建前调用）", async () => {
    // 模拟 fetch 返回 Docker 未就绪（即使页面加载时缓存是 true）
    const fakeFetch = (async () => ({
      json: async () => ({ status: "ok", docker: { ready: false, error: "Docker daemon not running" } }),
    })) as unknown as typeof fetch
    const result = await checkDockerReady(fakeFetch)
    expect(result.ready).toBe(false)
    expect(result.error).toContain("Docker daemon")
  })

  test("checkDockerReady 实时检查：Docker 就绪 → 返回就绪", async () => {
    const fakeFetch = (async () => ({
      json: async () => ({ status: "ok", docker: { ready: true } }),
    })) as unknown as typeof fetch
    const result = await checkDockerReady(fakeFetch)
    expect(result.ready).toBe(true)
  })

  test("checkDockerReady 实时检查：主 Agent 不可达 → 未就绪+错误", async () => {
    const fakeFetch = (async () => { throw new Error("network down") }) as unknown as typeof fetch
    const result = await checkDockerReady(fakeFetch)
    expect(result.ready).toBe(false)
    expect(result.error).toContain("无法连接主 Agent")
  })
})
