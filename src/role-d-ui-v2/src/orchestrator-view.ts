import type { SubmissionAnswer } from "./orchestrator-client"

export type OrchestratorPage = "goal" | "diagnosis" | "path" | "lesson" | "assessment" | "feedback"

export function finalFeedbackAction(session: any): { label: string; ready: boolean } | null {
  return isFinalMasterySession(session, null) ? { label: "返回首页", ready: true } : null
}

export function nextRoundResourceGate(session: any): { ready: boolean; label: string } {
  if (isFinalAdvanceSession(session)) return { ready: true, label: "返回主页" }
  if (session?.status === "running") {
    return { ready: false, label: "主 Agent正在调用 C 生成并审核下一轮资源…" }
  }
  if (session?.status !== "waiting_for_user" || session?.waiting_for?.type !== "assessment_answers") {
    return { ready: false, label: "等待主 Agent调用 C 准备下一轮资源…" }
  }
  const newItems = Array.isArray(session?.waiting_for?.items) ? session.waiting_for.items : []
  const priorItems = Array.isArray(session?.feedback?.assessment_items?.items)
    ? session.feedback.assessment_items.items
    : []
  const newIds = newItems.map((item: any) => item?.item_id).filter(Boolean)
  const priorIds = new Set(priorItems.map((item: any) => item?.item_id).filter(Boolean))
  const assessmentIds = Array.isArray(session?.assessment?.payload?.items)
    ? session.assessment.payload.items.map((item: any) => item?.item_id).filter(Boolean)
    : []
  const hasFreshItems = newIds.length > 0
    && newIds.every((id: string) => !priorIds.has(id))
    && assessmentIds.length === newIds.length
    && newIds.every((id: string) => assessmentIds.includes(id))
  const hasResources = Boolean(
    session?.learning_resources?.concept_lesson
      || session?.learning_resources?.code_lab,
  )
  return hasFreshItems && hasResources
    ? { ready: true, label: "进入下一轮学习" }
    : { ready: false, label: "等待 C 发布下一轮新资源…" }
}

/** True only when the persisted feedback grades the assessment currently published. */
export function currentAssessmentAlreadyGraded(session: any): boolean {
  const currentItems = Array.isArray(session?.assessment?.payload?.items)
    ? session.assessment.payload.items
    : []
  const feedbackItems = Array.isArray(session?.feedback?.assessment_items?.items)
    ? session.feedback.assessment_items.items
    : []
  const currentIds = currentItems.map((item: any) => item?.item_id).filter(Boolean)
  const feedbackIds = new Set(feedbackItems.map((item: any) => item?.item_id).filter(Boolean))
  return currentIds.length > 0
    && feedbackIds.size === currentIds.length
    && currentIds.every((itemId: string) => feedbackIds.has(itemId))
}

export function shouldPollOrchestratorSession(session: any): boolean {
  return Boolean(session?.session_id && session?.status === "running")
}

export interface MainFlowStatusView {
  headline: string
  detail: string
  badge: string
  latestEvent: string
}

export interface AgentTimelineEntryView {
  id: string
  unit: string
  status: string
  statusLabel: string
  roundLabel: string
  attemptLabel: string
  executionType: string
  summary: string
  timeLabel: string
  artifactRefs: Array<{ id: string; locator: string | null; verified: boolean }>
  errorLabel: string | null
  retryLabel: string | null
}

