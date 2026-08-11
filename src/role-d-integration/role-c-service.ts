import type {
  ContinueRoleCAfterSubmissionInput,
  ContinueRoleCForRoleDResult,
  GenerateRoleCForRoleDInput,
  RoleDContentAuditSummary,
  RoleDCodeLab,
  RoleCCodeLabFeedbackCode,
  RoleCForRoleDResult,
  RoleDAssessmentItem,
  RoleDGeneratedArtifact,
  RoleDPublicCitation,
  RoleDWorkflowEvent,
  RouteRoleCAssessmentAnchorsInput,
  RouteRoleCAssessmentAnchorsResult,
  RunRoleCCodeLabInput,
  RunRoleCAssessmentCodeInput,
  RunRoleCAssessmentCodeResult,
  RunRoleCCodeLabResult,
  SubmitRoleCAssessmentInput,
} from "./contracts"
import { loadKnowledgeBase } from "../knowledge/loader"
import type { KnowledgeBase } from "../knowledge/types"
import { canonicalizeConcept } from "../role-b-profile/concept-canonicalizer"
import {
  type RagResult,
  type RagResultItem,
} from "../rag/retriever"
import {
  retrieveStructuredEvidenceFromKnowledgeBase,
  type StructuredEvidenceRetrievalPort,
  type StructuredEvidenceRequest,
} from "../rag/structured-evidence"
import { join, resolve } from "node:path"
import { appendFile, mkdir } from "node:fs/promises"
import { roleCGenerationBudgets, shouldRetryWholeGenerationReason } from "./generation-budget"
import {
  adaptLearnerProfile,
  adaptRagResult,
  AtomicFileAdaptiveLearningLoopJournal,
  AtomicFileLearningCycleStore,
  AtomicFileMasteryStateStore,
  AtomicFileSecureArtifactStore,
  buildGenerationSpec,
  continueCompletedLearningCycle,
  contentHash,
  createLocalABContentReviewPort,
  createLocalBPathPlanningPort,
  createLearningSessionDelivery,
  createReviewedReleaseDelivery,
  createReviewRecoveryStatusDelivery,
  createRoleCAgents,
  defineLearningPathNode,
  createDockerPythonCodeRunnerFromEnv,
  InMemoryLearningCycleStore,
  InMemoryMasteryStateStore,
  InMemorySecureArtifactStore,
  LearningCycleService,
  ModelBackedRoleCContentProvider,
  modelBackedProviderOptionsFromEnv,
  projectPublicRagEvidencePack,
  createRoleCModelGatewayFromEnv,
  ROLE_C_PROMPT_MANIFEST_VERSION,
  runRecoverableReviewedCPipeline,
  stableId,
  TrustedAssessmentVerifier,
  TrustedCodeLabVerifier,
  type AgentTraceEvent,
  type AssessmentPublicArtifact,
  type ContentReviewResult,
  type ContentReviewPort,
  type CrossArtifactCritic,
  type CitationRef,
  type CodeLabPublicArtifact,
  type ConceptLessonArtifact,
  type CodeExecutionRequest,
  type CodeExecutionResult,
  type CodeRunner,
  type SafeStageFailureDiagnostic,
  type RenderBlock,
  type LearningCyclePublicOutcome,
  type LearningCycleStore,
  type MasteryStateStore,
  type AdaptiveLearningLoopJournal,
  type EvidenceRefreshPort,
  type LearnerProfileSnapshot,
  type LearningPathNode,
  type RagEvidencePack,
  type RecoverableReviewedReadyContext,
  type ReviewRecoveryAttempt,
  type ReviewRecoverySummary,
  type RoleCContentProvider,
  type RoleBLearningProgressPort,
  type RoleBPathPlanningPort,
  type RoleDAdaptiveLearningLoopPort,
  type SecureArtifactStore,
  type SubmissionEnvelope,
} from "../role-c-content"

const defaultInMemoryLearningPersistence: RoleCLearningPersistence = {
  cycleStore: new InMemoryLearningCycleStore(),
  secureStore: new InMemorySecureArtifactStore(),
  masteryStore: new InMemoryMasteryStateStore(),
}

/** Fail-closed convenience entry. Runtime adapters select model or explicit offline mode. */

export async function generateRoleCForRoleD(input: GenerateRoleCForRoleDInput): Promise<RoleCForRoleDResult> {
  return generateRoleCForRoleDWithRuntime(input, {
    providerMode: "unconfigured",
    allowDeterministicFallback: false,
  })
}

function stageDiagnosticSink(dataDirectory?: string) {
  if (!dataDirectory?.trim()) return undefined
  const path = join(resolve(dataDirectory), "diagnostics", "stage-failures.jsonl")
  return async (diagnostic: SafeStageFailureDiagnostic): Promise<void> => {
    try {
      await mkdir(join(resolve(dataDirectory), "diagnostics"), { recursive: true })
      await appendFile(path, `${JSON.stringify({ ...diagnostic, timestamp: new Date().toISOString() })}\n`, "utf8")
    } catch {
      // Diagnostics must never weaken or replace the trusted content gate.
    }
  }
}

export interface RoleCForRoleDRuntimeOptions {
  providerMode?: "deterministic" | "model" | "unconfigured"
  /** UI/production sets false unless offline deterministic mode was selected explicitly. */
  allowDeterministicFallback?: boolean
  env?: Record<string, string | undefined>
  cwd?: string
  runner?: CodeRunner
  /** Test/backend seam; production selects the Provider from providerMode. */
  provider?: RoleCContentProvider
  /** Backend/test seam for a remote or instrumented A/B review adapter. */
  reviewPort?: ContentReviewPort
  /** Optional advisory semantic review; deterministic alignment remains authoritative. */
  critic?: CrossArtifactCritic
  dockerRunnerFactory?: (env?: Record<string, string | undefined>) => Promise<CodeRunner>
  /** Stable server-side directory used to recover C sessions after a process restart. */
  dataDirectory?: string
  /** Test/backend seam for callers that own equivalent durable stores. */
  learningPersistence?: RoleCLearningPersistence
  /** A identity-based evidence adapter used by recovery and next-path activation. */
  evidenceRefreshPort?: EvidenceRefreshPort
  /** B progress delivery used to submit completed assessment outcomes to B. */
  learningProgressPort?: RoleBLearningProgressPort
  /** B path adapter used when a generated candidate needs formal replanning. */
  pathPlanningPort?: RoleBPathPlanningPort
  /** Durable D receiver. Continuation fails closed when it is not configured. */
  roleDPort?: RoleDAdaptiveLearningLoopPort
  /** Durable outer continuation journal; dataDirectory selects the file adapter by default. */
  adaptiveExecutionJournal?: AdaptiveLearningLoopJournal
  /** Stable receiver identity included in continuation idempotency. */
  deliveryTargetNamespace?: string
  /** 触发 reprofile 所需的最小冲突目标数；缺省回退 C 侧默认（2）。主 Agent 传 1 以适配每节点单 objective。 */
  profileDriftMinimumConflicts?: number
}

export interface RoleCLearningPersistence {
  cycleStore: LearningCycleStore
  secureStore: SecureArtifactStore
  masteryStore: MasteryStateStore
}

