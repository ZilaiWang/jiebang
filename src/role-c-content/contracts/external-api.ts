import type {
  AssessmentPublicArtifact,
  CodeLabPublicArtifact,
  ConceptLessonArtifact,
  GradeResultArtifact,
  SubmissionEnvelope,
} from "./artifacts"
import type {
  EvidenceGapRequest,
  EvidenceRefreshPort,
  FactAuditPacket,
  FactAuditPort,
  RagEvidencePack,
} from "./evidence-pack"
import type { AgentTraceEvent, LearningEvidenceEvent, ProfileDriftSuggestion } from "./learning-evidence-event"
import type { LearnerProfileSnapshot, LearningPathNode } from "./profile-adapter"
import type { DynamicFeedbackResult } from "./dynamic-feedback"
import type { ReviewedCPipelineResult } from "../review/types"
import type { NextRoundGenerationContext } from "../agents/types"
import type { ReviewRecoveryPublicResult } from "../review/run-recoverable-pipeline"
import type {
  RoleBPathPlanningRequest,
  RoleBPathPlanningResult,
} from "./recovery"
import { C_SCHEMA_VERSION, contentHash, type SchemaVersion } from "./common"
import { assertReviewedReadyPipeline } from "../review/validate-reviewed-release"
import { validatePublicArtifactNoSecrets } from "../validators/public-secure-leak-validator"
import { validateRoleCSchema, type RoleCSchemaFile } from "../validators/runtime-schema-validator"

/** Artifacts that D may render or return to a learner-facing client. */
export type PublicArtifact =
  | ConceptLessonArtifact
  | CodeLabPublicArtifact
  | AssessmentPublicArtifact
  | GradeResultArtifact

/** Complete inbound message inventory for Role C's current framework boundary. */
export interface RoleCInboundMessages {
  from_a: RagEvidencePack
  from_b:
    | LearnerProfileSnapshot
    | LearningPathNode
    | RoleBPathPlanningResult
  from_d: SubmissionEnvelope
}

/** Complete outbound message inventory. Secure artifacts are deliberately not part of this public API. */
export interface RoleCOutboundMessages {
  to_a: EvidenceGapRequest | FactAuditPacket
  to_b: RoleCLearningProgressDelivery | RoleBPathPlanningRequest
  to_d:
    | RoleCReviewedReleaseDelivery
    | RoleCDynamicFeedbackDelivery
    | RoleCReviewRecoveryStatusDelivery
    | RoleCLearningSessionDelivery
}

/** Transport-neutral integration ports; HTTP/OpenCode/MCP adapters can implement these contracts. */
export interface RoleAContentEvidencePort extends EvidenceRefreshPort, FactAuditPort {}

export interface RoleBLearningProgressPort {
  /**
   * Commits one same-learner progress batch. The receiver uses `delivery_id` as
   * its idempotency key and returns `duplicate` after an earlier commit.
   */
  publishLearningProgress(
    delivery: RoleCLearningProgressDelivery,
  ): Promise<RoleCDeliveryAck>
}

export type RoleCDeliveryKind =
  | "learning_progress"
  | "reviewed_release"
  | "dynamic_feedback"
  | "review_recovery_status"
  | "learning_session"
export type RoleCDeliveryStatus = "accepted" | "duplicate"

/**
 * The recipient acknowledges the exact delivery ID it accepted and returns
 * `duplicate` when the same delivery was committed previously.
 */
export interface RoleCDeliveryAck {
  schema_version: SchemaVersion
  delivery_kind: RoleCDeliveryKind
  delivery_id: string
  status: RoleCDeliveryStatus
}

/** 本轮生成相对上一轮的适配信息（由 next_round_context 确定性拼装，非模型输出）。 */
export interface RoleCAdaptationInfo {
  adaptation_action: "remediate" | "reinforce" | "advance"
  target_objective_ids: string[]
  /** 上一轮反馈指出的具体误区；主 Agent 传入 misconception_tags 后自动透传。 */
  addressed_misconception_tags: string[]
  adaptation_summary: string
  source_feedback_refs: string[]
}