export function agentTimelineView(session: any): AgentTimelineEntryView[] {
  const history = Array.isArray(session?.worker_ledger_history) ? session.worker_ledger_history : []
  const executions = new Map<string, any[]>()
  history.forEach((entry: any, index: number) => {
    const key = [entry?.unit_name ?? "unknown", Number(entry?.round_no) || 1, Number(entry?.attempt_no) || 1].join("::")
    const entries = executions.get(key) ?? []
    entries.push({ ...entry, __index: index })
    executions.set(key, entries)
  })
  return [...executions.entries()].map(([key, entries]) => {
    const entry = entries[entries.length - 1]
    const outputs = entries.flatMap((item: any) => Array.isArray(item?.output_refs) ? item.output_refs : [])
    const errors = entries.flatMap((item: any) => Array.isArray(item?.errors) ? item.errors : [])
    const retry = [...entries].reverse().find((item: any) => item?.retry)?.retry
    const hadFailure = entries.some((item: any) => item?.status === "failed" || item?.status === "blocked")
    const hasTerminal = entries.some((item: any) => ["completed", "failed", "blocked", "skipped"].includes(item?.status))
    const status = entry?.status === "running" && session?.status !== "running" && !hasTerminal ? "invoked" : entry?.status
    const uniqueOutputs = [...new Map(outputs.map((ref: any) => [ref?.ref_id ?? JSON.stringify(ref), ref])).values()] as any[]
    return { view: {
      id: entries.length === 1 ? String(entry?.entry_id ?? key) : key,
      unit: String(entry?.unit_name ?? "unknown"),
      status: String(status ?? "unknown"),
      statusLabel: timelineStatusLabel(status),
      roundLabel: `第 ${Number(entry?.round_no) || 1} 轮`,
      attemptLabel: hadFailure && entry?.status === "completed"
        ? "尝试次数未完整记录"
        : `第 ${Number(entry?.attempt_no) || 1} 次尝试`,
      executionType: executionTypeLabel(entry?.execution_type),
      summary: String(entry?.summary ?? "主 Agent未公开执行摘要"),
      timeLabel: timelineTimeLabel(entries[0]?.started_at, entry?.duration_ms),
      artifactRefs: uniqueOutputs
        .filter((ref: any) => ref?.visibility === "public")
        .map((ref: any) => ({ id: String(ref?.ref_id ?? "unknown"), locator: typeof ref?.locator === "string" ? ref.locator : null, verified: ref?.verified_exists === true })),
      errorLabel: errors.length ? errors.map((error: any) => `${error?.code ? `${error.code}：` : ""}${error?.message ?? "未知错误"}`).join("；") : null,
      retryLabel: hadFailure && entry?.status === "completed"
        ? "本次执行曾失败或阻塞，修复后已完成"
        : retry?.scheduled
        ? `已安排第 ${retry.next_attempt_no ?? "?"} 次尝试${retry.reason ? `：${retry.reason}` : ""}`
        : retry?.eligible
          ? `可重试${retry.reason ? `：${retry.reason}` : ""}`
          : null,
    }, order: {
      round: Number(entry?.round_no) || 1,
      step: Math.min(...entries.map((item: any) => Number(item?.step_index) || Number.MAX_SAFE_INTEGER)),
      attempt: Number(entry?.attempt_no) || 1,
      firstSeen: Math.min(...entries.map((item: any) => Number(item?.__index) || 0)),
    } }
  }).sort((left, right) => left.order.round - right.order.round
    || left.order.step - right.order.step
    || left.order.attempt - right.order.attempt
    || left.order.firstSeen - right.order.firstSeen)
    .map((entry) => entry.view)
}

function timelineStatusLabel(status?: string): string {
  return ({ invoked: "历史启动记录", running: "正在运行", waiting_for_user: "等待用户", completed: "已完成", blocked: "已阻塞", failed: "执行失败", skipped: "已跳过" } as Record<string, string>)[status ?? ""] ?? "状态未公开"
}

function executionTypeLabel(type?: string): string {
  return ({ opencode_primary: "OpenCode 主 Agent", opencode_subagent: "OpenCode 子 Agent", deterministic_adapter: "确定性适配器", reviewed_pipeline: "受审核生成流程", external_port: "外部能力接口", session_logic: "主会话逻辑", manual: "人工操作", unknown: "类型未公开" } as Record<string, string>)[type ?? ""] ?? String(type ?? "类型未公开")
}

function timelineTimeLabel(startedAt?: string, durationMs?: number | null): string {
  const parsed = typeof startedAt === "string" ? new Date(startedAt) : null
  const started = parsed && !Number.isNaN(parsed.getTime()) ? parsed.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) : "时间未公开"
  return typeof durationMs === "number" ? `${started} · ${durationMs} ms` : started
}

