import { describe, expect, test } from "bun:test"
import { render, screen, fireEvent } from "@testing-library/react"
import { DiagnosisPage, LiveContext, type LiveContextValue } from "./App"

const items = [
  { item_id: "DIAG-1", question: "第1题：for 循环最适合什么场景？", options: ["遍历序列", "定义变量"], concept: "for 循环", source_id: "K007", difficulty: "beginner" },
  { item_id: "DIAG-2", question: "第2题：变量赋值符号？", options: ["=", "=="], concept: "变量", source_id: "K002", difficulty: "beginner" },
  { item_id: "DIAG-3", question: "第3题：95 是什么类型？", options: ["int", "str"], concept: "类型", source_id: "K003", difficulty: "beginner" },
]

function makeContext(overrides: Partial<LiveContextValue> = {}): LiveContextValue {
  return {
    session: {
      session_id: "S1",
      status: "waiting_for_user",
      current_stage: "objective_diagnosis",
      waiting_for: { type: "diagnosis_answers", items },
      worker_ledger: [],
    } as any,
    isLive: true,
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
    retry: async () => {},
    refreshEvents: async () => {},
    reset: () => {},
    ...overrides,
  }
}

function renderPage(context: LiveContextValue) {
  return render(
    <LiveContext.Provider value={context}>
      <DiagnosisPage onContinue={() => {}} />
    </LiveContext.Provider>,
  )
}

describe("DiagnosisPage 下一题按钮", () => {
  test("选中答案后点下一题应进入第2题", () => {
    let answers: Record<string, string> = {}
    const context = makeContext({
      setDiagnosisAnswer: (itemId: string, answer: string) => { answers = { ...answers, [itemId]: answer } },
    })
    const { rerender } = renderPage(context)
    expect(screen.getByText(/第1题/)).toBeTruthy()

    fireEvent.click(screen.getByText("遍历序列"))
    rerender(
      <LiveContext.Provider value={{ ...context, diagnosisAnswers: answers }}>
        <DiagnosisPage onContinue={() => {}} />
      </LiveContext.Provider>,
    )

    const nextButton = screen.getByText(/下一题/)
    expect(nextButton.closest("button")!.disabled).toBe(false)

    fireEvent.click(nextButton)
    rerender(
      <LiveContext.Provider value={{ ...context, diagnosisAnswers: answers }}>
        <DiagnosisPage onContinue={() => {}} />
      </LiveContext.Provider>,
    )

    expect(screen.getByText(/第2题/)).toBeTruthy()
    expect(screen.getByText(/变量赋值符号/)).toBeTruthy()
  })

  test("3道题逐题下一题直到出现提交按钮（纯前端完整流程）", () => {
    let answers: Record<string, string> = {}
    const context = makeContext({
      setDiagnosisAnswer: (itemId: string, answer: string) => { answers = { ...answers, [itemId]: answer } },
    })
    const { rerender } = renderPage(context)

    // 第1题：选"遍历序列" → 下一题
    fireEvent.click(screen.getByText("遍历序列"))
    rerender(<LiveContext.Provider value={{ ...context, diagnosisAnswers: answers }}><DiagnosisPage onContinue={() => {}} /></LiveContext.Provider>)
    fireEvent.click(screen.getByText(/下一题/))
    rerender(<LiveContext.Provider value={{ ...context, diagnosisAnswers: answers }}><DiagnosisPage onContinue={() => {}} /></LiveContext.Provider>)
    expect(screen.getByText(/第2题/)).toBeTruthy()

    // 第2题：选"=" → 下一题
    fireEvent.click(screen.getByText("="))
    rerender(<LiveContext.Provider value={{ ...context, diagnosisAnswers: answers }}><DiagnosisPage onContinue={() => {}} /></LiveContext.Provider>)
    fireEvent.click(screen.getByText(/下一题/))
    rerender(<LiveContext.Provider value={{ ...context, diagnosisAnswers: answers }}><DiagnosisPage onContinue={() => {}} /></LiveContext.Provider>)
    expect(screen.getByText(/第3题/)).toBeTruthy()

    // 第3题：选"int" → 应出现提交按钮（不再是下一题）
    fireEvent.click(screen.getByText("int"))
    rerender(<LiveContext.Provider value={{ ...context, diagnosisAnswers: answers }}><DiagnosisPage onContinue={() => {}} /></LiveContext.Provider>)
    expect(screen.queryByText(/下一题/)).toBeNull()
    const submitButton = screen.getByText(/提交诊断并生成学习方案/)
    expect(submitButton.closest("button")!.disabled).toBe(false)
  })
})
