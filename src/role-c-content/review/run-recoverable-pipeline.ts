import type { RoleCAgents } from "../agents/types"
import {
  C_SCHEMA_VERSION,
  contentHash,
  stableId,
} from "../contracts/common"
import {
  requestEvidenceRefresh,
  type EvidenceGapRequest,
  type EvidenceRefreshPort,
  type RagEvidencePack,
} from "../contracts/evidence-pack"
import {
  buildGenerationSpec,
  type BuildGenerationSpecResult,
  type GenerationSpec,
} from "../contracts/generation-spec"
import type {
  LearnerProfileSnapshot,
  LearningPathNode,
} from "../contracts/profile-adapter"
import type {
  RoleBPathDraft,
  RoleBPathPlanningPort,
  RoleBPathPlanningRequest,
  RoleBPathPlanningResult,
} from "../contracts/recovery"
import type { CPipelineInput } from "../orchestrator/content-pipeline"
import type { SecureArtifactStore } from "../security/secure-artifact-store"
import { validateRoleCSchema } from "../validators/runtime-schema-validator"
import { runReviewedCPipeline } from "./run-reviewed-pipeline"
import type {
  ContentRecoveryAction,
  ContentReviewResult,
  ContentRevisionInstruction,
  ReviewedCPipelineResult,
  ReviewFixScope,
  RunReviewedCPipelineOptions,
} from "./types"

export type ReviewRecoveryTerminalCode =
  | "READY"
  | "BLOCKED"
  | "UNSUPPORTED_TARGET"

export interface ReviewRecoverySummary {
  code: ReviewRecoveryTerminalCode
  failed_dimensions: string[]
  missing_prerequisite_source_ids: string[]
  unknown_prerequisite_refs: string[]
  required_action: ContentRecoveryAction | "none"
  fix_scope: ReviewFixScope | "none"
  recommended_level?: LearnerProfileSnapshot["level"]
  can_recover: boolean
  recovery_attempts: number
  message: string
}

export interface ReviewRecoveryAttempt {
  attempt_no: number
  action: Exclude<ReviewFixScope, "artifact">
  input_spec_id: string
  input_run_id: string
  evidence_request_id?: string
  path_request_id?: string
  output_spec_id?: string
  output_run_id?: string
}

export interface RecoverableReviewedCPipelineResult
  extends ReviewedCPipelineResult {
  recovery: ReviewRecoverySummary
  recovery_history: ReviewRecoveryAttempt[]
}

/** D-safe projection; public artifacts are delivered through the release port. */
export interface ReviewRecoveryPublicResult {
  schema_version: typeof C_SCHEMA_VERSION
  result_kind: "review_recovery"
  run_id: string
  spec_id: string
  pipeline_input_hash: string
  generation_spec_hash: string
  pipeline_status: ReviewedCPipelineResult["status"]
  pipeline_state: ReviewedCPipelineResult["state"]
  review_policy_version: string
  recovery: ReviewRecoverySummary
  recovery_history: ReviewRecoveryAttempt[]
}

/**
 * Backend-only registration context. It may contain answer-bearing RAG seeds
 * and a full learner profile, so it is handed directly to a trusted callback
 * and is never included in RecoverableReviewedCPipelineResult.
 */
export interface RecoverableReviewedReadyContext {
  pipeline_input: CPipelineInput
  profile_snapshot: LearnerProfileSnapshot
  pipeline_result: ReviewedCPipelineResult & {
    status: "ready"
    state: "READY"
  }
}

export interface RunRecoverableReviewedPipelineOptions
  extends RunReviewedCPipelineOptions {
  /** Full frozen profile is needed when a new GenerationSpec must be built. */
  profile_snapshot: LearnerProfileSnapshot
  evidence_refresh_port?: EvidenceRefreshPort
  path_planning_port?: RoleBPathPlanningPort
  /** New evidence/spec attempts. Artifact-local revisions keep their existing limit. */
  max_recovery_attempts?: 0 | 1 | 2
  /** Test/transport seam; production uses runReviewedCPipeline. */
  reviewed_pipeline_runner?: typeof runReviewedCPipeline
  /**
   * Trusted backend commit hook for registering the final recovered run.
   * The callback completes before a READY result is returned.
   */
  on_ready?: (context: RecoverableReviewedReadyContext) => Promise<void>
}

interface RecoveryDirective {
  failed_dimensions: string[]
  missing_prerequisite_source_ids: string[]
  unknown_prerequisite_refs: string[]
  required_action: ContentRecoveryAction
  fix_scope: ReviewFixScope
  recommended_level?: LearnerProfileSnapshot["level"]
  can_recover: boolean
  review_instruction_ids: string[]
  reason: string
}

type PreparedRecovery =
  | {
      ok: true
      input: CPipelineInput
      profile: LearnerProfileSnapshot
      evidence_request_id?: string
      path_request_id?: string
    }
  | {
      ok: false
      code: Exclude<ReviewRecoveryTerminalCode, "READY">
      message: string
      directive?: RecoveryDirective
      evidence_request_id?: string
      path_request_id?: string
    }

/**
 * Adds recovery across immutable GenerationSpecs. The wrapped review pipeline
 * remains responsible for artifact-local revisions (at most two); this layer
 * only handles review decisions that require new evidence or a new path/spec.
 */
