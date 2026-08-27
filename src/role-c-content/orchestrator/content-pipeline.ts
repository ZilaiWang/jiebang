// Role C content generation pipeline; the directory already identifies the owning role.
import type {
  AssessmentPublicArtifact,
  AssessmentArtifactPair,
  CodeLabArtifactPair,
  CodeLabPublicArtifact,
  ConceptLessonArtifact,
} from "../contracts/artifacts"
import type { SecureArtifact, SecureArtifactStore } from "../security/secure-artifact-store"
import { contentHash, type BlockedReason, type FailureReason } from "../contracts/common"
import type { AgentTraceEvent } from "../contracts/learning-evidence-event"
import { newTraceEvent } from "../contracts/learning-evidence-event"
import type { GenerationSpec } from "../contracts/generation-spec"
import type { EvidenceFact, FactAuditPacket, FactAuditPort, RagEvidencePack } from "../contracts/evidence-pack"
import type {
  NextRoundGenerationContext,
  PriorAssessmentItem,
  GenerationRecoveryContext,
  RoleCAgents,
  TieredEvaluatorRequest,
} from "../agents/types"
import {
  reportFromObjections,
  validateCrossArtifactAlignment,
  type CrossArtifactCritic,
  type AlignmentObjection,
  type AlignmentReport,
} from "../validators/alignment-validator"
import { detectEvidenceConflicts, validateSpecEvidence } from "../validators/evidence-validator"
import { transitionCState, type CPipelineState } from "./state-machine"
import type { ContentCache } from "../reliability/content-cache"
import { pipelineInputHash } from "../reliability/content-cache"
import type { CPipelineCheckpoint, CPipelineCheckpointStore } from "../reliability/checkpoint-store"
import type { AgentTraceStore } from "../reliability/trace-store"
import { validateRoleCSchema } from "../validators/runtime-schema-validator"
import { validatePublicArtifactNoSecrets } from "../validators/public-secure-leak-validator"
import { buildResourceBlueprint, type ResourceBlueprint } from "../planning/resource-blueprint"
import { planAssessmentCapacity, type AssessmentCapacityPlan } from "../planning/assessment-capacity"
import { planArtifactFeasibility } from "../planning/artifact-feasibility"
import {
  assessmentObservationKey,
  STRUCTURAL_NOVELTY_WINDOW,
} from "../providers/staged-generation"
import type { RoundSemanticPlan, RoundSemanticPlanner } from "../planning/round-semantic-plan"
import type { ReviewRevisionContext } from "../review/types"
import { PublicQualityGateError } from "../quality/candidate-tournament"

export interface CPipelineInput {
  generation_spec: GenerationSpec
  evidence_pack: RagEvidencePack
  /** Frozen trigger and focus shared by all three Agents in a follow-up round. */
  next_round_context?: NextRoundGenerationContext
  /** Public question history is independent of learning action and exists on the first round too. */
  prior_assessment_items?: PriorAssessmentItem[]
  /** Changes only the failed model stage while preserving the frozen Spec identity. */
  generation_recovery?: GenerationRecoveryContext
}

export interface CPipelineResult {
  status: "ready" | "blocked" | "failed"
  state: CPipelineState
  generation_spec: GenerationSpec
  /** 本轮真正执行过的容量调整后蓝图，供最终资源审计复用。 */
  resource_blueprint?: ResourceBlueprint
  public_artifacts: {
    concept_lesson?: ConceptLessonArtifact
    code_lab?: CodeLabPublicArtifact
    assessment?: AssessmentPublicArtifact
  }
  secure_refs: string[]
  alignment_report?: AlignmentReport
  trace_events: AgentTraceEvent[]
  fact_audit_packets: FactAuditPacket[]
  blocked_reason?: BlockedReason
  failure_reason?: FailureReason
}

export interface CPipelineOptions {
  /** Optional semantic diagnostics; its findings never override deterministic trust checks. */
  critic?: CrossArtifactCritic
  fact_audit_port?: FactAuditPort
  cache?: ContentCache<CPipelineResult>
  checkpoint_store?: CPipelineCheckpointStore
  trace_store?: AgentTraceStore
  /** Optional one-shot semantic planner used only when the deterministic blueprint requests QUALITY. */
  semantic_planner?: RoundSemanticPlanner
  /** Internal continuation offset; callers normally leave this unset. */
  trace_seq_start?: number
  /**
   * 外审修订身份。外审修订轮（revision_round > 0）通过它参与 stage fingerprint，
   * 保证"审核要求修订的 stage 一定会重新生成"，且旧检查点不得绕过修订意见。
   */
  review_revision_context?: ReviewRevisionContext
}

const activePipelineFlights = new Map<string, Promise<CPipelineResult>>()
const localDependencyIds = new WeakMap<object, string>()
let nextLocalDependencyId = 1

export async function runCPipeline(
  input: CPipelineInput,
  agents: RoleCAgents,
  secureStore: SecureArtifactStore,
  options: CPipelineOptions = {},
): Promise<CPipelineResult> {
  const checkpointHash = pipelineCheckpointHash(input)
  const cacheKey = secureStore.namespace_id
    ? pipelineInputHash({ input, secure_store_namespace: secureStore.namespace_id })
    : undefined
  const flightKey = pipelineInputHash({
    input,
    secure_store: secureStore.namespace_id ?? localDependencyId(secureStore),
    execution_dependencies: {
      agents: localDependencyId(agents),
      critic: localDependencyId(options.critic),
      fact_audit_port: localDependencyId(options.fact_audit_port),
      cache: localDependencyId(options.cache),
      checkpoint_store: localDependencyId(options.checkpoint_store),
      trace_store: localDependencyId(options.trace_store),
      semantic_planner: localDependencyId(options.semantic_planner),
      trace_seq_start: options.trace_seq_start ?? null,
    },
  })
  const activeBeforeCache = activePipelineFlights.get(flightKey)
  if (activeBeforeCache) return structuredClone(await activeBeforeCache)

  try {
    const cached = cacheKey ? await options.cache?.get(cacheKey) : undefined
    if (cached) {
      if (cached.status !== "ready" || cached.secure_refs.length !== 2) {
        throw new Error("CACHED_PIPELINE_RESULT_INVALID")
      }
      const secureArtifacts = await Promise.all(cached.secure_refs.map((ref) => secureStore.get(ref, {
        principal: "role-c-pipeline",
        run_id: input.generation_spec.run_id,
      })))
      if (cachedResultIssues(cached, input, secureArtifacts).length > 0) {
        throw new Error("CACHED_PIPELINE_RESULT_INVALID")
      }
      return cached
    }
  } catch {
    // Cache/ref validation is an optimization. A stale entry must regenerate through the full trust path.
  }

  const activeAfterCache = activePipelineFlights.get(flightKey)
  if (activeAfterCache) return structuredClone(await activeAfterCache)

  const flight = executePipeline(
    input,
    agents,
    secureStore,
    options,
    checkpointHash,
    cacheKey,
  )
  activePipelineFlights.set(flightKey, flight)
  try {
    return await flight
  } finally {
    if (activePipelineFlights.get(flightKey) === flight) {
      activePipelineFlights.delete(flightKey)
    }
  }
}

async function executePipeline(
  input: CPipelineInput,
  agents: RoleCAgents,
  secureStore: SecureArtifactStore,
  options: CPipelineOptions,
  checkpointHash: string,
  cacheKey: string | undefined,
): Promise<CPipelineResult> {
  let traceSeqStart = options.trace_seq_start ?? 1
  try {
    const prior = await options.trace_store?.read(input.generation_spec.run_id)
    if (prior?.length) traceSeqStart = Math.max(...prior.map((event) => event.seq)) + 1
  } catch { /* return trace remains available even if persistence is unavailable */ }
  const result = await runCPipelineCore(input, agents, secureStore, { ...options, trace_seq_start: traceSeqStart }, checkpointHash)
  try { if (options.trace_store) await options.trace_store.append(result.trace_events) } catch { /* result still carries the complete trace */ }
  if (result.status === "ready") {
    try { if (cacheKey) await options.cache?.put(cacheKey, result) } catch { /* cache is non-authoritative */ }
    try { await options.checkpoint_store?.delete(checkpointHash) } catch { /* stale checkpoint is safe */ }
  }
  return result
}

