import type { RoleCAgents } from "../agents/types"
import type { EvidenceGapRequest, RagEvidencePack } from "../contracts/evidence-pack"
import type { DynamicFeedbackResult } from "../contracts/dynamic-feedback"
import {
  contentHash,
  stableId,
} from "../contracts/common"
import {
  buildGenerationSpec,
  type BuildGenerationSpecResult,
  type DifficultyVector,
  type GenerationSpec,
} from "../contracts/generation-spec"
import type {
  LearnerProfileSnapshot,
  LearningPathNode,
} from "../contracts/profile-adapter"
import type { ProfileDriftSuggestion } from "../contracts/learning-evidence-event"
import type {
  SecureArtifact,
  SecureArtifactStore,
} from "../security/secure-artifact-store"
import {
  runReviewedCPipeline,
} from "../review/run-reviewed-pipeline"
import { assertReviewedReadyPipeline } from "../review/validate-reviewed-release"
import type {
  ReviewedCPipelineResult,
  RunReviewedCPipelineOptions,
} from "../review/types"
import { validateRoleCSchema } from "../validators/runtime-schema-validator"
import {
  type CPipelineInput,
} from "./content-pipeline"

export type NextRoundAction = DynamicFeedbackResult["final_decision"]["action"]

export type NextRoundGenerationVersions = Pick<
  GenerationSpec["versions"],
  "prompt_version" | "model_config_hash" | "runner_image_digest"
>

export interface PrepareNextRoundInput {
  /** Derived from the authenticated request context. */
  authenticated_learner_id_hash: string
  feedback: DynamicFeedbackResult
  parent_spec: GenerationSpec
  profile_snapshot: LearnerProfileSnapshot
  current_evidence_pack: RagEvidencePack
  /** Supplied by the upstream path owner only after an advance decision. */
  next_path_node?: LearningPathNode
  /** Evidence retrieved for next_path_node; it is never synthesized by Role C. */
  next_evidence_pack?: RagEvidencePack
  /** Optional newer upstream profile for the next path node. */
  next_profile_snapshot?: LearnerProfileSnapshot
  /**
   * Explicit teaching action selected upstream after a reprofile decision.
   * Required when the updated profile/path/evidence triplet is supplied.
   */
  next_generation_action?: Exclude<NextRoundAction, "reprofile">
  /**
   * Generation runtime selected for this follow-up. When omitted, versions
   * are inherited from the parent spec.
   */
  current_generation_versions?: NextRoundGenerationVersions
}

interface NextRoundIdentity {
  parent_spec_id: string
  parent_run_id: string
  parent_spec_hash: string
  grade_artifact_id: string
  feedback_id: string
  submission_id: string
  attempt_no: number
  action: NextRoundAction
  decision_hash: string
  current_profile_hash: string
  current_evidence_hash: string
  generation_versions_hash: string
  next_path_node_id?: string
  next_profile_version?: string
  next_evidence_ref?: string
  next_path_hash?: string
  next_profile_hash?: string
  next_evidence_hash?: string
  next_generation_action?: Exclude<NextRoundAction, "reprofile">
}

export interface GenerationReadyNextRound {
  status: "generation_ready"
  /** Decision that caused B to prepare this follow-up. */
  action: NextRoundAction
  /** Content adaptation applied by C after any B-side reprofile step. */
  generation_action: Exclude<NextRoundAction, "reprofile">
  request_id: string
  idempotency_key: string
  parent_spec_id: string
  trigger_grade_artifact_id: string
  prior_feedback_ref: string
  /** Objectives that caused the decision in the completed node. */
  trigger_objective_ids: string[]
  /** Objectives the generated bundle must cover. */
  focus_objective_ids: string[]
  /** Frozen decision that caused this generation request. */
  trigger_decision: DynamicFeedbackResult["final_decision"]
  /** Cryptographic fingerprint of the complete profile used to build the spec. */
  profile_content_hash: string
  /**
   * Backend-only frozen snapshot used to register the generated run.
   * Do not expose GenerationReadyNextRound through a learner-facing API.
   */
  profile_snapshot: LearnerProfileSnapshot
  generation_spec: GenerationSpec
  evidence_pack: RagEvidencePack
}

export interface AwaitingPathNodeNextRound {
  status: "awaiting_path_node"
  action: "advance"
  request_id: string
  idempotency_key: string
  current_path_node_id: string
  completed_objective_ids: string[]
  reason_codes: string[]
  required_inputs: Array<"next_path_node" | "next_evidence_pack">
}

export interface ReprofileSuggestedNextRound {
  status: "reprofile_suggested"
  action: "reprofile"
  request_id: string
  idempotency_key: string
  suggestion: ProfileDriftSuggestion
}

export interface BlockedNextRound {
  status: "blocked"
  action: NextRoundAction
  request_id: string
  idempotency_key: string
  code:
    | "INVALID_FEEDBACK"
    | "IDENTITY_MISMATCH"
    | "INVALID_TARGET_OBJECTIVES"
    | "INVALID_CURRENT_INPUT"
    | "INVALID_ADVANCE_INPUT"
    | "MISSING_PROFILE_DRIFT"
    | "SPEC_BUILD_BLOCKED"
  errors: string[]
  gap_request?: EvidenceGapRequest
}

export type NextRoundPreparation =
  | GenerationReadyNextRound
  | AwaitingPathNodeNextRound
  | ReprofileSuggestedNextRound
  | BlockedNextRound

export interface NextRoundExecutionDependencies {
  agents: RoleCAgents
  secure_store: SecureArtifactStore
  review_options: RunReviewedCPipelineOptions
  /**
   * Explicit fingerprint for reviewer, critic and fact-audit execution
   * semantics not otherwise represented in review_options.
   */
  review_execution_config_version: string
  /** Injectable reviewed boundary for tests or a transport adapter. */
  reviewed_pipeline_runner?: (
    input: CPipelineInput,
    agents: RoleCAgents,
    secureStore: SecureArtifactStore,
    options: RunReviewedCPipelineOptions,
  ) => Promise<ReviewedCPipelineResult>
  single_flight?: KeyedSingleFlight
  /** Inject a durable implementation when completed results must survive restarts. */
  execution_journal?: NextRoundExecutionJournal
}