export async function runRecoverableReviewedCPipeline(
  initialInput: CPipelineInput,
  agents: RoleCAgents,
  secureStore: SecureArtifactStore,
  options: RunRecoverableReviewedPipelineOptions,
): Promise<RecoverableReviewedCPipelineResult> {
  const maxRecoveryAttempts = options.max_recovery_attempts ?? 2
  if (![0, 1, 2].includes(maxRecoveryAttempts)) {
    throw new Error("ROLE_C_RECOVERY_MAX_ATTEMPTS_INVALID")
  }

  const runner = options.reviewed_pipeline_runner ?? runReviewedCPipeline
  const reviewOptions = baseReviewOptions(options)
  let currentInput = deepFreeze(structuredClone(initialInput))
  let currentProfile = deepFreeze(structuredClone(options.profile_snapshot))
  const history: ReviewRecoveryAttempt[] = []
  let lastDirective: RecoveryDirective | undefined

  if (!profileMatchesSpec(currentProfile, currentInput.generation_spec)) {
    throw new Error("ROLE_C_RECOVERY_INITIAL_PROFILE_MISMATCH")
  }

  for (let attempt = 0; ; attempt += 1) {
    const result = await runner(
      currentInput,
      agents,
      secureStore,
      reviewOptions,
    )
    if (result.status === "ready" && result.state === "READY") {
      assertFinalRecoveryContext(result, currentInput, currentProfile)
      const readyResult = result as ReviewedCPipelineResult & {
        status: "ready"
        state: "READY"
      }
      if (options.on_ready) {
        await options.on_ready(deepFreeze({
          pipeline_input: structuredClone(currentInput),
          profile_snapshot: structuredClone(currentProfile),
          pipeline_result: structuredClone(readyResult),
        }))
      }
      return attachRecovery(readyResult, {
        code: "READY",
        failed_dimensions: lastDirective?.failed_dimensions ?? [],
        missing_prerequisite_source_ids:
          lastDirective?.missing_prerequisite_source_ids ?? [],
        unknown_prerequisite_refs:
          lastDirective?.unknown_prerequisite_refs ?? [],
        required_action: lastDirective?.required_action ?? "none",
        fix_scope: lastDirective?.fix_scope ?? "none",
        ...(lastDirective?.recommended_level
          ? { recommended_level: lastDirective.recommended_level }
          : {}),
        can_recover: lastDirective?.can_recover ?? false,
        recovery_attempts: history.length,
        message: history.length > 0
          ? "审核拒绝后的恢复流程已通过完整审核"
          : "内容已通过完整审核",
      }, history, currentInput, currentProfile)
    }

    const directive = recoveryDirective(result)
    if (!directive) {
      return attachRecovery(result, fallbackBlockedSummary(
        result,
        history.length,
      ), history, currentInput, currentProfile)
    }
    lastDirective = directive

    if (directive.unknown_prerequisite_refs.length > 0) {
      return attachRecovery(result, blockedSummary(
        { ...directive, can_recover: false },
        history.length,
        `知识库中存在无法解析的前置引用：${directive.unknown_prerequisite_refs.join("、")}`,
      ), history, currentInput, currentProfile)
    }
    if (directive.fix_scope === "artifact") {
      return attachRecovery(result, blockedSummary(
        directive,
        history.length,
        "artifact 修订已由当前 GenerationSpec 的审核流程处理，未在允许轮次内通过",
      ), history, currentInput, currentProfile)
    }
    if (!directive.can_recover) {
      return attachRecovery(result, terminalSummary(
        unsupportedDirective(directive) ? "UNSUPPORTED_TARGET" : "BLOCKED",
        directive,
        history.length,
        directive.reason || "审核结果标记为不可恢复",
      ), history, currentInput, currentProfile)
    }
    if (attempt >= maxRecoveryAttempts) {
      return attachRecovery(result, blockedSummary(
        { ...directive, can_recover: false },
        history.length,
        "已达到新证据/新规范恢复次数上限",
      ), history, currentInput, currentProfile)
    }
    if (!profileMatchesSpec(currentProfile, currentInput.generation_spec)) {
      return attachRecovery(result, blockedSummary(
        { ...directive, can_recover: false },
        history.length,
        "用于恢复的画像快照与当前 GenerationSpec 不一致",
      ), history, currentInput, currentProfile)
    }

    const prepared = directive.fix_scope === "new_evidence"
      ? await prepareEvidenceRecovery(
          currentInput,
          currentProfile,
          directive,
          options.evidence_refresh_port,
        )
      : await prepareSpecRecovery(
          currentInput,
          currentProfile,
          directive,
          options.path_planning_port,
          options.evidence_refresh_port,
        )
    const historyEntry: ReviewRecoveryAttempt = {
      attempt_no: history.length + 1,
      action: directive.fix_scope as Exclude<ReviewFixScope, "artifact">,
      input_spec_id: currentInput.generation_spec.spec_id,
      input_run_id: currentInput.generation_spec.run_id,
      ...(prepared.evidence_request_id
        ? { evidence_request_id: prepared.evidence_request_id }
        : {}),
      ...(prepared.path_request_id
        ? { path_request_id: prepared.path_request_id }
        : {}),
      ...(prepared.ok
        ? {
            output_spec_id: prepared.input.generation_spec.spec_id,
            output_run_id: prepared.input.generation_spec.run_id,
          }
        : {}),
    }
    history.push(historyEntry)

    if (!prepared.ok) {
      const finalDirective = prepared.directive ?? {
        ...directive,
        can_recover: false,
      }
      return attachRecovery(result, terminalSummary(
        prepared.code,
        finalDirective,
        history.length,
        prepared.message,
      ), history, currentInput, currentProfile)
    }
    if (!profileMatchesSpec(
      prepared.profile,
      prepared.input.generation_spec,
    )) {
      return attachRecovery(result, blockedSummary(
        { ...directive, can_recover: false },
        history.length,
        "恢复后的画像快照与新 GenerationSpec 不一致",
      ), history, currentInput, currentProfile)
    }
    currentInput = deepFreeze(structuredClone(prepared.input))
    currentProfile = deepFreeze(structuredClone(prepared.profile))
  }
}