export function pipelineCheckpointHash(input: CPipelineInput): string {
  return pipelineInputHash({
    generation_spec: input.generation_spec,
    evidence_pack: input.evidence_pack,
    next_round_context: input.next_round_context,
    prior_assessment_items: input.prior_assessment_items,
  })
}

/**
 * 每个阶段单独计算 fingerprint（改进方案4 第 4.3 节）。
 * base 不含外审修订意见（保持"普通故障恢复可复用成功阶段"的性质）；
 * 各 stage 指纹额外并入"该阶段自身"的修订指令 hash 与（下游阶段的）concept 产物 id。
 * 因此：assessment 被质疑只使 assessment 指纹变化，concept/code_lab 指纹不变，仍可复用。
 */
export function stageFingerprint(input: {
  inputHash: string
  blueprintId: string
  stage: "concept" | "code_lab" | "assessment"
  revisionContext?: ReviewRevisionContext
  conceptArtifactId?: string
}): string {
  const base = contentHash({ inputHash: input.inputHash, blueprint: input.blueprintId })
  if (input.stage === "concept") {
    return contentHash({
      base,
      instructions: contentHash(input.revisionContext?.instructions_by_agent.concept_tutor ?? []),
    })
  }
  const instructions = input.stage === "code_lab"
    ? contentHash(input.revisionContext?.instructions_by_agent.code_lab ?? [])
    : contentHash(input.revisionContext?.instructions_by_agent.tiered_evaluator ?? [])
  return contentHash({
    base,
    concept: input.conceptArtifactId ?? "",
    instructions,
  })
}

/**
 * 判断某阶段产物能否从检查点恢复。
 * 外审修订轮（revision_round > 0）fail-closed：缺失 stage_fingerprints /
 * revision_context 的旧检查点不得恢复目标阶段；指纹不匹配同样不恢复。
 */
export function canResumeStage(
  checkpoint: CPipelineCheckpoint | undefined,
  stage: "concept" | "code_lab" | "assessment",
  fingerprint: string,
  revisionContext: ReviewRevisionContext | undefined,
): boolean {
  if (!checkpoint) return false
  const hasStageArtifact = stage === "concept"
    ? checkpoint.concept !== undefined
    : stage === "code_lab"
      ? checkpoint.code_lab !== undefined
      : checkpoint.assessment !== undefined
  if (!hasStageArtifact) return false
  if (!revisionContext || revisionContext.revision_round === 0) return true
  const affected = stage === "concept"
    ? revisionContext.instructions_by_agent.concept_tutor.length > 0
    : stage === "code_lab"
      ? revisionContext.instructions_by_agent.code_lab.length > 0
        || revisionContext.instructions_by_agent.concept_tutor.length > 0
      : revisionContext.instructions_by_agent.tiered_evaluator.length > 0
        || revisionContext.instructions_by_agent.concept_tutor.length > 0
  const storedFingerprint = checkpoint.stage_fingerprints?.[stage]
  // Legacy checkpoints may still provide a valid base candidate for an
  // unaffected stage. A stage targeted by this review round (or downstream of
  // a concept revision) must fail closed when no stage identity is available.
  if (!storedFingerprint) return !affected
  return storedFingerprint === fingerprint
}

/** 构造写入检查点的修订身份 + 阶段指纹字段。 */
function checkpointRevisionFields(
  fingerprints: Partial<CPipelineCheckpoint["stage_fingerprints"]>,
  revisionContext: ReviewRevisionContext | undefined,
): Pick<CPipelineCheckpoint, "stage_fingerprints"> & Pick<CPipelineCheckpoint, "revision_context"> {
  return {
    stage_fingerprints: fingerprints as CPipelineCheckpoint["stage_fingerprints"],
    ...(revisionContext
      ? {
          revision_context: {
            revision_round: revisionContext.revision_round,
            instruction_hash: revisionContext.instruction_hash,
          },
        }
      : {}),
  }
}

function recoveryForAgent(
  input: CPipelineInput,
  agent: "concept" | "code_lab" | "assessment",
): GenerationRecoveryContext | undefined {
  const recovery = input.generation_recovery
  if (!recovery) return undefined
  return recovery.failed_stage === agent
    || recovery.failed_stage === "provider"
    || recovery.failed_stage === "unknown"
    ? recovery
    : undefined
}

function localDependencyId(value: object | undefined): string {
  if (!value) return "none"
  const existing = localDependencyIds.get(value)
  if (existing) return existing
  const created = `local-dependency-${nextLocalDependencyId}`
  nextLocalDependencyId += 1
  localDependencyIds.set(value, created)
  return created
}

function validateNextRoundContext(
  input: CPipelineInput,
): Array<{ path: string; message: string }> {
  const context = input.next_round_context
  if (!context) return []
  const issues: Array<{ path: string; message: string }> = []
  for (const [field, value] of Object.entries({
    request_id: context.request_id,
    parent_spec_id: context.parent_spec_id,
    prior_feedback_ref: context.prior_feedback_ref,
    trigger_grade_artifact_id: context.trigger_grade_artifact_id,
  })) {
    if (typeof value !== "string" || !value.trim()) {
      issues.push({
        path: `$.next_round_context.${field}`,
        message: "必须为非空字符串",
      })
    }
  }
  if (!["remediate", "reinforce", "advance"].includes(context.action)) {
    issues.push({
      path: "$.next_round_context.action",
      message: "必须为 remediate、reinforce 或 advance",
    })
  }
  const targetIds = new Set(input.generation_spec.targets.map((target) =>
    target.objective_id))
  if (!Array.isArray(context.focus_objective_ids)
    || context.focus_objective_ids.length === 0
    || new Set(context.focus_objective_ids).size !== context.focus_objective_ids.length
    || context.focus_objective_ids.some((objectiveId) => !targetIds.has(objectiveId))) {
    issues.push({
      path: "$.next_round_context.focus_objective_ids",
      message: "必须是当前 GenerationSpec 中非空且不重复的目标集合",
    })
  }
  if (!Array.isArray(context.reason_codes)
    || context.reason_codes.length === 0
    || new Set(context.reason_codes).size !== context.reason_codes.length
    || context.reason_codes.some((code) => typeof code !== "string" || !code.trim())) {
    issues.push({
      path: "$.next_round_context.reason_codes",
      message: "必须是非空且不重复的原因码集合",
    })
  }
  if (context.parent_spec_id === input.generation_spec.spec_id) {
    issues.push({
      path: "$.next_round_context.parent_spec_id",
      message: "必须引用上一轮 GenerationSpec",
    })
  }
  return issues
}

function validateAssessmentHistory(
  history: CPipelineInput["prior_assessment_items"],
): Array<{ path: string; message: string }> {
  const issues: Array<{ path: string; message: string }> = []
  if (history !== undefined) {
    if (!Array.isArray(history) || history.some((item) =>
      !item || typeof item !== "object"
      || !item.form_id?.trim()
      || !item.item_id?.trim()
      || !item.objective_id?.trim()
      || !["mcq", "true_false", "trace", "short_answer", "code"].includes(item.modality)
      || !item.prompt?.trim()
      || !Array.isArray(item.options)
      || item.options.some((option) => typeof option !== "string"))) {
      issues.push({
        path: "$.prior_assessment_items",
        message: "必须只包含已发布题面的结构化摘要",
      })
    } else {
      const identities = history.map((item) => `${item.form_id}:${item.item_id}`)
      if (new Set(identities).size !== identities.length) {
        issues.push({
          path: "$.prior_assessment_items",
          message: "历史题目身份不得重复",
        })
      }
    }
  }
  return issues
}