export interface RoleCReviewedReleaseDelivery {
  schema_version: SchemaVersion
  delivery_kind: "reviewed_release"
  delivery_id: string
  run_id: string
  pipeline_input_hash: string
  generation_spec_hash: string
  review_policy_version: string
  final_review_hash: string
  artifacts: [
    ConceptLessonArtifact,
    CodeLabPublicArtifact,
    AssessmentPublicArtifact,
  ]
  trace_events: [AgentTraceEvent, ...AgentTraceEvent[]]
  /** 仅当本轮由上一轮决策触发（remediate/reinforce/advance）时存在。 */
  adaptation?: RoleCAdaptationInfo
}

export type RoleCLearningSessionHandoff =
  | {
      /** New production path: all formal assessment items are preselected by trusted C. */
      phase: "preselected"
      routing_request_id: string
      session_id: string
      run_id: string
      form_id: string
      attempt_no: number
      /** Exactly the backend-selected formal assessment item set. */
      required_item_ids: string[]
    }
  | {
      phase: "route_locked"
      routing_request_id: string
      session_id: string
      run_id: string
      form_id: string
      attempt_no: number
      route_lock_id: string
      route_id: string
      action: "remediate" | "reinforce" | "advance"
      anchor_score_ratio: number
      required_item_ids: string[]
    }

export interface RoleCLearningSessionDelivery {
  schema_version: SchemaVersion
  delivery_kind: "learning_session"
  delivery_id: string
  session: RoleCLearningSessionHandoff
}

export type TerminalReviewRecoveryPublicResult =
  ReviewRecoveryPublicResult & (
    | {
        pipeline_status: "blocked"
        pipeline_state: "BLOCKED"
      }
    | {
        pipeline_status: "failed"
        pipeline_state: "FAILED"
      }
  )

export interface RoleCReviewRecoveryStatusDelivery {
  schema_version: SchemaVersion
  delivery_kind: "review_recovery_status"
  delivery_id: string
  result: TerminalReviewRecoveryPublicResult
}

export interface RoleCDynamicFeedbackDelivery {
  schema_version: SchemaVersion
  delivery_kind: "dynamic_feedback"
  delivery_id: string
  feedback: DynamicFeedbackResult
}

export type RoleCToDDelivery =
  | RoleCReviewedReleaseDelivery
  | RoleCDynamicFeedbackDelivery
  | RoleCReviewRecoveryStatusDelivery
  | RoleCLearningSessionDelivery

interface RoleCLearningProgressDeliveryBase {
  schema_version: SchemaVersion
  delivery_kind: "learning_progress"
  delivery_id: string
  learner_id_hash: string
  profile_version: string
}

export type RoleCLearningProgressDelivery =
  | RoleCLearningProgressDeliveryBase & {
    evidence_events: [LearningEvidenceEvent, ...LearningEvidenceEvent[]]
    profile_drift_suggestion?: ProfileDriftSuggestion
  }
  | RoleCLearningProgressDeliveryBase & {
    evidence_events: []
    profile_drift_suggestion: ProfileDriftSuggestion
  }

export interface RoleDPublicDeliveryPort {
  /**
   * Commits the reviewed artifacts and their trace as one idempotent receiver unit.
   * The receiver uses `delivery_id` as its idempotency key.
   */
  publishReviewedRelease(
    release: RoleCReviewedReleaseDelivery,
  ): Promise<RoleCDeliveryAck>
}

export interface RoleDDynamicFeedbackPort {
  /**
   * Commits one feedback result. Repeating the same envelope returns `duplicate`.
   */
  publishDynamicFeedback(
    delivery: RoleCDynamicFeedbackDelivery,
  ): Promise<RoleCDeliveryAck>
}