export interface NextRoundExecutionJournalEntry {
  journal_version: "1.0"
  execution_key: string
  result_hash: string
  result: ReviewedCPipelineResult
}

export interface ReviewedPipelineInputExecutionIdentity {
  /** Stable orchestration namespace, for example next_round_recovery. */
  execution_scope: string
  /** Stable identity of the parent orchestration request. */
  orchestration_idempotency_key: string
}

/**
 * Successful-result journal. commitSuccessful must atomically create the
 * record or return the record already stored for the same execution key.
 * invalidateSuccessful must compare-and-delete so one worker cannot remove a
 * newer winner installed by another worker.
 */
export interface NextRoundExecutionJournal {
  loadSuccessful(
    executionKey: string,
  ): Promise<NextRoundExecutionJournalEntry | undefined>
  commitSuccessful(
    entry: NextRoundExecutionJournalEntry,
  ): Promise<NextRoundExecutionJournalEntry>
  invalidateSuccessful(
    executionKey: string,
    expectedResultHash: string,
  ): Promise<boolean>
}

/**
 * Builds the next Role C generation request without selecting a path node.
 * This pure planner expects trusted, frozen feedback. Request handlers should
 * use LearningCycleService.prepareNextRoundFromCompletedSubmission so feedback
 * is resolved from the durable COMPLETED record.
 *
 * - remediate/reinforce reuse the frozen current node;
 * - advance waits for an explicit upstream node and its evidence;
 * - reprofile emits only the existing profile-drift suggestion.
 */
export function prepareNextRound(input: PrepareNextRoundInput): NextRoundPreparation {
  const action = input.feedback.final_decision.action
  const baseIdentity = feedbackIdentity(input)
  const baseRequest = requestIdentity(baseIdentity)
  const feedbackIssues = validateFeedback(input)
  if (feedbackIssues.length > 0) {
    return blocked(action, baseRequest, "INVALID_FEEDBACK", feedbackIssues)
  }

  const identityIssues = validateCurrentIdentity(input)
  if (identityIssues.length > 0) {
    return blocked(action, baseRequest, "IDENTITY_MISMATCH", identityIssues)
  }

  const objectiveIssues = validateDecisionObjectives(input)
  if (objectiveIssues.length > 0) {
    return blocked(action, baseRequest, "INVALID_TARGET_OBJECTIVES", objectiveIssues)
  }

  const currentInputIssues = validateCurrentInputs(input)
  if (currentInputIssues.length > 0) {
    return blocked(action, baseRequest, "INVALID_CURRENT_INPUT", currentInputIssues)
  }

  if (action === "reprofile") {
    const hasUpdatedGenerationState = Boolean(
      input.next_path_node
        || input.next_evidence_pack
        || input.next_generation_action,
    )
    if (hasUpdatedGenerationState && (!input.next_path_node
      || !input.next_evidence_pack
      || !input.next_profile_snapshot)) {
      return blocked(action, baseRequest, "INVALID_ADVANCE_INPUT", [
        "reprofile 继续生成时必须同时提供 B 的新版画像、路径节点和 A 的对应证据",
      ])
    }
    if (hasUpdatedGenerationState && !input.next_generation_action) {
      return blocked(action, baseRequest, "INVALID_ADVANCE_INPUT", [
        "reprofile 继续生成时必须由上游明确提供 next_generation_action",
      ])
    }
    const suggestion = input.feedback.profile_drift_suggestion
    if (!suggestion) {
      return blocked(action, baseRequest, "MISSING_PROFILE_DRIFT", [
        "reprofile 决策必须携带 profile_drift_suggestion",
      ])
    }
    const suggestionIssues = validateDriftSuggestion(input, suggestion)
    if (suggestionIssues.length > 0) {
      return blocked(action, baseRequest, "MISSING_PROFILE_DRIFT", suggestionIssues)
    }
    if (hasUpdatedGenerationState) {
      const updatedStateIssues = validateUpdatedState(
        input,
        input.next_profile_snapshot!,
        input.next_evidence_pack!,
        "reprofile",
      )
      if (updatedStateIssues.length > 0) {
        return blocked(
          action,
          baseRequest,
          "INVALID_ADVANCE_INPUT",
          updatedStateIssues,
        )
      }
      const readyIdentity: NextRoundIdentity = {
        ...baseIdentity,
        next_path_node_id: input.next_path_node!.node_id,
        next_profile_version: input.next_profile_snapshot!.profile_version,
        next_evidence_ref: input.next_evidence_pack!.retrieval_id,
        next_path_hash: contentHash(input.next_path_node),
        next_profile_hash: contentHash(input.next_profile_snapshot),
        next_evidence_hash: contentHash(input.next_evidence_pack),
        next_generation_action: input.next_generation_action!,
      }
      return buildReadyNextRound({
        input,
        action,
        generation_action: input.next_generation_action!,
        identity: readyIdentity,
        profile: input.next_profile_snapshot!,
        path: input.next_path_node!,
        evidence: input.next_evidence_pack!,
        difficulty: undefined,
        adaptive_shell: undefined,
        focus_objective_ids: input.next_path_node!.objectives.map(
          (objective) => objective.objective_id,
        ),
      })
    }
    return {
      status: "reprofile_suggested",
      action,
      ...baseRequest,
      suggestion: structuredClone(suggestion),
    }
  }

  if (action === "advance") {
    const requiredInputs: AwaitingPathNodeNextRound["required_inputs"] = []
    if (!input.next_path_node) requiredInputs.push("next_path_node")
    if (!input.next_evidence_pack) requiredInputs.push("next_evidence_pack")
    if (requiredInputs.length > 0) {
      return {
        status: "awaiting_path_node",
        action,
        ...baseRequest,
        current_path_node_id: input.parent_spec.path_node.node_id,
        completed_objective_ids: input.parent_spec.targets.map(
          (target) => target.objective_id,
        ),
        reason_codes: [...input.feedback.final_decision.reason_codes],
        required_inputs: requiredInputs,
      }
    }
    if (input.next_path_node!.node_id === input.parent_spec.path_node.node_id) {
      return blocked(action, baseRequest, "INVALID_ADVANCE_INPUT", [
        "advance 的 next_path_node.node_id 必须不同于当前节点",
      ])
    }
    const nextProfile = input.next_profile_snapshot ?? input.profile_snapshot
    const updatedStateIssues = validateUpdatedState(
      input,
      nextProfile,
      input.next_evidence_pack!,
      "advance",
    )
    if (updatedStateIssues.length > 0) {
      return blocked(action, baseRequest, "INVALID_ADVANCE_INPUT", [
        ...updatedStateIssues,
      ])
    }
    const readyIdentity: NextRoundIdentity = {
      ...baseIdentity,
      next_path_node_id: input.next_path_node!.node_id,
      next_profile_version: nextProfile.profile_version,
      next_evidence_ref: input.next_evidence_pack!.retrieval_id,
      next_path_hash: contentHash(input.next_path_node),
      next_profile_hash: contentHash(nextProfile),
      next_evidence_hash: contentHash(input.next_evidence_pack),
    }
    return buildReadyNextRound({
      input,
      action,
      identity: readyIdentity,
      profile: nextProfile,
      path: input.next_path_node!,
      evidence: input.next_evidence_pack!,
      difficulty: undefined,
      adaptive_shell: undefined,
      focus_objective_ids: input.next_path_node!.objectives.map((objective) => objective.objective_id),
    })
  }

  if (input.next_path_node) {
    return blocked(action, baseRequest, "INVALID_ADVANCE_INPUT", [
      `${action} 必须复用当前节点，不能携带下一路径节点`,
    ])
  }
  if (input.next_generation_action) {
    return blocked(action, baseRequest, "INVALID_ADVANCE_INPUT", [
      `${action} 已由冻结反馈确定，不能另行提供 next_generation_action`,
    ])
  }

  const nextProfile = input.next_profile_snapshot ?? input.profile_snapshot
  const nextEvidence = input.next_evidence_pack ?? input.current_evidence_pack
  if (input.next_profile_snapshot || input.next_evidence_pack) {
    const updatedStateIssues = validateUpdatedState(
      input,
      nextProfile,
      nextEvidence,
      action,
    )
    if (updatedStateIssues.length > 0) {
      return blocked(
        action,
        baseRequest,
        "INVALID_ADVANCE_INPUT",
        updatedStateIssues,
      )
    }
  }
  const currentNodeIdentity: NextRoundIdentity = {
    ...baseIdentity,
    ...(input.next_profile_snapshot
      ? {
          next_profile_version: nextProfile.profile_version,
          next_profile_hash: contentHash(nextProfile),
        }
      : {}),
    ...(input.next_evidence_pack
      ? {
          next_evidence_ref: nextEvidence.retrieval_id,
          next_evidence_hash: contentHash(nextEvidence),
        }
      : {}),
  }
  const currentPath = pathFromSpec(input.parent_spec)
  const difficulty = action === "remediate"
    ? remedialDifficulty(input.parent_spec.difficulty)
    : structuredClone(input.parent_spec.difficulty)
  const adaptiveShell = action === "remediate"
    ? {
        scaffold_level: incrementScaffoldLevel(input.parent_spec.learner_adaptation.scaffold_level),
        reading_density: reduceReadingDensity(input.parent_spec.learner_adaptation.reading_density),
      }
    : {
        scaffold_level: input.parent_spec.learner_adaptation.scaffold_level,
        reading_density: input.parent_spec.learner_adaptation.reading_density,
      }
  return buildReadyNextRound({
    input,
    action,
    identity: currentNodeIdentity,
    profile: nextProfile,
    path: currentPath,
    evidence: nextEvidence,
    difficulty,
    adaptive_shell: adaptiveShell,
    focus_objective_ids: input.feedback.final_decision.target_objective_ids,
  })
}