function validateGenerationRecovery(
  recovery: CPipelineInput["generation_recovery"],
): Array<{ path: string; message: string }> {
  if (!recovery) return []
  const validStage = ["concept", "code_lab", "assessment", "provider", "unknown"]
    .includes(recovery.failed_stage)
  const validCodes = Array.isArray(recovery.issue_codes)
    && recovery.issue_codes.length > 0
    && recovery.issue_codes.every((code) => typeof code === "string" && code.trim())
  if (!Number.isSafeInteger(recovery.attempt) || recovery.attempt < 1
    || !validStage || !validCodes || !recovery.failure_fingerprint?.trim()) {
    return [{
      path: "$.generation_recovery",
      message: "必须包含有效的 attempt、failed_stage、issue_codes 和 failure_fingerprint",
    }]
  }
  return []
}

/** 从 pipeline input 构造 feasibility 输入：事实数取 required_fact_ids，事实内容从 evidence_pack 提取。 */
function buildFeasibilityInput(input: CPipelineInput, capacity: AssessmentCapacityPlan): Parameters<typeof planArtifactFeasibility>[0] {
  const factsByRef = new Map<string, Pick<EvidenceFact, "fact_id" | "content" | "capabilities">>()
  for (const item of input.evidence_pack.results) {
    for (const fact of item.facts ?? []) {
      factsByRef.set(`${fact.source_id}:${fact.fact_id}`, {
        fact_id: fact.fact_id,
        content: fact.content,
        ...(fact.capabilities?.length ? { capabilities: [...fact.capabilities] } : {}),
      })
    }
  }
  return {
    objectives: input.generation_spec.targets.map((target) => ({
      objective_id: target.objective_id,
      observable_behavior: target.observable_behavior,
      importance: target.importance,
      fact_refs: target.required_fact_ids.map((factId) => ({ source_id: target.source_id, fact_id: factId })),
      facts: target.required_fact_ids.flatMap((factId) => {
        const fact = factsByRef.get(`${target.source_id}:${factId}`)
        return fact ? [fact] : []
      }),
    })),
    capacity,
  }
}

/**
 * 从 pipeline input 估算测评容量。available_facts 取该 objective 绑定的事实数
 * （required_fact_ids）；used_structures 取历史里同 observation_key 的
 * 去重结构数（operation + reasoning + representation + context + answer form）。
 */
function planAssessmentCapacityForPipeline(input: CPipelineInput): AssessmentCapacityPlan {
  const spec = input.generation_spec
  const history = input.prior_assessment_items ?? []
  const usedStructures = new Map<string, Set<string>>()
  const seenByObservation = new Map<string, number>()
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const item = history[index]!
    const key = item.observation_key ?? item.objective_id
    const seen = seenByObservation.get(key) ?? 0
    if (seen >= STRUCTURAL_NOVELTY_WINDOW) continue
    seenByObservation.set(key, seen + 1)
    if (!item.structure_meta) continue
    const structureSignature = [
      item.structure_meta.operation,
      item.structure_meta.reasoning_pattern,
      item.structure_meta.representation,
      item.structure_meta.context_family,
      item.structure_meta.answer_form,
    ].join("\u0000")
    const set = usedStructures.get(key) ?? new Set<string>()
    set.add(structureSignature)
    usedStructures.set(key, set)
  }
  return planAssessmentCapacity({
    requested: {
      tier_1_count: spec.assessment_blueprint.tier_1_count,
      tier_2_count: spec.assessment_blueprint.tier_2_count,
      tier_3_count: spec.assessment_blueprint.tier_3_count,
      required_modalities: [...spec.assessment_blueprint.required_modalities],
    },
    objectives: spec.targets.map((target) => {
      const observationKey = assessmentObservationKey(target)
      return {
        objective_id: target.objective_id,
        observable_behavior: target.observable_behavior,
        importance: target.importance,
        available_facts: target.required_fact_ids.length,
        used_structures: (usedStructures.get(observationKey)
          ?? usedStructures.get(target.objective_id))?.size ?? 0,
      }
    }),
  })
}