/**
 * Creates one single-host durable namespace. Every instance opened on the same
 * directory resolves the same run, secure artifacts, sessions and mastery state.
 */
export function createAtomicRoleCLearningPersistence(
  dataDirectory: string,
): RoleCLearningPersistence {
  if (!dataDirectory.trim()) throw new Error("ROLE_C_RUNTIME_DATA_DIR 不能为空")
  const root = resolve(dataDirectory)
  return {
    cycleStore: new AtomicFileLearningCycleStore({
      root_directory: join(root, "learning-cycle"),
    }),
    secureStore: new AtomicFileSecureArtifactStore({
      root_directory: join(root, "secure-artifacts"),
    }),
    masteryStore: new AtomicFileMasteryStateStore({
      root_directory: join(root, "mastery"),
    }),
  }
}

export async function resolveRoleCCodeRunner(runtime: Pick<RoleCForRoleDRuntimeOptions, "providerMode" | "runner" | "env" | "dockerRunnerFactory">): Promise<CodeRunner> {
  if (runtime.runner) return runtime.runner
  return (runtime.dockerRunnerFactory ?? createDockerPythonCodeRunnerFromEnv)(runtime.env ?? process.env)
}

export async function generateRoleCForRoleDWithRuntime(
  input: GenerateRoleCForRoleDInput,
  runtime: RoleCForRoleDRuntimeOptions,
): Promise<RoleCForRoleDResult> {
  const configurationIssue = roleCProviderConfigurationIssue(runtime)
  if (configurationIssue) {
    const reason = configurationIssue
    return {
      status: "blocked",
      artifacts: [],
      workflow: [{
        id: `${input.runId}-provider-mode-blocked`,
        agent: "role-c-model-provider",
        stage: "模型 Provider 配置",
        status: "blocked",
        summary: reason,
        timestamp: new Date().toISOString(),
      }],
      runId: input.runId,
      reason,
    }
  }
  const knowledgeBase = await loadKnowledgeBase()
  const evidencePack = adaptRagResult(input.ragResult, {
    kb_version: input.kbVersion,
    rag_version: "rule-rag-0.1",
  })
  const profileSnapshot = adaptLearnerProfile(input.profile, {
    // 跨轮稳定标识：主 Agent 传入会话级 run_id 时，mastery 状态可跨轮累积
    //（reprofile 才能被多轮高分/低分触发）；缺省时每轮 runId 派生 → 每轮独立评估。
    profile_version: input.profile_version ?? `${input.runId}-profile-v1`,
    provenance_ref: "role-d:new-learning-plan",
  })
  const pathNode = structuredClone(input.pathNode)

  const runtimeEnv = runtime.env ?? process.env
  let modelGateway: ReturnType<typeof createRoleCModelGatewayFromEnv> | undefined
  try {
    modelGateway = runtime.providerMode === "model"
      ? createRoleCModelGatewayFromEnv(runtimeEnv)
      : undefined
  } catch (error) {
    const reason = error instanceof Error ? error.message : "C 的模型 Provider 配置不可用"
    return {
      status: "blocked",
      artifacts: [],
      workflow: [{
        id: `${input.runId}-model-provider-blocked`,
        agent: "role-c-model-provider",
        stage: "模型 Provider 配置",
        status: "blocked",
        summary: reason,
        timestamp: new Date().toISOString(),
      }],
      runId: input.runId,
      reason,
    }
  }
  let runner: CodeRunner
  try {
    runner = await resolveRoleCCodeRunner(runtime)
  } catch (error) {
    const reason = error instanceof Error ? error.message : "C 的 Docker CodeRunner 不可用"
    return {
      status: "blocked",
      artifacts: [],
      workflow: [{
        id: `${input.runId}-docker-runner-blocked`,
        agent: "docker-python-runner",
        stage: "可信代码执行",
        status: "blocked",
        summary: reason,
        timestamp: new Date().toISOString(),
      }],
      runId: input.runId,
      reason,
    }
  }

  // 真实模型生成有少量随机失败（code-lab secure 阶段、可信执行修复等），
  // 至多重试 5 次，每次使用新 runId 重建 spec 避免产物 ID 冲突；
  // 仍失败才向调用方阻塞。审核通过即停止。
  const provider = runtime.provider ?? new ModelBackedRoleCContentProvider(
    modelGateway!,
    {
      ...modelBackedProviderOptionsFromEnv(runtimeEnv),
      stage_failure_diagnostic_sink: stageDiagnosticSink(runtime.dataDirectory),
    },
  )
  const agents = createRoleCAgents(provider, {
    code_lab: new TrustedCodeLabVerifier(runner),
    assessment: new TrustedAssessmentVerifier(runner),
  })
  const persistence = resolveRoleCLearningPersistence(runtime)
  const secureStore = persistence.secureStore
  const cycleService = new LearningCycleService({
    cycle_store: persistence.cycleStore,
    secure_store: secureStore,
    mastery_store: persistence.masteryStore,
    code_runner: runner,
  })
  // 循环内必有赋值：built 失败直接 return，成功则 pipeline 一定被赋值。
  let pipeline!: Awaited<ReturnType<typeof runRecoverableReviewedCPipeline>>
  let readyContext: RecoverableReviewedReadyContext | undefined
  for (let attempt = 0; attempt < roleCGenerationBudgets().inner_attempts; attempt += 1) {
    const attemptRunId = attempt === 0 ? input.runId : `${input.runId}-R${attempt + 1}`
    const built = buildGenerationSpec({
      run_id: attemptRunId,
      profile_snapshot: profileSnapshot,
      path_node: pathNode,
      evidence_pack: evidencePack,
      versions: {
        prompt_version: ROLE_C_PROMPT_MANIFEST_VERSION,
        model_config_hash: modelGateway
          ? modelGateway.model_config_hash
          : "deterministic-role-d-local-reference-v1",
        runner_image_digest: runner.runner_image_digest,
      },
      // seed 由 run_id 派生：同一轮确定性结构稳定（幂等/审计可复现），
      // 不同轮/不同重试自然产生不同变体，不再全仓库写死同一 seed。
      seed: seedFromRunId(attemptRunId),
    })
    if (!built.ok) {
      return {
        status: "blocked",
        artifacts: [],
        workflow: [],
        runId: attemptRunId,
        reason: built.errors.join("；"),
      }
    }
    const pipelineInput = {
      generation_spec: built.spec,
      evidence_pack: evidencePack,
      ...(input.next_round_context ? { next_round_context: input.next_round_context } : {}),
    }
    pipeline = await runRecoverableReviewedCPipeline(
      pipelineInput,
      agents,
      secureStore,
      {
      review_port: runtime.reviewPort
        ?? createLocalABContentReviewPort({ knowledge_base: knowledgeBase }),
      profile_snapshot: profileSnapshot,
      path_planning_port: createLocalBPathPlanningPort(knowledgeBase),
      evidence_refresh_port: createRoleCRecoveryEvidenceRefreshPort({
        kbVersion: input.kbVersion,
        knowledgeBase,
      }),
      max_external_revisions: 2,
      max_recovery_attempts: 2,
      ...(runtime.critic ? { critic: runtime.critic } : {}),
      async on_ready(context) {
        await cycleService.registerReadyRun({
          pipeline_input: context.pipeline_input,
          pipeline_result: context.pipeline_result,
          profile_snapshot: context.profile_snapshot,
          learner_id_hash: input.profile.learner_id,
        })
        readyContext = context
      },
    })
    if (pipeline.status === "ready") break
    const attemptReason = pipeline.blocked_reason
      ? [pipeline.blocked_reason.message, ...(pipeline.blocked_reason.details ?? [])].join("；")
      : pipeline.failure_reason?.message ?? ""
    if (!shouldRetryWholeGenerationReason(attemptReason)) break
  }
  const workflow = [
    ...pipeline.trace_events.map(toWorkflowEvent),
    ...recoveryWorkflowEvents(input.runId, pipeline.recovery, pipeline.recovery_history),
  ]
  const audit = reviewAuditSummary(pipeline.review_reports, toRoleDArtifacts(pipeline.public_artifacts))
  const finalReview = pipeline.review_reports.at(-1)
  if (pipeline.status !== "ready" || finalReview?.decision !== "pass") {
    const reviewReason = finalReview
      ? finalReview.artifact_results.flatMap((result) => result.findings.map((finding) => finding.message)).slice(0, 3).join("；")
      : ""
    const pipelineReason = pipeline.blocked_reason
      ? [
          pipeline.blocked_reason.message,
          ...(pipeline.blocked_reason.details ?? []).slice(0, 3),
        ].join("；")
      : pipeline.failure_reason?.message
    return {
      status: pipeline.status === "failed" ? "failed" : "blocked",
      artifacts: [],
      workflow,
      runId: pipeline.generation_spec.run_id,
      reason: pipelineReason || pipeline.recovery.message || reviewReason || "A/B 审核未通过，内容未发布给 D。",
      ...(audit ? { audit } : {}),
      recovery: toRoleDRecovery(pipeline.recovery),
    }
  }
  if (!readyContext) throw new Error("ROLE_C_READY_CONTEXT_MISSING")
  const artifacts = toRoleDArtifacts(pipeline.public_artifacts)
  const finalSpec = readyContext.pipeline_input.generation_spec
  const learningSessionId = `C-${finalSpec.run_id}-SESSION-1`
  const assessment = pipeline.public_artifacts.assessment!
  const requiredItemIds = (assessment.payload!.items ?? []).map((item: { item_id: string }) => item.item_id)
  await cycleService.openTrustedPreselectedSession({
    routing_policy: "trusted_preselected_v1",
    session_id: learningSessionId,
    run_id: finalSpec.run_id,
    authenticated_learner_id_hash: input.profile.learner_id,
    attempt_no: 1,
    required_item_ids: requiredItemIds,
    revealed_hint_levels: {},
    // 画像预期来自 B 初始画像的真实 known/weak_concepts（按 source_id 映射）：
    // 画像认为已掌握的目标标 known，其余标 weak。reprofile 检测据此判定
    //「预期 known 但 mastery < 0.45」或「预期 weak 但 mastery > 0.85」的冲突。
    profile_expectations_by_objective: Object.fromEntries(
      finalSpec.targets.map((target) => [
        target.objective_id,
        profileExpectationForTarget(input.profile, target.source_id, knowledgeBase),
      ]),
    ),
  })
  return {
    status: "ready",
    artifacts,
    workflow,
    runId: finalSpec.run_id,
    learningSession: {
      sessionId: learningSessionId,
      formId: assessment.payload!.form_id,
      attemptNo: 1,
    },
    reviewedRelease: createReviewedReleaseDelivery(pipeline, input.next_round_context),
    ...(audit ? { audit } : {}),
    recovery: toRoleDRecovery(pipeline.recovery),
    finalContext: {
      profileSnapshot: structuredClone(readyContext.profile_snapshot),
      profileVersion: readyContext.profile_snapshot.profile_version,
      pathNode: defineLearningPathNode({
        ...structuredClone(finalSpec.path_node),
        objectives: structuredClone(finalSpec.targets),
        assessment_blueprint: structuredClone(finalSpec.assessment_blueprint),
      }),
      evidencePack: projectPublicRagEvidencePack(
        readyContext.pipeline_input.evidence_pack,
      ),
    },
  }
}