export function toReviewRecoveryPublicResult(
  result: RecoverableReviewedCPipelineResult,
): ReviewRecoveryPublicResult {
  const projection: ReviewRecoveryPublicResult = {
    schema_version: C_SCHEMA_VERSION,
    result_kind: "review_recovery",
    run_id: result.generation_spec.run_id,
    spec_id: result.generation_spec.spec_id,
    pipeline_input_hash: result.pipeline_input_hash,
    generation_spec_hash: result.generation_spec_hash,
    pipeline_status: result.status,
    pipeline_state: result.state,
    review_policy_version: result.review_policy_version,
    recovery: structuredClone(result.recovery),
    recovery_history: structuredClone(result.recovery_history),
  }
  const report = validateRoleCSchema(
    "review_recovery_result.schema.json",
    projection,
  )
  if (!report.ok) {
    throw new Error("ROLE_C_RECOVERY_PUBLIC_RESULT_INVALID")
  }
  return projection
}

async function prepareEvidenceRecovery(
  input: CPipelineInput,
  profile: LearnerProfileSnapshot,
  directive: RecoveryDirective,
  port: EvidenceRefreshPort | undefined,
): Promise<PreparedRecovery> {
  const request = reviewEvidenceGapRequest(input, profile, directive)
  if (!port) {
    return {
      ok: false,
      code: "BLOCKED",
      message: "审核要求补充证据，但未配置 A 证据刷新接口",
      evidence_request_id: request.request_id,
    }
  }

  let evidence: RagEvidencePack
  try {
    evidence = await requestEvidenceRefresh(
      deepFreeze(structuredClone(request)),
      port,
    )
  } catch {
    return {
      ok: false,
      code: "BLOCKED",
      message: "A 证据刷新接口调用失败",
      evidence_request_id: request.request_id,
    }
  }
  const evidenceIssue = validateRefreshedEvidence(
    evidence,
    pathFromSpec(input.generation_spec),
    profile,
    request.target_source_ids,
  )
  if (evidenceIssue) {
    return {
      ok: false,
      code: "BLOCKED",
      message: evidenceIssue,
      evidence_request_id: request.request_id,
    }
  }

  const built = buildRecoverySpec(
    input.generation_spec,
    profile,
    pathFromSpec(input.generation_spec),
    evidence,
    "new_evidence",
  )
  if (!built.ok) {
    return {
      ok: false,
      code: "BLOCKED",
      message: `补证据后仍无法创建 GenerationSpec：${built.errors.join("；")}`,
      evidence_request_id: request.request_id,
    }
  }
  return {
    ok: true,
    input: pipelineInputAfterRecovery(input, built.spec, evidence),
    profile,
    evidence_request_id: request.request_id,
  }
}

