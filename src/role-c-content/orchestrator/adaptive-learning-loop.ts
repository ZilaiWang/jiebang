import { contentHash, stableId } from "../contracts/common"
import type {
  EvidenceGapRequest,
  EvidenceRefreshPort,
  RagEvidencePack,
} from "../contracts/evidence-pack"
import {
  deliverLearningSessionToD,
  deliverReviewRecoveryStatusToD,
  deliverRoleCToD,
  type RoleCDeliveryAck,
  type RoleCLearningSessionHandoff,
  type RoleDLearningSessionPort,
  type RoleDPublicDeliveryPort,
  type RoleDReviewRecoveryStatusPort,
} from "../contracts/external-api"
import type {
  RoleBPathPlanningPort,
  RoleBPathPlanningRequest,
  RoleBPathPlanningResult,
} from "../contracts/recovery"
import {
  InMemoryAdaptiveLearningLoopJournal,
  type AdaptiveLearningLoopJournal,
  type AdaptiveLearningLoopJournalEntry,
} from "../reliability/adaptive-learning-loop-journal"
import {
  runRecoverableReviewedCPipeline,
  toReviewRecoveryPublicResult,
  type RecoverableReviewedCPipelineResult,
  type RecoverableReviewedReadyContext,
  type ReviewRecoveryPublicResult,
} from "../review/run-recoverable-pipeline"
import { assertReviewedReadyPipeline } from "../review/validate-reviewed-release"
import type { SecureArtifactStore } from "../security/secure-artifact-store"
import { validatePublicArtifactNoSecrets } from "../validators/public-secure-leak-validator"
import type { CPipelineInput } from "./content-pipeline"
import type {
  OpenTrustedPreselectedSessionInput,
  PrepareNextRoundFromCompletedSubmissionInput,
  RegisterReadyRunInput,
} from "./learning-cycle-service"
import {
  assertNextRoundSecureArtifactsResolvable,
  executeReviewedPipelineInput,
  type GenerationReadyNextRound,
  type NextRoundExecutionDependencies,
  type NextRoundPreparation,
} from "./next-round"

/**
 * Trusted preparation and persistence boundary implemented by
 * LearningCycleService.
 */
export interface CompletedSubmissionNextRoundPort {
  prepareNextRoundFromCompletedSubmission(
    input: PrepareNextRoundFromCompletedSubmissionInput,
  ): Promise<NextRoundPreparation>
  registerReadyRun(input: RegisterReadyRunInput): Promise<unknown>
  openTrustedPreselectedSession(input: OpenTrustedPreselectedSessionInput): Promise<unknown>
}

export interface RoleDAdaptiveLearningLoopPort
extends RoleDPublicDeliveryPort,
  RoleDReviewRecoveryStatusPort,
  RoleDLearningSessionPort {}

export interface ContinueCompletedLearningCycleDependencies
extends NextRoundExecutionDependencies {
  learning_cycle: CompletedSubmissionNextRoundPort
  role_d_port: RoleDAdaptiveLearningLoopPort
  evidence_refresh_port?: EvidenceRefreshPort
  path_planning_port?: RoleBPathPlanningPort
  max_recovery_attempts?: 0 | 1 | 2
  /** Version of C's recovery decision and retry semantics. */
  recovery_policy_version: string
  /** Version of the configured A/B recovery adapters and their contracts. */
  recovery_port_version: string
  /** Stable identity of the D receiver used by this execution. */
  delivery_target_namespace: string
  /** Inject the atomic file adapter when executions must survive restarts. */
  adaptive_execution_journal?: AdaptiveLearningLoopJournal
  /** Injectable orchestration seam; production uses the recoverable pipeline. */
  recoverable_pipeline_runner?: typeof runRecoverableReviewedCPipeline
}

export interface GenerationReadyNextRoundSummary {
  status: "generation_ready"
  action: GenerationReadyNextRound["action"]
  generation_action: GenerationReadyNextRound["generation_action"]
  request_id: string
  idempotency_key: string
  parent_spec_id: string
  prior_feedback_ref: string
  trigger_objective_ids: string[]
  focus_objective_ids: string[]
  run_id: string
  spec_id: string
  path_node_id: string
  profile_version: string
  evidence_ref: string
}

export type SafeNextRoundPreparation =
  | Exclude<NextRoundPreparation, GenerationReadyNextRound>
  | GenerationReadyNextRoundSummary

export type RecoverableGenerationSummary = ReviewRecoveryPublicResult