export interface RoleCRecoveryEvidenceRefreshOptions {
  kbVersion: string
  knowledgeBase: KnowledgeBase
  structuredEvidencePort?: StructuredEvidenceRetrievalPort
}

const RECOVERY_SOURCE_BATCH_SIZE = 8

/**
 * Resolves B's fixed recovery path through A's identity-based evidence port.
 * Text retrieval remains reserved for the initial stage, before source IDs are known.
 */
export function createRoleCRecoveryEvidenceRefreshPort(
  options: RoleCRecoveryEvidenceRefreshOptions,
): EvidenceRefreshPort {
  const retrieve = options.structuredEvidencePort
    ? options.structuredEvidencePort.retrieveStructuredEvidence.bind(
        options.structuredEvidencePort,
      )
    : async (request: StructuredEvidenceRequest) =>
        retrieveStructuredEvidenceFromKnowledgeBase(
          request,
          options.knowledgeBase,
        )
  return {
    async refreshEvidence(request) {
      const sourceIds = [...new Set(request.target_source_ids)]
      const requiredFactsBySource = groupRequiredFacts(
        request.required_facts,
        sourceIds,
      )
      const batches = chunk(sourceIds, RECOVERY_SOURCE_BATCH_SIZE)
      const recalled = await Promise.all(batches.map((batch) =>
        retrieve({
          source_ids: batch,
          fact_ids_by_source: Object.fromEntries(batch.flatMap((sourceId) => {
            const factIds = requiredFactsBySource[sourceId]
            return factIds && factIds.length > 0
              ? [[sourceId, factIds]]
              : []
          })),
        })))
      const requested = new Set(sourceIds)
      const mergedBySource = new Map<string, RagResultItem>()
      const missingSources = new Set<string>()
      const missingFactKeys = new Set<string>()
      for (const result of recalled) {
        for (const sourceId of result.missing_source_ids) {
          if (requested.has(sourceId)) missingSources.add(sourceId)
        }
        for (const fact of result.missing_fact_refs) {
          if (requested.has(fact.source_id)) {
            missingFactKeys.add(`${fact.source_id}:${fact.fact_id}`)
          }
        }
        for (const item of result.results) {
          const sourceId = sourceIdOf(item)
          if (requested.has(sourceId) && !mergedBySource.has(sourceId)) {
            mergedBySource.set(sourceId, structuredClone(item))
          }
        }
      }
      for (const sourceId of sourceIds) {
        if (!mergedBySource.has(sourceId)) missingSources.add(sourceId)
        const item = mergedBySource.get(sourceId)
        const availableFacts = new Set(item?.facts.map((fact) =>
          fact.factId ?? fact.fact_id) ?? [])
        for (const factId of requiredFactsBySource[sourceId] ?? []) {
          if (!availableFacts.has(factId)) {
            missingFactKeys.add(`${sourceId}:${factId}`)
          }
        }
      }
      const merged: RagResult = {
        query: `按标识刷新证据：${sourceIds.join("、")}`,
        learnerLevel: request.learner_level,
        topK: Math.max(1, sourceIds.length),
        results: sourceIds.flatMap((sourceId) => {
          if (missingSources.has(sourceId)) return []
          const item = mergedBySource.get(sourceId)
          if (!item) return []
          const filtered = {
            ...item,
            facts: item.facts.filter((fact) =>
              !missingFactKeys.has(
                `${sourceId}:${fact.factId ?? fact.fact_id}`,
              )),
          }
          return [filtered]
        }),
      }
      const evidence = adaptRagResult(merged, {
        kb_version: options.kbVersion,
        rag_version: "structured-evidence-1.0-recovery",
        retrieval_id: stableId("RAG-RECOVERY", {
          request_id: request.request_id,
          source_ids: sourceIds,
          required_facts_by_source: requiredFactsBySource,
          kb_version: options.kbVersion,
        }),
      })
      return {
        ...evidence,
        match_status: missingSources.size === 0 && missingFactKeys.size === 0
          ? "strong"
          : evidence.results.length > 0
            ? "weak"
            : "no_match",
      }
    },
  }
}