export function mainFlowStatusView(session: any): MainFlowStatusView {
  const waitingType = session?.waiting_for?.type
  const waitingCount = Array.isArray(session?.waiting_for?.items) ? session.waiting_for.items.length : 0
  const decisionAction = session?.feedback?.final_decision?.action
  const nextRoundStatus = session?.next_round_action?.status
  const parts = [`当前阶段：${stageLabel(session?.current_stage)}`]
  if (waitingType) parts.push(`等待你完成 ${waitingCount} 项输入`)
  if (decisionAction) {
    const decisionPrefix = currentAssessmentAlreadyGraded(session)
      ? "本轮反馈决策"
      : "当前资源依据的上一轮决策"
    parts.push(`${decisionPrefix}：${decisionLabel(decisionAction)}`)
  }
  if (nextRoundStatus) parts.push(`下一轮状态：${nextRoundStatusLabel(nextRoundStatus)}`)
  if (session?.blocked_reason && !decisionAction) parts.push(`阻塞原因：${session.blocked_reason}`)
  return {
    headline: `第 ${session?.round_no ?? "--"} 轮 · ${waitingType ? waitingLabel(waitingType) : statusLabel(session?.status)}`,
    detail: `${parts.join("；")}。`,
    badge: String(session?.status ?? "unknown"),
    latestEvent: latestEventLabel(session?.events),
  }
}

export function sessionNeedsEventRefresh(currentSession: any, nextSession: any): boolean {
  if (!nextSession?.session_id) return false
  if (!Array.isArray(currentSession?.events) || currentSession.events.length === 0) return true
  const currentRevision = Number(currentSession?.revision)
  const nextRevision = Number(nextSession?.revision)
  return Number.isFinite(currentRevision)
    && Number.isFinite(nextRevision)
    && nextRevision !== currentRevision
}

function latestEventLabel(events: any): string {
  const list = Array.isArray(events) ? events : []
  const latest = list[list.length - 1]
  if (!latest) return "暂无事件"
  return `${latest.worker || latest.agent || latest.event_type || "learning-orchestrator"}：${latest.message || latest.summary || latest.event_type || "事件已记录"}`
}

function statusLabel(status?: string): string {
  return ({ waiting_for_user: "等待你继续", running: "主 Agent运行中", completed: "学习完成", blocked: "流程受阻", failed: "流程失败" } as Record<string, string>)[status ?? ""] ?? "状态未公开"
}

function stageLabel(stage?: string): string {
  return ({ objective_diagnosis: "客观诊断", assessment: "互动学习与正式测评", completed: "学习完成", blocked: "流程受阻", failed: "流程失败" } as Record<string, string>)[stage ?? ""] ?? stage ?? "未公开"
}

function waitingLabel(type?: string): string {
  return ({ diagnosis_answers: "等待诊断作答", assessment_answers: "等待正式测评", clarification_answer: "等待补充回答" } as Record<string, string>)[type ?? ""] ?? "等待你继续"
}

function decisionLabel(action?: string): string {
  return ({ remediate: "开始针对性补救", reinforce: "进入巩固学习", advance: "进入下一知识节点", reprofile: "重新确认学习画像", complete: "完成本次学习" } as Record<string, string>)[action ?? ""] ?? action ?? "未公开"
}

function nextRoundStatusLabel(status?: string): string {
  return ({ generating_next_round: "正在生成下一轮资源", waiting_for_reprofile: "等待重新画像" } as Record<string, string>)[status ?? ""] ?? status ?? "未公开"
}

export function answersMatchAssessmentItems(items: Array<{ item_id?: unknown }>, answers: Record<string, string>): boolean {
  const itemIds = items.map((item) => item.item_id).filter((itemId): itemId is string => typeof itemId === "string")
  return itemIds.length > 0
    && itemIds.length === Object.keys(answers).length
    && itemIds.every((itemId) => Object.prototype.hasOwnProperty.call(answers, itemId))
}

export function isFinalAdvanceSession(session: any): boolean {
  if (session?.terminal_outcome && session.terminal_outcome.code !== "PATH_MASTERED") return false
  return Boolean(
    session?.status === "completed"
      && session?.current_path_node == null
      && session?.feedback?.final_decision?.action === "advance"
      && Array.isArray(session?.formal_path?.nodes)
      && session.formal_path.nodes.length > 0
      && session.formal_path.nodes.every((node: any) => node?.status === "completed"),
  )
}