async function runCPipelineCore(
  input: CPipelineInput,
  agents: RoleCAgents,
  secureStore: SecureArtifactStore,
  options: CPipelineOptions,
  inputHash: string,
): Promise<CPipelineResult> {
  let state: CPipelineState = "PLANNED"
  const trace: AgentTraceEvent[] = []
  let seq = options.trace_seq_start ?? 1
  const startedAt = new Map<string, number>()
  const pushTrace = (event: Omit<AgentTraceEvent, "schema_version" | "seq">): void => {
    if (event.event_type === "c.agent.started" && event.agent) startedAt.set(event.agent, performance.now())
    const duration = event.event_type === "c.agent.ready" && event.agent && startedAt.has(event.agent)
      ? Math.max(0, Math.round((performance.now() - startedAt.get(event.agent)!) * 1000) / 1000)
      : undefined
    trace.push(newTraceEvent({
      seq,
      occurred_at: new Date().toISOString(),
      versions: input.generation_spec.versions,
      ...(event.agent ? { attempt: event.attempt ?? 1 } : {}),
      ...(duration !== undefined ? { duration_ms: duration } : {}),
      ...event,
    }))
    seq += 1
  }

  const inputSchemaIssues = [
    ...validateRoleCSchema("generation_spec.schema.json", input.generation_spec).issues,
    ...validateRoleCSchema("rag_evidence_pack.schema.json", input.evidence_pack).issues,
    ...validateNextRoundContext(input),
    ...validateAssessmentHistory(input.prior_assessment_items),
    ...validateGenerationRecovery(input.generation_recovery),
  ]
  if (inputSchemaIssues.length > 0) {
    state = transitionCState(state, "BLOCKED")
    const blockedReason: BlockedReason = {
      code: "BLOCKED_INVALID_OUTPUT",
      message: "Role C 入口消息未通过运行时 Schema",
      details: inputSchemaIssues.map((entry) => `${entry.path}:${entry.message}`),
    }
    pushTrace({
      event_type: "c.pipeline.blocked",
      run_id: input.generation_spec.run_id,
      status: "blocked",
      input_refs: [input.generation_spec.spec_id, input.evidence_pack.retrieval_id],
      summary: blockedReason.message,
      validator_results: [{ validator: "runtime-input-schema", ok: false, issue_count: inputSchemaIssues.length }],
    })
    return blockedResult(input.generation_spec, state, trace, blockedReason)
  }

  const conflictReport = detectEvidenceConflicts(input.evidence_pack, input.generation_spec.run_id)
  if (!conflictReport.ok) {
    if (options.fact_audit_port) {
      try {
        await options.fact_audit_port.sendFactAudits(conflictReport.audit_packets)
      } catch (error) {
        state = transitionCState(state, "FAILED")
        const failure: FailureReason = { code: "PROVIDER_ERROR", message: `FactAudit 发送失败：${errorMessage(error)}` }
        pushTrace({
          event_type: "c.pipeline.failed",
          run_id: input.generation_spec.run_id,
          status: "failed",
          input_refs: [input.generation_spec.spec_id, input.evidence_pack.retrieval_id],
          summary: failure.message,
        })
        return failedResult(
          input.generation_spec,
          state,
          trace,
          failure,
          {},
          conflictReport.audit_packets,
        )
      }
    }
    state = transitionCState(state, "BLOCKED")
    const blockedReason: BlockedReason = {
      code: "BLOCKED_EVIDENCE_CONFLICT",
      message: "evidence_pack 存在事实归属或内容冲突，已生成人工核验包",
      details: conflictReport.issues.map((entry) => entry.message),
    }
    pushTrace({
      event_type: "c.pipeline.blocked",
      run_id: input.generation_spec.run_id,
      status: "blocked",
      input_refs: [input.generation_spec.spec_id, input.evidence_pack.retrieval_id],
      summary: blockedReason.message,
      validator_results: [{ validator: "evidence-conflict", ok: false, issue_count: conflictReport.issues.length }],
    })
    return blockedResult(input.generation_spec, state, trace, blockedReason, {}, conflictReport.audit_packets)
  }

  const evidenceReport = validateSpecEvidence(input.generation_spec, input.evidence_pack)
  if (!evidenceReport.ok) {
    state = transitionCState(state, "BLOCKED")
    const blockedReason: BlockedReason = {
      code: "BLOCKED_MISSING_EVIDENCE",
      message: "GenerationSpec 与 A 的 evidence_pack 不一致或证据不足",
      details: evidenceReport.issues.map((issue) => issue.message),
    }
    pushTrace({
      event_type: "c.pipeline.blocked",
      run_id: input.generation_spec.run_id,
      status: "blocked",
      input_refs: [input.generation_spec.spec_id, input.evidence_pack.retrieval_id],
      summary: blockedReason.message,
    })
    return blockedResult(input.generation_spec, state, trace, blockedReason)
  }

  pushTrace({
    event_type: "c.spec.ready",
    run_id: input.generation_spec.run_id,
    status: "success",
    input_refs: [input.evidence_pack.retrieval_id],
    output_ref: input.generation_spec.spec_id,
    summary: "GenerationSpec 与 evidence_pack 已通过入口校验",
    validator_results: [{ validator: "spec-evidence", ok: true, issue_count: 0 }],
  })
  state = transitionCState(state, "GENERATING")

  // 测评容量规划：生成前先算"证据 + novelty 约束能支撑多少道题"。
  // 连 core objective 都覆盖不了 → 直接 blocked（要求 B replan），而不是让生成模型 retry 到死；
  // 可行题量不足但能覆盖 core → 缩减蓝图，避免 CONTENT_NOT_NOVEL 死循环。
  const capacityPlan = planAssessmentCapacityForPipeline(input)

  // 生成前可行性判断：evidence capability 不足以支撑冻结 behavior 时，
  // 直接 need_evidence（A 补证据）或 need_spec（B 降级），不调用生成模型。
  const feasibilityPlan = planArtifactFeasibility(buildFeasibilityInput(input, capacityPlan))
  if (feasibilityPlan.status === "need_evidence") {
    const missing = feasibilityPlan.objectives
      .flatMap((objective) => objective.missing_support.map((gap) => `[${objective.objective_id}] ${gap}`))
    const blockedReason: BlockedReason = {
      code: "BLOCKED_MISSING_EVIDENCE",
      message: "证据能力不足：当前事实束无法支撑冻结的 observable behavior，需要 A 补齐相应能力事实或由 B 调整目标设计",
      details: missing.slice(0, 8),
    }
    pushTrace({
      event_type: "c.pipeline.blocked",
      run_id: input.generation_spec.run_id,
      status: "blocked",
      input_refs: [input.generation_spec.spec_id, input.evidence_pack.retrieval_id],
      summary: blockedReason.message,
      validator_results: [{ validator: "artifact-feasibility", ok: false, issue_count: missing.length }],
    })
    return blockedResult(input.generation_spec, state, trace, blockedReason)
  }

  if (capacityPlan.decision === "REPLAN") {
    const blockedReason: BlockedReason = {
      code: "BLOCKED_MISSING_EVIDENCE",
      message: "测评容量不足：当前证据与历史约束无法覆盖 core objective，需要 B 重新规划路径或补证据",
      details: [
        `requested=${capacityPlan.requested_items}`,
        `feasible=${capacityPlan.feasible_items}`,
        `limiting=${capacityPlan.limiting_factors.join(",") || "none"}`,
      ],
    }
    pushTrace({
      event_type: "c.pipeline.blocked",
      run_id: input.generation_spec.run_id,
      status: "blocked",
      input_refs: [input.generation_spec.spec_id, input.evidence_pack.retrieval_id],
      summary: blockedReason.message,
      validator_results: [{ validator: "assessment-capacity", ok: false, issue_count: 1 }],
    })
    return blockedResult(input.generation_spec, state, trace, blockedReason)
  }
  if (capacityPlan.decision === "REDUCE" && capacityPlan.adjusted_blueprint) {
    pushTrace({
      event_type: "c.capacity.reduced",
      run_id: input.generation_spec.run_id,
      status: "success",
      input_refs: [input.generation_spec.spec_id],
      summary: `测评容量不足，蓝图题量 ${capacityPlan.requested_items} → ${capacityPlan.feasible_items}（${capacityPlan.limiting_factors.join(",")}）`,
    })
  }

  const resourceBlueprint = buildResourceBlueprint(
    input.generation_spec,
    input.evidence_pack,
    {
      assessment_blueprint: capacityPlan.adjusted_blueprint
        ?? input.generation_spec.assessment_blueprint,
      assessment_capacity: capacityPlan,
    },
  )

  let checkpoint: CPipelineCheckpoint | undefined
  try {
    const loaded = await options.checkpoint_store?.load(inputHash)
    checkpoint = loaded && checkpointIssues(loaded, input, inputHash, resourceBlueprint).length === 0 ? loaded : undefined
  } catch { checkpoint = undefined }

  const revisionContext = options.review_revision_context
  const conceptFingerprint = stageFingerprint({
    inputHash,
    blueprintId: resourceBlueprint.blueprint_id,
    stage: "concept",
    revisionContext,
  })

  let roundSemanticPlan: RoundSemanticPlan | undefined = checkpoint?.round_semantic_plan
  if (!roundSemanticPlan && options.semantic_planner) {
    roundSemanticPlan = await options.semantic_planner.plan({
      spec: input.generation_spec,
      evidence: input.evidence_pack,
      blueprint: resourceBlueprint,
    })
  }
  const checkpointMetadata: NonNullable<CPipelineCheckpoint["metadata"]> = {
    spec_id: input.generation_spec.spec_id,
    blueprint_id: resourceBlueprint.blueprint_id,
    model_id: input.generation_spec.versions.model_config_hash,
    prompt_version: input.generation_spec.versions.prompt_version,
    policy_version: resourceBlueprint.quality_requirement.policy_version,
    policy_decision_hash: resourceBlueprint.quality_requirement.decision_hash,
    evidence_hash: input.generation_spec.evidence_content_hash,
    created_at: new Date().toISOString(),
  }
  if (roundSemanticPlan && !checkpoint?.round_semantic_plan) {
    try {
      await options.checkpoint_store?.save({
        input_hash: inputHash,
        stage: "semantic_plan_ready",
        round_semantic_plan: roundSemanticPlan,
        metadata: checkpointMetadata,
      })
      checkpoint = {
        input_hash: inputHash,
        stage: "semantic_plan_ready",
        round_semantic_plan: roundSemanticPlan,
        metadata: checkpointMetadata,
      }
    } catch { /* checkpoint is non-authoritative */ }
  }

  pushTrace({
    event_type: "c.agent.started",
    run_id: input.generation_spec.run_id,
    agent: "concept-tutor",
    status: "started",
    input_refs: [input.generation_spec.spec_id, input.evidence_pack.retrieval_id],
    summary: "concept-tutor 开始生成讲义",
    ...(checkpoint?.concept ? { retry_kind: "resume" as const } : {}),
  })
  let concept: ConceptLessonArtifact
  try {
    const resumeConcept = canResumeStage(checkpoint, "concept", conceptFingerprint, revisionContext)
    concept = resumeConcept
      ? checkpoint!.concept!
      : await agents.concept_tutor.generate({
          generation_spec: input.generation_spec,
          evidence_pack: input.evidence_pack,
          next_round_context: input.next_round_context,
          resource_blueprint: resourceBlueprint,
          round_semantic_plan: roundSemanticPlan,
          generation_recovery: recoveryForAgent(input, "concept"),
        })
    if (!resumeConcept && concept.status === "ready") {
      try {
        await options.checkpoint_store?.save({
          input_hash: inputHash,
          stage: "concept_ready",
          concept,
          metadata: checkpointMetadata,
          ...(roundSemanticPlan ? { round_semantic_plan: roundSemanticPlan } : {}),
          ...checkpointRevisionFields({ concept: conceptFingerprint }, revisionContext),
        })
      } catch { /* checkpoint is non-authoritative */ }
    }
  } catch (error) {
    const qualityReason = publicQualityBlockedReason(error)
    if (qualityReason) {
      state = transitionCState(state, "BLOCKED")
      return blockedResult(input.generation_spec, state, trace, qualityReason)
    }
    state = transitionCState(state, "FAILED")
    const failure: FailureReason = { code: "PROVIDER_ERROR", message: errorMessage(error) }
    pushTrace({
      event_type: "c.pipeline.failed",
      run_id: input.generation_spec.run_id,
      agent: "concept-tutor",
      status: "failed",
      input_refs: [input.generation_spec.spec_id, input.evidence_pack.retrieval_id],
      summary: failure.message,
    })
    return failedResult(input.generation_spec, state, trace, failure)
  }
  if (concept.status !== "ready") {
    state = transitionCState(state, "BLOCKED")
    pushTrace({
      event_type: "c.pipeline.blocked",
      run_id: input.generation_spec.run_id,
      agent: "concept-tutor",
      status: "blocked",
      input_refs: concept.input_refs,
      output_ref: concept.artifact_id,
      summary: concept.blocked_reason?.message ?? "concept-tutor 未就绪",
    })
    return blockedResult(
      input.generation_spec,
      state,
      trace,
      concept.blocked_reason ?? { code: "BLOCKED_PROVIDER_UNAVAILABLE", message: "concept-tutor 未就绪" },
      { concept_lesson: concept },
    )
  }
  pushTrace({
    event_type: "c.agent.ready",
    run_id: input.generation_spec.run_id,
    agent: "concept-tutor",
    status: "success",
    input_refs: concept.input_refs,
    output_ref: concept.artifact_id,
    summary: "concept-tutor 讲义产物已就绪",
    validator_results: [{ validator: "concept-structure-grounding", ok: true, issue_count: 0 }],
  })

  let labPair: CodeLabArtifactPair
  let assessmentPair: AssessmentArtifactPair
  const codeLabFingerprint = stageFingerprint({
    inputHash,
    blueprintId: resourceBlueprint.blueprint_id,
    stage: "code_lab",
    revisionContext,
    conceptArtifactId: concept.artifact_id,
  })
  const assessmentFingerprint = stageFingerprint({
    inputHash,
    blueprintId: resourceBlueprint.blueprint_id,
    stage: "assessment",
    revisionContext,
    conceptArtifactId: concept.artifact_id,
  })
  const resumedBranches = checkpoint?.stage === "branches_ready"
    && checkpoint.code_lab !== undefined
    && checkpoint.assessment !== undefined
    && canResumeStage(checkpoint, "code_lab", codeLabFingerprint, revisionContext)
    && canResumeStage(checkpoint, "assessment", assessmentFingerprint, revisionContext)
  const resumedCodeLab = checkpoint?.code_lab !== undefined
    && (checkpoint.stage === "code_lab_ready" || checkpoint.stage === "branches_ready")
    && canResumeStage(checkpoint, "code_lab", codeLabFingerprint, revisionContext)
  const resumedAssessment = checkpoint?.assessment !== undefined
    && (checkpoint.stage === "assessment_ready" || checkpoint.stage === "branches_ready")
    && canResumeStage(checkpoint, "assessment", assessmentFingerprint, revisionContext)
  if (resumedBranches) {
    labPair = checkpoint!.code_lab!
    assessmentPair = checkpoint!.assessment!
    for (const agent of ["code-lab", "tiered-evaluator"] as const) {
      pushTrace({
        event_type: "c.agent.started",
        run_id: input.generation_spec.run_id,
        agent,
        status: "started",
        input_refs: [input.generation_spec.spec_id, input.evidence_pack.retrieval_id, concept.artifact_id],
        summary: `${agent} 从已验证检查点恢复`,
        retry_kind: "resume",
      })
    }
  } else {
    for (const [agent, resumed] of [
      ["code-lab", resumedCodeLab],
      ["tiered-evaluator", resumedAssessment],
    ] as const) {
      pushTrace({
        event_type: "c.agent.started",
        run_id: input.generation_spec.run_id,
        agent,
        status: "started",
        input_refs: [input.generation_spec.spec_id, input.evidence_pack.retrieval_id, concept.artifact_id],
        summary: resumed ? `${agent} 从已验证检查点恢复` : `${agent} 开始并行生成`,
        ...(resumed ? { retry_kind: "resume" as const } : {}),
      })
    }
    const [labOutcome, assessmentOutcome] = await Promise.allSettled([
      resumedCodeLab
        ? Promise.resolve(checkpoint!.code_lab!)
        : agents.code_lab.generate({
            generation_spec: input.generation_spec,
            evidence_pack: input.evidence_pack,
            concept_artifact: concept,
            next_round_context: input.next_round_context,
            resource_blueprint: resourceBlueprint,
            round_semantic_plan: roundSemanticPlan,
            generation_recovery: recoveryForAgent(input, "code_lab"),
          }),
      resumedAssessment
        ? Promise.resolve(checkpoint!.assessment!)
        : agents.tiered_evaluator.generate({
            generation_spec: input.generation_spec,
            evidence_pack: input.evidence_pack,
            concept_artifact: concept,
            next_round_context: input.next_round_context,
            prior_assessment_items: input.prior_assessment_items,
            resource_blueprint: resourceBlueprint,
            round_semantic_plan: roundSemanticPlan,
            generation_recovery: recoveryForAgent(input, "assessment"),
          }),
    ])
    if (labOutcome.status === "rejected" || assessmentOutcome.status === "rejected") {
      const failedAgent = labOutcome.status === "rejected" ? "code-lab" : "tiered-evaluator"
      const error = labOutcome.status === "rejected"
        ? labOutcome.reason
        : assessmentOutcome.status === "rejected"
          ? assessmentOutcome.reason
          : new Error("C 并行分支失败")
      if (labOutcome.status === "fulfilled" && codeLabPairReady(labOutcome.value) && !resumedCodeLab) {
        try {
          await options.checkpoint_store?.save({
            input_hash: inputHash,
            stage: "code_lab_ready",
            concept,
            code_lab: labOutcome.value,
            metadata: checkpointMetadata,
            ...(roundSemanticPlan ? { round_semantic_plan: roundSemanticPlan } : {}),
            ...checkpointRevisionFields({ concept: conceptFingerprint, code_lab: codeLabFingerprint }, revisionContext),
          })
        } catch { /* checkpoint is non-authoritative */ }
      } else if (assessmentOutcome.status === "fulfilled" && assessmentPairReady(assessmentOutcome.value) && !resumedAssessment) {
        try {
          await options.checkpoint_store?.save({
            input_hash: inputHash,
            stage: "assessment_ready",
            concept,
            assessment: assessmentOutcome.value,
            metadata: checkpointMetadata,
            ...(roundSemanticPlan ? { round_semantic_plan: roundSemanticPlan } : {}),
            ...checkpointRevisionFields({ concept: conceptFingerprint, assessment: assessmentFingerprint }, revisionContext),
          })
        } catch { /* checkpoint is non-authoritative */ }
      }
      const qualityReason = publicQualityBlockedReason(error)
      if (qualityReason) {
        state = transitionCState(state, "BLOCKED")
        return blockedResult(input.generation_spec, state, trace, qualityReason, {
          concept_lesson: concept,
          ...(labOutcome.status === "fulfilled" ? { code_lab: labOutcome.value.public_artifact } : {}),
          ...(assessmentOutcome.status === "fulfilled" ? { assessment: assessmentOutcome.value.public_artifact } : {}),
        })
      }
      state = transitionCState(state, "FAILED")
      const failure: FailureReason = { code: "PROVIDER_ERROR", message: errorMessage(error) }
      pushTrace({
        event_type: "c.pipeline.failed",
        run_id: input.generation_spec.run_id,
        agent: failedAgent,
        status: "failed",
        input_refs: [input.generation_spec.spec_id, input.evidence_pack.retrieval_id, concept.artifact_id],
        summary: failure.message,
      })
      return failedResult(input.generation_spec, state, trace, failure, {
        concept_lesson: concept,
        ...(labOutcome.status === "fulfilled"
          ? { code_lab: labOutcome.value.public_artifact }
          : {}),
        ...(assessmentOutcome.status === "fulfilled"
          ? { assessment: assessmentOutcome.value.public_artifact }
          : {}),
      })
    }
    labPair = labOutcome.value
    assessmentPair = assessmentOutcome.value
    const blockedLab = [labPair.public_artifact, labPair.secure_artifact]
      .find((artifact) => artifact.status !== "ready")
    if (blockedLab) {
      if (!resumedAssessment && assessmentPairReady(assessmentPair)) {
        try {
          await options.checkpoint_store?.save({
            input_hash: inputHash,
            stage: "assessment_ready",
            concept,
            assessment: assessmentPair,
            metadata: checkpointMetadata,
            ...(roundSemanticPlan ? { round_semantic_plan: roundSemanticPlan } : {}),
            ...checkpointRevisionFields({ concept: conceptFingerprint, assessment: assessmentFingerprint }, revisionContext),
          })
        } catch { /* checkpoint is non-authoritative */ }
      }
      state = transitionCState(state, "BLOCKED")
      pushTrace({
        event_type: "c.pipeline.blocked",
        run_id: input.generation_spec.run_id,
        agent: "code-lab",
        status: "blocked",
        input_refs: blockedLab.input_refs,
        output_ref: blockedLab.artifact_id,
        summary: blockedLab.blocked_reason?.message ?? "code-lab 产物未就绪",
      })
      return blockedResult(
        input.generation_spec,
        state,
        trace,
        blockedLab.blocked_reason
          ?? { code: "BLOCKED_PROVIDER_UNAVAILABLE", message: "code-lab 产物未就绪" },
        { concept_lesson: concept, code_lab: labPair.public_artifact },
      )
    }
    const blockedAssessment = [
      assessmentPair.public_artifact,
      assessmentPair.secure_artifact,
    ].find((artifact) => artifact.status !== "ready")
    if (blockedAssessment) {
      if (!resumedCodeLab && codeLabPairReady(labPair)) {
        try {
          await options.checkpoint_store?.save({
            input_hash: inputHash,
            stage: "code_lab_ready",
            concept,
            code_lab: labPair,
            metadata: checkpointMetadata,
            ...(roundSemanticPlan ? { round_semantic_plan: roundSemanticPlan } : {}),
            ...checkpointRevisionFields({ concept: conceptFingerprint, code_lab: codeLabFingerprint }, revisionContext),
          })
        } catch { /* checkpoint is non-authoritative */ }
      }
      state = transitionCState(state, "BLOCKED")
      pushTrace({
        event_type: "c.pipeline.blocked",
        run_id: input.generation_spec.run_id,
        agent: "tiered-evaluator",
        status: "blocked",
        input_refs: blockedAssessment.input_refs,
        output_ref: blockedAssessment.artifact_id,
        summary: blockedAssessment.blocked_reason?.message
          ?? "tiered-evaluator 产物未就绪",
      })
      return blockedResult(
        input.generation_spec,
        state,
        trace,
        blockedAssessment.blocked_reason
          ?? { code: "BLOCKED_PROVIDER_UNAVAILABLE", message: "tiered-evaluator 产物未就绪" },
        {
          concept_lesson: concept,
          code_lab: labPair.public_artifact,
          assessment: assessmentPair.public_artifact,
        },
      )
    }
    for (const [agent, artifact, validator, resumed] of [
      ["code-lab", labPair.public_artifact, "code-lab-structure-execution", resumedCodeLab],
      ["tiered-evaluator", assessmentPair.public_artifact, "assessment-structure-answer", resumedAssessment],
    ] as const) {
      pushTrace({
        event_type: "c.agent.ready",
        run_id: input.generation_spec.run_id,
        agent,
        status: "success",
        input_refs: artifact.input_refs,
        output_ref: artifact.artifact_id,
        summary: resumed
          ? `${agent} public/secure 产物已从检查点恢复`
          : `${agent} public/secure 产物已通过发布前检查`,
        validator_results: [{ validator, ok: true, issue_count: 0 }],
      })
    }
    try {
      await options.checkpoint_store?.save({
        input_hash: inputHash,
        stage: "branches_ready",
        concept,
        code_lab: labPair,
        assessment: assessmentPair,
        metadata: checkpointMetadata,
        ...(roundSemanticPlan ? { round_semantic_plan: roundSemanticPlan } : {}),
        ...checkpointRevisionFields({ concept: conceptFingerprint, code_lab: codeLabFingerprint, assessment: assessmentFingerprint }, revisionContext),
      })
    } catch { /* checkpoint is non-authoritative */ }
  }

  let publicArtifacts = {
    concept_lesson: concept,
    code_lab: labPair.public_artifact,
    assessment: assessmentPair.public_artifact,
  }
  const blockedArtifact = [
    labPair.public_artifact,
    labPair.secure_artifact,
    assessmentPair.public_artifact,
    assessmentPair.secure_artifact,
  ].find((artifact) => artifact.status !== "ready")
  if (blockedArtifact) {
    state = transitionCState(state, "BLOCKED")
    pushTrace({
      event_type: "c.pipeline.blocked",
      run_id: input.generation_spec.run_id,
      agent: blockedArtifact.agent,
      status: "blocked",
      input_refs: blockedArtifact.input_refs,
      output_ref: blockedArtifact.artifact_id,
      summary: blockedArtifact.blocked_reason?.message ?? "C 分支产物未就绪",
    })
    return blockedResult(
      input.generation_spec,
      state,
      trace,
      blockedArtifact.blocked_reason ?? { code: "BLOCKED_PROVIDER_UNAVAILABLE", message: "C 分支产物未就绪" },
      publicArtifacts,
    )
  }

  if (resumedBranches) {
    pushTrace({
      event_type: "c.agent.ready",
      run_id: input.generation_spec.run_id,
      agent: "code-lab",
      status: "success",
      input_refs: labPair.public_artifact.input_refs,
      output_ref: labPair.public_artifact.artifact_id,
      summary: "code-lab public/secure 产物已从检查点恢复",
      validator_results: [{ validator: "code-lab-structure-execution", ok: true, issue_count: 0 }],
    })
    pushTrace({
      event_type: "c.agent.ready",
      run_id: input.generation_spec.run_id,
      agent: "tiered-evaluator",
      status: "success",
      input_refs: assessmentPair.public_artifact.input_refs,
      output_ref: assessmentPair.public_artifact.artifact_id,
      summary: "tiered-evaluator public/secure 产物已从检查点恢复",
      validator_results: [{ validator: "assessment-structure-answer", ok: true, issue_count: 0 }],
    })
  }

  state = transitionCState(state, "VALIDATING")
  const alignmentInput = {
    spec: input.generation_spec,
    concept,
    lab: labPair.public_artifact,
    assessment: assessmentPair.public_artifact,
    lab_secure: labPair.secure_artifact,
    assessment_secure: assessmentPair.secure_artifact,
  }
  let criticObjections = validateCrossArtifactAlignment(alignmentInput).objections
  if (options.critic) {
    try {
      criticObjections = [
        ...criticObjections,
        ...asDiagnosticObjections(await options.critic.review(alignmentInput)),
      ]
    } catch { /* optional semantic diagnostics do not affect publication */ }
  }
  let alignmentReport = reportFromObjections(input.generation_spec, criticObjections)
  if (!alignmentReport.ok) {
    state = transitionCState(state, "REVISING")
    pushTrace({
      event_type: "c.validation.failed",
      run_id: input.generation_spec.run_id,
      status: "started",
      input_refs: [concept.artifact_id, labPair.public_artifact.artifact_id, assessmentPair.public_artifact.artifact_id],
      summary: `跨产物门禁发现 ${alignmentReport.objections.length} 项问题，开始唯一一次定向修订`,
      retry_kind: "semantic_revision",
      attempt: 1,
      validator_results: [{ validator: "cross-artifact-critic", ok: false, issue_count: alignmentReport.objections.length }],
    })

    const blockingObjections = alignmentReport.objections.filter((entry) =>
      entry.severity === "critical")
    const conceptNeedsRevision = blockingObjections.some((entry) =>
      entry.target_artifact_id === concept.artifact_id)
    const labNeedsRevision = conceptNeedsRevision || blockingObjections.some((entry) =>
      entry.target_artifact_id === labPair.public_artifact.artifact_id || entry.target_artifact_id === labPair.secure_artifact.artifact_id)
    const assessmentNeedsRevision = conceptNeedsRevision || labNeedsRevision || blockingObjections.some((entry) =>
      entry.target_artifact_id === assessmentPair.public_artifact.artifact_id || entry.target_artifact_id === assessmentPair.secure_artifact.artifact_id)
    try {
      if (conceptNeedsRevision) {
        concept = await agents.concept_tutor.generate({
          generation_spec: input.generation_spec,
          evidence_pack: input.evidence_pack,
          next_round_context: input.next_round_context,
          revision_objections: blockingObjections.filter((entry) => entry.target_artifact_id === concept.artifact_id),
          resource_blueprint: resourceBlueprint,
          round_semantic_plan: roundSemanticPlan,
          generation_recovery: recoveryForAgent(input, "concept"),
        })
      }
      if (labNeedsRevision) {
        labPair = await agents.code_lab.generate({
          generation_spec: input.generation_spec,
          evidence_pack: input.evidence_pack,
          concept_artifact: concept,
          next_round_context: input.next_round_context,
          revision_objections: blockingObjections.filter((entry) =>
            entry.target_artifact_id === labPair.public_artifact.artifact_id
              || entry.target_artifact_id === labPair.secure_artifact.artifact_id),
          resource_blueprint: resourceBlueprint,
          round_semantic_plan: roundSemanticPlan,
          generation_recovery: recoveryForAgent(input, "code_lab"),
        })
      }
      if (assessmentNeedsRevision) {
        assessmentPair = await agents.tiered_evaluator.generate({
          generation_spec: input.generation_spec,
          evidence_pack: input.evidence_pack,
          concept_artifact: concept,
          next_round_context: input.next_round_context,
          prior_assessment_items: input.prior_assessment_items,
          code_lab_summary: toCodeLabSummary(labPair),
          revision_objections: blockingObjections.filter((entry) =>
            entry.target_artifact_id === assessmentPair.public_artifact.artifact_id
              || entry.target_artifact_id === assessmentPair.secure_artifact.artifact_id),
          resource_blueprint: resourceBlueprint,
          round_semantic_plan: roundSemanticPlan,
          generation_recovery: recoveryForAgent(input, "assessment"),
        })
      }
    } catch (error) {
      const qualityReason = publicQualityBlockedReason(error)
      if (qualityReason) {
        state = transitionCState(state, "BLOCKED")
        return blockedResult(input.generation_spec, state, trace, qualityReason, publicArtifacts)
      }
      state = transitionCState(state, "FAILED")
      const failure: FailureReason = { code: "PROVIDER_ERROR", message: errorMessage(error) }
      pushTrace({
        event_type: "c.pipeline.failed",
        run_id: input.generation_spec.run_id,
        status: "failed",
        input_refs: [concept.artifact_id, labPair.public_artifact.artifact_id, assessmentPair.public_artifact.artifact_id],
        summary: `定向修订失败：${failure.message}`,
        retry_kind: "semantic_revision",
        attempt: 1,
      })
      return failedResult(input.generation_spec, state, trace, failure, publicArtifacts)
    }

    publicArtifacts = { concept_lesson: concept, code_lab: labPair.public_artifact, assessment: assessmentPair.public_artifact }
    const revisedBlocked = [concept, labPair.public_artifact, labPair.secure_artifact, assessmentPair.public_artifact, assessmentPair.secure_artifact]
      .find((artifact) => artifact.status !== "ready")
    if (revisedBlocked) {
      state = transitionCState(state, "BLOCKED")
      const blockedReason = revisedBlocked.blocked_reason
        ?? { code: "BLOCKED_INVALID_OUTPUT" as const, message: "定向修订产物未通过自身门禁" }
      pushTrace({
        event_type: "c.pipeline.blocked",
        run_id: input.generation_spec.run_id,
        agent: revisedBlocked.agent,
        status: "blocked",
        input_refs: revisedBlocked.input_refs,
        output_ref: revisedBlocked.artifact_id,
        summary: blockedReason.message,
        retry_kind: "semantic_revision",
        attempt: 1,
      })
      return blockedResult(
        input.generation_spec,
        state,
        trace,
        blockedReason,
        publicArtifacts,
      )
    }
    state = transitionCState(state, "VALIDATING")
    const revisedAlignmentInput = {
      spec: input.generation_spec,
      concept,
      lab: labPair.public_artifact,
      assessment: assessmentPair.public_artifact,
      lab_secure: labPair.secure_artifact,
      assessment_secure: assessmentPair.secure_artifact,
    }
    let revisedObjections = validateCrossArtifactAlignment(revisedAlignmentInput).objections
    if (options.critic) {
      try {
        revisedObjections = [
          ...revisedObjections,
          ...asDiagnosticObjections(await options.critic.review(revisedAlignmentInput)),
        ]
      } catch { /* optional semantic diagnostics do not affect publication */ }
    }
    alignmentReport = reportFromObjections(input.generation_spec, revisedObjections)
    if (!alignmentReport.ok) {
      state = transitionCState(state, "BLOCKED")
      const blockedReason: BlockedReason = {
        code: "BLOCKED_ALIGNMENT_FAILURE",
        message: "唯一一次定向修订后仍存在关键对齐问题",
        details: alignmentReport.objections.map((entry) => `${entry.objective_id}:${entry.issue_type}`),
      }
      pushTrace({
        event_type: "c.pipeline.blocked",
        run_id: input.generation_spec.run_id,
        status: "blocked",
        input_refs: [concept.artifact_id, labPair.public_artifact.artifact_id, assessmentPair.public_artifact.artifact_id],
        summary: blockedReason.message,
      })
      return { ...blockedResult(input.generation_spec, state, trace, blockedReason, publicArtifacts), alignment_report: alignmentReport }
    }
  }

  for (const artifact of [concept, labPair.public_artifact, labPair.secure_artifact, assessmentPair.public_artifact, assessmentPair.secure_artifact]) {
    artifact.quality.alignment_score = alignmentReport.alignment_score
  }

  let secureRefs: string[]
  try {
    secureRefs = await secureStore.putBatch(
      [labPair.secure_artifact, assessmentPair.secure_artifact],
      { principal: "role-c-pipeline", run_id: input.generation_spec.run_id },
    )
    if (secureRefs.length !== 2 || new Set(secureRefs).size !== 2) {
      try { await secureStore.deleteBatch(secureRefs, { principal: "role-c-pipeline", run_id: input.generation_spec.run_id }) } catch { /* bad store result is already fatal */ }
      throw new Error("secure store 未原子返回两份不同的私有产物引用")
    }
  } catch (error) {
    state = transitionCState(state, "FAILED")
    const failure: FailureReason = { code: "SECURE_STORE_ERROR", message: errorMessage(error) }
    pushTrace({
      event_type: "c.pipeline.failed",
      run_id: input.generation_spec.run_id,
      status: "failed",
      input_refs: [labPair.secure_artifact.artifact_id, assessmentPair.secure_artifact.artifact_id],
      summary: failure.message,
    })
    return failedResult(input.generation_spec, state, trace, failure, publicArtifacts)
  }
  state = transitionCState(state, "READY")
  pushTrace({
    event_type: "c.pipeline.ready",
    run_id: input.generation_spec.run_id,
    status: "success",
    input_refs: [concept.artifact_id, labPair.public_artifact.artifact_id, assessmentPair.public_artifact.artifact_id],
    summary: "公开产物已就绪；私有产物只返回安全存储引用",
  })
  return {
    status: "ready",
    state,
    generation_spec: input.generation_spec,
    resource_blueprint: resourceBlueprint,
    public_artifacts: publicArtifacts,
    secure_refs: secureRefs,
    alignment_report: alignmentReport,
    trace_events: trace,
    fact_audit_packets: [],
  }
}