function groupRequiredFacts(
  requiredFacts: Array<{ source_id: string; fact_id: string }>,
  sourceIds: string[],
): Record<string, string[]> {
  const requested = new Set(sourceIds)
  const grouped: Record<string, string[]> = {}
  for (const fact of requiredFacts) {
    if (!requested.has(fact.source_id)) continue
    const factIds = grouped[fact.source_id] ?? []
    if (!factIds.includes(fact.fact_id)) factIds.push(fact.fact_id)
    grouped[fact.source_id] = factIds
  }
  return grouped
}

/**
 * 由 run_id 派生确定性 seed：同一 run 稳定（幂等/审计可复现），不同 run 自然
 * 产生不同变体。参考 next-round.ts 的 followUpSeed 模式。
 */
function seedFromRunId(runId: string): number {
  const digest = contentHash({ contract: "role-c-generation-seed-v1", run_id: runId })
  return Number.parseInt(digest.slice("sha256:".length, "sha256:".length + 12), 16)
}

/**
 * 由 B 画像决定单个测评目标的画像预期：画像 known_concepts 映射到该 source_id
 * 则预期 known，否则 weak。reprofile 检测以这些预期为基准，判断真实表现是否
 * 与画像冲突（画像说会却不会 / 画像说弱却已掌握）。
 */
export function profileExpectationForTarget(
  profile: { known_concepts: string[]; weak_concepts: string[] },
  sourceId: string,
  knowledgeBase: KnowledgeBase,
): "known" | "weak" {
  const knownSourceIds = new Set(profile.known_concepts.flatMap((concept) =>
    canonicalizeConcept(concept, knowledgeBase).sourceIds))
  return knownSourceIds.has(sourceId) ? "known" : "weak"
}

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size))
  }
  return chunks
}

function toRoleDRecovery(recovery: ReviewRecoverySummary) {
  return {
    code: recovery.code,
    failedDimensions: [...recovery.failed_dimensions],
    missingPrerequisiteSourceIds: [...recovery.missing_prerequisite_source_ids],
    unknownPrerequisiteRefs: [...recovery.unknown_prerequisite_refs],
    requiredAction: recovery.required_action,
    fixScope: recovery.fix_scope,
    ...(recovery.recommended_level ? { recommendedLevel: recovery.recommended_level } : {}),
    canRecover: recovery.can_recover,
    attempts: recovery.recovery_attempts,
    message: recovery.message,
  }
}

function recoveryWorkflowEvents(
  runId: string,
  recovery: ReviewRecoverySummary,
  history: ReviewRecoveryAttempt[],
): RoleDWorkflowEvent[] {
  if (history.length === 0 && recovery.required_action === "none") return []
  return [{
    id: `${runId}-review-recovery-${history.length}`,
    agent: recovery.fix_scope === "new_spec" ? "B/C recovery-loop" : "A/C recovery-loop",
    stage: "审核恢复",
    status: recovery.code === "READY" ? "completed" : "blocked",
    summary: recovery.message,
    timestamp: "刚刚",
  }]
}

export type { SubmitRoleCAssessmentInput } from "./contracts"

export async function submitRoleCAssessment(
  input: SubmitRoleCAssessmentInput,
  runtime: RoleCForRoleDRuntimeOptions = {},
): Promise<LearningCyclePublicOutcome> {
  const persistence = resolveRoleCLearningPersistence(runtime)
  const runner = await resolveRoleCCodeRunner(runtime)
  const service = new LearningCycleService({
    cycle_store: persistence.cycleStore,
    secure_store: persistence.secureStore,
    mastery_store: persistence.masteryStore,
    code_runner: runner,
    ...(runtime.profileDriftMinimumConflicts !== undefined
      ? { profile_drift_minimum_conflicts: runtime.profileDriftMinimumConflicts }
      : {}),
    ...(runtime.learningProgressPort
      ? {
          learning_progress_delivery: {
            mode: "required" as const,
            port: runtime.learningProgressPort,
          },
        }
      : {}),
  })
  return service.processSubmission({
    session_id: input.sessionId,
    authenticated_learner_id_hash: input.learnerId,
    submission: {
      schema_version: "1.0",
      submission_id: input.submissionId,
      run_id: input.runId,
      learner_id_hash: input.learnerId,
      form_id: input.formId,
      attempt_no: input.attemptNo,
      answers: input.answers,
    },
  })
}

export async function runRoleCAssessmentCode(
  input: RunRoleCAssessmentCodeInput,
  runtime: RoleCForRoleDRuntimeOptions = {},
) {
  let runner: CodeRunner
  try { runner = await resolveRoleCCodeRunner(runtime) }
  catch { return { status: "blocked" as const, executionId: input.executionId, itemId: input.itemId, code: "RUNNER_UNAVAILABLE", message: "代码执行服务暂不可用" } }
  const persistence = resolveRoleCLearningPersistence(runtime)
  const service = new LearningCycleService({ cycle_store: persistence.cycleStore, secure_store: persistence.secureStore, mastery_store: persistence.masteryStore, code_runner: runner })
  const result = await service.executeAssessmentCode({ execution_id: input.executionId, session_id: input.sessionId, run_id: input.runId, authenticated_learner_id_hash: input.learnerId, item_id: input.itemId, code: input.code })
  if (result.status === "blocked") return { status: "blocked" as const, executionId: result.execution_id, itemId: result.item_id, code: result.code, message: result.message }
  return { status: result.status, executionId: result.execution_id, runId: result.run_id, itemId: result.item_id, passedChecks: result.passed_checks, totalChecks: result.total_checks, scoreRatio: result.score_ratio, feedback: result.feedback_codes.map((feedbackCode) => ({ code: feedbackCode, message: codeLabFeedbackMessage(feedbackCode) })) }
}