export type ContinueCompletedLearningCycleResult =
  | {
      status: "awaiting_input"
      preparation: Exclude<
        SafeNextRoundPreparation,
        GenerationReadyNextRoundSummary
          | Extract<SafeNextRoundPreparation, { status: "blocked" }>
      >
    }
  | {
      status: "blocked"
      stage: "preparation"
      preparation: Extract<SafeNextRoundPreparation, { status: "blocked" }>
    }
  | {
      status: "blocked" | "failed"
      stage: "generation_review"
      preparation: GenerationReadyNextRoundSummary
      generation: RecoverableGenerationSummary
      /** Omitted only when a transient A/B port failure remains retryable. */
      delivery_to_d?: RoleCDeliveryAck
    }
  | {
      status: "published"
      preparation: GenerationReadyNextRoundSummary
      generation: RecoverableGenerationSummary & {
        pipeline_status: "ready"
        pipeline_state: "READY"
      }
      learning_session: RoleCLearningSessionHandoff
      delivery_to_d: {
        reviewed_release: RoleCDeliveryAck
        learning_session: RoleCDeliveryAck
      }
    }

type AdaptiveExecutionPhase =
  | "STARTED"
  | "GENERATED"
  | "ACTIVATING"
  | "ACTIVATED"
  | "DELIVERING"
  | "PUBLISHED"
  | "TERMINAL_DELIVERING"
  | "TERMINAL"

interface AdaptiveRecoveryPortOperation {
  operation_key: string
  kind: "evidence_refresh" | "path_planning"
  request_hash: string
  attempt_count: number
  status: "pending" | "succeeded" | "failed"
  response_hash?: string
  response?: RagEvidencePack | RoleBPathPlanningResult
}

interface AdaptiveGeneratedCheckpoint {
  result: RecoverableReviewedCPipelineResult
  result_hash: string
  ready_context: RecoverableReviewedReadyContext
  ready_context_hash: string
}

interface AdaptiveExecutionState {
  state_version: "1.0"
  phase: AdaptiveExecutionPhase
  preparation: GenerationReadyNextRoundSummary
  preparation_hash: string
  recovery_operations: Record<string, AdaptiveRecoveryPortOperation>
  generated?: AdaptiveGeneratedCheckpoint
  learning_session?: RoleCLearningSessionHandoff
  final_result?: ContinueCompletedLearningCycleResult
}

interface AdaptiveExecutionIdentity {
  source_key: string
  request_hash: string
  execution_key: string
}

interface AdaptiveExecutionConfig {
  orchestration_contract_version: "role-c-adaptive-learning-loop-v2"
  recovery_policy_version: string
  recovery_port_version: string
  review_execution_config_version: string
  review_policy_version: string
  max_external_revisions: 0 | 1 | 2
  max_recovery_attempts: 0 | 1 | 2
  trace_seq_start: number
  secure_store_namespace: string
  delivery_target_namespace: string
}

/**
 * Runs the backend-owned second half of the adaptive loop:
 * trusted completed submission -> updated B/A inputs -> recoverable C review
 * -> durable run/session registration -> idempotent D publication.
 */