async function prepareSpecRecovery(
  input: CPipelineInput,
  profile: LearnerProfileSnapshot,
  directive: RecoveryDirective,
  pathPort: RoleBPathPlanningPort | undefined,
  evidencePort: EvidenceRefreshPort | undefined,
): Promise<PreparedRecovery> {
  const request = pathPlanningRequest(input, profile, directive)
  const requestReport = validateRoleCSchema(
    "role_b_path_planning_request.schema.json",
    request,
  )
  if (!requestReport.ok) {
    return {
      ok: false,
      code: "BLOCKED",
      message: "C 生成的 B 路径规划请求未通过 Schema 校验",
      path_request_id: request.request_id,
    }
  }
  if (!pathPort) {
    return {
      ok: false,
      code: "BLOCKED",
      message: "审核要求更换学习路径，但未配置 B 路径规划接口",
      path_request_id: request.request_id,
    }
  }

  let plannedResponse: unknown
  try {
    plannedResponse = await pathPort.replanLearningPath(
      deepFreeze(structuredClone(request)),
    )
  } catch {
    return {
      ok: false,
      code: "BLOCKED",
      message: "B 路径规划接口调用失败",
      path_request_id: request.request_id,
    }
  }
  const responseReport = validateRoleCSchema(
    "role_b_path_planning_result.schema.json",
    plannedResponse,
  )
  if (!responseReport.ok) {
    return {
      ok: false,
      code: "BLOCKED",
      message: "B 路径规划响应未通过 Schema 校验",
      path_request_id: request.request_id,
    }
  }
  const planned = plannedResponse as RoleBPathPlanningResult
  if (planned.request_id !== request.request_id) {
    return {
      ok: false,
      code: "BLOCKED",
      message: "B 路径规划响应与请求标识不一致",
      path_request_id: request.request_id,
    }
  }
  if (planned.status === "blocked") {
    return {
      ok: false,
      code: planned.code,
      message: planned.reason,
      directive: {
        ...directive,
        failed_dimensions: unique([
          ...directive.failed_dimensions,
          ...planned.failed_dimensions,
        ]),
        missing_prerequisite_source_ids: unique([
          ...directive.missing_prerequisite_source_ids,
          ...planned.missing_prerequisite_source_ids,
        ]),
        ...(planned.recommended_level
          ? { recommended_level: planned.recommended_level }
          : {}),
        can_recover: false,
      },
      path_request_id: request.request_id,
    }
  }

  const draftReport = validateRoleCSchema(
    "role_b_path_draft.schema.json",
    planned.path_draft,
  )
  const nextProfile = planned.profile_snapshot ?? profile
  const profileReport = validateRoleCSchema(
    "learner_profile_snapshot.schema.json",
    nextProfile,
  )
  if (!draftReport.ok || !profileReport.ok) {
    return {
      ok: false,
      code: "BLOCKED",
      message: "B 路径规划响应中的路径草案或画像未通过 C Schema 校验",
      path_request_id: request.request_id,
    }
  }
  const requiresFactBinding = planned.path_draft.objectives.some(
    (objective) => objective.required_fact_ids.length === 0,
  )
  const validationPath = pathForDraftPreflight(planned.path_draft)
  if (!requiresFactBinding) {
    const formalPathReport = validateRoleCSchema(
      "learning_path_node.schema.json",
      validationPath,
    )
    if (!formalPathReport.ok) {
      return {
        ok: false,
        code: "BLOCKED",
        message: "B 返回的已绑定路径未通过 C 正式路径 Schema 校验",
        path_request_id: request.request_id,
      }
    }
  }
  const preflight = buildRecoverySpec(
    input.generation_spec,
    nextProfile,
    validationPath,
    input.evidence_pack,
    "new_spec",
  )
  if (!preflight.ok && preflight.code === "INVALID_INPUT") {
    return {
      ok: false,
      code: "BLOCKED",
      message: `B 返回的路径无法创建 GenerationSpec：${preflight.errors.join("；")}`,
      path_request_id: request.request_id,
    }
  }
  if (nextProfile.learner_id !== profile.learner_id) {
    return {
      ok: false,
      code: "BLOCKED",
      message: "B 返回的画像不属于当前学习者",
      path_request_id: request.request_id,
    }
  }
  if (planned.profile_snapshot
    && contentHash(nextProfile) !== contentHash(profile)
    && nextProfile.profile_version === profile.profile_version) {
    return {
      ok: false,
      code: "BLOCKED",
      message: "B 修改画像内容时必须更新 profile_version",
      path_request_id: request.request_id,
    }
  }
  const currentPath = pathFromSpec(input.generation_spec)
  if (contentHash(planned.path_draft) === contentHash(currentPath)
    && contentHash(nextProfile) === contentHash(profile)) {
    return {
      ok: false,
      code: "BLOCKED",
      message: "B 返回的路径和画像均未发生变化，不能创建新的 GenerationSpec",
      path_request_id: request.request_id,
    }
  }

  let evidence = input.evidence_pack
  let resolvedPath: LearningPathNode = structuredClone(validationPath)
  let evidenceRequestId: string | undefined
  let currentBindingErrors: string[] = []
  if (requiresFactBinding) {
    const currentBinding = bindUnboundObjectiveFacts(
      planned.path_draft,
      evidence,
    )
    if (currentBinding.ok) {
      resolvedPath = formalizeDraftPath(
        currentBinding.path,
        request.request_id,
      )
      const resolvedPathReport = validateRoleCSchema(
        "learning_path_node.schema.json",
        resolvedPath,
      )
      if (!resolvedPathReport.ok) {
        return {
          ok: false,
          code: "BLOCKED",
          message: "事实绑定后的学习路径未通过 C Schema 校验",
          path_request_id: request.request_id,
        }
      }
    } else {
      currentBindingErrors = currentBinding.errors
    }
  }

  const currentEvidenceIssues = currentBindingErrors.length > 0
    ? currentBindingErrors
    : evidenceCoverageIssues(evidence, resolvedPath, nextProfile)
  let built: BuildGenerationSpecResult | undefined
  if (currentEvidenceIssues.length === 0) {
    built = buildRecoverySpec(
      input.generation_spec,
      nextProfile,
      resolvedPath,
      evidence,
      "new_spec",
    )
    if (!built.ok) {
      return {
        ok: false,
        code: "BLOCKED",
        message: `B 返回的路径无法创建 GenerationSpec：${built.errors.join("；")}`,
        path_request_id: request.request_id,
      }
    }
  }

  if (!built) {
    const gap = pathEvidenceGapRequest(
      input,
      nextProfile,
      planned.path_draft,
      directive,
      !preflight.ok && "gap_request" in preflight
        ? preflight.gap_request
        : undefined,
    )
    evidenceRequestId = gap.request_id
    if (!evidencePort) {
      return {
        ok: false,
        code: "BLOCKED",
        message: "新路径需要新的知识证据，但未配置 A 证据刷新接口",
        path_request_id: request.request_id,
        evidence_request_id: gap.request_id,
      }
    }
    try {
      evidence = await requestEvidenceRefresh(
        deepFreeze(structuredClone(gap)),
        evidencePort,
      )
    } catch {
      return {
        ok: false,
        code: "BLOCKED",
        message: "为新路径请求 A 证据时调用失败",
        path_request_id: request.request_id,
        evidence_request_id: gap.request_id,
      }
    }
    const evidenceIssue = validateRefreshedEvidence(
      evidence,
      planned.path_draft,
      nextProfile,
      gap.target_source_ids,
    )
    if (evidenceIssue) {
      return {
        ok: false,
        code: "BLOCKED",
        message: evidenceIssue,
        path_request_id: request.request_id,
        evidence_request_id: gap.request_id,
      }
    }
    if (requiresFactBinding) {
      const binding = bindUnboundObjectiveFacts(planned.path_draft, evidence)
      if (!binding.ok) {
        return {
          ok: false,
          code: "BLOCKED",
          message: `A 返回的新路径证据无法绑定 required_fact_ids：${binding.errors.join("；")}`,
          path_request_id: request.request_id,
          evidence_request_id: gap.request_id,
        }
      }
      resolvedPath = formalizeDraftPath(binding.path, request.request_id)
      const resolvedPathReport = validateRoleCSchema(
        "learning_path_node.schema.json",
        resolvedPath,
      )
      if (!resolvedPathReport.ok) {
        return {
          ok: false,
          code: "BLOCKED",
          message: "事实绑定后的学习路径未通过 C Schema 校验",
          path_request_id: request.request_id,
          evidence_request_id: gap.request_id,
        }
      }
      const resolvedEvidenceIssues = evidenceCoverageIssues(
        evidence,
        resolvedPath,
        nextProfile,
      )
      if (resolvedEvidenceIssues.length > 0) {
        return {
          ok: false,
          code: "BLOCKED",
          message: `A 返回的证据仍不足：${resolvedEvidenceIssues.join("；")}`,
          path_request_id: request.request_id,
          evidence_request_id: gap.request_id,
        }
      }
    }
    built = buildRecoverySpec(
      input.generation_spec,
      nextProfile,
      resolvedPath,
      evidence,
      "new_spec",
    )
  }
  if (!built?.ok) {
    return {
      ok: false,
      code: "BLOCKED",
      message: `新路径补证据后仍无法创建 GenerationSpec：${built.errors.join("；")}`,
      path_request_id: request.request_id,
      ...(evidenceRequestId
        ? { evidence_request_id: evidenceRequestId }
        : {}),
    }
  }
  return {
    ok: true,
    input: pipelineInputAfterRecovery(input, built.spec, evidence),
    profile: nextProfile,
    path_request_id: request.request_id,
    ...(evidenceRequestId
      ? { evidence_request_id: evidenceRequestId }
      : {}),
  }
}