/** Executes one published code lab without accepting hidden tests from D. */
export async function runRoleCCodeLab(
  input: RunRoleCCodeLabInput,
  runtime: RoleCForRoleDRuntimeOptions = {},
): Promise<RunRoleCCodeLabResult> {
  let runner: CodeRunner
  try {
    runner = await resolveRoleCCodeRunner(runtime)
  } catch {
    return {
      status: "blocked",
      executionId: input.executionId,
      code: "RUNNER_UNAVAILABLE",
      message: "代码执行服务暂不可用",
    }
  }
  const persistence = resolveRoleCLearningPersistence(runtime)
  const service = new LearningCycleService({
    cycle_store: persistence.cycleStore,
    secure_store: persistence.secureStore,
    mastery_store: persistence.masteryStore,
    code_runner: runner,
  })
  const result = await service.executePublishedCodeLab({
    execution_id: input.executionId,
    session_id: input.sessionId,
    run_id: input.runId,
    authenticated_learner_id_hash: input.learnerId,
    lab_id: input.labId,
    code: input.code,
  })
  if (result.status === "blocked") {
    return {
      status: "blocked",
      executionId: result.execution_id,
      code: result.code,
      message: result.message,
    }
  }
  return {
    status: result.status,
    executionId: result.execution_id,
    runId: result.run_id,
    labId: result.lab_id,
    passedChecks: result.passed_checks,
    totalChecks: result.total_checks,
    scoreRatio: result.score_ratio,
    feedback: result.feedback_codes.map((code) => ({
      code,
      message: codeLabFeedbackMessage(code),
    })),
  }
}

/**
 * Completes the backend-owned post-submission loop. The current run, profile,
 * evidence and feedback are reloaded from C storage; a new B path is refreshed
 * through A before it can enter generation.
 */
export async function continueRoleCAfterSubmission(
  input: ContinueRoleCAfterSubmissionInput,
  runtime: RoleCForRoleDRuntimeOptions = {},
): Promise<ContinueRoleCForRoleDResult> {
  const configurationIssue = roleCProviderConfigurationIssue(runtime)
  if (configurationIssue) {
    return {
      status: "blocked",
      stage: "configuration",
      reason: configurationIssue,
    }
  }

  if (!runtime.roleDPort) {
    return {
      status: "blocked",
      stage: "configuration",
      reason: "Role D durable delivery port is not configured",
    }
  }

  const persistence = resolveRoleCLearningPersistence(runtime)
  let session: Awaited<ReturnType<LearningCycleStore["loadSession"]>>
  let knowledgeBase: KnowledgeBase
  try {
    const loaded = await Promise.all([
      persistence.cycleStore.loadSession(input.sessionId),
      loadKnowledgeBase(),
    ])
    session = loaded[0]
    knowledgeBase = loaded[1]
  } catch (error) {
    return continuationPreparationBlocked(
      `学习会话读取失败：${errorMessage(error)}`,
    )
  }
  if (!session
    || session.session_state.learner_id_hash !== input.learnerId) {
    return continuationPreparationBlocked("学习会话不存在或学习者身份不一致")
  }
  let currentRun: Awaited<ReturnType<LearningCycleStore["loadRun"]>>
  try {
    currentRun = await persistence.cycleStore.loadRun(session.run_id)
  } catch (error) {
    return continuationPreparationBlocked(
      `当前学习 run 读取失败：${errorMessage(error)}`,
    )
  }
  if (!currentRun
    || currentRun.learner_id_hash !== input.learnerId
    || !currentRun.profile_snapshot) {
    return continuationPreparationBlocked(
      "当前学习 run 缺少可信画像；请重新生成本轮内容后再继续",
    )
  }

  const runtimeEnv = runtime.env ?? process.env
  let modelGateway: ReturnType<typeof createRoleCModelGatewayFromEnv> | undefined
  let runner: CodeRunner
  try {
    modelGateway = runtime.providerMode === "model"
      ? createRoleCModelGatewayFromEnv(runtimeEnv)
      : undefined
    runner = await resolveRoleCCodeRunner(runtime)
  } catch (error) {
    return {
      status: "blocked",
      stage: "configuration",
      reason: error instanceof Error
        ? error.message
        : "C 的模型 Provider 或 Docker CodeRunner 不可用",
    }
  }
  const provider = runtime.provider ?? new ModelBackedRoleCContentProvider(
    modelGateway!,
    {
      ...modelBackedProviderOptionsFromEnv(runtimeEnv),
      stage_failure_diagnostic_sink: stageDiagnosticSink(runtime.dataDirectory),
    },
  )
  const agents = createRoleCAgents(provider, {
    code_lab: new TrustedCodeLabVerifier(runner),
    assessment: new TrustedAssessmentVerifier(runner),
  })
  const cycleService = new LearningCycleService({
    cycle_store: persistence.cycleStore,
    secure_store: persistence.secureStore,
    mastery_store: persistence.masteryStore,
    code_runner: runner,
  })
  const evidenceRefreshPort = runtime.evidenceRefreshPort
    ?? createRoleCRecoveryEvidenceRefreshPort({
      kbVersion: knowledgeBase.version,
      knowledgeBase,
    })
  const pathPlanningPort = runtime.pathPlanningPort
    ?? createLocalBPathPlanningPort(knowledgeBase)

  let nextPathNode = input.nextPathNode
    ? structuredClone(input.nextPathNode)
    : undefined
  let nextEvidencePack: RagEvidencePack | undefined
  let advanceProfileSnapshot: LearnerProfileSnapshot | undefined

  // Advance flow: when D does not provide a next path node and the completed
  // submission's feedback action is "advance", proactively call B to plan the
  // next learning node instead of returning `awaiting_path_node` to D.
  if (!nextPathNode) {
    const completedSubmission = await persistence.cycleStore.loadSubmission(
      input.sessionId,
      input.submissionId,
    )
    if (
      completedSubmission?.status === "COMPLETED"
      && completedSubmission.feedback?.final_decision.action === "advance"
    ) {
      const replanResult = await pathPlanningPort.replanLearningPath({
        schema_version: "1.0",
        request_id: stableId("ADVANCE-REPLAN", {
          run_id: currentRun.run_id,
          submission_id: input.submissionId,
        }),
        run_id: currentRun.run_id,
        current_spec_id:
          currentRun.pipeline_input.generation_spec.spec_id,
        profile_snapshot: currentRun.profile_snapshot,
        current_path_node: defineLearningPathNode({
          ...structuredClone(
            currentRun.pipeline_input.generation_spec.path_node,
          ),
          objectives: structuredClone(
            currentRun.pipeline_input.generation_spec.targets,
          ),
          assessment_blueprint: structuredClone(
            currentRun.pipeline_input.generation_spec.assessment_blueprint,
          ),
        }),
        failed_dimensions: [],
        missing_prerequisite_source_ids: [],
        required_action: "replan_path",
        fix_scope: "new_spec",
        review_instruction_ids: [],
      })
      if (replanResult.status === "blocked") {
        return continuationPreparationBlocked(
          `B 无法规划下一学习节点：${replanResult.reason}`,
        )
      }
      const rawPathNode = replanResult.path_draft
      const bProfile =
        replanResult.profile_snapshot ?? currentRun.profile_snapshot
      if (bProfile.learner_id !== currentRun.profile_snapshot.learner_id) {
        return continuationPreparationBlocked(
          "B 返回的新画像属于另一名学习者",
        )
      }
      advanceProfileSnapshot = bProfile
      nextPathNode = defineLearningPathNode({
        ...structuredClone(rawPathNode),
        objectives: rawPathNode.objectives.map((obj) => ({
          ...obj,
          required_fact_ids: [...obj.required_fact_ids],
        })),
      })
      const refreshed = await refreshNextPathEvidence(
        nextPathNode,
        bProfile,
        currentRun.run_id,
        evidenceRefreshPort,
      )
      if (!refreshed.ok) {
        return continuationPreparationBlocked(refreshed.reason)
      }
      nextPathNode = refreshed.pathNode
      nextEvidencePack = refreshed.evidencePack
    }
  }

  if (nextPathNode && !nextEvidencePack) {
    const nextProfile = input.nextProfileSnapshot
      ?? currentRun.profile_snapshot
    if (nextProfile.learner_id !== currentRun.profile_snapshot.learner_id) {
      return continuationPreparationBlocked("B 返回的新画像属于另一名学习者")
    }
    const refreshed = await refreshNextPathEvidence(
      nextPathNode,
      nextProfile,
      currentRun.run_id,
      evidenceRefreshPort,
    )
    if (!refreshed.ok) {
      return continuationPreparationBlocked(refreshed.reason)
    }
    nextPathNode = refreshed.pathNode
    nextEvidencePack = refreshed.evidencePack
  }

  const adaptiveExecutionJournal = resolveAdaptiveJournal(runtime)
  let continuation: Awaited<ReturnType<typeof continueCompletedLearningCycle>>
  try {
    continuation = await continueCompletedLearningCycle(
      {
        session_id: input.sessionId,
        submission_id: input.submissionId,
        authenticated_learner_id_hash: input.learnerId,
        ...(nextPathNode ? { next_path_node: nextPathNode } : {}),
        ...(nextEvidencePack ? { next_evidence_pack: nextEvidencePack } : {}),
        ...(advanceProfileSnapshot
          ? { next_profile_snapshot: structuredClone(advanceProfileSnapshot) }
          : input.nextProfileSnapshot
            ? { next_profile_snapshot: structuredClone(input.nextProfileSnapshot) }
            : {}),
        ...(input.nextGenerationAction
          ? { next_generation_action: input.nextGenerationAction }
          : {}),
        current_generation_versions: {
          prompt_version: ROLE_C_PROMPT_MANIFEST_VERSION,
          model_config_hash: modelGateway
            ? modelGateway.model_config_hash
            : "deterministic-role-d-local-reference-v1",
          runner_image_digest: runner.runner_image_digest,
        },
      },
      {
        learning_cycle: cycleService,
        agents,
        secure_store: persistence.secureStore,
        review_options: {
          review_port: runtime.reviewPort
            ?? createLocalABContentReviewPort({ knowledge_base: knowledgeBase }),
          ...(runtime.critic ? { critic: runtime.critic } : {}),
          max_external_revisions: 2,
        },
        review_execution_config_version: "role-c-role-d-review-v1",
        evidence_refresh_port: evidenceRefreshPort,
        path_planning_port: pathPlanningPort,
        max_recovery_attempts: 2,
        recovery_policy_version: "role-c-review-recovery-v1",
        recovery_port_version: "role-c-a-b-runtime-v1",
        role_d_port: runtime.roleDPort,
        delivery_target_namespace:
          runtime.deliveryTargetNamespace ?? "role-d-http-facade-v1",
        ...(adaptiveExecutionJournal
          ? { adaptive_execution_journal: adaptiveExecutionJournal }
          : {}),
      },
    )
  } catch (error) {
    return continuationPreparationBlocked(
      `下一轮学习准备失败：${errorMessage(error)}`,
    )
  }

  if (continuation.status === "awaiting_input") {
    const preparation = continuation.preparation
    return preparation.status === "awaiting_path_node"
      ? {
          status: "awaiting_input",
          action: "advance",
          requestId: preparation.request_id,
          requiredInputs: ["nextPathNode"],
        }
      : {
          status: "awaiting_input",
          action: "reprofile",
          requestId: preparation.request_id,
          requiredInputs: [
            "nextProfileSnapshot",
            "nextPathNode",
            "nextGenerationAction",
          ],
          profileDriftSuggestion: structuredClone(preparation.suggestion),
        }
  }
  if (continuation.status !== "published") {
    const stage = continuation.stage
    const reason = continuationFailureReason(continuation)
    return {
      status: continuation.status,
      stage,
      reason,
      continuation,
      ...(stage === "generation_review"
        ? {
            recoveryStatus: createReviewRecoveryStatusDelivery(
              continuation.generation,
            ),
          }
        : {}),
    }
  }

  let publishedRun: Awaited<ReturnType<LearningCycleStore["loadRun"]>>
  try {
    publishedRun = await persistence.cycleStore.loadRun(
      continuation.generation.run_id,
    )
  } catch (error) {
    return continuationPreparationBlocked(
      `下一轮公开上下文读取失败：${errorMessage(error)}`,
    )
  }
  if (!publishedRun?.profile_snapshot) {
    return continuationPreparationBlocked(
      "下一轮已生成，但持久化 run 缺少公开交接上下文",
    )
  }
  return {
    status: "published",
    continuation,
    reviewedRelease: createReviewedReleaseDelivery(
      publishedRun.pipeline_result,
    ),
    learningSession: createLearningSessionDelivery(
      publishedRun.pipeline_result,
      continuation.learning_session,
    ),
    artifacts: toRoleDArtifacts(
      publishedRun.pipeline_result.public_artifacts,
    ),
    finalContext: {
      profileSnapshot: structuredClone(publishedRun.profile_snapshot),
      profileVersion: publishedRun.profile_snapshot.profile_version,
      pathNode: defineLearningPathNode({
        ...structuredClone(publishedRun.pipeline_input.generation_spec.path_node),
        objectives: structuredClone(
          publishedRun.pipeline_input.generation_spec.targets,
        ),
        assessment_blueprint: structuredClone(
          publishedRun.pipeline_input.generation_spec.assessment_blueprint,
        ),
      }),
      evidencePack: projectPublicRagEvidencePack(
        publishedRun.pipeline_input.evidence_pack,
      ),
    },
  }
}