export async function continueCompletedLearningCycle(
  input: PrepareNextRoundFromCompletedSubmissionInput,
  dependencies: ContinueCompletedLearningCycleDependencies,
): Promise<ContinueCompletedLearningCycleResult> {
  const preparation =
    await dependencies.learning_cycle.prepareNextRoundFromCompletedSubmission(
      structuredClone(input),
    )
  const safePreparation = summarizePreparation(preparation)
  if (preparation.status === "blocked") {
    return {
      status: "blocked",
      stage: "preparation",
      preparation: safePreparation as Extract<
        SafeNextRoundPreparation,
        { status: "blocked" }
      >,
    }
  }
  if (preparation.status !== "generation_ready") {
    return {
      status: "awaiting_input",
      preparation: safePreparation as Exclude<
        SafeNextRoundPreparation,
        GenerationReadyNextRoundSummary
          | Extract<SafeNextRoundPreparation, { status: "blocked" }>
      >,
    }
  }

  const generationReadySummary =
    safePreparation as GenerationReadyNextRoundSummary
  const executionConfig = normalizeAdaptiveExecutionConfig(dependencies)
  const identity = adaptiveExecutionIdentity(
    input,
    preparation,
    executionConfig,
  )
  const journal = dependencies.adaptive_execution_journal
    ?? defaultAdaptiveLearningLoopJournal

  return journal.withExclusive(identity.execution_key, async (transaction) => {
    let entry = await transaction.load()
    let state: AdaptiveExecutionState
    if (!entry) {
      state = {
        state_version: "1.0",
        phase: "STARTED",
        preparation: structuredClone(generationReadySummary),
        preparation_hash: contentHash(generationReadySummary),
        recovery_operations: {},
      }
      entry = journalEntry(identity, state, 0)
      await transaction.save(entry, undefined)
    } else {
      assertAdaptiveJournalIdentity(entry, identity)
      state = adaptiveExecutionState(
        entry.state,
        generationReadySummary,
      )
    }

    const checkpoint = async (
      nextState: AdaptiveExecutionState,
    ): Promise<void> => {
      const normalized = adaptiveExecutionState(
        nextState,
        generationReadySummary,
      )
      const nextEntry = journalEntry(
        identity,
        normalized,
        entry!.revision + 1,
      )
      await transaction.save(nextEntry, entry!.revision)
      entry = nextEntry
      state = normalized
    }

    if (state.phase === "TERMINAL") {
      return replayFinalResult(state, "generation_review")
    }
    if (state.phase === "TERMINAL_DELIVERING") {
      const pending = replayFinalResult(state, "generation_review")
      if (pending.status === "published"
        || pending.status === "awaiting_input"
        || (pending.status === "blocked"
          && pending.stage === "preparation")) {
        throw new Error("ROLE_C_ADAPTIVE_FINAL_CHECKPOINT_INVALID")
      }
      const deliveryToD = await deliverReviewRecoveryStatusToD(
        dependencies.role_d_port,
        pending.generation,
      )
      const terminal: ContinueCompletedLearningCycleResult = {
        ...pending,
        delivery_to_d: deliveryToD,
      }
      assertPublicContinuationResult(terminal)
      await checkpoint({
        ...state,
        phase: "TERMINAL",
        final_result: structuredClone(terminal),
      })
      return terminal
    }
    if (state.phase === "PUBLISHED") {
      await assertPersistedGeneratedCheckpoint(
        state,
        dependencies.secure_store,
        true,
      )
      return replayFinalResult(state, "published")
    }

    if (state.generated) {
      try {
        await assertPersistedGeneratedCheckpoint(
          state,
          dependencies.secure_store,
          state.phase !== "GENERATED",
        )
      } catch (error) {
        if (state.phase !== "GENERATED"
          || !isUnresolvableSecurePairError(error)) {
          throw error
        }
        await checkpoint({
          ...state,
          phase: "STARTED",
          generated: undefined,
          learning_session: undefined,
          final_result: undefined,
        })
      }
    }

    if (state.phase === "STARTED") {
      let readyContext: RecoverableReviewedReadyContext | undefined
      let recoveryPortAttemptFailed = false
      const persistRecoveryOperation = async (
        operation: AdaptiveRecoveryPortOperation,
      ): Promise<void> => {
        await checkpoint({
          ...state,
          recovery_operations: {
            ...state.recovery_operations,
            [operation.operation_key]: structuredClone(operation),
          },
        })
      }
      const evidencePort = dependencies.evidence_refresh_port
        ? durableEvidenceRefreshPort(
            dependencies.evidence_refresh_port,
            executionConfig.recovery_port_version,
            () => state,
            persistRecoveryOperation,
            () => {
              recoveryPortAttemptFailed = true
            },
          )
        : undefined
      const pathPort = dependencies.path_planning_port
        ? durablePathPlanningPort(
            dependencies.path_planning_port,
            executionConfig.recovery_port_version,
            () => state,
            persistRecoveryOperation,
            () => {
              recoveryPortAttemptFailed = true
            },
          )
        : undefined
      const recoverableRunner = dependencies.recoverable_pipeline_runner
        ?? runRecoverableReviewedCPipeline
      const pipeline = await recoverableRunner(
        nextRoundPipelineInput(preparation),
        dependencies.agents,
        dependencies.secure_store,
        {
          ...dependencies.review_options,
          profile_snapshot: preparation.profile_snapshot,
          ...(evidencePort ? { evidence_refresh_port: evidencePort } : {}),
          ...(pathPort ? { path_planning_port: pathPort } : {}),
          ...(dependencies.max_recovery_attempts !== undefined
            ? { max_recovery_attempts: dependencies.max_recovery_attempts }
            : {}),
          reviewed_pipeline_runner: (candidate, agents, secureStore, options) =>
            executeReviewedPipelineInput(
              candidate,
              {
                execution_scope: "next_round_recovery",
                orchestration_idempotency_key: preparation.idempotency_key,
              },
              {
                ...dependencies,
                agents,
                secure_store: secureStore,
                review_options: options,
              },
            ),
          async on_ready(context) {
            if (readyContext
              && contentHash(readyContext) !== contentHash(context)) {
              throw new Error("ROLE_C_ADAPTIVE_MULTIPLE_READY_CONTEXTS")
            }
            readyContext = structuredClone(context)
          },
        },
      )
      const generation = summarizeGeneration(pipeline)
      if (pipeline.status !== "ready" || pipeline.state !== "READY") {
        const retryable: ContinueCompletedLearningCycleResult = {
          status: pipeline.status === "blocked" ? "blocked" : "failed",
          stage: "generation_review",
          preparation: generationReadySummary,
          generation,
        }
        assertPublicContinuationResult(retryable)
        if (recoveryPortAttemptFailed) return retryable
        await checkpoint({
          ...state,
          phase: "TERMINAL_DELIVERING",
          final_result: structuredClone(retryable),
        })
        const deliveryToD = await deliverReviewRecoveryStatusToD(
          dependencies.role_d_port,
          generation,
        )
        const terminal: ContinueCompletedLearningCycleResult = {
          ...retryable,
          delivery_to_d: deliveryToD,
        }
        assertPublicContinuationResult(terminal)
        await checkpoint({
          ...state,
          phase: "TERMINAL",
          final_result: structuredClone(terminal),
        })
        return terminal
      }
      if (!readyContext) {
        throw new Error("ROLE_C_ADAPTIVE_READY_CONTEXT_MISSING")
      }
      const generated = generatedCheckpoint(pipeline, readyContext)
      assertGeneratedCheckpoint(generated)
      await assertNextRoundSecureArtifactsResolvable(
        generated.ready_context.pipeline_result,
        dependencies.secure_store,
      )
      await checkpoint({
        ...state,
        phase: "GENERATED",
        generated,
        final_result: undefined,
      })
    }

    if (state.phase === "GENERATED") {
      await checkpoint({ ...state, phase: "ACTIVATING" })
    }
    if (state.phase === "ACTIVATING") {
      const generated = requiredGeneratedCheckpoint(state)
      const learningSession = await activateLearningSession(
        input,
        preparation,
        generated.ready_context,
        dependencies.learning_cycle,
      )
      await checkpoint({
        ...state,
        phase: "ACTIVATED",
        learning_session: structuredClone(learningSession),
      })
    }
    if (state.phase === "ACTIVATED") {
      await checkpoint({ ...state, phase: "DELIVERING" })
    }
    if (state.phase !== "DELIVERING") {
      throw new Error("ROLE_C_ADAPTIVE_JOURNAL_PHASE_INVALID")
    }

    const generated = requiredGeneratedCheckpoint(state)
    const learningSession = requiredLearningSession(state)
    const reviewedReleaseDelivery = await deliverRoleCToD(
      dependencies.role_d_port,
      generated.result,
    )
    const learningSessionDelivery = await deliverLearningSessionToD(
      dependencies.role_d_port,
      generated.result,
      learningSession,
    )
    const published: ContinueCompletedLearningCycleResult = {
      status: "published",
      preparation: structuredClone(generationReadySummary),
      generation: summarizeGeneration(generated.result) as
        RecoverableGenerationSummary & {
          pipeline_status: "ready"
          pipeline_state: "READY"
        },
      learning_session: structuredClone(learningSession),
      delivery_to_d: {
        reviewed_release: reviewedReleaseDelivery,
        learning_session: learningSessionDelivery,
      },
    }
    assertPublicContinuationResult(published)
    await checkpoint({
      ...state,
      phase: "PUBLISHED",
      final_result: structuredClone(published),
    })
    return published
  })
}