export function completedNodeFromPath(session: any): any | null {
  const nodes = Array.isArray(session?.formal_path?.nodes) ? session.formal_path.nodes : []
  return [...nodes].reverse().find((node: any) => node?.status === "completed") ?? null
}

export function nextUnmasteredPathNode(session: any): any | null {
  const nodes = Array.isArray(session?.formal_path?.nodes) ? session.formal_path.nodes : []
  return nodes.find((node: any) => node?.status !== "completed") ?? null
}

export function isFinalMasterySession(session: any, notice: { final: boolean } | null): boolean {
  if (notice?.final === true) return true
  if (session?.status !== "completed") return false
  if (session?.terminal_outcome && session.terminal_outcome.code !== "PATH_MASTERED") return false
  const accuracy = Number(session?.feedback?.round_score?.accuracy ?? 0)
  if (accuracy < 0.8 || session?.feedback?.final_decision?.action !== "advance") return false
  const nodes = Array.isArray(session?.formal_path?.nodes) ? session.formal_path.nodes : []
  return nodes.length > 0 && nodes.every((node: any) => node.status === "completed")
}

export function pageForSession(session: any, options?: { feedbackDismissed?: boolean }): OrchestratorPage {
  if (session?.feedback && !options?.feedbackDismissed) return "feedback"
  const hasPlanCheckpoint = Boolean(session?.profile && session?.formal_path && session?.current_path_node)
  if (session?.feedback && options?.feedbackDismissed && hasPlanCheckpoint) return "path"
  // 诊断完成后只要主Agent已公开B画像与正式路径，默认先展示画像/学习方案。
  // assessment_answers 只说明题目已准备好，不应绕过用户的"进入讲义"操作。
  if (hasPlanCheckpoint) return "path"
  const waitingType = session?.waiting_for?.type
  if (waitingType === "assessment_answers") return "assessment"
  if (session?.status === "blocked" || session?.status === "failed") return "feedback"
  if (session?.waiting_for?.type === "diagnosis_answers" || session?.current_stage === "objective_diagnosis") return "diagnosis"
  if (session?.current_stage === "assessment") {
    if (session?.learning_resources?.concept_lesson || session?.learning_resources?.code_lab) return "lesson"
    return "assessment"
  }
  if (session?.feedback) return "feedback"
  if (session?.status === "completed" || session?.current_stage === "completed") return "feedback"
  if (session?.profile || session?.formal_path) return "path"
  return "goal"
}

export function pathNodeTitle(node: any, ragItems: Array<{ source_id: string; title?: string }>): string {
  const target = node?.target_source_ids?.[0]
  if (!target) return node?.goal ?? "未命名节点"
  const title = ragItems.find((item) => item.source_id === target)?.title
  return title || node?.goal || "未命名节点"
}

export interface PathChainEntry {
  node_id: string
  source_id: string
  title: string
  status: "completed" | "in_progress" | "pending" | "blocked" | "reference_mastered" | "reference_pending"
}

/**
 * 展开展示链：按 B 节点顺序，在每个节点前插入其先修中尚未出现过的
 * source（来自 B 公开的 prerequisite_source_ids）。先修若与画像
 * known_concepts 匹配则标 reference_mastered（已掌握），否则 reference_pending（先修）。
 * 只做展示展开，不改变 B 的节点顺序与学习决策。
 */
export function pathChainView(
  nodes: Array<{ node_id?: string; target_source_ids?: string[]; prerequisite_source_ids?: string[]; status?: string }>,
  ragItems: Array<{ source_id: string; title?: string }>,
  knownConcepts: string[],
): PathChainEntry[] {
  const seen = new Set<string>()
  const chain: PathChainEntry[] = []
  const mastered = new Set(knownConcepts.map((concept) => concept.trim()))
  const titleFor = (sourceId: string): string => ragItems.find((item) => item.source_id === sourceId)?.title ?? sourceId

  for (const node of nodes) {
    for (const prereq of node.prerequisite_source_ids ?? []) {
      if (seen.has(prereq)) continue
      seen.add(prereq)
      chain.push({
        node_id: `PREREQ-${prereq}`,
        source_id: prereq,
        title: titleFor(prereq),
        status: mastered.has(titleFor(prereq)) ? "reference_mastered" : "reference_pending",
      })
    }
    const target = node.target_source_ids?.[0]
    if (target && !seen.has(target)) {
      seen.add(target)
      chain.push({
        node_id: node.node_id ?? `NODE-${target}`,
        source_id: target,
        title: titleFor(target),
        status: (node.status === "in_progress" ? "in_progress" : node.status === "completed" ? "completed" : node.status === "blocked" ? "blocked" : "pending") as PathChainEntry["status"],
      })
    }
  }
  return chain
}