function recoveryDirective(
  result: ReviewedCPipelineResult,
): RecoveryDirective | undefined {
  const report = result.review_reports.at(-1)
  if (!report || report.decision === "pass") return undefined
  const action = selectedAction(report)
  if (!action) return undefined
  const relevant = report.revision_instructions.filter((instruction) =>
    instruction.fix_scope === action)
  const failedDimensions = report.failed_dimensions?.length
    ? unique(report.failed_dimensions)
    : unique(report.revision_instructions.map((instruction) => instruction.code))
  const missingPrerequisites = report.missing_prerequisite_source_ids
    ? unique(report.missing_prerequisite_source_ids)
    : inferredMissingPrerequisites(report.revision_instructions)
  const unknownPrerequisites = unique(
    report.unknown_prerequisite_refs ?? [],
  )
  const canRecover = report.can_recover
    ?? (action !== "artifact" && relevant.length > 0)
  return {
    failed_dimensions: failedDimensions.length > 0
      ? failedDimensions
      : ["content_review"],
    missing_prerequisite_source_ids: missingPrerequisites,
    unknown_prerequisite_refs: unknownPrerequisites,
    required_action: report.required_action ?? recoveryActionForScope(action),
    fix_scope: report.fix_scope ?? action,
    ...(report.recommended_level
      ? { recommended_level: report.recommended_level }
      : {}),
    can_recover: canRecover,
    review_instruction_ids: relevant.map((instruction) =>
      instruction.instruction_id),
    reason: relevant.map((instruction) => instruction.message).join("；")
      || result.blocked_reason?.message
      || "内容审核未通过",
  }
}

function selectedAction(
  report: ContentReviewResult,
): ReviewFixScope | undefined {
  if (isReviewFixScope(report.fix_scope)) return report.fix_scope
  if (report.required_action) return scopeForRecoveryAction(report.required_action)
  const scopes = new Set(report.revision_instructions.map((instruction) =>
    instruction.fix_scope))
  if (scopes.has("new_spec")) return "new_spec"
  if (scopes.has("new_evidence")) return "new_evidence"
  if (scopes.has("artifact")) return "artifact"
  return undefined
}