function normalizeAdaptiveExecutionConfig(
  dependencies: ContinueCompletedLearningCycleDependencies,
): AdaptiveExecutionConfig {
  const requiredVersions = [
    dependencies.recovery_policy_version,
    dependencies.recovery_port_version,
    dependencies.review_execution_config_version,
    dependencies.review_options.review_port.policy_version,
    dependencies.delivery_target_namespace,
  ]
  if (requiredVersions.some((version) => !version.trim())) {
    throw new Error("ROLE_C_ADAPTIVE_EXECUTION_VERSION_EMPTY")
  }
  const maxExternalRevisions =
    dependencies.review_options.max_external_revisions ?? 2
  const maxRecoveryAttempts = dependencies.max_recovery_attempts ?? 2
  const traceSeqStart = dependencies.review_options.trace_seq_start ?? 1
  if (![0, 1, 2].includes(maxExternalRevisions)
    || ![0, 1, 2].includes(maxRecoveryAttempts)) {
    throw new Error("ROLE_C_ADAPTIVE_ATTEMPT_LIMIT_INVALID")
  }
  if (!Number.isSafeInteger(traceSeqStart) || traceSeqStart < 1) {
    throw new Error("ROLE_C_ADAPTIVE_TRACE_SEQ_START_INVALID")
  }
  const secureStoreNamespace = dependencies.secure_store.namespace_id
  if (!secureStoreNamespace?.trim()) {
    throw new Error("ROLE_C_ADAPTIVE_SECURE_STORE_NAMESPACE_REQUIRED")
  }
  return {
    orchestration_contract_version: "role-c-adaptive-learning-loop-v2",
    recovery_policy_version: dependencies.recovery_policy_version,
    recovery_port_version: dependencies.recovery_port_version,
    review_execution_config_version:
      dependencies.review_execution_config_version,
    review_policy_version:
      dependencies.review_options.review_port.policy_version,
    max_external_revisions:
      maxExternalRevisions as AdaptiveExecutionConfig["max_external_revisions"],
    max_recovery_attempts:
      maxRecoveryAttempts as AdaptiveExecutionConfig["max_recovery_attempts"],
    trace_seq_start: traceSeqStart,
    secure_store_namespace: secureStoreNamespace,
    delivery_target_namespace: dependencies.delivery_target_namespace,
  }
}