/** Trusted anchor routing for the anchor-first sessions returned by continuation. */
export async function routeRoleCAssessmentAnchors(
  input: RouteRoleCAssessmentAnchorsInput,
  runtime: RoleCForRoleDRuntimeOptions = {},
): Promise<RouteRoleCAssessmentAnchorsResult> {
  const persistence = resolveRoleCLearningPersistence(runtime)
  const runner = await resolveRoleCCodeRunner(runtime)
  const service = new LearningCycleService({
    cycle_store: persistence.cycleStore,
    secure_store: persistence.secureStore,
    mastery_store: persistence.masteryStore,
    code_runner: runner,
  })
  try {
    return await service.routeAssessmentAnchors({
      routing_request_id: input.routingRequestId,
      session_id: input.sessionId,
      run_id: input.runId,
      authenticated_learner_id_hash: input.learnerId,
      attempt_no: input.attemptNo,
      anchor_submission: {
        schema_version: "1.0",
        submission_id: input.submissionId,
        run_id: input.runId,
        learner_id_hash: input.learnerId,
        form_id: input.formId,
        attempt_no: input.attemptNo,
        answers: structuredClone(input.answers),
      },
      revealed_anchor_hint_levels: Object.fromEntries(
        input.answers.map((answer) => [answer.item_id, answer.hint_level_used]),
      ),
    })
  } catch (error) {
    return {
      status: "blocked",
      routing_request_id: input.routingRequestId,
      issues: [`锚点路由失败：${errorMessage(error)}`],
    }
  }
}

