/**
 * 遗留前端（role-d-ui）的 C 延续契约。
 *
 * 废弃标注（2026-08-08）：本文件属于已被 `src/role-d-ui-v2` 取代的旧前端。
 * 它描述的 `/api/role-c/*` HTTP facade（含锚点路由）**没有对应的后端实现**，
 * 仅被演示/参考路径 `src/orchestration/dynamic-planning-orchestrator.ts` 及其
 * 测试引用。生产主路径（主 Agent 交互会话 + role-d-ui-v2）不依赖本模块。
 * 若旧前端下线，本文件应连同 `dynamic-planning-orchestrator` 一并移除。
 */
import type {
  CodeLabPublicArtifact,
  ConceptLessonArtifact,
  AssessmentPublicArtifact,
  RenderBlock,
} from "../../../role-c-content/contracts/artifacts"
import type { CitationRef } from "../../../role-c-content/contracts/common"
import type { LearningArtifactView, CitationView } from "./types"
import type { LearnerProfileSnapshot, LearningPathNode } from "../../../role-c-content/contracts/profile-adapter"
import type { RagEvidencePack } from "../../../role-c-content/contracts/evidence-pack"
import type { RoleDGeneratedArtifact, RoleDWorkflowEvent } from "../../../role-d-integration/contracts"

export interface ContinueRoleCAfterSubmissionInput {
  sessionId: string
  submissionId: string
  learnerId: string
  nextPathNode?: LearningPathNode
  nextProfileSnapshot?: LearnerProfileSnapshot
  nextGenerationAction?: "remediate" | "reinforce" | "advance"
}

export interface ContinueRoleCGenerationReadyResult {
  status: "generation_ready"
  action: "remediate" | "reinforce" | "advance" | "reprofile"
  generation_action: "remediate" | "reinforce" | "advance"
  request_id: string
  idempotency_key: string
  parent_spec_id: string
  prior_feedback_ref: string
  trigger_objective_ids: string[]
  focus_objective_ids: string[]
  trigger_decision: { action: string; reason_codes: string[] }
  profile_content_hash: string
  profile_snapshot: LearnerProfileSnapshot
  generation_spec: Record<string, unknown>
  evidence_pack: RagEvidencePack
}

export interface ContinueRoleCPublishedResult {
  status: "published"
  continuation: {
    status: "published"
    preparation: ContinueRoleCGenerationReadyResult
    generation: Record<string, unknown>
    learning_session: { session: { run_id: string; session_id: string; form_id: string; attempt_no: number; phase?: string; routing_request_id?: string; required_item_ids?: string[] } }
    delivery_to_d: Record<string, unknown>
  }
  reviewedRelease: {
    artifacts: RoleDGeneratedArtifact[]
    trace_events: Array<{ run_id: string; seq: number; agent?: string; event_type: string; status: string; summary?: string; occurred_at?: string }>
  }
  learningSession: { session: { run_id: string; session_id: string; form_id: string; attempt_no: number; phase?: string; routing_request_id?: string; required_item_ids?: string[] } }
  artifacts: RoleDGeneratedArtifact[]
  finalContext: {
    profileSnapshot: LearnerProfileSnapshot
    profileVersion: string
    pathNode: LearningPathNode
    evidencePack: RagEvidencePack
  }
}

export interface ContinueRoleCAwaitingInputResult {
  status: "awaiting_input"
  action: "advance" | "reprofile"
  requestId: string
  requiredInputs: Array<"nextPathNode" | "nextProfileSnapshot" | "nextGenerationAction">
  profileDriftSuggestion?: unknown
}

export interface ContinueRoleCBlockedResult {
  status: "blocked" | "failed"
  stage: string
  reason: string
  continuation?: never
}

export type ContinueRoleCForRoleDResult =
  | ContinueRoleCPublishedResult
  | ContinueRoleCAwaitingInputResult
  | ContinueRoleCBlockedResult

export interface RouteRoleCAssessmentAnchorsInput {
  routingRequestId: string
  sessionId: string
  runId: string
  learnerId: string
  formId: string
  attemptNo: number
  submissionId: string
  answers: Array<{ item_id: string; selected_option_id?: string; text_response?: string; code_response?: string; hint_level_used: 0 }>
}