function reviewEvidenceGapRequest(
  input: CPipelineInput,
  profile: LearnerProfileSnapshot,
  directive: RecoveryDirective,
): EvidenceGapRequest {
  const path = pathFromSpec(input.generation_spec)
  const targetSourceIds = unique([
    ...path.target_source_ids,
    ...directive.missing_prerequisite_source_ids,
  ])
  const requiredFacts = uniqueFacts(path.objectives.flatMap((objective) =>
    objective.required_fact_ids.map((factId) => ({
      source_id: objective.source_id,
      fact_id: factId,
    }))))
  const missingType: EvidenceGapRequest["missing_type"] =
    directive.missing_prerequisite_source_ids.length > 0
      ? "knowledge_item"
      : "fact"
  const core = {
    source_spec_id: input.generation_spec.spec_id,
    action: directive.required_action,
    target_source_ids: targetSourceIds,
    failed_dimensions: directive.failed_dimensions,
    missing_type: missingType,
  }
  return {
    schema_version: C_SCHEMA_VERSION,
    request_id: stableId("EGR-REVIEW", core),
    run_id: input.generation_spec.run_id,
    target_source_ids: targetSourceIds,
    missing_type: missingType,
    reason: directive.reason,
    learner_level: profile.level,
    required_facts: requiredFacts,
  }
}

function pathPlanningRequest(
  input: CPipelineInput,
  profile: LearnerProfileSnapshot,
  directive: RecoveryDirective,
): RoleBPathPlanningRequest {
  const core = {
    run_id: input.generation_spec.run_id,
    spec_id: input.generation_spec.spec_id,
    profile_hash: contentHash(profile),
    failed_dimensions: directive.failed_dimensions,
    missing_prerequisite_source_ids:
      directive.missing_prerequisite_source_ids,
    recommended_level: directive.recommended_level,
    review_instruction_ids: directive.review_instruction_ids,
  }
  return {
    schema_version: C_SCHEMA_VERSION,
    request_id: stableId("BPATH", core),
    run_id: input.generation_spec.run_id,
    current_spec_id: input.generation_spec.spec_id,
    profile_snapshot: structuredClone(profile),
    current_path_node: pathFromSpec(input.generation_spec),
    failed_dimensions: [...directive.failed_dimensions],
    missing_prerequisite_source_ids: [
      ...directive.missing_prerequisite_source_ids,
    ],
    required_action: "replan_path",
    fix_scope: "new_spec",
    ...(directive.recommended_level
      ? { recommended_level: directive.recommended_level }
      : {}),
    review_instruction_ids: [...directive.review_instruction_ids],
  }
}

function pathEvidenceGapRequest(
  input: CPipelineInput,
  profile: LearnerProfileSnapshot,
  path: LearningPathNode | RoleBPathDraft,
  directive: RecoveryDirective,
  builtGap: EvidenceGapRequest | undefined,
): EvidenceGapRequest {
  const missingPrerequisites = unique([
    ...directive.missing_prerequisite_source_ids,
    ...path.prerequisite_source_ids,
  ])
  const targetSourceIds = unique([
    ...path.target_source_ids,
    ...missingPrerequisites,
  ])
  const requiredFacts = uniqueFacts(path.objectives.flatMap((objective) =>
    objective.required_fact_ids.map((factId) => ({
      source_id: objective.source_id,
      fact_id: factId,
    }))))
  const missingType = missingPrerequisites.length > 0
    ? "knowledge_item" as const
    : builtGap?.missing_type ?? "strong_match"
  const reason = unique([
    directive.reason,
    builtGap?.reason ?? "",
    "新学习路径需要完整且强匹配的目标与先修证据",
  ]).filter(Boolean).join("；")
  const core = {
    source_spec_id: input.generation_spec.spec_id,
    path_hash: contentHash(path),
    profile_hash: contentHash(profile),
    target_source_ids: targetSourceIds,
    missing_type: missingType,
  }
  return {
    schema_version: C_SCHEMA_VERSION,
    request_id: stableId("EGR-PATH", core),
    run_id: input.generation_spec.run_id,
    target_source_ids: targetSourceIds,
    missing_type: missingType,
    reason,
    learner_level: profile.level,
    required_facts: requiredFacts,
  }
}

function buildRecoverySpec(
  current: GenerationSpec,
  profile: LearnerProfileSnapshot,
  path: LearningPathNode,
  evidence: RagEvidencePack,
  action: "new_evidence" | "new_spec",
): BuildGenerationSpecResult {
  const identity = {
    parent_spec_id: current.spec_id,
    action,
    profile_hash: contentHash(profile),
    path_hash: contentHash(path),
    evidence_hash: contentHash(evidence),
  }
  const digest = contentHash({
    contract: "role-c-review-recovery-run-v1",
    ...identity,
  })
  const seedDigest = contentHash({
    contract: "role-c-review-recovery-seed-v1",
    ...identity,
  })
  return buildGenerationSpec({
    run_id: `RUN-C-RECOVERY-${digest.slice(7, 31)}`,
    profile_snapshot: profile,
    path_node: path,
    evidence_pack: evidence,
    versions: {
      prompt_version: current.versions.prompt_version,
      model_config_hash: current.versions.model_config_hash,
      ...(current.versions.runner_image_digest
        ? { runner_image_digest: current.versions.runner_image_digest }
        : {}),
    },
    seed: Number.parseInt(seedDigest.slice(7, 19), 16),
    ...(action === "new_evidence"
      ? {
          difficulty: structuredClone(current.difficulty),
          adaptive_shell: {
            scaffold_level: current.learner_adaptation.scaffold_level,
            reading_density: current.learner_adaptation.reading_density,
          },
        }
      : {}),
  })
}