export interface RoleDReviewRecoveryStatusPort {
  /**
   * Commits one terminal review/recovery status. READY content uses the
   * reviewed-release boundary instead.
   */
  publishReviewRecoveryStatus(
    delivery: RoleCReviewRecoveryStatusDelivery,
  ): Promise<RoleCDeliveryAck>
}

export interface RoleDLearningSessionPort {
  /**
   * Commits one immutable session handoff independently of reviewed content.
   */
  publishLearningSession(
    delivery: RoleCLearningSessionDelivery,
  ): Promise<RoleCDeliveryAck>
}

export async function deliverRoleCToB(
  port: RoleBLearningProgressPort,
  events: LearningEvidenceEvent[],
  drift?: ProfileDriftSuggestion,
): Promise<RoleCDeliveryAck> {
  if (events.length === 0 && drift === undefined) {
    throw new Error("ROLE_C_B_DELIVERY_EMPTY")
  }
  for (const event of events) {
    assertOutboundSchema("learning_evidence_event.schema.json", event)
    assertNoOutboundSecrets("ROLE_C_B_DELIVERY_SECRET_LEAK", event)
  }
  if (drift) {
    assertOutboundSchema("profile_drift_suggestion.schema.json", drift)
    assertNoOutboundSecrets("ROLE_C_B_DELIVERY_SECRET_LEAK", drift)
  }
  if (new Set(events.map((event) => event.event_id)).size !== events.length) {
    throw new Error("ROLE_C_B_DELIVERY_DUPLICATE_EVENT")
  }
  const learnerProfiles = new Set(events.map((event) => `${event.learner_id_hash}\u0000${event.profile_version}`))
  if (learnerProfiles.size > 1) throw new Error("ROLE_C_B_DELIVERY_MIXED_PROFILE_BATCH")
  if (drift && events.some((event) =>
    event.learner_id_hash !== drift.learner_id_hash || event.profile_version !== drift.profile_version)) {
    throw new Error("ROLE_C_B_DELIVERY_DRIFT_PROFILE_MISMATCH")
  }
  const identitySource = events[0] ?? drift!
  const base = {
    schema_version: C_SCHEMA_VERSION,
    delivery_kind: "learning_progress" as const,
    learner_id_hash: identitySource.learner_id_hash,
    profile_version: identitySource.profile_version,
  }
  const sortedEvents = structuredClone(events).sort(
    (left, right) => left.event_id < right.event_id
      ? -1
      : left.event_id > right.event_id
        ? 1
        : 0,
  )
  const body = sortedEvents.length > 0
    ? {
      ...base,
      evidence_events: sortedEvents as [LearningEvidenceEvent, ...LearningEvidenceEvent[]],
      ...(drift ? { profile_drift_suggestion: structuredClone(drift) } : {}),
    }
    : {
      ...base,
      evidence_events: [] as [],
      profile_drift_suggestion: structuredClone(drift!),
    }
  const delivery: RoleCLearningProgressDelivery = {
    ...body,
    delivery_id: contentHash(body),
  }
  assertOutboundSchema("learning_progress_delivery.schema.json", delivery)
  assertNoOutboundSecrets("ROLE_C_B_DELIVERY_SECRET_LEAK", delivery)
  const ack = await port.publishLearningProgress(structuredClone(delivery))
  return assertDeliveryAck(ack, delivery, "ROLE_C_B")
}

export async function deliverRoleCToD(
  port: RoleDPublicDeliveryPort,
  pipeline: ReviewedCPipelineResult,
): Promise<RoleCDeliveryAck> {
  const delivery = createReviewedReleaseDelivery(pipeline)
  const ack = await port.publishReviewedRelease(structuredClone(delivery))
  return assertDeliveryAck(ack, delivery, "ROLE_C_D")
}

function reviewedRelease(pipeline: ReviewedCPipelineResult): {
  run_id: string
  artifacts: [ConceptLessonArtifact, CodeLabPublicArtifact, AssessmentPublicArtifact]
} {
  return assertReviewedReadyPipeline(pipeline, {
    error_prefix: "ROLE_C_D_DELIVERY",
  })
}