export function microCheckFeedbackView(
  check: {
    options?: Array<{ option_id: string; label: string; text: string }>
    answer_option_id?: string
    answer_explanation?: string
  },
  selectedOptionId?: string,
): { correct: boolean; answer_text: string; explanation: string } | null {
  if (!selectedOptionId || !check.answer_option_id) return null
  const correctOption = check.options?.find((option) => option.option_id === check.answer_option_id)
  return {
    correct: selectedOptionId === check.answer_option_id,
    answer_text: correctOption ? `${correctOption.label}. ${correctOption.text}` : check.answer_option_id,
    explanation: check.answer_explanation ?? "C 未公开答案解析。",
  }
}

export interface AssessmentItemFeedbackView {
  item_id: string
  prompt: string
  modality: string
  max_score: number
  raw_score: number
  correct: boolean | null
  your_answer_text: string
  correct_answer_text?: string
  correct_answer_kind?: "choice" | "text" | "numeric" | "rubric" | "code"
  feedback_message?: string
  next_step?: string
}

function revealedAnswerView(
  revealed: any,
  options?: Array<{ option_id: string; text?: string }>,
): Pick<AssessmentItemFeedbackView, "correct_answer_text" | "correct_answer_kind"> {
  if (!revealed || typeof revealed.kind !== "string") return {}
  if (revealed.kind === "choice") {
    return {
      correct_answer_kind: "choice",
      correct_answer_text: options?.find((option) => option.option_id === revealed.option_id)?.text ?? revealed.option_id,
    }
  }
  if (revealed.kind === "text") {
    return { correct_answer_kind: "text", correct_answer_text: (revealed.accepted ?? []).join("；") }
  }
  if (revealed.kind === "numeric") {
    return { correct_answer_kind: "numeric", correct_answer_text: `${revealed.target}${revealed.unit ? ` ${revealed.unit}` : ""}` }
  }
  if (revealed.kind === "rubric") {
    const criteria = (revealed.criteria ?? []).map((criterion: any, index: number) =>
      `${index + 1}. ${criterion.description}${criterion.required_evidence?.length ? `（需包含：${criterion.required_evidence.join("、")}）` : ""}`)
    return { correct_answer_kind: "rubric", correct_answer_text: criteria.join("\n") }
  }
  if (revealed.kind === "code") {
    return { correct_answer_kind: "code", correct_answer_text: revealed.code ?? "" }
  }
  return {}
}

export function assessmentFeedbackView(
  items: Array<{ item_id: string; modality?: string; prompt?: string; max_score?: number; options?: Array<{ option_id: string; text?: string }> }>,
  gradeResult: any,
  yourAnswers: Array<{ item_id: string; selected_option_id?: string | null; text_response?: string | null; code_response?: string | null }>,
): AssessmentItemFeedbackView[] {
  const results = new Map<string, any>((gradeResult?.item_results ?? []).map((r: any) => [r.item_id, r]))
  const itemFeedback = new Map<string, any>((gradeResult?.feedback?.item_feedback ?? []).map((f: any) => [f.item_id, f]))
  const yours = new Map<string, any>((yourAnswers ?? []).map((a) => [a.item_id, a]))
  return (items ?? []).map((item) => {
    const result = results.get(item.item_id)
    const guidance = itemFeedback.get(item.item_id)
    const your = yours.get(item.item_id)
    let yourAnswerText = ""
    if (your) {
      if (your.selected_option_id) {
        yourAnswerText = item.options?.find((o) => o.option_id === your.selected_option_id)?.text ?? your.selected_option_id
      } else if (your.code_response) {
        yourAnswerText = your.code_response.length > 80 ? `${your.code_response.slice(0, 77)}…` : your.code_response
      } else if (your.text_response) {
        yourAnswerText = your.text_response.length > 80 ? `${your.text_response.slice(0, 77)}…` : your.text_response
      } else {
        yourAnswerText = "未作答"
      }
    }
    return {
      item_id: item.item_id,
      prompt: item.prompt ?? item.item_id,
      modality: item.modality ?? "unknown",
      max_score: item.max_score ?? result?.max_score ?? 0,
      raw_score: result?.raw_score ?? 0,
      correct: result ? result.feedback_code === "correct" || result.raw_score >= (result.max_score || 1) : null,
      your_answer_text: your ? yourAnswerText : "未作答",
      ...revealedAnswerView(guidance?.revealed_answer, item.options),
      feedback_message: guidance?.message,
      next_step: guidance?.next_step,
    }
  })
}