function pipelineInputAfterRecovery(
  previous: CPipelineInput,
  spec: GenerationSpec,
  evidence: RagEvidencePack,
): CPipelineInput {
  return {
    generation_spec: spec,
    evidence_pack: structuredClone(evidence),
    ...(previous.next_round_context
      ? {
          next_round_context: {
            ...structuredClone(previous.next_round_context),
            focus_objective_ids: spec.targets.map((target) =>
              target.objective_id),
          },
        }
      : {}),
  }
}

function validateRefreshedEvidence(
  refreshed: RagEvidencePack,
  path: LearningPathNode | RoleBPathDraft,
  profile: LearnerProfileSnapshot,
  requiredSourceIds: string[] = [],
): string | undefined {
  const schema = validateRoleCSchema("rag_evidence_pack.schema.json", refreshed)
  if (!schema.ok) return "A 返回的新证据包未通过 C Schema 校验"
  const issues = evidenceCoverageIssues(
    refreshed,
    path,
    profile,
    requiredSourceIds,
  )
  return issues.length > 0
    ? `A 返回的证据仍不足：${issues.join("；")}`
    : undefined
}

/**
 * GenerationSpec's semantic preflight requires non-empty fact IDs. A sentinel
 * lets it check all other path rules; the value never leaves this module.
 */
function pathForDraftPreflight(
  path: RoleBPathDraft,
): LearningPathNode {
  const draft = structuredClone(path)
  for (const objective of draft.objectives) {
    if (objective.required_fact_ids.length === 0) {
      objective.required_fact_ids = ["F000"]
    }
  }
  return draft as LearningPathNode
}

type PathFactBindingResult =
  | { ok: true; path: LearningPathNode }
  | { ok: false; errors: string[] }

const MAX_REQUIRED_FACTS_PER_OBJECTIVE = 3

function bindUnboundObjectiveFacts(
  path: RoleBPathDraft,
  evidence: RagEvidencePack,
): PathFactBindingResult {
  const bound = structuredClone(path)
  const errors: string[] = []
  for (const objective of bound.objectives) {
    if (objective.required_fact_ids.length > 0) continue
    const availableFactIds = unique(
      evidence.results
        .filter((item) => item.source_id === objective.source_id)
        .flatMap((item) => item.facts)
        .filter((fact) => fact.source_id === objective.source_id)
        .map((fact) => fact.fact_id),
    ).sort().slice(0, MAX_REQUIRED_FACTS_PER_OBJECTIVE)
    if (availableFactIds.length === 0) {
      errors.push(
        `目标 ${objective.objective_id} 的知识点 ${objective.source_id} 没有可用事实`,
      )
      continue
    }
    objective.required_fact_ids = availableFactIds
  }
  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, path: bound as LearningPathNode }
}

function formalizeDraftPath(
  path: LearningPathNode,
  pathRequestId: string,
): LearningPathNode {
  const semantics = {
    schema_version: path.schema_version,
    target_source_ids: [...path.target_source_ids],
    prerequisite_source_ids: [...path.prerequisite_source_ids],
    goal: path.goal,
    objectives: structuredClone(path.objectives),
    assessment_blueprint: structuredClone(path.assessment_blueprint),
  }
  return {
    ...structuredClone(path),
    node_id: stableId("PATH-C-RECOVERY", {
      request_id: pathRequestId,
      ...semantics,
    }),
  }
}

function evidenceCoverageIssues(
  evidence: RagEvidencePack,
  path: LearningPathNode | RoleBPathDraft,
  profile: LearnerProfileSnapshot,
  requiredSourceIds: string[] = [],
): string[] {
  const issues: string[] = []
  if (evidence.match_status !== "strong") {
    issues.push("证据匹配状态不是 strong")
  }
  if (evidence.learner_level !== undefined
    && evidence.learner_level !== profile.level) {
    issues.push("证据难度与画像 level 不一致")
  }
  const items = new Map(evidence.results.map((item) => [item.source_id, item]))
  for (const sourceId of unique([
    ...path.target_source_ids,
    ...path.prerequisite_source_ids,
    ...requiredSourceIds,
  ])) {
    if (!items.has(sourceId)) issues.push(`缺少知识点 ${sourceId}`)
  }
  for (const objective of path.objectives) {
    const item = items.get(objective.source_id)
    if (!item) continue
    const facts = new Set(item.facts.map((fact) => fact.fact_id))
    for (const factId of objective.required_fact_ids) {
      if (!facts.has(factId)) {
        issues.push(`缺少事实 ${objective.source_id}:${factId}`)
      }
    }
  }
  return unique(issues)
}

function pathFromSpec(spec: GenerationSpec): LearningPathNode {
  return {
    schema_version: spec.schema_version,
    node_id: spec.path_node.node_id,
    target_source_ids: [...spec.path_node.target_source_ids],
    prerequisite_source_ids: [...spec.path_node.prerequisite_source_ids],
    goal: spec.path_node.goal,
    objectives: structuredClone(spec.targets),
    assessment_blueprint: structuredClone(spec.assessment_blueprint),
  }
}

function profileMatchesSpec(
  profile: LearnerProfileSnapshot,
  spec: GenerationSpec,
): boolean {
  return profile.profile_id === spec.profile_ref.profile_id
    && profile.profile_version === spec.profile_ref.profile_version
    && contentHash(profile) === spec.profile_ref.profile_content_hash
}