/** Builds the exact validated public envelope used by HTTP and delivery ports. */
export function createReviewedReleaseDelivery(
  pipeline: ReviewedCPipelineResult,
  nextRoundContext?: NextRoundGenerationContext,
): RoleCReviewedReleaseDelivery {
  const reviewed = reviewedRelease(pipeline)
  const runId = reviewed.run_id
  const artifacts = reviewed.artifacts
  const trace = pipeline.trace_events
  if (!runId.trim()) throw new Error("ROLE_C_D_DELIVERY_RUN_EMPTY")
  if (new Set(artifacts.map((artifact) => artifact.artifact_id)).size !== artifacts.length) {
    throw new Error("ROLE_C_D_DELIVERY_DUPLICATE_ARTIFACT")
  }
  for (const artifact of artifacts) {
    if (artifact.run_id !== runId) throw new Error("ROLE_C_D_DELIVERY_RUN_MISMATCH")
    const schema = publicArtifactSchema(artifact.artifact_type)
    assertOutboundSchema(schema, artifact)
    const leak = validatePublicArtifactNoSecrets(artifact)
    if (!leak.ok) throw new Error(`ROLE_C_D_DELIVERY_SECRET_LEAK:${leak.issues.map((issue) => issue.path).join(",")}`)
  }
  for (const event of trace) {
    if (event.run_id !== runId) throw new Error("ROLE_C_D_TRACE_RUN_MISMATCH")
    assertOutboundSchema("agent_trace_event.schema.json", event)
    const leak = validatePublicArtifactNoSecrets(event)
    if (!leak.ok) throw new Error("ROLE_C_D_TRACE_SECRET_LEAK")
  }
  const finalReview = pipeline.review_reports.at(-1)
  if (!finalReview) throw new Error("ROLE_C_D_DELIVERY_REVIEW_MISSING")
  const traceEvents = structuredClone(trace) as [AgentTraceEvent, ...AgentTraceEvent[]]
  const adaptation = buildAdaptationInfo(nextRoundContext)
  const body = {
    schema_version: C_SCHEMA_VERSION,
    delivery_kind: "reviewed_release" as const,
    run_id: runId,
    pipeline_input_hash: pipeline.pipeline_input_hash,
    generation_spec_hash: pipeline.generation_spec_hash,
    review_policy_version: pipeline.review_policy_version,
    final_review_hash: contentHash(finalReview),
    artifacts: structuredClone(artifacts),
    trace_events: traceEvents,
    ...(adaptation ? { adaptation } : {}),
  }
  const delivery: RoleCReviewedReleaseDelivery = {
    ...body,
    delivery_id: contentHash(reviewedReleaseDeliveryIdentity(body)),
  }
  assertOutboundSchema("reviewed_release_delivery.schema.json", delivery)
  return delivery
}

/**
 * 确定性拼装本轮适配信息（非模型输出）：
 * adaptation_action/focus → 目标；misconception_tags 由主 Agent 传入后透传；
 * summary 为模板文案；source_feedback_refs 来自上一轮反馈引用。
 */
function buildAdaptationInfo(
  nextRoundContext: NextRoundGenerationContext | undefined,
): RoleCAdaptationInfo | undefined {
  if (!nextRoundContext) return undefined
  const targetList = [...nextRoundContext.focus_objective_ids]
  const summary = nextRoundContext.action === "remediate"
    ? `本轮针对目标 ${targetList.join("、")} 进行针对性补救：拆解步骤、补基础、针对误区重新讲解，并新出纠错与基础导向题目。`
    : nextRoundContext.action === "reinforce"
      ? `本轮对目标 ${targetList.join("、")} 进行巩固强化：变式与迁移练习，难度适当提高，并新出变式导向题目。`
      : `本轮继续推进目标 ${targetList.join("、")}。`
  return {
    adaptation_action: nextRoundContext.action,
    target_objective_ids: targetList,
    addressed_misconception_tags: [...(nextRoundContext.misconception_tags ?? [])],
    adaptation_summary: summary,
    source_feedback_refs: [
      nextRoundContext.prior_feedback_ref,
      nextRoundContext.trigger_grade_artifact_id,
    ].filter((ref): ref is string => Boolean(ref)),
  }
}