/**
 * Executes one reviewed request per execution identity. Concurrent calls share
 * one flight; successful READY results are journaled for sequential replay.
 */
export async function executePreparedNextRound(
  prepared: GenerationReadyNextRound,
  dependencies: NextRoundExecutionDependencies,
): Promise<ReviewedCPipelineResult> {
  if (prepared.status !== "generation_ready") {
    throw new Error("NEXT_ROUND_NOT_READY")
  }
  const frozenInput = freezePipelineInput({
    generation_spec: prepared.generation_spec,
    evidence_pack: prepared.evidence_pack,
    next_round_context: nextRoundContext(prepared),
  })
  const frozenDecision = deepFreeze(structuredClone(prepared.trigger_decision))
  const expectedPreparedKey = contentHash({
    contract: "role-c-next-round-prepared-execution-v2",
    input: frozenInput,
    feedback_id: prepared.prior_feedback_ref,
    decision: frozenDecision,
    profile_content_hash: prepared.profile_content_hash,
    evidence_content_hash: contentHash(frozenInput.evidence_pack),
  })
  if (prepared.idempotency_key !== expectedPreparedKey) {
    throw new Error("NEXT_ROUND_PREPARED_IDENTITY_MISMATCH")
  }
  return executeReviewedPipelineInput(
    frozenInput,
    {
      execution_scope: "next_round",
      orchestration_idempotency_key: prepared.idempotency_key,
    },
    dependencies,
  )
}

/**
 * Durable, single-flight execution for one exact reviewed Role C input.
 * Recovery orchestration uses this boundary for each immutable candidate spec,
 * so retries reuse the winning secure pair instead of producing orphan copies.
 */