function roleCProviderConfigurationIssue(
  runtime: RoleCForRoleDRuntimeOptions,
): string | undefined {
  if (runtime.provider) return undefined
  if (runtime.providerMode === "deterministic") {
    return "确定性离线模板 Provider 已删除。请设置 ROLE_C_PROVIDER_MODE=model、模型接口地址和模型名称。"
  }
  if (runtime.providerMode !== "model") {
    return "C 的通用内容生成模型尚未配置。请设置 ROLE_C_PROVIDER_MODE=model、模型接口地址和模型名称。"
  }
  return undefined
}

function resolveAdaptiveJournal(
  runtime: RoleCForRoleDRuntimeOptions,
): AdaptiveLearningLoopJournal | undefined {
  if (runtime.adaptiveExecutionJournal) {
    return runtime.adaptiveExecutionJournal
  }
  return runtime.dataDirectory
    ? new AtomicFileAdaptiveLearningLoopJournal({
        root_directory: join(
          resolve(runtime.dataDirectory),
          "adaptive-learning-loop",
        ),
      })
    : undefined
}

type NextPathEvidenceRefreshResult =
  | {
      ok: true
      pathNode: LearningPathNode
      evidencePack: RagEvidencePack
    }
  | { ok: false; reason: string }

async function refreshNextPathEvidence(
  pathNode: LearningPathNode,
  profile: LearnerProfileSnapshot,
  parentRunId: string,
  port: EvidenceRefreshPort,
): Promise<NextPathEvidenceRefreshResult> {
  const sourceIds = [...new Set([
    ...pathNode.target_source_ids,
    ...pathNode.prerequisite_source_ids,
  ])]
  if (sourceIds.length === 0) {
    return { ok: false, reason: "B 返回的新路径没有目标或先修知识点" }
  }
  let evidence: RagEvidencePack
  try {
    evidence = await port.refreshEvidence({
      schema_version: "1.0",
      request_id: stableId("RAG-NEXT", {
        parent_run_id: parentRunId,
        path_node_id: pathNode.node_id,
        profile_version: profile.profile_version,
      }),
      run_id: parentRunId,
      target_source_ids: sourceIds,
      missing_type: "knowledge_item",
      reason: "为 B 确认的下一学习节点刷新完整目标与先修证据",
      learner_level: profile.level,
      required_facts: pathNode.objectives.flatMap((objective) =>
        objective.required_fact_ids.map((factId) => ({
          source_id: objective.source_id,
          fact_id: factId,
        }))),
    })
  } catch (error) {
    return {
      ok: false,
      reason: `A 下一路径证据刷新失败：${error instanceof Error ? error.message : "未知错误"}`,
    }
  }

  const evidenceBySource = new Map(
    evidence.results.map((result) => [result.source_id, result]),
  )
  const missingSources = sourceIds.filter((sourceId) =>
    !evidenceBySource.has(sourceId))
  if (missingSources.length > 0) {
    return {
      ok: false,
      reason: `A 未返回下一路径所需证据：${missingSources.join("、")}`,
    }
  }

  const resolvedPath = structuredClone(pathNode)
  let boundFacts = false
  for (const objective of resolvedPath.objectives) {
    const item = evidenceBySource.get(objective.source_id)
    if (!item) {
      return {
        ok: false,
        reason: `A 未返回目标 ${objective.objective_id} 对应的 ${objective.source_id}`,
      }
    }
    const availableFacts = new Set(item.facts.map((fact) => fact.fact_id))
    if (objective.required_fact_ids.length === 0) {
      objective.required_fact_ids = [...availableFacts].sort().slice(0, 3)
      boundFacts = true
    }
    const missingFacts = objective.required_fact_ids.filter((factId) =>
      !availableFacts.has(factId))
    if (objective.required_fact_ids.length === 0 || missingFacts.length > 0) {
      return {
        ok: false,
        reason: missingFacts.length > 0
          ? `A 未返回目标 ${objective.objective_id} 的必要事实：${missingFacts.join("、")}`
          : `目标 ${objective.objective_id} 没有可绑定事实`,
      }
    }
  }
  if (boundFacts) {
    resolvedPath.node_id = stableId("PATH-C-NEXT", {
      upstream_path_node_id: pathNode.node_id,
      profile_version: profile.profile_version,
      objectives: resolvedPath.objectives,
    })
  }
  return {
    ok: true,
    pathNode: defineLearningPathNode(resolvedPath),
    evidencePack: evidence,
  }
}