export type RouteRoleCAssessmentAnchorsResult =
  | {
      status: "routed"
      routing_request_id: string
      anchor_score_ratio: number
      route_id: string
      action: "remediate" | "reinforce" | "advance"
      required_item_ids: string[]
      learning_session: { phase: "route_locked"; routing_request_id: string; session_id: string; run_id: string; form_id: string; attempt_no: number; route_lock_id: string; route_id: string; action: "remediate" | "reinforce" | "advance"; anchor_score_ratio: number; required_item_ids: string[] }
    }
  | { status: "needs_review"; routing_request_id: string; unresolved_anchor_item_ids: string[] }
  | { status: "blocked"; routing_request_id: string; issues: string[] }

const ROLE_C_CONTINUE_ENDPOINT = "/api/role-c/continue"
const ROLE_C_ROUTE_ANCHORS_ENDPOINT = "/api/role-c/route-anchors"

export async function continueRoleCAfterSubmission(
  input: ContinueRoleCAfterSubmissionInput,
): Promise<ContinueRoleCForRoleDResult> {
  const response = await fetch(ROLE_C_CONTINUE_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  })
  const payload: unknown = await response.json()
  if (response.ok && isPublishedContinuation(payload)) return payload
  if (!response.ok && isBlockedContinuation(payload)) return payload
  if (!response.ok && isAwaitingContinuation(payload)) return payload
  return {
    status: "blocked",
    stage: "configuration",
    reason: "C 返回了不符合公开合同的续轮响应。",
  }
}

export async function routeRoleCAssessmentAnchors(
  input: RouteRoleCAssessmentAnchorsInput,
): Promise<RouteRoleCAssessmentAnchorsResult> {
  const response = await fetch(ROLE_C_ROUTE_ANCHORS_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  })
  const payload: unknown = await response.json()
  if (response.ok && isRoutedAnchors(payload)) return payload
  if (!response.ok && (isBlockedAnchors(payload) || isReviewAnchors(payload))) return payload
  return {
    status: "blocked",
    routing_request_id: input.routingRequestId,
    issues: ["C 返回了不符合公开合同的锚点路由响应。"],
  }
}

export function continuationToRoleDArtifacts(
  delivery: { artifacts: Array<{ artifact_type: string; artifact_id: string; payload?: any; citations: CitationRef[] }>} ,
): LearningArtifactView[] {
  const concept = delivery.artifacts.find((entry) => entry.artifact_type === "concept_lesson") as ConceptLessonArtifact | undefined
  const lab = delivery.artifacts.find((entry) => entry.artifact_type === "code_lab_public") as CodeLabPublicArtifact | undefined
  const assessment = delivery.artifacts.find((entry) => entry.artifact_type === "assessment_public") as AssessmentPublicArtifact | undefined
  if (!concept?.payload || !lab?.payload || !assessment?.payload) return []

  const assessmentItems = assessment.payload.items.map((item) => ({
    id: item.item_id,
    tier: item.tier,
    modality: item.modality,
    prompt: item.prompt,
    options: item.options?.map((option) => `${option.label}. ${option.text}`) ?? [],
    optionIds: item.options?.map((option) => option.option_id) ?? [],
    maxScore: item.max_score,
    ...(item.starter_code ? { starterCode: item.starter_code } : {}),
    citations: simplifyCitations(item.citations),
  }))

  return [
    {
      id: concept.artifact_id,
      kind: "lesson",
      title: concept.payload.title,
      status: "real",
      content: renderConceptLesson(concept.payload),
      options: [],
      citations: simplifyCitations(concept.citations),
      items: [],
      evidenceStatus: "grounded",
    },
    {
      id: lab.artifact_id,
      kind: "lab",
      title: lab.payload.title,
      status: "real",
      content: renderCodeLab(lab.payload),
      options: [],
      citations: simplifyCitations(lab.citations),
      items: [],
      evidenceStatus: "grounded",
    },
    {
      id: assessment.artifact_id,
      kind: "assessment",
      title: assessment.payload.title,
      status: "real",
      content: `共 ${assessment.payload.items.length} 道分阶题，覆盖 Tier 1、Tier 2 和 Tier 3。`,
      options: assessmentItems[0]?.options ?? [],
      citations: simplifyCitations(assessment.citations),
      items: assessmentItems,
      evidenceStatus: "grounded",
    },
  ]
}

