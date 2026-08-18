import { describe, expect, test } from "bun:test"
import { abilityRadarView, activeAdaptationView, agentTimelineView, answersToSubmission, assessmentEntryBlockedByPriorFeedback, assessmentFeedbackView, blockedSessionAction, initialGoalSelection, mainFlowStatusView, microCheckFeedbackView, pageForSession, pathChainView, pathNodeTitle, pathNodeWhyView } from "./orchestrator-view"

describe("orchestrator UI state mapping", () => {
  test("explains why a node is learned using B-public prerequisites and stage order", () => {
    const ragItems = [
      { source_id: "K007", title: "for 循环" },
      { source_id: "K002", title: "变量与赋值" },
      { source_id: "K003", title: "基本数据类型" },
    ]
    const node = {
      node_id: "FN-K007-S1",
      target_source_ids: ["K007"],
      prerequisite_source_ids: ["K002", "K003"],
      goal: "for 循环",
      stage_order: 1,
    }
    const why = pathNodeWhyView(node, ragItems, ["变量与赋值"], "学习 Python for 循环")
    expect(why).toContain("第 1 步")
    expect(why).toContain("for 循环")
    expect(why).toContain("基本数据类型")
    expect(why).toContain("变量与赋值")
  })

  test("returns null when a node has no stage order and no prerequisites", () => {
    const ragItems = [{ source_id: "K007", title: "for 循环" }]
    const node = { node_id: "FN-K007-S1", target_source_ids: ["K007"], goal: "for 循环" }
    expect(pathNodeWhyView(node, ragItems, [], "学习 Python for 循环")).toBeNull()
  })

  test("marks the first step as the starting point of the learning goal", () => {
    const ragItems = [{ source_id: "K001", title: "Python 是什么" }]
    const node = { node_id: "FN-K001-S1", target_source_ids: ["K001"], prerequisite_source_ids: [], goal: "Python 是什么", stage_order: 1 }
    expect(pathNodeWhyView(node, ragItems, [], "学习 Python")).toBe("这是学习路径的第 1 步，是你学习目标的起点。")
  })

  test("does not steer a content-generation failure into changing the learning goal", () => {
    const action = blockedSessionAction({
      terminal_outcome: { kind: "content_generation_failed", generation_failure: { nextAction: "change_goal", canRetry: false } },
    })
    expect(action).toEqual({ canRetry: false, label: "内容生成暂时失败，请稍后重试" })
  })

  test("keeps retry labels for retryable generation failures", () => {
    const action = blockedSessionAction({
      terminal_outcome: { kind: "content_generation_failed", generation_failure: { nextAction: "regenerate_assessment", canRetry: true } },
    })
    expect(action).toEqual({ canRetry: true, label: "重新生成正式测评" })
  })

  test("keeps change-goal for genuinely unsupported goals", () => {
    const action = blockedSessionAction({ terminal_outcome: { kind: "unsupported_goal" } })
    expect(action).toEqual({ canRetry: false, label: "调整学习目标" })
  })

  test("builds a truthful Agent timeline with attempts, public artifacts, failures, and retries", () => {
    const timeline = agentTimelineView({ worker_ledger_history: [{
      entry_id: "LEDGER-1",
      round_no: 2,
      attempt_no: 2,
      unit_name: "code-lab",
      execution_type: "reviewed_pipeline",
      status: "blocked",
      started_at: "2026-08-17T01:02:03.000Z",
      duration_ms: 1250,
      output_refs: [
        { ref_id: "LAB-1", locator: "sessions/S1.json#/learning_resources/code_lab", visibility: "public", verified_exists: true },
        { ref_id: "INTERNAL-1", locator: "internal/run.json", visibility: "internal", verified_exists: true },
        { ref_id: "SECURE-1", locator: null, visibility: "secure", verified_exists: true },
      ],
      summary: "code lab generation blocked",
      errors: [{ code: "CONTENT_INVALID", message: "invalid expected type" }],
      retry: { eligible: true, scheduled: true, reason: "regenerate", next_attempt_no: 3 },
    }] })
    expect(timeline).toHaveLength(1)
    expect(timeline[0]).toMatchObject({
      id: "LEDGER-1",
      unit: "code-lab",
      statusLabel: "已阻塞",
      roundLabel: "第 2 轮",
      attemptLabel: "第 2 次尝试",
      executionType: "受审核生成流程",
      errorLabel: "CONTENT_INVALID：invalid expected type",
      retryLabel: "已安排第 3 次尝试：regenerate",
    })
    expect(timeline[0].artifactRefs).toEqual([{ id: "LAB-1", locator: "sessions/S1.json#/learning_resources/code_lab", verified: true }])
  })

  test("merges lifecycle snapshots and does not present historical starts as currently running", () => {
    const base = { round_no: 1, attempt_no: 1, unit_name: "tiered-evaluator", execution_type: "reviewed_pipeline" }
    const timeline = agentTimelineView({
      status: "waiting_for_user",
      worker_ledger_history: [
        { ...base, entry_id: "START", status: "running", started_at: "2026-08-17T01:00:00.000Z", summary: "正在生成正式测评", output_refs: [] },
        { ...base, entry_id: "FAILED", status: "failed", started_at: "2026-08-17T01:00:10.000Z", summary: "测评防重失败", errors: [{ code: "DUPLICATE", message: "题目重复" }], output_refs: [] },
        { ...base, entry_id: "RESTART", status: "running", started_at: "2026-08-17T01:00:11.000Z", summary: "重新生成正式测评", output_refs: [] },
        { ...base, entry_id: "DONE", status: "completed", started_at: "2026-08-17T01:00:20.000Z", duration_ms: 9000, summary: "正式测评已发布", output_refs: [{ ref_id: "FORM-1", visibility: "public", locator: "sessions/S1.json#/assessment", verified_exists: true }] },
      ],
    })
    expect(timeline).toHaveLength(1)
    expect(timeline[0]).toMatchObject({
      unit: "tiered-evaluator",
      status: "completed",
      statusLabel: "已完成",
      summary: "正式测评已发布",
      attemptLabel: "尝试次数未完整记录",
      retryLabel: "本次执行曾失败或阻塞，修复后已完成",
    })
    expect(timeline[0].artifactRefs).toEqual([{ id: "FORM-1", locator: "sessions/S1.json#/assessment", verified: true }])
  })

  test("marks an orphaned historical running snapshot as not current after the session stops", () => {
    const timeline = agentTimelineView({ status: "waiting_for_user", worker_ledger_history: [{
      entry_id: "START", round_no: 1, attempt_no: 1, unit_name: "profile-builder", execution_type: "deterministic_adapter",
      status: "running", started_at: "2026-08-17T01:00:00.000Z", summary: "invoke profile-builder",
    }] })
    expect(timeline[0]).toMatchObject({ status: "invoked", statusLabel: "历史启动记录" })
  })

  test("orders timeline workers by the main Agent ledger sequence within each round", () => {
    const entry = (unit_name: string, step_index: number, attempt_no = 1) => ({
      entry_id: `${unit_name}-${attempt_no}`, unit_name, step_index, attempt_no, round_no: 1,
      execution_type: "session_logic", status: "completed", started_at: "2026-08-17T01:00:00.000Z",
    })
    const timeline = agentTimelineView({ status: "waiting_for_user", worker_ledger_history: [
      entry("tiered-evaluator", 8),
      entry("profile-builder", 4, 2),
      entry("background-collector", 1),
      entry("profile-builder", 4, 1),
      entry("path-planner", 5),
    ] })
    expect(timeline.map((item) => `${item.unit}:${item.attemptLabel}`)).toEqual([
      "background-collector:第 1 次尝试",
      "profile-builder:第 1 次尝试",
      "profile-builder:第 2 次尝试",
      "path-planner:第 1 次尝试",
      "tiered-evaluator:第 1 次尝试",
    ])
  })

  test("summarizes main flow status from public session, waiting gate, feedback, next action, and events", () => {
    expect(mainFlowStatusView({
      session_id: "S1",
      status: "waiting_for_user",
      current_stage: "objective_diagnosis",
      round_no: 1,
      waiting_for: { type: "diagnosis_answers", items: [{ item_id: "D1" }, { item_id: "D2" }] },
      events: [{ event_type: "waiting_for_user", message: "waiting for diagnosis answers", timestamp: "2026-08-17T01:00:00.000Z", worker: "objective-diagnostician" }],
    })).toEqual({
      headline: "第 1 轮 · 等待诊断作答",
      detail: "当前阶段：客观诊断；等待你完成 2 项输入。",
      badge: "waiting_for_user",
      latestEvent: "objective-diagnostician：waiting for diagnosis answers",
    })

    expect(mainFlowStatusView({
      session_id: "S1",
      status: "running",
      current_stage: "assessment",
      round_no: 2,
      waiting_for: null,
      next_round_action: { action: "advance", status: "generating_next_round", target_node_id: "NODE-2", feedback_id: "FB-1" },
      feedback: { final_decision: { action: "advance" } },
      events: [{ event_type: "session_updated", message: "round 2 generation started in background", timestamp: "2026-08-17T01:01:00.000Z", worker: "tiered-evaluator" }],
    }).detail).toBe("当前阶段：互动学习与正式测评；反馈决策：进入下一知识节点；下一轮状态：正在生成下一轮资源。")
  })

  test("hides stale completed actions after the session has moved on", () => {
    expect(mainFlowStatusView({
      session_id: "S1",
      status: "waiting_for_user",
      current_stage: "objective_diagnosis",
      round_no: 1,
      waiting_for: { type: "diagnosis_answers", items: [{ item_id: "D1" }] },
      next_round_action: { action: "reprofile", status: "waiting_for_reprofile", round_no: 1, target_node_id: "NODE-1", feedback_id: "FB-1" },
      feedback: null,
    }).detail).toBe("当前阶段：客观诊断；等待你完成 1 项输入。")

    expect(mainFlowStatusView({
      session_id: "S1",
      status: "waiting_for_user",
      current_stage: "assessment",
      round_no: 2,
      waiting_for: { type: "assessment_answers", items: [{ item_id: "R2-Q1" }] },
      next_round_action: { action: "remediate", status: "generating_next_round", round_no: 1, target_node_id: "NODE-1", feedback_id: "FB-1" },
      feedback: null,
    }).detail).toBe("当前阶段：互动学习与正式测评；等待你完成 1 项输入。")
  })

  test("hides stale remediate adaptation once the current round no longer matches it", () => {
    expect(activeAdaptationView({
      round_no: 2,
      adaptation: { adaptation_action: "remediate", round_no: 1, adaptation_summary: "old", target_objective_ids: [], addressed_misconception_tags: [] },
    })).toBeNull()
    expect(activeAdaptationView({
      round_no: 2,
      adaptation: { adaptation_action: "remediate", round_no: 2, adaptation_summary: "current", target_objective_ids: [], addressed_misconception_tags: [] },
    })?.adaptation_summary).toBe("current")
  })

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

  test("does not fall back to the overall plan goal for unresolved path node titles", () => {
    const overallGoal = "学习for 循环"
    expect(pathNodeTitle({ target_source_ids: ["K003"], goal: overallGoal }, [], overallGoal)).toBe("未解析知识节点（K003）")
    expect(pathNodeTitle({ target_source_ids: [], goal: overallGoal }, [], overallGoal)).toBe("未解析知识节点")
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

  test("does not treat prior-round feedback as completed when a fresh second-round assessment is waiting", () => {
    const secondRoundReady = {
      status: "waiting_for_user",
      current_stage: "assessment",
      round_no: 2,
      waiting_for: { type: "assessment_answers", items: [{ item_id: "R2-Q1" }, { item_id: "R2-Q2" }] },
      feedback: {
        final_decision: { action: "remediate" },
        assessment_items: { items: [{ item_id: "R1-Q1" }, { item_id: "R1-Q2" }] },
      },
      assessment: { artifact_id: "ASSESSMENT-R2", payload: { items: [{ item_id: "R2-Q1" }, { item_id: "R2-Q2" }] } },
      learning_resources: { concept_lesson: { payload: {} } },
    }

    expect(assessmentEntryBlockedByPriorFeedback(secondRoundReady, true)).toBe(false)
  })

  test("maps blocked sessions to a truthful recovery action", () => {
    expect(blockedSessionAction({ status: "failed", profile: {}, formal_path: {}, current_path_node: {}, blocked_reason: "C blocked" })).toEqual({ canRetry: true, label: "重新生成当前学习资源" })
    expect(blockedSessionAction({ status: "blocked", terminal_outcome: { kind: "content_generation_failed", generation_failure: { nextAction: "regenerate_assessment", canRetry: true } } })).toEqual({ canRetry: true, label: "重新生成正式测评" })
    expect(blockedSessionAction({ status: "blocked", profile: {}, formal_path: {}, current_path_node: {}, blocked_reason: "LEARNING_SUPPORT_REQUIRED: 当前节点未掌握" })).toEqual({ canRetry: false, label: "重新诊断或调整目标" })
    expect(blockedSessionAction({ status: "blocked", terminal_outcome: { kind: "unsupported_goal" } })).toEqual({ canRetry: false, label: "调整学习目标" })
    expect(blockedSessionAction({ status: "blocked", terminal_outcome: { kind: "insufficient_evidence" } })).toEqual({ canRetry: false, label: "调整目标或补充资料" })
    expect(blockedSessionAction({ status: "blocked", terminal_outcome: { kind: "planning_failed" } })).toEqual({ canRetry: false, label: "重新规划或调整目标" })
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