function adaptiveExecutionIdentity(
  input: PrepareNextRoundFromCompletedSubmissionInput,
  preparation: GenerationReadyNextRound,
  config: AdaptiveExecutionConfig,
): AdaptiveExecutionIdentity {
  const sourceKey = contentHash({
    contract: "role-c-completed-submission-source-v1",
    parent_session_id: input.session_id,
    parent_submission_id: input.submission_id,
    learner_id_hash: input.authenticated_learner_id_hash,
    parent_spec_id: preparation.parent_spec_id,
    prior_feedback_ref: preparation.prior_feedback_ref,
    preparation_idempotency_key: preparation.idempotency_key,
  })
  const requestHash = contentHash({
    contract: "role-c-adaptive-learning-loop-request-v2",
    source_key: sourceKey,
    preparation_idempotency_key: preparation.idempotency_key,
    preparation_hash: contentHash(preparation),
    execution_config: config,
  })
  return {
    source_key: sourceKey,
    request_hash: requestHash,
    execution_key: contentHash({
      contract: "role-c-adaptive-learning-loop-execution-v2",
      preparation_idempotency_key: preparation.idempotency_key,
      recovery_policy_version: config.recovery_policy_version,
      recovery_port_version: config.recovery_port_version,
      request_hash: requestHash,
    }),
  }
}

function nextRoundPipelineInput(
  preparation: GenerationReadyNextRound,
): CPipelineInput {
  return {
    generation_spec: structuredClone(preparation.generation_spec),
    evidence_pack: structuredClone(preparation.evidence_pack),
    next_round_context: {
      request_id: preparation.request_id,
      parent_spec_id: preparation.parent_spec_id,
      prior_feedback_ref: preparation.prior_feedback_ref,
      trigger_grade_artifact_id: preparation.trigger_grade_artifact_id,
      action: preparation.generation_action,
      focus_objective_ids: [...preparation.focus_objective_ids],
      reason_codes: [...preparation.trigger_decision.reason_codes],
    },
  }
}

function journalEntry(
  identity: AdaptiveExecutionIdentity,
  state: AdaptiveExecutionState,
  revision: number,
): AdaptiveLearningLoopJournalEntry {
  const frozenState = structuredClone(state)
  return {
    journal_version: "1.0",
    execution_key: identity.execution_key,
    source_key: identity.source_key,
    request_hash: identity.request_hash,
    revision,
    state_hash: contentHash(frozenState),
    state: frozenState,
  }
}

function assertAdaptiveJournalIdentity(
  entry: AdaptiveLearningLoopJournalEntry,
  identity: AdaptiveExecutionIdentity,
): void {
  if (entry.execution_key !== identity.execution_key
    || entry.source_key !== identity.source_key
    || entry.request_hash !== identity.request_hash) {
    throw new Error("ROLE_C_ADAPTIVE_JOURNAL_IDENTITY_MISMATCH")
  }
}