export function publicQualityBlockedReason(error: unknown): BlockedReason | undefined {
  if (!(error instanceof PublicQualityGateError)) return undefined
  const details = [...new Set(error.evaluations.flatMap((evaluation) =>
    evaluation.critical_findings))]
  return {
    code: "BLOCKED_INVALID_OUTPUT",
    message: error.message,
    ...(details.length > 0 ? { details } : {}),
  }
}

function toCodeLabSummary(
  pair: CodeLabArtifactPair,
): TieredEvaluatorRequest["code_lab_summary"] {
  const payload = pair.public_artifact.payload
  if (!payload) return undefined
  return {
    lab_id: payload.lab_id,
    objective_ids: [...payload.objective_ids],
    execution_verified: pair.public_artifact.quality.execution_verified === true,
  }
}

function codeLabPairReady(pair: CodeLabArtifactPair): boolean {
  return pair.public_artifact.status === "ready" && pair.secure_artifact.status === "ready"
}

function assessmentPairReady(pair: AssessmentArtifactPair): boolean {
  return pair.public_artifact.status === "ready" && pair.secure_artifact.status === "ready"
}

function cachedResultIssues(
  cached: CPipelineResult,
  input: CPipelineInput,
  secureArtifacts: SecureArtifact[],
): string[] {
  const issues: string[] = []
  if (cached.status !== "ready" || cached.state !== "READY") issues.push("cached result 未处于 READY")
  if (cached.generation_spec.run_id !== input.generation_spec.run_id
    || cached.generation_spec.spec_id !== input.generation_spec.spec_id
    || cached.generation_spec.evidence_ref !== input.evidence_pack.retrieval_id) {
    issues.push("cached result 与当前输入身份不一致")
  }
  const publicArtifacts = [
    [cached.public_artifacts.concept_lesson, "concept_artifact.schema.json"],
    [cached.public_artifacts.code_lab, "code_lab_public.schema.json"],
    [cached.public_artifacts.assessment, "assessment_public.schema.json"],
  ] as const
  for (const [artifact, schema] of publicArtifacts) {
    if (!artifact || artifact.status !== "ready" || artifact.run_id !== input.generation_spec.run_id) {
      issues.push(`${schema} 缺失或身份无效`)
      continue
    }
    issues.push(...validateRoleCSchema(schema, artifact).issues.map((entry) => `${schema}:${entry.path}`))
    issues.push(...validatePublicArtifactNoSecrets(artifact).issues.map((entry) => `${schema}:${entry.path}`))
  }
  if (secureArtifacts.length !== 2
    || !sameStringSet(secureArtifacts.map((artifact) => artifact.artifact_type), ["code_lab_secure", "assessment_secure"])) {
    issues.push("cached secure refs 未解析为一份实验和一份测评私有产物")
  }
  if (!cached.alignment_report?.ok) issues.push("cached result 缺少通过的 alignment report")
  for (const event of cached.trace_events) {
    if (event.run_id !== input.generation_spec.run_id || !validateRoleCSchema("agent_trace_event.schema.json", event).ok) {
      issues.push("cached trace 无效")
    }
  }
  return issues
}