export async function executeReviewedPipelineInput(
  pipelineInput: CPipelineInput,
  identity: ReviewedPipelineInputExecutionIdentity,
  dependencies: NextRoundExecutionDependencies,
): Promise<ReviewedCPipelineResult> {
  if (!identity.execution_scope.trim()
    || !identity.orchestration_idempotency_key.trim()) {
    throw new Error("REVIEWED_PIPELINE_EXECUTION_IDENTITY_INVALID")
  }
  const executionConfig = normalizeExecutionConfig(dependencies)
  const flight = dependencies.single_flight ?? defaultNextRoundSingleFlight
  const journal = dependencies.execution_journal
    ?? defaultNextRoundExecutionJournal
  const pipelineRunner = dependencies.reviewed_pipeline_runner
    ?? runReviewedCPipeline
  const frozenInput = freezePipelineInput(pipelineInput)
  const executionKey = contentHash({
    contract: "role-c-reviewed-input-execution-v1",
    execution_scope: identity.execution_scope,
    orchestration_idempotency_key: identity.orchestration_idempotency_key,
    input: frozenInput,
    max_external_revisions: executionConfig.max_external_revisions,
    trace_seq_start: executionConfig.trace_seq_start,
    review_policy_version: executionConfig.review_policy_version,
    secure_store_namespace: executionConfig.secure_store_namespace,
    review_execution_config_version:
      executionConfig.review_execution_config_version,
  })
  return flight.run(executionKey, async () => {
    const replay = await loadValidJournalResult(
      journal,
      executionKey,
      frozenInput,
      executionConfig,
      dependencies.secure_store,
    )
    if (replay) {
      return replay
    }

    const result = await pipelineRunner(
      frozenInput,
      dependencies.agents,
      dependencies.secure_store,
      dependencies.review_options,
    )
    if (result.status !== "ready" || result.state !== "READY") {
      return structuredClone(result)
    }
    assertReviewedExecutionResult(result, frozenInput, executionConfig)
    await assertSecurePairResolvable(result, dependencies.secure_store)
    const entry: NextRoundExecutionJournalEntry = {
      journal_version: "1.0",
      execution_key: executionKey,
      result_hash: contentHash(result),
      result: structuredClone(result),
    }
    return commitGeneratedJournalResult(
      journal,
      entry,
      result,
      executionKey,
      frozenInput,
      executionConfig,
      dependencies.secure_store,
    )
  })
}

interface NormalizedNextRoundExecutionConfig {
  max_external_revisions: 0 | 1 | 2
  trace_seq_start: number
  review_policy_version: string
  secure_store_namespace: string
  review_execution_config_version: string
}

async function commitGeneratedJournalResult(
  journal: NextRoundExecutionJournal,
  entry: NextRoundExecutionJournalEntry,
  generated: ReviewedCPipelineResult,
  executionKey: string,
  pipelineInput: CPipelineInput,
  executionConfig: NormalizedNextRoundExecutionConfig,
  secureStore: SecureArtifactStore,
): Promise<ReviewedCPipelineResult> {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    let committed: NextRoundExecutionJournalEntry
    try {
      committed = await journal.commitSuccessful(entry)
    } catch (error) {
      await deleteGeneratedSecureBatch(
        generated,
        secureStore,
        "NEXT_ROUND_JOURNAL_COMMIT_SECURE_CLEANUP_FAILED",
      )
      try {
        await journal.invalidateSuccessful(executionKey, entry.result_hash)
      } catch {
        throw new Error("NEXT_ROUND_JOURNAL_COMMIT_RECOVERY_FAILED")
      }
      throw error
    }

    try {
      const winner = await validatedJournalResult(
        committed,
        executionKey,
        pipelineInput,
        executionConfig,
        secureStore,
      )
      if (!sameStringSet(generated.secure_refs, winner.secure_refs)) {
        await deleteGeneratedSecureBatch(
          generated,
          secureStore,
          "NEXT_ROUND_LOSER_SECURE_CLEANUP_FAILED",
        )
      }
      return winner
    } catch (error) {
      if (!isInvalidSecurePairError(error)) {
        try {
          await journal.invalidateSuccessful(
            executionKey,
            committed.result_hash,
          )
        } catch {
          await deleteGeneratedSecureBatch(
            generated,
            secureStore,
            "NEXT_ROUND_LOSER_SECURE_CLEANUP_FAILED",
          )
          throw new Error("NEXT_ROUND_JOURNAL_INVALIDATION_FAILED")
        }
        await deleteGeneratedSecureBatch(
          generated,
          secureStore,
          "NEXT_ROUND_LOSER_SECURE_CLEANUP_FAILED",
        )
        throw error
      }

      let invalidated: boolean
      try {
        invalidated = await journal.invalidateSuccessful(
          executionKey,
          committed.result_hash,
        )
      } catch {
        await deleteGeneratedSecureBatch(
          generated,
          secureStore,
          "NEXT_ROUND_LOSER_SECURE_CLEANUP_FAILED",
        )
        throw new Error("NEXT_ROUND_JOURNAL_INVALIDATION_FAILED")
      }
      if (sameStringSet(generated.secure_refs, committed.result.secure_refs)) {
        throw error
      }
      if (invalidated) continue
    }
  }
  await deleteGeneratedSecureBatch(
    generated,
    secureStore,
    "NEXT_ROUND_LOSER_SECURE_CLEANUP_FAILED",
  )
  throw new Error("NEXT_ROUND_JOURNAL_CONCURRENT_REPLACEMENT_LIMIT")
}

async function loadValidJournalResult(
  journal: NextRoundExecutionJournal,
  executionKey: string,
  pipelineInput: CPipelineInput,
  executionConfig: NormalizedNextRoundExecutionConfig,
  secureStore: SecureArtifactStore,
): Promise<ReviewedCPipelineResult | undefined> {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const entry = await journal.loadSuccessful(executionKey)
    if (!entry) return undefined
    try {
      return await validatedJournalResult(
        entry,
        executionKey,
        pipelineInput,
        executionConfig,
        secureStore,
      )
    } catch (error) {
      if (!isInvalidSecurePairError(error)) {
        throw error
      }
      let invalidated: boolean
      try {
        invalidated = await journal.invalidateSuccessful(
          executionKey,
          entry.result_hash,
        )
      } catch {
        throw new Error("NEXT_ROUND_JOURNAL_INVALIDATION_FAILED")
      }
      if (invalidated) return undefined
    }
  }
  throw new Error("NEXT_ROUND_JOURNAL_CONCURRENT_REPLACEMENT_LIMIT")
}