function adaptiveExecutionState(
  value: unknown,
  expectedPreparation: GenerationReadyNextRoundSummary,
): AdaptiveExecutionState {
  if (!value || typeof value !== "object") {
    throw new Error("ROLE_C_ADAPTIVE_JOURNAL_STATE_INVALID")
  }
  const state = structuredClone(value) as AdaptiveExecutionState
  const phases = new Set<AdaptiveExecutionPhase>([
    "STARTED",
    "GENERATED",
    "ACTIVATING",
    "ACTIVATED",
    "DELIVERING",
    "PUBLISHED",
    "TERMINAL_DELIVERING",
    "TERMINAL",
  ])
  if (state.state_version !== "1.0"
    || !phases.has(state.phase)
    || state.preparation_hash !== contentHash(state.preparation)
    || state.preparation_hash !== contentHash(expectedPreparation)
    || !state.recovery_operations
    || typeof state.recovery_operations !== "object") {
    throw new Error("ROLE_C_ADAPTIVE_JOURNAL_STATE_INVALID")
  }
  for (const [key, operation] of Object.entries(
    state.recovery_operations,
  )) {
    const responseIsValid = operation.status === "succeeded"
      ? operation.response !== undefined
        && operation.response_hash === contentHash(operation.response)
      : operation.response === undefined
        && operation.response_hash === undefined
    if (operation.operation_key !== key
      || !["evidence_refresh", "path_planning"].includes(operation.kind)
      || !operation.request_hash?.trim()
      || !Number.isSafeInteger(operation.attempt_count)
      || operation.attempt_count < 1
      || !["pending", "succeeded", "failed"].includes(operation.status)
      || !responseIsValid) {
      throw new Error("ROLE_C_ADAPTIVE_RECOVERY_OPERATION_INVALID")
    }
  }
  const generatedRequired = ![
    "STARTED",
    "TERMINAL_DELIVERING",
    "TERMINAL",
  ].includes(state.phase)
  if (generatedRequired !== Boolean(state.generated)) {
    throw new Error("ROLE_C_ADAPTIVE_GENERATED_CHECKPOINT_INVALID")
  }
  if (state.generated) assertGeneratedCheckpoint(state.generated)
  const sessionRequired = [
    "ACTIVATED",
    "DELIVERING",
    "PUBLISHED",
  ].includes(state.phase)
  if (sessionRequired !== Boolean(state.learning_session)) {
    throw new Error("ROLE_C_ADAPTIVE_SESSION_CHECKPOINT_INVALID")
  }
  const finalRequired = [
    "PUBLISHED",
    "TERMINAL_DELIVERING",
    "TERMINAL",
  ].includes(state.phase)
  if (finalRequired !== Boolean(state.final_result)) {
    throw new Error("ROLE_C_ADAPTIVE_FINAL_CHECKPOINT_INVALID")
  }
  if (state.final_result) assertPublicContinuationResult(state.final_result)
  if (state.phase === "PUBLISHED"
    && state.final_result?.status !== "published") {
    throw new Error("ROLE_C_ADAPTIVE_FINAL_CHECKPOINT_INVALID")
  }
  if (["TERMINAL_DELIVERING", "TERMINAL"].includes(state.phase)
    && (state.final_result?.status === "published"
      || state.final_result?.status === "awaiting_input"
      || (state.final_result?.status === "blocked"
        && state.final_result.stage === "preparation"))) {
    throw new Error("ROLE_C_ADAPTIVE_FINAL_CHECKPOINT_INVALID")
  }
  return state
}

function generatedCheckpoint(
  result: RecoverableReviewedCPipelineResult,
  readyContext: RecoverableReviewedReadyContext,
): AdaptiveGeneratedCheckpoint {
  const frozenResult = structuredClone(result)
  const frozenContext = structuredClone(readyContext)
  return {
    result: frozenResult,
    result_hash: contentHash(frozenResult),
    ready_context: frozenContext,
    ready_context_hash: contentHash(frozenContext),
  }
}

function assertGeneratedCheckpoint(
  checkpoint: AdaptiveGeneratedCheckpoint,
): void {
  if (checkpoint.result_hash !== contentHash(checkpoint.result)
    || checkpoint.ready_context_hash !== contentHash(checkpoint.ready_context)
    || checkpoint.result.status !== "ready"
    || checkpoint.result.state !== "READY"
    || checkpoint.ready_context.pipeline_result.status !== "ready"
    || checkpoint.ready_context.pipeline_result.state !== "READY") {
    throw new Error("ROLE_C_ADAPTIVE_GENERATED_CHECKPOINT_INVALID")
  }
  const {
    recovery: _recovery,
    recovery_history: _recoveryHistory,
    ...baseResult
  } = checkpoint.result
  if (contentHash(baseResult)
      !== contentHash(checkpoint.ready_context.pipeline_result)
    || contentHash(checkpoint.ready_context.profile_snapshot)
      !== checkpoint.ready_context.pipeline_input.generation_spec
        .profile_ref.profile_content_hash) {
    throw new Error("ROLE_C_ADAPTIVE_READY_CONTEXT_MISMATCH")
  }
  assertReviewedReadyPipeline(checkpoint.ready_context.pipeline_result, {
    pipeline_input: checkpoint.ready_context.pipeline_input,
    evidence_pack: checkpoint.ready_context.pipeline_input.evidence_pack,
    expected_spec_id:
      checkpoint.ready_context.pipeline_input.generation_spec.spec_id,
    error_prefix: "ROLE_C_ADAPTIVE_READY",
  })
  toReviewRecoveryPublicResult(checkpoint.result)
}