function reviewedReleaseDeliveryIdentity(
  release: Omit<RoleCReviewedReleaseDelivery, "delivery_id">,
): unknown {
  const semanticTrace = release.trace_events.map((event) =>
    Object.fromEntries(Object.entries(event).filter(([key]) =>
      !["seq", "occurred_at", "duration_ms"].includes(key))))
  return {
    schema_version: release.schema_version,
    delivery_kind: release.delivery_kind,
    run_id: release.run_id,
    pipeline_input_hash: release.pipeline_input_hash,
    generation_spec_hash: release.generation_spec_hash,
    review_policy_version: release.review_policy_version,
    final_review_hash: release.final_review_hash,
    artifact_hashes: release.artifacts.map((artifact) => contentHash(artifact)),
    trace_semantic_hash: contentHash(semanticTrace),
  }
}

/**
 * Recomputes the stable identity carried in a C -> D delivery ID.
 *
 * Reviewed-release trace timing fields are observational and deliberately do
 * not change replay identity. Every other D delivery hashes its complete body.
 * D receivers use this same boundary to reject forged IDs and mutated replays.
 */
export function roleCToDDeliveryIdentityHash(
  delivery: RoleCToDDelivery,
): string {
  if (delivery.delivery_kind === "reviewed_release") {
    const { delivery_id: _deliveryId, ...body } = delivery
    return contentHash(reviewedReleaseDeliveryIdentity(body))
  }
  const { delivery_id: _deliveryId, ...body } = delivery
  return contentHash(body)
}

export async function deliverReviewRecoveryStatusToD(
  port: RoleDReviewRecoveryStatusPort,
  result: ReviewRecoveryPublicResult,
): Promise<RoleCDeliveryAck> {
  const delivery = createReviewRecoveryStatusDelivery(result)
  const ack = await port.publishReviewRecoveryStatus(
    structuredClone(delivery),
  )
  return assertDeliveryAck(ack, delivery, "ROLE_C_D")
}

export function createReviewRecoveryStatusDelivery(
  result: ReviewRecoveryPublicResult,
): RoleCReviewRecoveryStatusDelivery {
  assertOutboundSchema("review_recovery_result.schema.json", result)
  if (!isTerminalReviewRecoveryResult(result)) {
    throw new Error("ROLE_C_D_RECOVERY_STATUS_NOT_TERMINAL")
  }
  assertNoOutboundSecrets("ROLE_C_D_RECOVERY_STATUS_SECRET_LEAK", result)
  const body = {
    schema_version: C_SCHEMA_VERSION,
    delivery_kind: "review_recovery_status" as const,
    result: structuredClone(result),
  }
  const delivery: RoleCReviewRecoveryStatusDelivery = {
    ...body,
    delivery_id: contentHash(body),
  }
  assertOutboundSchema(
    "review_recovery_status_delivery.schema.json",
    delivery,
  )
  assertNoOutboundSecrets("ROLE_C_D_RECOVERY_STATUS_SECRET_LEAK", delivery)
  return delivery
}

export async function deliverLearningSessionToD(
  port: RoleDLearningSessionPort,
  pipeline: ReviewedCPipelineResult,
  learningSession: RoleCLearningSessionHandoff,
): Promise<RoleCDeliveryAck> {
  const delivery = createLearningSessionDelivery(pipeline, learningSession)
  const ack = await port.publishLearningSession(structuredClone(delivery))
  return assertDeliveryAck(ack, delivery, "ROLE_C_D")
}