function normalizeExecutionConfig(
  dependencies: NextRoundExecutionDependencies,
): NormalizedNextRoundExecutionConfig {
  const maxExternalRevisions =
    dependencies.review_options.max_external_revisions ?? 2
  if (![0, 1, 2].includes(maxExternalRevisions)) {
    throw new Error("NEXT_ROUND_MAX_EXTERNAL_REVISIONS_INVALID")
  }
  const traceSeqStart = dependencies.review_options.trace_seq_start ?? 1
  if (!Number.isSafeInteger(traceSeqStart) || traceSeqStart < 1) {
    throw new Error("NEXT_ROUND_TRACE_SEQ_START_INVALID")
  }
  const reviewPolicyVersion =
    dependencies.review_options.review_port.policy_version
  if (!reviewPolicyVersion.trim()) {
    throw new Error("NEXT_ROUND_REVIEW_POLICY_VERSION_EMPTY")
  }
  const secureStoreNamespace = dependencies.secure_store.namespace_id
  if (!secureStoreNamespace?.trim()) {
    throw new Error("NEXT_ROUND_SECURE_STORE_NAMESPACE_REQUIRED")
  }
  const reviewExecutionConfigVersion =
    dependencies.review_execution_config_version
  if (!reviewExecutionConfigVersion.trim()) {
    throw new Error("NEXT_ROUND_REVIEW_EXECUTION_CONFIG_VERSION_EMPTY")
  }
  return {
    max_external_revisions: maxExternalRevisions,
    trace_seq_start: traceSeqStart,
    review_policy_version: reviewPolicyVersion,
    secure_store_namespace: secureStoreNamespace,
    review_execution_config_version: reviewExecutionConfigVersion,
  }
}

async function validatedJournalResult(
  entry: NextRoundExecutionJournalEntry,
  executionKey: string,
  pipelineInput: CPipelineInput,
  executionConfig: NormalizedNextRoundExecutionConfig,
  secureStore: SecureArtifactStore,
): Promise<ReviewedCPipelineResult> {
  if (entry.journal_version !== "1.0"
    || entry.execution_key !== executionKey
    || entry.result_hash !== contentHash(entry.result)) {
    throw new Error("NEXT_ROUND_JOURNAL_ENTRY_INVALID")
  }
  assertReviewedExecutionResult(entry.result, pipelineInput, executionConfig)
  await assertSecurePairResolvable(entry.result, secureStore)
  return structuredClone(entry.result)
}

function assertReviewedExecutionResult(
  result: ReviewedCPipelineResult,
  pipelineInput: CPipelineInput,
  executionConfig: NormalizedNextRoundExecutionConfig,
): void {
  assertReviewedReadyPipeline(result, {
    pipeline_input: pipelineInput,
    evidence_pack: pipelineInput.evidence_pack,
    expected_spec_id: pipelineInput.generation_spec.spec_id,
    error_prefix: "NEXT_ROUND_REVIEWED_RESULT",
  })
  if (result.review_policy_version !== executionConfig.review_policy_version
    || result.review_reports.some((report) =>
      report.max_revision_rounds
        !== executionConfig.max_external_revisions)
    || result.trace_events[0]?.seq !== executionConfig.trace_seq_start) {
    throw new Error("NEXT_ROUND_REVIEWED_RESULT_EXECUTION_CONFIG_MISMATCH")
  }
}

async function assertSecurePairResolvable(
  result: ReviewedCPipelineResult,
  secureStore: SecureArtifactStore,
): Promise<void> {
  let artifacts: SecureArtifact[]
  try {
    artifacts = await Promise.all(result.secure_refs.map((ref) =>
      secureStore.get(ref, {
        principal: "role-c-grader",
        run_id: result.generation_spec.run_id,
      })))
  } catch {
    throw new Error("NEXT_ROUND_SECURE_REFS_UNRESOLVABLE")
  }
  const types = artifacts.map((artifact) => artifact.artifact_type).sort()
  if (types.length !== 2
    || types[0] !== "assessment_secure"
    || types[1] !== "code_lab_secure") {
    throw new Error("NEXT_ROUND_SECURE_PAIR_INVALID")
  }
}

/**
 * Revalidates the private artifact pair before a persisted READY checkpoint is
 * activated or replayed.
 */
export async function assertNextRoundSecureArtifactsResolvable(
  result: ReviewedCPipelineResult,
  secureStore: SecureArtifactStore,
): Promise<void> {
  await assertSecurePairResolvable(result, secureStore)
}

async function deleteGeneratedSecureBatch(
  result: ReviewedCPipelineResult,
  secureStore: SecureArtifactStore,
  failureCode: string,
): Promise<void> {
  try {
    await secureStore.deleteBatch(result.secure_refs, {
      principal: "role-c-pipeline",
      run_id: result.generation_spec.run_id,
    })
  } catch {
    throw new Error(failureCode)
  }
}

function hasErrorMessage(error: unknown, message: string): boolean {
  return error instanceof Error && error.message === message
}

function isInvalidSecurePairError(error: unknown): boolean {
  return hasErrorMessage(error, "NEXT_ROUND_SECURE_REFS_UNRESOLVABLE")
    || hasErrorMessage(error, "NEXT_ROUND_SECURE_PAIR_INVALID")
}

/** In-process duplicate suppression. Production can inject a distributed equivalent. */
export class KeyedSingleFlight {
  private readonly inFlight = new Map<string, Promise<unknown>>()

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    if (!key.trim()) return Promise.reject(new Error("NEXT_ROUND_IDEMPOTENCY_KEY_EMPTY"))
    const existing = this.inFlight.get(key)
    if (existing) return existing as Promise<T>
    const created = Promise.resolve().then(task)
    this.inFlight.set(key, created)
    const clean = (): void => {
      if (this.inFlight.get(key) === created) this.inFlight.delete(key)
    }
    void created.then(clean, clean)
    return created
  }

  get size(): number {
    return this.inFlight.size
  }
}