function continuationPreparationBlocked(
  reason: string,
): ContinueRoleCForRoleDResult {
  return {
    status: "blocked",
    stage: "preparation",
    reason,
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "未知错误"
}

function continuationFailureReason(
  continuation: Extract<
    import("../role-c-content").ContinueCompletedLearningCycleResult,
    { status: "blocked" | "failed" }
  >,
): string {
  if (continuation.stage === "generation_review") {
    return continuation.generation.recovery.message
  }
  const preparation = continuation.preparation
  return "errors" in preparation && Array.isArray(preparation.errors)
    ? preparation.errors.join("；")
    : "下一轮准备未通过"
}

function resolveRoleCLearningPersistence(
  runtime: Pick<RoleCForRoleDRuntimeOptions, "dataDirectory" | "learningPersistence">,
): RoleCLearningPersistence {
  if (runtime.learningPersistence) return runtime.learningPersistence
  if (runtime.dataDirectory) {
    return createAtomicRoleCLearningPersistence(runtime.dataDirectory)
  }
  return defaultInMemoryLearningPersistence
}

function sourceIdOf(item: RagResultItem): string {
  return item.sourceId ?? item.source_id
}

function reviewAuditSummary(
  reports: ContentReviewResult[],
  artifacts: RoleDGeneratedArtifact[],
): RoleDContentAuditSummary | undefined {
  const final = reports.at(-1)
  if (!final) return undefined
  const artifactById = new Map(artifacts.map((artifact) => [artifact.id, artifact]))
  const factAudits = final.artifact_results.map((result) => {
    const artifact = artifactById.get(result.artifact_id)
    const factFindings = result.findings.filter((finding) =>
      finding.source === "fact_audit")
    return {
      artifactId: result.artifact_id,
      artifactTitle: artifact?.title ?? result.artifact_id,
      artifactKind: result.artifact_kind === "concept" ? "lesson" as const : result.artifact_kind === "code_lab" ? "lab" as const : "assessment" as const,
      status: result.fact_status,
      checkedClaims: artifact?.citations.length ?? 0,
      conflicts: factFindings.length,
      notes: factFindings.map((finding) => finding.message).slice(0, 3),
    }
  })
  const factStatus = combineReviewStatuses(final.artifact_results.map((result) => result.fact_status))
  const teachingStatus = combineReviewStatuses(final.artifact_results.map((result) => result.teaching_status))
  return {
    factStatus,
    factAudits,
    teachingAudit: {
      artifactId: "role-c-reviewed-content",
      status: teachingStatus,
      summary: teachingStatus === "pass" ? "B 教学审核通过。" : "B 教学审核未通过。",
      revisionHints: final.revision_instructions.filter((instruction) => instruction.source === "teaching_audit").map((instruction) => instruction.proposed_action),
    },
    arbitration: {
      artifactId: "role-c-reviewed-content",
      decision: final.decision,
      revisionRound: final.revision_round,
      maxRevisionRounds: final.max_revision_rounds,
      canRevise: final.decision === "revise" && final.revision_round < final.max_revision_rounds,
      reason: final.decision === "pass"
        ? "A/B 双审核已通过，C 公开产物可以发布给 D。"
        : final.decision === "revise"
          ? "A/B 审核要求 C 修订后重新提交。"
          : "A/B 审核驳回，本轮产物未发布给 D。",
    },
  }
}

function combineReviewStatuses(statuses: Array<"pass" | "revise" | "reject">): "pass" | "revise" | "reject" {
  if (statuses.includes("reject")) return "reject"
  if (statuses.includes("revise")) return "revise"
  return "pass"
}

function toRoleDArtifacts(publicArtifacts: {
  concept_lesson?: ConceptLessonArtifact
  code_lab?: CodeLabPublicArtifact
  assessment?: AssessmentPublicArtifact
}): RoleDGeneratedArtifact[] {
  const concept = publicArtifacts.concept_lesson
  const lab = publicArtifacts.code_lab
  const assessment = publicArtifacts.assessment
  if (!concept?.payload || concept.artifact_type !== "concept_lesson") return []
  if (!lab?.payload || lab.artifact_type !== "code_lab_public") return []
  if (!assessment?.payload || assessment.artifact_type !== "assessment_public") return []

  const assessmentItems: RoleDAssessmentItem[] = assessment.payload.items.map((item) => ({
    id: item.item_id,
    tier: item.tier,
    modality: item.modality,
    prompt: item.prompt,
    options: item.options?.map((option) => `${option.label}. ${option.text}`) ?? [],
    option_ids: item.options?.map((option) => option.option_id) ?? [],
    maxScore: item.max_score,
    ...(item.starter_code ? { starter_code: item.starter_code } : {}),
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
      sections: conceptSections(concept.payload),
    },
    {
      id: lab.artifact_id,
      kind: "lab",
      title: lab.payload.title,
      status: "real",
      content: lab.payload.starter_code,
      options: [],
      citations: simplifyCitations(lab.citations),
      items: [],
      lab: toRoleDCodeLab(lab.payload),
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
    },
  ]
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

function conceptSections(payload: NonNullable<ConceptLessonArtifact["payload"]>): RoleDGeneratedArtifact["sections"] {
  const blocks = [...payload.prerequisite_bridge, ...payload.explanation_blocks, ...payload.worked_examples, ...payload.summary]
  return [
    ...blocks.flatMap((block) => toRoleDSection(block)),
    ...payload.misconceptions.map((item, index) => ({
      id: `misconception-${index + 1}`,
      title: "常见误区",
      kind: "callout" as const,
      text: item.explanation,
      citations: simplifyCitations(item.citations),
    })),
  ]
}

function toRoleDSection(block: RenderBlock): NonNullable<RoleDGeneratedArtifact["sections"]> {
  if (block.block_type === "heading") return [{ id: block.block_id, title: block.text, kind: "heading", text: block.text, citations: [] }]
  if (block.block_type === "paragraph") return [{ id: block.block_id, title: block.text.split(/[。！？]/)[0]!.slice(0, 28), kind: "paragraph", text: block.text, citations: simplifyCitations(block.claims.flatMap((claim) => claim.citations)) }]
  if (block.block_type === "code") return [{ id: block.block_id, title: block.caption ?? "代码示例", kind: "code", code: block.code, language: block.language, citations: simplifyCitations(block.claims.flatMap((claim) => claim.citations)) }]
  if (block.block_type === "callout") return [{ id: block.block_id, title: block.title, kind: "callout", text: block.text, citations: simplifyCitations(block.claims.flatMap((claim) => claim.citations)) }]
  if (block.block_type === "comparison") return [{ id: block.block_id, title: block.title, kind: "comparison", text: block.columns.map((column) => `${column.heading}：${column.content}`).join("\n"), citations: simplifyCitations(block.claims.flatMap((claim) => claim.citations)) }]
  return []
}

function toRoleDCodeLab(
  payload: NonNullable<CodeLabPublicArtifact["payload"]>,
): RoleDCodeLab {
  return {
    lab_id: payload.lab_id,
    instructions: payload.instructions.flatMap((block) => toRoleDSection(block)),
    execution_contract: structuredClone(payload.execution_contract),
    starter_code: payload.starter_code,
    public_tests: payload.public_tests.map((test) => ({
      id: test.test_id,
      objective_id: test.objective_id,
      description: test.description,
      input: structuredClone(test.input),
      expected_behavior: test.expected_behavior,
      citations: simplifyCitations(test.citations),
    })),
    hint_ladders: payload.hint_ladders.map((ladder) => ({
      objective_id: ladder.objective_id,
      hints: ladder.hints.map((hint) => ({
        level: hint.hint_level,
        text: hint.text,
        citations: simplifyCitations(hint.citations),
      })),
    })),
    reflection_questions: [...payload.reflection_questions],
  }
}

function codeLabFeedbackMessage(
  code: RoleCCodeLabFeedbackCode,
): string {
  return ({
    assertion_failed: "代码已运行，但部分检查结果不符合要求。",
    syntax_error: "代码存在语法错误，请检查缩进、括号和关键字。",
    runtime_error: "代码运行时发生错误，请检查变量、类型和边界情况。",
    output_limit: "程序输出过多，请检查循环或输出逻辑。",
    non_json_output: "程序返回值不符合实验约定。",
    forbidden_import: "代码使用了本实验不允许的导入。",
    forbidden_syntax: "代码使用了本实验不允许的语法。",
    resource_limit_exceeded: "程序超出运行资源限制。",
    execution_timeout: "程序运行超时，请检查循环和算法。",
    execution_failed: "代码暂未通过检查，请结合实验提示继续修改。",
  })[code]
}

function simplifyCitations(citations: CitationRef[]): RoleDPublicCitation[] {
  return [...new Map(citations.map((citation) => [
    `${citation.source_id}:${citation.fact_id}`,
    { source_id: citation.source_id, fact_id: citation.fact_id },
  ])).values()]
}

function toWorkflowEvent(event: AgentTraceEvent): RoleDWorkflowEvent {
  const status = event.status === "success"
    ? "completed"
    : event.status === "started"
      ? "running"
      : event.status === "blocked" || event.status === "failed"
        ? "blocked"
        : "pending"
  return {
    id: `${event.run_id}-${event.seq}`,
    agent: event.agent ?? "role-c-pipeline",
    stage: stageLabel(event),
    status,
    summary: event.summary ?? event.event_type,
    timestamp: event.occurred_at ?? "刚刚",
  }
}

function stageLabel(event: AgentTraceEvent): string {
  if (event.agent === "concept-tutor") {
    if (event.event_type === "c.agent.started") return "定制讲义生成"
    if (event.event_type === "c.agent.ready") return "定制讲义准备"
    if (event.status === "blocked" || event.status === "failed") return "定制讲义受阻"
    return "定制讲义"
  }
  if (event.agent === "code-lab") return "代码实验"
  if (event.agent === "tiered-evaluator") return "分阶测评"
  return event.event_type === "c.pipeline.ready" ? "C 内容发布" : "C 入口校验"
}

