import { describe, expect, test } from "bun:test"
import { abilityRadarView, answersToSubmission, assessmentFeedbackView, blockedSessionAction, initialGoalSelection, microCheckFeedbackView, pageForSession, pathChainView, pathNodeTitle } from "./orchestrator-view"

describe("orchestrator UI state mapping", () => {
  test("routes diagnosis completion and plan re-entry to the learning plan before C content", () => {
    expect(pageForSession({ status: "waiting_for_user", current_stage: "objective_diagnosis", waiting_for: { type: "diagnosis_answers" } })).toBe("diagnosis")
    expect(pageForSession({ status: "waiting_for_user", current_stage: "assessment", waiting_for: { type: "assessment_answers" }, profile: {}, formal_path: {}, current_path_node: {}, learning_resources: { concept_lesson: {} } })).toBe("path")
    expect(pageForSession({ status: "blocked", current_stage: "blocked", profile: {}, formal_path: {}, current_path_node: {}, learning_resources: {} })).toBe("path")
    expect(pageForSession({ status: "completed", current_stage: "completed", feedback: {} })).toBe("feedback")
  })

  test("starts a new plan with no preselected chapter or custom goal", () => {
    expect(initialGoalSelection()).toEqual({ mode: "catalog", selectedNodeId: "", customGoal: "" })
  })

  test("keeps showing the graded feedback until dismissed, then returns to the learning plan", () => {
    const graded = { feedback: { final_decision: { action: "remediate" } }, current_stage: "assessment", waiting_for: { type: "assessment_answers" }, profile: {}, formal_path: {}, current_path_node: {}, learning_resources: { concept_lesson: {} } }
    expect(pageForSession(graded)).toBe("feedback")
    expect(pageForSession(graded, { feedbackDismissed: true })).toBe("path")
    const gradedReinforce = { feedback: { final_decision: { action: "reinforce" } }, current_stage: "assessment", waiting_for: { type: "assessment_answers" }, profile: {}, formal_path: {}, current_path_node: {} }
    expect(pageForSession(gradedReinforce)).toBe("feedback")
    expect(pageForSession(gradedReinforce, { feedbackDismissed: true })).toBe("path")
  })

  test("keeps the ability radar pending until B publishes real dimensions", () => {
    expect(abilityRadarView({ level: "beginner", known_concepts: ["变量"], weak_concepts: ["循环"] })).toEqual({ status: "pending", dimensions: [] })
    expect(abilityRadarView({ ability_dimensions: [{ label: "概念理解", value: 0.7 }, { label: "代码追踪", value: 0.5 }, { label: "应用实践", value: 0.8 }] })).toEqual({ status: "verified", dimensions: [{ label: "概念理解", value: 0.7 }, { label: "代码追踪", value: 0.5 }, { label: "应用实践", value: 0.8 }] })
  })

  test("shows each path node by its real A knowledge title instead of repeating the plan goal", () => {
    const rag = [{ source_id: "K002", title: "变量与赋值" }, { source_id: "K009", title: "列表" }]
    expect(pathNodeTitle({ target_source_ids: ["K002"], goal: "学习列表" }, rag)).toBe("变量与赋值")
    expect(pathNodeTitle({ target_source_ids: ["K009"], goal: "学习列表" }, rag)).toBe("列表")
    expect(pathNodeTitle({ target_source_ids: ["K999"], goal: "学习列表" }, rag)).toBe("学习列表")
    expect(pathNodeTitle({ target_source_ids: [], goal: "学习列表" }, rag)).toBe("学习列表")
  })

  test("expands the chain with every referenced prerequisite, marking mastered ones", () => {
    const rag = [{ source_id: "K001", title: "Python 是什么" }, { source_id: "K002", title: "变量与赋值" }, { source_id: "K003", title: "基本数据类型" }, { source_id: "K009", title: "列表" }]
    const nodes = [
      { node_id: "FN-K002", target_source_ids: ["K002"], prerequisite_source_ids: ["K001"], status: "completed" },
      { node_id: "FN-K009", target_source_ids: ["K009"], prerequisite_source_ids: ["K002", "K003"], status: "in_progress" },
    ]
    const chain = pathChainView(nodes as any, rag, ["列表", "基本数据类型"])
    expect(chain.map((entry) => `${entry.source_id}:${entry.status}`)).toEqual([
      "K001:reference_pending",
      "K002:completed",
      "K003:reference_mastered",
      "K009:in_progress",
    ])
    expect(chain.map((entry) => entry.title)).toEqual(["Python 是什么", "变量与赋值", "基本数据类型", "列表"])
  })

  test("reveals C-authored micro-check correctness and explanation after a choice", () => {
    const check = {
      item_id: "CHECK-1",
      options: [
        { option_id: "A", label: "A", text: "一次" },
        { option_id: "B", label: "B", text: "列表长度次" },
      ],
      answer_option_id: "B",
      answer_explanation: "for 循环会依次处理列表中的每个元素。",
    }
    expect(microCheckFeedbackView(check, undefined)).toBeNull()
    expect(microCheckFeedbackView(check, "A")).toEqual({
      correct: false,
      answer_text: "B. 列表长度次",
      explanation: "for 循环会依次处理列表中的每个元素。",
    })
    expect(microCheckFeedbackView(check, "B")?.correct).toBe(true)
  })

  test("builds per-item assessment feedback with your answer, verdict and C guidance", () => {
    const items = [
      { item_id: "I1", modality: "mcq", prompt: "列表的主要用途？", max_score: 1, options: [{ option_id: "A", label: "A", text: "保存一个元素" }, { option_id: "B", label: "B", text: "保存多个有序元素" }] },
      { item_id: "I2", modality: "code", prompt: "补全代码", max_score: 4 },
    ]
    const grade = {
      item_results: [
        { item_id: "I1", raw_score: 0, max_score: 1, feedback_code: "incorrect" },
        { item_id: "I2", raw_score: 4, max_score: 4, feedback_code: "correct" },
      ],
      feedback: { item_feedback: [
        { item_id: "I1", message: "与参考答案不符", next_step: "复习列表概念", revealed_answer: { kind: "choice", option_id: "B" } },
        { item_id: "I2", message: "作答满足要求", next_step: "进入迁移练习", revealed_answer: { kind: "code", code: "fruits = [1, 2, 3]" } },
      ] },
    }
    const yours = [
      { item_id: "I1", selected_option_id: "A" },
      { item_id: "I2", code_response: "fruits = [1,2,3]" },
    ]
    const view = assessmentFeedbackView(items as any, grade as any, yours as any)
    expect(view[0]).toMatchObject({ item_id: "I1", correct: false, your_answer_text: "保存一个元素", correct_answer_text: "保存多个有序元素", max_score: 1, raw_score: 0 })
    expect(view[1]).toMatchObject({ item_id: "I2", correct: true, correct_answer_text: "fruits = [1, 2, 3]", max_score: 4, raw_score: 4 })
    expect(view[1].your_answer_text).toContain("fruits")
  })

  test("keeps showing the graded feedback page after re-entry until the learner enters the next round", () => {
    const graded = { status: "waiting_for_user", current_stage: "assessment", profile: {}, formal_path: { nodes: [] }, current_path_node: {}, feedback: { final_decision: { action: "advance" } }, learning_resources: { concept_lesson: { payload: {} } } }
    expect(pageForSession(graded)).toBe("feedback")
    expect(pageForSession(graded, { feedbackDismissed: true })).toBe("path")
  })

  test("maps blocked sessions to a truthful recovery action", () => {
    expect(blockedSessionAction({ status: "failed", profile: {}, formal_path: {}, current_path_node: {}, blocked_reason: "C blocked" })).toEqual({ canRetry: true, label: "原样重试 C 资源生成" })
    expect(blockedSessionAction({ status: "failed", profile: null, formal_path: null, current_path_node: null, blocked_reason: "legacy failure" })).toEqual({ canRetry: false, label: "重新诊断" })
  })

  test("maps public answers to the formal submission contract", () => {
    const items = [
      { item_id: "mcq", modality: "mcq", options: [{ option_id: "A" }] },
      { item_id: "text", modality: "short_answer" },
      { item_id: "code", modality: "code" },
    ]
    expect(answersToSubmission(items, { mcq: "A", text: "解释", code: "print(1)" })).toEqual([
      { item_id: "mcq", selected_option_id: "A", hint_level_used: 0 },
      { item_id: "text", text_response: "解释", hint_level_used: 0 },
      { item_id: "code", code_response: "print(1)", hint_level_used: 0 },
    ])
  })
})