export function abilityRadarView(profile: any): { status: "pending" | "verified"; dimensions: Array<{ label: string; value: number }> } {
  const dimensions = Array.isArray(profile?.ability_dimensions)
    ? profile.ability_dimensions.filter((item: any) => typeof item?.label === "string" && Number.isFinite(item?.value) && item.value >= 0 && item.value <= 1).map((item: any) => ({ label: item.label, value: item.value }))
    : []
  return dimensions.length >= 3 ? { status: "verified", dimensions } : { status: "pending", dimensions: [] }
}

export function initialGoalSelection(): { mode: "catalog"; selectedNodeId: string; customGoal: string } {
  return { mode: "catalog", selectedNodeId: "", customGoal: "" }
}

export function blockedSessionAction(session: any): { canRetry: boolean; label: string } {
  const outcome = session?.terminal_outcome
  const generationFailure = outcome?.generation_failure
  if (outcome?.kind === "content_generation_failed" && generationFailure) {
    const labels: Record<string, string> = {
      regenerate_concept: "重新生成概念讲解",
      regenerate_code_lab: "重新生成代码实验",
      regenerate_assessment: "重新生成正式测评",
      retry_provider: "重试内容生成服务",
    }
    return {
      canRetry: generationFailure.canRetry === true,
      label: labels[generationFailure.nextAction] ?? "调整学习目标",
    }
  }
  if (outcome?.kind === "unsupported_goal") {
    return { canRetry: false, label: "调整学习目标" }
  }
  if (outcome?.kind === "insufficient_evidence") {
    return { canRetry: false, label: "调整目标或补充资料" }
  }
  if (outcome?.kind === "planning_failed") {
    return { canRetry: false, label: "重新规划或调整目标" }
  }
  if (outcome?.kind === "learning_support_required" || String(session?.blocked_reason ?? "").startsWith("LEARNING_SUPPORT_REQUIRED:")) {
    return { canRetry: false, label: "重新诊断或调整目标" }
  }
  const hasGenerationCheckpoint = Boolean(session?.profile && session?.formal_path && session?.current_path_node)
  return hasGenerationCheckpoint
    ? { canRetry: true, label: "重新生成当前学习资源" }
    : { canRetry: false, label: "重新诊断" }
}

export function answersToSubmission(items: any[], answers: Record<string, string>): SubmissionAnswer[] {
  return items.map((item) => {
    const answer = answers[item.item_id] ?? ""
    if (item.modality === "mcq" || item.modality === "true_false") {
      return { item_id: item.item_id, selected_option_id: answer, hint_level_used: 0 }
    }
    if (item.modality === "code") {
      return { item_id: item.item_id, code_response: answer, hint_level_used: 0 }
    }
    return { item_id: item.item_id, text_response: answer, hint_level_used: 0 }
  })
}

export function diagnosisComplete(session: any, answers: Record<string, string>): boolean {
  const items = session?.waiting_for?.type === "diagnosis_answers" ? session.waiting_for.items ?? [] : []
  return items.length > 0 && items.every((item: any) => (answers[item.item_id] ?? "").trim().length > 0)
}

export function assessmentComplete(session: any, answers: Record<string, string>): boolean {
  const items = session?.assessment?.payload?.items ?? []
  return items.length > 0 && items.every((item: any) => (answers[item.item_id] ?? "").trim().length > 0)
}