/** Process-local journal; persistent adapters implement the same atomic contract. */
export class InMemoryNextRoundExecutionJournal
implements NextRoundExecutionJournal {
  private readonly successful = new Map<
    string,
    NextRoundExecutionJournalEntry
  >()

  async loadSuccessful(
    executionKey: string,
  ): Promise<NextRoundExecutionJournalEntry | undefined> {
    const found = this.successful.get(executionKey)
    return found ? structuredClone(found) : undefined
  }

  async commitSuccessful(
    entry: NextRoundExecutionJournalEntry,
  ): Promise<NextRoundExecutionJournalEntry> {
    if (!entry.execution_key.trim()
      || entry.journal_version !== "1.0"
      || entry.result_hash !== contentHash(entry.result)) {
      throw new Error("NEXT_ROUND_JOURNAL_ENTRY_INVALID")
    }
    const existing = this.successful.get(entry.execution_key)
    if (existing) return structuredClone(existing)
    const frozen = deepFreeze(structuredClone(entry))
    this.successful.set(entry.execution_key, frozen)
    return structuredClone(frozen)
  }

  async invalidateSuccessful(
    executionKey: string,
    expectedResultHash: string,
  ): Promise<boolean> {
    const existing = this.successful.get(executionKey)
    if (!existing || existing.result_hash !== expectedResultHash) return false
    this.successful.delete(executionKey)
    return true
  }

  get size(): number {
    return this.successful.size
  }
}

function buildReadyNextRound(input: {
  input: PrepareNextRoundInput
  action: GenerationReadyNextRound["action"]
  generation_action?: GenerationReadyNextRound["generation_action"]
  identity: NextRoundIdentity
  profile: LearnerProfileSnapshot
  path: LearningPathNode
  evidence: RagEvidencePack
  difficulty: DifficultyVector | undefined
  adaptive_shell: {
    scaffold_level: 0 | 1 | 2 | 3
    reading_density: "low" | "medium" | "high"
  } | undefined
  focus_objective_ids: string[]
}): NextRoundPreparation {
  const identity = requestIdentity(input.identity)
  const built = buildGenerationSpec({
    run_id: followUpRunId(input.identity),
    profile_snapshot: input.profile,
    path_node: input.path,
    evidence_pack: input.evidence,
    versions: selectedGenerationVersions(input.input),
    seed: followUpSeed(input.identity),
    ...(input.difficulty ? { difficulty: input.difficulty } : {}),
    ...(input.adaptive_shell ? { adaptive_shell: input.adaptive_shell } : {}),
  })
  if (!built.ok) {
    return specBuildBlocked(input.action, identity, built)
  }
  const triggerDecision = deepFreeze(structuredClone(input.input.feedback.final_decision))
  const profileContentHash = contentHash(input.profile)
  const generationAction = input.generation_action
    ?? (input.action === "reprofile" ? undefined : input.action)
  if (!generationAction) {
    throw new Error("NEXT_ROUND_REPROFILE_GENERATION_ACTION_REQUIRED")
  }
  const frozenInput = freezePipelineInput({
    generation_spec: built.spec,
    evidence_pack: input.evidence,
    next_round_context: {
      request_id: identity.request_id,
      parent_spec_id: input.input.parent_spec.spec_id,
      prior_feedback_ref: input.input.feedback.feedback_id,
      trigger_grade_artifact_id: input.input.feedback.grade_result.artifact_id,
      action: generationAction,
      focus_objective_ids: [...input.focus_objective_ids],
      reason_codes: [...input.input.feedback.final_decision.reason_codes],
    },
  })
  const idempotencyKey = contentHash({
    contract: "role-c-next-round-prepared-execution-v2",
    input: frozenInput,
    feedback_id: input.input.feedback.feedback_id,
    decision: triggerDecision,
    profile_content_hash: profileContentHash,
    evidence_content_hash: contentHash(frozenInput.evidence_pack),
  })
  return {
    status: "generation_ready",
    action: input.action,
    generation_action: generationAction,
    request_id: identity.request_id,
    idempotency_key: idempotencyKey,
    parent_spec_id: input.input.parent_spec.spec_id,
    trigger_grade_artifact_id: input.input.feedback.grade_result.artifact_id,
    prior_feedback_ref: input.input.feedback.feedback_id,
    trigger_objective_ids: [...input.input.feedback.final_decision.target_objective_ids],
    focus_objective_ids: [...input.focus_objective_ids],
    trigger_decision: triggerDecision,
    profile_content_hash: profileContentHash,
    profile_snapshot: deepFreeze(structuredClone(input.profile)),
    generation_spec: frozenInput.generation_spec,
    evidence_pack: frozenInput.evidence_pack,
  }
}

function nextRoundContext(
  prepared: GenerationReadyNextRound,
): NonNullable<CPipelineInput["next_round_context"]> {
  return {
    request_id: prepared.request_id,
    parent_spec_id: prepared.parent_spec_id,
    prior_feedback_ref: prepared.prior_feedback_ref,
    trigger_grade_artifact_id: prepared.trigger_grade_artifact_id,
    action: prepared.generation_action,
    focus_objective_ids: [...prepared.focus_objective_ids],
    reason_codes: [...prepared.trigger_decision.reason_codes],
  }
}

function specBuildBlocked(
  action: GenerationReadyNextRound["action"],
  identity: Pick<NextRoundPreparation, "request_id" | "idempotency_key">,
  result: Exclude<BuildGenerationSpecResult, { ok: true }>,
): BlockedNextRound {
  return {
    status: "blocked",
    action,
    ...identity,
    code: "SPEC_BUILD_BLOCKED",
    errors: [...result.errors],
    ...("gap_request" in result ? { gap_request: structuredClone(result.gap_request) } : {}),
  }
}

function feedbackIdentity(input: PrepareNextRoundInput): NextRoundIdentity {
  const payload = input.feedback.grade_result.payload
  return {
    parent_spec_id: input.parent_spec.spec_id,
    parent_run_id: input.parent_spec.run_id,
    parent_spec_hash: contentHash(input.parent_spec),
    grade_artifact_id: input.feedback.grade_result.artifact_id,
    feedback_id: input.feedback.feedback_id,
    submission_id: payload?.submission_id ?? input.feedback.submission_id,
    attempt_no: input.feedback.attempt_no,
    action: input.feedback.final_decision.action,
    decision_hash: contentHash(input.feedback.final_decision),
    current_profile_hash: contentHash(input.profile_snapshot),
    current_evidence_hash: contentHash(input.current_evidence_pack),
    generation_versions_hash: contentHash(selectedGenerationVersions(input)),
  }
}