export function createLearningSessionDelivery(
  pipeline: ReviewedCPipelineResult,
  learningSession: RoleCLearningSessionHandoff,
): RoleCLearningSessionDelivery {
  const release = reviewedRelease(pipeline)
  const normalizedSession = validateLearningSessionHandoff(
    learningSession,
    release,
  )
  const body = {
    schema_version: C_SCHEMA_VERSION,
    delivery_kind: "learning_session" as const,
    session: normalizedSession,
  }
  const delivery: RoleCLearningSessionDelivery = {
    ...body,
    delivery_id: contentHash(body),
  }
  assertOutboundSchema("learning_session_delivery.schema.json", delivery)
  assertNoOutboundSecrets("ROLE_C_D_SESSION_SECRET_LEAK", delivery)
  return delivery
}

export function validateLearningSessionHandoff(
  session: RoleCLearningSessionHandoff,
  reviewed: {
    run_id: string
    artifacts: [ConceptLessonArtifact, CodeLabPublicArtifact, AssessmentPublicArtifact]
  },
): RoleCLearningSessionHandoff {
  const assessment = reviewed.artifacts[2]
  if (!session.session_id.trim()
    || session.run_id !== reviewed.run_id
    || session.attempt_no < 1
    || !Number.isSafeInteger(session.attempt_no)
    || !session.routing_request_id.trim()
    || assessment.payload === null
    || session.form_id !== assessment.payload.form_id) {
    throw new Error("ROLE_C_D_SESSION_HANDOFF_INVALID")
  }
  const assessmentItemIds = assessment.payload.items.map((item) => item.item_id)
  if (session.phase === "preselected") {
    if (session.required_item_ids.length === 0
      || new Set(session.required_item_ids).size
        !== session.required_item_ids.length
      || !sameStringSet(session.required_item_ids, assessmentItemIds)) {
      throw new Error("ROLE_C_D_SESSION_ITEMS_MISMATCH")
    }
    return {
      ...structuredClone(session),
      required_item_ids: [...assessmentItemIds],
    }
  }
  if (!session.route_lock_id.trim() || !session.route_id.trim()
    || !Number.isFinite(session.anchor_score_ratio)
    || session.anchor_score_ratio < 0
    || session.anchor_score_ratio > 1) {
    throw new Error("ROLE_C_D_SESSION_HANDOFF_INVALID")
  }
  const route = assessment.payload.routing.rules.find((candidate) =>
    candidate.route_id === session.route_id)
  if (!route) throw new Error("ROLE_C_D_SESSION_ROUTE_MISMATCH")
  const sortedRoutes = [...assessment.payload.routing.rules].sort(
    (left, right) =>
      left.min_anchor_score_ratio - right.min_anchor_score_ratio,
  )
  const routeIndex = sortedRoutes.findIndex((candidate) =>
    candidate.route_id === route.route_id)
  const ratioMatchesRoute =
    session.anchor_score_ratio >= route.min_anchor_score_ratio
      && (routeIndex === sortedRoutes.length - 1
        ? session.anchor_score_ratio <= route.max_anchor_score_ratio
        : session.anchor_score_ratio < route.max_anchor_score_ratio)
  if (route.action !== session.action || !ratioMatchesRoute) {
    throw new Error("ROLE_C_D_SESSION_ROUTE_MISMATCH")
  }
  const anchorIds = assessment.payload.routing.anchor_item_ids
  const anchorIdSet = new Set(anchorIds)
  const expectedItemIds = assessment.payload.items
    .filter((item) =>
      anchorIdSet.has(item.item_id)
        || route.reveal_tiers.includes(item.tier))
    .map((item) => item.item_id)
  if (session.required_item_ids.length === 0
    || new Set(session.required_item_ids).size !== session.required_item_ids.length
    || !sameStringSet(session.required_item_ids, expectedItemIds)) {
    throw new Error("ROLE_C_D_SESSION_ITEMS_MISMATCH")
  }
  return {
    ...structuredClone(session),
    required_item_ids: expectedItemIds,
  }
}

