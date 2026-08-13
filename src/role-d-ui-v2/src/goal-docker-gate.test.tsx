import { describe, expect, test } from "bun:test"
import { render, screen, fireEvent } from "@testing-library/react"
import { GoalPage, LiveContext, type LiveContextValue } from "./App"

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
    submitAssessment: async () => {},
    runPublishedCodeLab: async () => {},
    runAssessmentItemCode: async () => {},
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
})