async function assertPersistedGeneratedCheckpoint(
  state: AdaptiveExecutionState,
  secureStore: SecureArtifactStore,
  activationStarted: boolean,
): Promise<void> {
  const generated = requiredGeneratedCheckpoint(state)
  assertGeneratedCheckpoint(generated)
  try {
    await assertNextRoundSecureArtifactsResolvable(
      generated.ready_context.pipeline_result,
      secureStore,
    )
  } catch (error) {
    if (activationStarted && isUnresolvableSecurePairError(error)) {
      throw new Error(
        "ROLE_C_ADAPTIVE_SECURE_REFS_INVALID_AFTER_ACTIVATION",
      )
    }
    throw error
  }
}

function requiredGeneratedCheckpoint(
  state: AdaptiveExecutionState,
): AdaptiveGeneratedCheckpoint {
  if (!state.generated) {
    throw new Error("ROLE_C_ADAPTIVE_GENERATED_CHECKPOINT_MISSING")
  }
  return state.generated
}

function requiredLearningSession(
  state: AdaptiveExecutionState,
): RoleCLearningSessionHandoff {
  if (!state.learning_session) {
    throw new Error("ROLE_C_ADAPTIVE_SESSION_CHECKPOINT_MISSING")
  }
  return structuredClone(state.learning_session)
}

function replayFinalResult(
  state: AdaptiveExecutionState,
  expected: "published" | "generation_review",
): ContinueCompletedLearningCycleResult {
  if (!state.final_result
    || (expected === "published"
      ? state.final_result.status !== "published"
      : state.final_result.status === "published"
        || state.final_result.status === "awaiting_input"
        || (state.final_result.status === "blocked"
          && state.final_result.stage === "preparation"))) {
    throw new Error("ROLE_C_ADAPTIVE_FINAL_CHECKPOINT_INVALID")
  }
  assertPublicContinuationResult(state.final_result)
  return structuredClone(state.final_result)
}

function durableEvidenceRefreshPort(
  port: EvidenceRefreshPort,
  recoveryPortVersion: string,
  state: () => AdaptiveExecutionState,
  persist: (operation: AdaptiveRecoveryPortOperation) => Promise<void>,
  markFailure: () => void,
): EvidenceRefreshPort {
  return {
    refreshEvidence: (request) =>
      executeDurableRecoveryPortOperation(
        "evidence_refresh",
        request,
        recoveryPortVersion,
        state,
        persist,
        markFailure,
        (frozenRequest) => port.refreshEvidence(frozenRequest),
      ),
  }
}

function durablePathPlanningPort(
  port: RoleBPathPlanningPort,
  recoveryPortVersion: string,
  state: () => AdaptiveExecutionState,
  persist: (operation: AdaptiveRecoveryPortOperation) => Promise<void>,
  markFailure: () => void,
): RoleBPathPlanningPort {
  return {
    replanLearningPath: (request) =>
      executeDurableRecoveryPortOperation(
        "path_planning",
        request,
        recoveryPortVersion,
        state,
        persist,
        markFailure,
        (frozenRequest) => port.replanLearningPath(frozenRequest),
      ),
  }
}

async function executeDurableRecoveryPortOperation<
  Request extends EvidenceGapRequest | RoleBPathPlanningRequest,
  Response extends RagEvidencePack | RoleBPathPlanningResult,
>(
  kind: AdaptiveRecoveryPortOperation["kind"],
  request: Request,
  recoveryPortVersion: string,
  state: () => AdaptiveExecutionState,
  persist: (operation: AdaptiveRecoveryPortOperation) => Promise<void>,
  markFailure: () => void,
  call: (request: Request) => Promise<Response>,
): Promise<Response> {
  const frozenRequest = structuredClone(request)
  const requestHash = contentHash(frozenRequest)
  const operationKey = contentHash({
    contract: "role-c-adaptive-recovery-port-operation-v1",
    kind,
    recovery_port_version: recoveryPortVersion,
    request: frozenRequest,
  })
  const existing = state().recovery_operations[operationKey]
  if (existing?.status === "succeeded") {
    return structuredClone(existing.response) as Response
  }
  const pending: AdaptiveRecoveryPortOperation = {
    operation_key: operationKey,
    kind,
    request_hash: requestHash,
    attempt_count: (existing?.attempt_count ?? 0) + 1,
    status: "pending",
  }
  try {
    await persist(pending)
  } catch (error) {
    markFailure()
    throw error
  }
  let response: Response
  try {
    response = structuredClone(await call(structuredClone(frozenRequest)))
  } catch (error) {
    markFailure()
    try {
      await persist({ ...pending, status: "failed" })
    } catch (checkpointError) {
      throw checkpointError
    }
    throw error
  }
  const succeeded: AdaptiveRecoveryPortOperation = {
    ...pending,
    status: "succeeded",
    response_hash: contentHash(response),
    response: structuredClone(response),
  }
  try {
    await persist(succeeded)
  } catch (error) {
    markFailure()
    throw error
  }
  return structuredClone(response)
}