function inferredMissingPrerequisites(
  instructions: ContentRevisionInstruction[],
): string[] {
  const text = instructions
    .filter((instruction) =>
      instruction.code === "prerequisite_coverage")
    .flatMap((instruction) => [
      instruction.message,
      instruction.proposed_action,
      ...instruction.evidence_refs,
    ])
    .join(" ")
  return unique(text.match(/\bK[0-9]{3}\b/g) ?? [])
}

function unsupportedDirective(directive: RecoveryDirective): boolean {
  return directive.failed_dimensions.some((dimension) =>
    dimension.toUpperCase().includes("UNSUPPORTED_TARGET"))
}

function fallbackBlockedSummary(
  result: ReviewedCPipelineResult,
  attempts: number,
): ReviewRecoverySummary {
  return {
    code: "BLOCKED",
    failed_dimensions: [
      result.blocked_reason?.code
        ?? result.failure_reason?.code
        ?? "pipeline_not_ready",
    ],
    missing_prerequisite_source_ids: [],
    unknown_prerequisite_refs: [],
    required_action: "none",
    fix_scope: "none",
    can_recover: false,
    recovery_attempts: attempts,
    message: result.blocked_reason?.message
      ?? result.failure_reason?.message
      ?? "流水线未就绪，且没有可执行的结构化恢复动作",
  }
}

function blockedSummary(
  directive: RecoveryDirective,
  attempts: number,
  message: string,
): ReviewRecoverySummary {
  return terminalSummary("BLOCKED", directive, attempts, message)
}

function terminalSummary(
  code: Exclude<ReviewRecoveryTerminalCode, "READY">,
  directive: RecoveryDirective,
  attempts: number,
  message: string,
): ReviewRecoverySummary {
  return {
    code,
    failed_dimensions: [...directive.failed_dimensions],
    missing_prerequisite_source_ids: [
      ...directive.missing_prerequisite_source_ids,
    ],
    unknown_prerequisite_refs: [...directive.unknown_prerequisite_refs],
    required_action: directive.required_action,
    fix_scope: directive.fix_scope,
    ...(directive.recommended_level
      ? { recommended_level: directive.recommended_level }
      : {}),
    can_recover: directive.can_recover,
    recovery_attempts: attempts,
    message,
  }
}

function attachRecovery(
  result: ReviewedCPipelineResult,
  recovery: ReviewRecoverySummary,
  history: ReviewRecoveryAttempt[],
  finalInput: CPipelineInput,
  finalProfile: LearnerProfileSnapshot,
): RecoverableReviewedCPipelineResult {
  assertFinalRecoveryContext(result, finalInput, finalProfile)
  const recovered = {
    ...structuredClone(result),
    recovery: structuredClone(recovery),
    recovery_history: structuredClone(history),
  }
  const statusReport = validateRoleCSchema(
    "review_recovery_status.schema.json",
    recovered.recovery,
  )
  if (!statusReport.ok) {
    throw new Error("ROLE_C_RECOVERY_STATUS_INVALID")
  }
  return recovered
}

function assertFinalRecoveryContext(
  result: ReviewedCPipelineResult,
  finalInput: CPipelineInput,
  finalProfile: LearnerProfileSnapshot,
): void {
  if (result.pipeline_input_hash !== contentHash(finalInput)
    || result.generation_spec_hash !== contentHash(finalInput.generation_spec)) {
    throw new Error("ROLE_C_RECOVERY_FINAL_INPUT_MISMATCH")
  }
  if (!profileMatchesSpec(finalProfile, finalInput.generation_spec)) {
    throw new Error("ROLE_C_RECOVERY_FINAL_PROFILE_MISMATCH")
  }
}

function baseReviewOptions(
  options: RunRecoverableReviewedPipelineOptions,
): RunReviewedCPipelineOptions {
  return {
    review_port: options.review_port,
    ...(options.max_external_revisions !== undefined
      ? { max_external_revisions: options.max_external_revisions }
      : {}),
    ...(options.critic ? { critic: options.critic } : {}),
    ...(options.fact_audit_port
      ? { fact_audit_port: options.fact_audit_port }
      : {}),
    ...(options.trace_seq_start !== undefined
      ? { trace_seq_start: options.trace_seq_start }
      : {}),
  }
}

function isReviewFixScope(value: unknown): value is ReviewFixScope {
  return value === "artifact"
    || value === "new_evidence"
    || value === "new_spec"
}

function recoveryActionForScope(
  scope: ReviewFixScope,
): ContentRecoveryAction {
  if (scope === "artifact") return "adjust_content"
  if (scope === "new_evidence") return "request_new_evidence"
  return "replan_path"
}

function scopeForRecoveryAction(
  action: ContentRecoveryAction,
): ReviewFixScope {
  if (action === "adjust_content") return "artifact"
  if (action === "request_new_evidence") return "new_evidence"
  return "new_spec"
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim()))]
}

function uniqueFacts(
  values: Array<{ source_id: string; fact_id: string }>,
): Array<{ source_id: string; fact_id: string }> {
  return [...new Map(values.map((value) => [
    `${value.source_id}:${value.fact_id}`,
    value,
  ])).values()]
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value
  Object.values(value as Record<string, unknown>).forEach(deepFreeze)
  return Object.freeze(value)
}