function checkpointIssues(
  checkpoint: CPipelineCheckpoint,
  input: CPipelineInput,
  inputHash: string,
  expectedBlueprint?: ResourceBlueprint,
): string[] {
  const issues: string[] = []
  if (checkpoint.input_hash !== inputHash) issues.push("checkpoint input_hash 不一致")
  if (checkpoint.metadata) {
    const blueprint = expectedBlueprint
      ?? buildResourceBlueprint(input.generation_spec, input.evidence_pack)
    if (checkpoint.metadata.spec_id !== input.generation_spec.spec_id
      || checkpoint.metadata.blueprint_id !== blueprint.blueprint_id
      || checkpoint.metadata.model_id !== input.generation_spec.versions.model_config_hash
      || checkpoint.metadata.prompt_version !== input.generation_spec.versions.prompt_version
      || checkpoint.metadata.policy_version !== blueprint.quality_requirement.policy_version
      || checkpoint.metadata.policy_decision_hash !== blueprint.quality_requirement.decision_hash
      || checkpoint.metadata.evidence_hash !== input.generation_spec.evidence_content_hash) {
      issues.push("checkpoint 依赖元数据已失效")
    }
  }
  if (checkpoint.round_semantic_plan
    && (checkpoint.round_semantic_plan.spec_id !== input.generation_spec.spec_id
      || checkpoint.round_semantic_plan.blueprint_id !== (expectedBlueprint
        ?? buildResourceBlueprint(input.generation_spec, input.evidence_pack)).blueprint_id)) {
    issues.push("checkpoint 语义规划依赖已失效")
  }
  if (checkpoint.stage === "semantic_plan_ready" && !checkpoint.round_semantic_plan) {
    issues.push("semantic_plan_ready checkpoint 缺少语义规划")
  }
  const artifacts: Array<[unknown, "concept_artifact.schema.json" | "code_lab_public.schema.json" | "code_lab_secure.schema.json" | "assessment_public.schema.json" | "assessment_secure.schema.json"]> = []
  if (checkpoint.stage !== "semantic_plan_ready") {
    if (!checkpoint.concept) issues.push(`${checkpoint.stage} checkpoint 缺少讲义产物`)
    else artifacts.push([checkpoint.concept, "concept_artifact.schema.json"])
  }
  if (checkpoint.stage === "code_lab_ready" || checkpoint.stage === "branches_ready") {
    if (!checkpoint.code_lab) issues.push(`${checkpoint.stage} checkpoint 缺少代码实验分支`)
    else artifacts.push(
      [checkpoint.code_lab.public_artifact, "code_lab_public.schema.json"],
      [checkpoint.code_lab.secure_artifact, "code_lab_secure.schema.json"],
    )
  }
  if (checkpoint.stage === "assessment_ready" || checkpoint.stage === "branches_ready") {
    if (!checkpoint.assessment) issues.push(`${checkpoint.stage} checkpoint 缺少测评分支`)
    else artifacts.push(
      [checkpoint.assessment.public_artifact, "assessment_public.schema.json"],
      [checkpoint.assessment.secure_artifact, "assessment_secure.schema.json"],
    )
  }
  for (const [value, schema] of artifacts) {
    const artifact = value as { run_id?: string; status?: string; input_refs?: string[] }
    if (artifact.run_id !== input.generation_spec.run_id || artifact.status !== "ready"
      || !artifact.input_refs?.includes(input.generation_spec.spec_id)
      || !validateRoleCSchema(schema, value).ok) {
      issues.push(`${schema} checkpoint 产物无效`)
    }
  }
  return issues
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  const leftSet = new Set(left)
  const rightSet = new Set(right)
  return leftSet.size === left.length && rightSet.size === right.length
    && leftSet.size === rightSet.size && [...leftSet].every((value) => rightSet.has(value))
}