function assertPublicContinuationResult(
  result: ContinueCompletedLearningCycleResult,
): void {
  const report = validatePublicArtifactNoSecrets(result)
  if (!report.ok) {
    throw new Error("ROLE_C_ADAPTIVE_PUBLIC_RESULT_SECRET_LEAK")
  }
}

function isUnresolvableSecurePairError(error: unknown): boolean {
  return error instanceof Error
    && [
      "NEXT_ROUND_SECURE_REFS_UNRESOLVABLE",
      "NEXT_ROUND_SECURE_PAIR_INVALID",
    ].includes(error.message)
}

const defaultAdaptiveLearningLoopJournal =
  new InMemoryAdaptiveLearningLoopJournal()

async function activateLearningSession(
  input: PrepareNextRoundFromCompletedSubmissionInput,
  preparation: GenerationReadyNextRound,
  context: RecoverableReviewedReadyContext,
  lifecycle: CompletedSubmissionNextRoundPort,
): Promise<RoleCLearningSessionHandoff> {
  await lifecycle.registerReadyRun({
    pipeline_input: context.pipeline_input,
    pipeline_result: context.pipeline_result,
    profile_snapshot: context.profile_snapshot,
    learner_id_hash: input.authenticated_learner_id_hash,
  })
  const assessment = context.pipeline_result.public_artifacts.assessment
  if (!assessment?.payload) {
    throw new Error("ROLE_C_NEXT_ROUND_ASSESSMENT_NOT_READY")
  }
  const assessmentItemIds = assessment.payload.items.map((item) => item.item_id)
  if (assessmentItemIds.length === 0) {
    throw new Error("ROLE_C_NEXT_ROUND_ASSESSMENT_ITEMS_NOT_READY")
  }
  const sessionId = stableId("SESSION-C-NEXT", {
    parent_session_id: input.session_id,
    request_id: preparation.request_id,
    final_run_id: context.pipeline_input.generation_spec.run_id,
    learner_id_hash: input.authenticated_learner_id_hash,
  })
  const routingRequestId = stableId("ROUTING-C-NEXT", {
    session_id: sessionId,
    request_id: preparation.request_id,
    final_run_id: context.pipeline_input.generation_spec.run_id,
    form_id: assessment.payload.form_id,
  })
  const attemptNo = 1
  await lifecycle.openTrustedPreselectedSession({
    routing_policy: "trusted_preselected_v1",
    session_id: sessionId,
    run_id: context.pipeline_input.generation_spec.run_id,
    authenticated_learner_id_hash: input.authenticated_learner_id_hash,
    attempt_no: attemptNo,
    required_item_ids: assessmentItemIds,
    revealed_hint_levels: Object.fromEntries(
      assessmentItemIds.map((itemId) => [itemId, 0 as const]),
    ),
  })
  return {
    phase: "preselected",
    routing_request_id: routingRequestId,
    session_id: sessionId,
    run_id: context.pipeline_input.generation_spec.run_id,
    form_id: assessment.payload.form_id,
    attempt_no: attemptNo,
    required_item_ids: assessmentItemIds,
  }
}

function summarizePreparation(
  preparation: NextRoundPreparation,
): SafeNextRoundPreparation {
  if (preparation.status !== "generation_ready") {
    return structuredClone(preparation)
  }
  return {
    status: "generation_ready",
    action: preparation.action,
    generation_action: preparation.generation_action,
    request_id: preparation.request_id,
    idempotency_key: preparation.idempotency_key,
    parent_spec_id: preparation.parent_spec_id,
    prior_feedback_ref: preparation.prior_feedback_ref,
    trigger_objective_ids: [...preparation.trigger_objective_ids],
    focus_objective_ids: [...preparation.focus_objective_ids],
    run_id: preparation.generation_spec.run_id,
    spec_id: preparation.generation_spec.spec_id,
    path_node_id: preparation.generation_spec.path_node.node_id,
    profile_version: preparation.generation_spec.profile_ref.profile_version,
    evidence_ref: preparation.generation_spec.evidence_ref,
  }
}

function summarizeGeneration(
  pipeline: RecoverableReviewedCPipelineResult,
): RecoverableGenerationSummary {
  return toReviewRecoveryPublicResult(pipeline)
}