export async function deliverDynamicFeedbackToD(
  port: RoleDDynamicFeedbackPort,
  feedback: DynamicFeedbackResult,
): Promise<RoleCDeliveryAck> {
  assertOutboundSchema("dynamic_feedback_result.schema.json", feedback)
  const leak = validatePublicArtifactNoSecrets(feedback)
  if (!leak.ok) {
    throw new Error(`ROLE_C_D_FEEDBACK_SECRET_LEAK:${leak.issues.map((issue) => issue.path).join(",")}`)
  }
  const body = {
    schema_version: C_SCHEMA_VERSION,
    delivery_kind: "dynamic_feedback" as const,
    feedback: structuredClone(feedback),
  }
  const delivery: RoleCDynamicFeedbackDelivery = {
    ...body,
    delivery_id: contentHash(body),
  }
  assertOutboundSchema("dynamic_feedback_delivery.schema.json", delivery)
  const ack = await port.publishDynamicFeedback(structuredClone(delivery))
  return assertDeliveryAck(ack, delivery, "ROLE_C_D")
}

function assertDeliveryAck(
  ack: RoleCDeliveryAck,
  delivery: Pick<
    | RoleCLearningProgressDelivery
    | RoleCReviewedReleaseDelivery
    | RoleCDynamicFeedbackDelivery
    | RoleCReviewRecoveryStatusDelivery
    | RoleCLearningSessionDelivery,
    "delivery_kind" | "delivery_id"
  >,
  errorPrefix: "ROLE_C_B" | "ROLE_C_D",
): RoleCDeliveryAck {
  const report = validateRoleCSchema("delivery_ack.schema.json", ack)
  if (!report.ok) {
    throw new Error(`${errorPrefix}_ACK_SCHEMA_INVALID:${report.issues.map((issue) => issue.path).join(",")}`)
  }
  if (ack.delivery_kind !== delivery.delivery_kind) {
    throw new Error(`${errorPrefix}_ACK_KIND_MISMATCH`)
  }
  if (ack.delivery_id !== delivery.delivery_id) {
    throw new Error(`${errorPrefix}_ACK_ID_MISMATCH`)
  }
  return structuredClone(ack)
}

function isTerminalReviewRecoveryResult(
  result: ReviewRecoveryPublicResult,
): result is TerminalReviewRecoveryPublicResult {
  return (result.pipeline_status === "blocked"
      && result.pipeline_state === "BLOCKED")
    || (result.pipeline_status === "failed"
      && result.pipeline_state === "FAILED")
}

function assertNoOutboundSecrets(errorCode: string, value: unknown): void {
  const leak = validatePublicArtifactNoSecrets(value)
  if (!leak.ok) {
    throw new Error(`${errorCode}:${leak.issues.map((issue) => issue.path).join(",")}`)
  }
}

function publicArtifactSchema(artifactType: PublicArtifact["artifact_type"]): RoleCSchemaFile {
  if (artifactType === "concept_lesson") return "concept_artifact.schema.json"
  if (artifactType === "code_lab_public") return "code_lab_public.schema.json"
  if (artifactType === "assessment_public") return "assessment_public.schema.json"
  if (artifactType === "grade_result") return "grade_result.schema.json"
  throw new Error(`ROLE_C_D_DELIVERY_PRIVATE_ARTIFACT:${String(artifactType)}`)
}

function assertOutboundSchema(schema: RoleCSchemaFile, value: unknown): void {
  const report = validateRoleCSchema(schema, value)
  if (!report.ok) throw new Error(`ROLE_C_OUTBOUND_SCHEMA_INVALID:${schema}:${report.issues.map((issue) => issue.path).join(",")}`)
}

function sameStringSet(left: string[], right: string[]): boolean {
  return left.length === right.length
    && new Set(left).size === left.length
    && left.every((value) => right.includes(value))
}
