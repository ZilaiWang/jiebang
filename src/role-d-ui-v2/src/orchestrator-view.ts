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

export function shouldPollOrchestratorSession(session: any): boolean {
  return Boolean(session?.session_id && session?.status === "running")
}

export function answersMatchAssessmentItems(items: Array<{ item_id?: unknown }>, answers: Record<string, string>): boolean {
  const itemIds = items.map((item) => item.item_id).filter((itemId): itemId is string => typeof itemId === "string")
  return itemIds.length > 0
    && itemIds.length === Object.keys(answers).length
    && itemIds.every((itemId) => Object.prototype.hasOwnProperty.call(answers, itemId))
}

export function isFinalAdvanceSession(session: any): boolean {
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
  const hasGenerationCheckpoint = Boolean(session?.profile && session?.formal_path && session?.current_path_node)
  return hasGenerationCheckpoint
    ? { canRetry: true, label: "原样重试 C 资源生成" }
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