function asDiagnosticObjections(
  objections: AlignmentObjection[],
): AlignmentObjection[] {
  return objections.map((objection) => ({
    ...objection,
    severity: "warning",
  }))
}

function failedResult(
  spec: GenerationSpec,
  state: CPipelineState,
  trace: AgentTraceEvent[],
  reason: FailureReason,
  publicArtifacts: CPipelineResult["public_artifacts"] = {},
  factAuditPackets: FactAuditPacket[] = [],
): CPipelineResult {
  return {
    status: "failed",
    state,
    generation_spec: spec,
    public_artifacts: publicArtifacts,
    secure_refs: [],
    trace_events: trace,
    fact_audit_packets: factAuditPackets,
    failure_reason: reason,
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "C 内部依赖调用失败"
}

function blockedResult(
  spec: GenerationSpec,
  state: CPipelineState,
  trace: AgentTraceEvent[],
  reason: BlockedReason,
  publicArtifacts: CPipelineResult["public_artifacts"] = {},
  factAuditPackets: FactAuditPacket[] = [],
): CPipelineResult {
  return {
    status: "blocked",
    state,
    generation_spec: spec,
    public_artifacts: publicArtifacts,
    secure_refs: [],
    trace_events: trace,
    fact_audit_packets: factAuditPackets,
    blocked_reason: reason,
  }
}