function requestIdentity(identity: NextRoundIdentity): {
  request_id: string
  idempotency_key: string
} {
  return {
    request_id: stableId("NXR", identity),
    idempotency_key: contentHash({ contract: "role-c-next-round-v1", identity }),
  }
}

function followUpRunId(identity: NextRoundIdentity): string {
  const digest = contentHash({ contract: "role-c-next-round-run-v1", identity })
  return `RUN-NEXT-${digest.slice("sha256:".length, "sha256:".length + 24)}`
}

function followUpSeed(identity: NextRoundIdentity): number {
  const digest = contentHash({ contract: "role-c-next-round-seed-v1", identity })
  return Number.parseInt(digest.slice("sha256:".length, "sha256:".length + 12), 16)
}

function selectedGenerationVersions(
  input: PrepareNextRoundInput,
): NextRoundGenerationVersions {
  const selected = input.current_generation_versions
  if (selected) return structuredClone(selected)
  return {
    prompt_version: input.parent_spec.versions.prompt_version,
    model_config_hash: input.parent_spec.versions.model_config_hash,
    ...(input.parent_spec.versions.runner_image_digest
      ? { runner_image_digest: input.parent_spec.versions.runner_image_digest }
      : {}),
  }
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

function remedialDifficulty(parent: DifficultyVector): DifficultyVector {
  return {
    domain_complexity: parent.domain_complexity,
    cognitive_demand: decrement(parent.cognitive_demand),
    reasoning_steps: decrement(parent.reasoning_steps),
    code_complexity: decrement(parent.code_complexity),
    prerequisite_load: decrement(parent.prerequisite_load),
    scaffold_strength: Math.min(5, parent.scaffold_strength + 1),
  }
}

function decrement(value: number): number {
  return Math.max(0, value - 1)
}

function incrementScaffoldLevel(value: 0 | 1 | 2 | 3): 0 | 1 | 2 | 3 {
  return Math.min(3, value + 1) as 0 | 1 | 2 | 3
}

function reduceReadingDensity(
  value: "low" | "medium" | "high",
): "low" | "medium" | "high" {
  if (value === "high") return "medium"
  return "low"
}

function validateFeedback(input: PrepareNextRoundInput): string[] {
  const schema = validateRoleCSchema("dynamic_feedback_result.schema.json", input.feedback)
  const issues = schema.issues.map((issue) => `${issue.path}: ${issue.message}`)
  const decision = input.feedback.final_decision
  if (!["remediate", "reinforce", "advance", "reprofile"].includes(decision.action)) {
    issues.push("final_decision.action 无效")
  }
  if (!Number.isFinite(decision.confidence) || decision.confidence < 0 || decision.confidence > 1) {
    issues.push("final_decision.confidence 必须在 0..1")
  }
  if (decision.reason_codes.length === 0 || decision.reason_codes.some((reason) => !reason.trim())) {
    issues.push("final_decision.reason_codes 必须包含非空原因码")
  }
  const grade = input.feedback.grade_result
  if (grade.status !== "ready" || grade.artifact_type !== "grade_result"
    || !grade.payload || grade.payload.score_frozen !== true) {
    issues.push("只有 ready 且 score_frozen 的 grade_result 才能触发下一轮")
  }
  if (grade.payload) {
    if (input.feedback.round_score.raw_score !== grade.payload.raw_score
      || input.feedback.round_score.max_score !== grade.payload.max_score
      || input.feedback.round_score.evidence_score !== grade.payload.evidence_score
      || input.feedback.round_score.accuracy !== scoreRatio(grade.payload.raw_score, grade.payload.max_score)) {
      issues.push("round_score 与冻结 grade_result 不一致")
    }
    if (grade.payload.recommendation.action !== decision.action
      || grade.payload.recommendation.confidence !== decision.confidence
      || !sameArray(grade.payload.recommendation.reason_codes, decision.reason_codes)) {
      issues.push("grade_result.recommendation 与 final_decision 不一致")
    }
  }
  if (decision.action === "reprofile" && decision.basis !== "profile_drift") {
    issues.push("reprofile 的 final_decision.basis 必须为 profile_drift")
  }
  if (decision.action !== "reprofile" && decision.basis !== "round_accuracy") {
    issues.push("非 reprofile 动作的 final_decision.basis 必须为 round_accuracy")
  }
  return issues
}

function validateCurrentIdentity(input: PrepareNextRoundInput): string[] {
  const issues: string[] = []
  const feedback = input.feedback
  const grade = input.feedback.grade_result
  if (!input.authenticated_learner_id_hash.trim()
    || feedback.learner_id_hash !== input.authenticated_learner_id_hash) {
    issues.push("认证学习者与 feedback 不一致")
  }
  if (feedback.run_id !== input.parent_spec.run_id) issues.push("feedback.run_id 与 parent_spec 不一致")
  if (feedback.path_node_id !== input.parent_spec.path_node.node_id) issues.push("feedback.path_node_id 与 parent_spec 不一致")
  if (feedback.profile_version !== input.parent_spec.profile_ref.profile_version) issues.push("feedback.profile_version 与 parent_spec 不一致")
  if (grade.run_id !== input.parent_spec.run_id) issues.push("grade_result.run_id 与 parent_spec 不一致")
  if (grade.versions.profile_version !== input.parent_spec.profile_ref.profile_version) {
    issues.push("grade_result.profile_version 与 parent_spec 不一致")
  }
  if (grade.payload && grade.payload.submission_id !== feedback.submission_id) {
    issues.push("grade_result.submission_id 与 feedback 不一致")
  }
  if (grade.payload && grade.payload.form_id !== feedback.form_id) {
    issues.push("grade_result.form_id 与 feedback 不一致")
  }
  return issues
}

function validateDecisionObjectives(input: PrepareNextRoundInput): string[] {
  const ids = input.feedback.final_decision.target_objective_ids
  const issues: string[] = []
  if (new Set(ids).size !== ids.length) issues.push("target_objective_ids 不得重复")
  const known = new Set(input.parent_spec.targets.map((target) => target.objective_id))
  const unknown = ids.filter((id) => !known.has(id))
  if (unknown.length > 0) issues.push(`target_objective_ids 包含当前节点未知目标：${unknown.join("、")}`)
  const resultIds = input.feedback.objective_results.map((result) => result.objective_id)
  if (new Set(resultIds).size !== resultIds.length) issues.push("objective_results.objective_id 不得重复")
  const unknownResults = resultIds.filter((id) => !known.has(id))
  if (unknownResults.length > 0) issues.push(`objective_results 包含当前节点未知目标：${unknownResults.join("、")}`)
  const resultSet = new Set(resultIds)
  const targetsWithoutResult = ids.filter((id) => !resultSet.has(id))
  if (targetsWithoutResult.length > 0) {
    issues.push(`target_objective_ids 缺少本轮 objective_result：${targetsWithoutResult.join("、")}`)
  }
  if ((input.feedback.final_decision.action === "remediate"
    || input.feedback.final_decision.action === "reinforce") && ids.length === 0) {
    issues.push("remediate/reinforce 必须包含至少一个当前节点目标")
  }
  return issues
}

function validateCurrentInputs(input: PrepareNextRoundInput): string[] {
  const issues: string[] = []
  const spec = input.parent_spec
  const profile = input.profile_snapshot
  const evidence = input.current_evidence_pack
  if (profile.profile_id !== spec.profile_ref.profile_id) issues.push("profile_snapshot.profile_id 与 parent_spec 不一致")
  if (profile.profile_version !== spec.profile_ref.profile_version) issues.push("profile_snapshot.profile_version 与 parent_spec 不一致")
  if (contentHash(profile) !== spec.profile_ref.profile_content_hash) {
    issues.push("profile_snapshot 完整内容与 parent_spec 不一致")
  }
  if (profile.level !== spec.learner_adaptation.level) issues.push("profile_snapshot.level 与 parent_spec 不一致")
  if (!sameArray(profile.known_concepts, spec.learner_adaptation.known_concepts)) issues.push("profile_snapshot.known_concepts 与 parent_spec 不一致")
  if (!sameArray(profile.weak_concepts, spec.learner_adaptation.weak_concepts)) issues.push("profile_snapshot.weak_concepts 与 parent_spec 不一致")
  if (!sameArray(profile.preferred_contexts, spec.learner_adaptation.preferred_contexts)) issues.push("profile_snapshot.preferred_contexts 与 parent_spec 不一致")
  if (!sameArray(profile.accommodations, spec.learner_adaptation.accommodations)) issues.push("profile_snapshot.accommodations 与 parent_spec 不一致")
  if (evidence.retrieval_id !== spec.evidence_ref) issues.push("current_evidence_pack.retrieval_id 与 parent_spec 不一致")
  if (contentHash(evidence) !== spec.evidence_content_hash) {
    issues.push("current_evidence_pack 完整内容与 parent_spec 不一致")
  }
  if (evidence.kb_version !== spec.versions.kb_version) issues.push("current_evidence_pack.kb_version 与 parent_spec 不一致")
  if (evidence.rag_version !== spec.versions.rag_version) issues.push("current_evidence_pack.rag_version 与 parent_spec 不一致")
  return issues
}

function validateUpdatedState(
  input: PrepareNextRoundInput,
  profile: LearnerProfileSnapshot,
  evidence: RagEvidencePack,
  action: NextRoundAction,
): string[] {
  const issues: string[] = []
  if (profile.learner_id !== input.profile_snapshot.learner_id) {
    issues.push(
      `${action} 的 next_profile_snapshot.learner_id 必须与当前画像一致`,
    )
  }
  if (input.next_profile_snapshot
    && profile.profile_version === input.profile_snapshot.profile_version) {
    issues.push(
      `${action} 的 next_profile_snapshot.profile_version 必须是 B 返回的新版画像`,
    )
  }
  if (evidence.learner_level !== profile.level) {
    issues.push(
      `${action} 的 next_evidence_pack.learner_level 必须与下一轮画像 level 一致`,
    )
  }
  if (input.next_evidence_pack
    && evidence.retrieval_id === input.current_evidence_pack.retrieval_id) {
    issues.push(
      `${action} 的 next_evidence_pack.retrieval_id 必须标识本次新检索结果`,
    )
  }
  return issues
}

function validateDriftSuggestion(
  input: PrepareNextRoundInput,
  suggestion: ProfileDriftSuggestion,
): string[] {
  const issues: string[] = []
  if (suggestion.action !== "reprofile") issues.push("profile_drift_suggestion.action 必须为 reprofile")
  if (suggestion.learner_id_hash !== input.feedback.learner_id_hash) {
    issues.push("profile_drift_suggestion.learner_id_hash 与 feedback 不一致")
  }
  if (suggestion.profile_version !== input.parent_spec.profile_ref.profile_version) {
    issues.push("profile_drift_suggestion.profile_version 与 parent_spec 不一致")
  }
  if (!sameStringSet(
    suggestion.conflicting_objective_ids,
    input.feedback.final_decision.target_objective_ids,
  )) {
    issues.push("profile_drift_suggestion.conflicting_objective_ids 与 final_decision 不一致")
  }
  return issues
}

function blocked(
  action: NextRoundAction,
  identity: { request_id: string; idempotency_key: string },
  code: BlockedNextRound["code"],
  errors: string[],
): BlockedNextRound {
  return {
    status: "blocked",
    action,
    ...identity,
    code,
    errors,
  }
}

function sameArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value))
}

function scoreRatio(rawScore: number, maxScore: number): number {
  if (!Number.isFinite(rawScore) || !Number.isFinite(maxScore) || maxScore <= 0) return 0
  return Math.round(Math.max(0, Math.min(1, rawScore / maxScore)) * 1_000_000) / 1_000_000
}

function freezePipelineInput(input: CPipelineInput): CPipelineInput {
  return deepFreeze(structuredClone(input))
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value
  Object.values(value as Record<string, unknown>).forEach(deepFreeze)
  return Object.freeze(value)
}

const defaultNextRoundSingleFlight = new KeyedSingleFlight()
/** Shared only by callers in this process; inject a durable journal for restarts or multiple hosts. */
const defaultNextRoundExecutionJournal =
  new InMemoryNextRoundExecutionJournal()