export function continuationToRoleDWorkflow(
  traceEvents: Array<{ run_id: string; seq: number; agent?: string; event_type: string; status: string; summary?: string; occurred_at?: string }>,
): RoleDWorkflowEvent[] {
  return traceEvents.map((event) => ({
    id: `${event.run_id}-${event.seq}`,
    agent: event.agent ?? "role-c-pipeline",
    stage: event.agent === "concept-tutor"
      ? event.event_type === "c.agent.started" ? "定制讲义生成" : event.event_type === "c.agent.ready" ? "定制讲义准备" : "定制讲义"
      : event.agent === "code-lab"
        ? "代码实验"
        : event.agent === "tiered-evaluator"
          ? "分阶测评"
          : event.event_type === "c.pipeline.ready" ? "C 内容发布" : "C 入口校验",
    status: event.status === "success"
      ? "completed"
      : event.status === "started"
        ? "running"
        : event.status === "blocked" || event.status === "failed"
          ? "blocked"
          : "pending",
    summary: event.summary ?? event.event_type,
    timestamp: event.occurred_at ?? "刚刚",
  }))
}

function isPublishedContinuation(value: unknown): value is ContinueRoleCPublishedResult {
  return typeof value === "object" && value !== null && (value as { status?: unknown }).status === "published"
}

function isAwaitingContinuation(value: unknown): value is ContinueRoleCAwaitingInputResult {
  return typeof value === "object" && value !== null && (value as { status?: unknown }).status === "awaiting_input"
}

function isBlockedContinuation(value: unknown): value is ContinueRoleCBlockedResult {
  return typeof value === "object" && value !== null
    && ((value as { status?: unknown }).status === "blocked" || (value as { status?: unknown }).status === "failed")
}

function isRoutedAnchors(value: unknown): value is Extract<RouteRoleCAssessmentAnchorsResult, { status: "routed" }> {
  return typeof value === "object" && value !== null && (value as { status?: unknown }).status === "routed"
}

function isReviewAnchors(value: unknown): value is Extract<RouteRoleCAssessmentAnchorsResult, { status: "needs_review" }> {
  return typeof value === "object" && value !== null && (value as { status?: unknown }).status === "needs_review"
}

function isBlockedAnchors(value: unknown): value is Extract<RouteRoleCAssessmentAnchorsResult, { status: "blocked" }> {
  return typeof value === "object" && value !== null && (value as { status?: unknown }).status === "blocked"
}

function renderConceptLesson(payload: NonNullable<ConceptLessonArtifact["payload"]>): string {
  const explanations = payload.explanation_blocks.flatMap((block) => "text" in block ? [block.text] : [])
  const examples = payload.worked_examples.flatMap((block) => block.block_type === "code"
    ? [`${block.caption ?? "示例"}\n${block.code}`]
    : [])
  const misconceptions = payload.misconceptions.map((item) => `常见误区：${item.explanation}`)
  const summaries = payload.summary.flatMap((block) => "text" in block ? [block.text] : [])
  return [...explanations, ...examples, ...misconceptions, ...summaries].join("\n\n")
}

function renderCodeLab(payload: NonNullable<CodeLabPublicArtifact["payload"]>): string {
  const instructions = payload.instructions.flatMap((block) => "text" in block ? [block.text] : [])
  const tests = payload.public_tests.map((test) => `公开测试：${test.description}（${test.expected_behavior}）`)
  return [...instructions, "Starter code:", payload.starter_code, ...tests].join("\n\n")
}

function simplifyCitations(citations: CitationRef[]): CitationView[] {
  return [...new Map(citations.map((citation) => [
    `${citation.source_id}:${citation.fact_id}`,
    { sourceId: citation.source_id, factId: citation.fact_id },
  ])).values()]
}
