import type { RoleCAgents } from "../agents/types"
import { isValidSourceId } from "../../knowledge/identifiers"
import type { CPipelineInput, CPipelineOptions, CPipelineResult } from "../orchestrator/content-pipeline"
import { runCPipeline } from "../orchestrator/content-pipeline"
import { contentHash } from "../contracts/common"
import { projectPublicRagEvidencePack } from "../contracts/evidence-pack"
import {
  InMemorySecureArtifactStore,
  type SecureArtifact,
  type SecureArtifactStore,
} from "../security/secure-artifact-store"
import { agentForReviewArtifact, toAlignmentObjections } from "./revision-mapper"
import { findingFingerprint, revisionStrictlyImproves } from "./disposition-resolver"
import type {
  ContentReviewDecision,
  ContentReviewFinding,
  ContentReviewRequest,
  ContentReviewResult,
  ContentRevisionInstruction,
  ReviewEvidencePack,
  ReviewedCPipelineResult,
  ReviewRevisionContext,
  RunReviewedCPipelineOptions,
} from "./types"
import { REVIEW_BLOCK_LOCATOR_FIELDS } from "./types"

export async function runReviewedCPipeline(
  input: CPipelineInput,
  agents: RoleCAgents,
  secureStore: SecureArtifactStore,
  options: RunReviewedCPipelineOptions,
): Promise<ReviewedCPipelineResult> {
  const maxExternalRevisions = options.max_external_revisions ?? 2
  if (!options.review_port.policy_version.trim()) {
    throw new Error("ROLE_C_REVIEW_POLICY_VERSION_EMPTY")
  }
  if (![0, 1, 2].includes(maxExternalRevisions)) {
    throw new Error("ROLE_C_REVIEW_MAX_REVISIONS_INVALID")
  }
  const frozenInput = deepFreeze(structuredClone(input))
  const pipelineInputHash = contentHash(frozenInput)
  const generationSpecHash = contentHash(frozenInput.generation_spec)
  const evidenceHash = contentHash(frozenInput.evidence_pack)
  const reviewEvidence = deepFreeze(projectPublicRagEvidencePack(frozenInput.evidence_pack))
  const reviewReports: ContentReviewResult[] = []
  let cumulativeInstructions: ContentRevisionInstruction[] = []
  let previousFindingFingerprints: string[] = []
  let parentCandidateHashes: ReviewRevisionContext["parent_candidate_hashes"] = {
    concept: "",
    code_lab_public: "",
    code_lab_secure: "",
    assessment_public: "",
    assessment_secure: "",
  }

  for (let revisionRound = 0; revisionRound <= maxExternalRevisions; revisionRound += 1) {
    const temporaryStore = new InMemorySecureArtifactStore()
    const revisionContext = buildReviewRevisionContext(
      cumulativeInstructions,
      revisionRound as 0 | 1 | 2,
      options.review_port.policy_version,
      parentCandidateHashes,
    )
    let candidate = await runCPipeline(
      frozenInput,
      agentsWithReviewInstructions(
        agents,
        cumulativeInstructions,
        revisionRound as 0 | 1 | 2,
      ),
      temporaryStore,
      basePipelineOptions(options, revisionContext),
    )
    if (candidate.status !== "ready") {
      if (candidate.blocked_reason?.code === "UNSUPPORTED_TARGET") {
        return unsupportedTargetCandidate(
          candidate,
          frozenInput,
          options.review_port.policy_version,
          maxExternalRevisions,
          pipelineInputHash,
          generationSpecHash,
          evidenceHash,
        )
      }
      return attachReviewMetadata(
        candidate,
        options.review_port.policy_version,
        reviewReports,
        pipelineInputHash,
        generationSpecHash,
      )
    }

    // 记录本轮候选产物 hash，并为"外审修订实际生效"追加可证明 trace。
    let currentHashes: ReviewRevisionContext["parent_candidate_hashes"]
    try {
      currentHashes = await extractCandidateHashes(candidate, temporaryStore)
    } catch {
      return failedCandidate(
        candidate,
        options.review_port.policy_version,
        reviewReports,
        "SECURE_STORE_ERROR",
        "无法校验候选私有产物的修订身份",
        pipelineInputHash,
        generationSpecHash,
      )
    }
    const revisionAppliedTrace = revisionAppliedEvents(
      candidate,
      revisionContext,
      parentCandidateHashes,
      currentHashes,
    )
    if (revisionAppliedTrace.length > 0) {
      candidate = { ...candidate, trace_events: [...candidate.trace_events, ...revisionAppliedTrace] }
    }
    const unappliedAgents = revisionContext.revision_round > 0
      ? revisionContext.affected_agents.filter((agent) => {
          const pair = artifactHashPairForAgent(agent, parentCandidateHashes, currentHashes)
          return pair.before.length > 0 && pair.before === pair.after
        })
      : []
    if (unappliedAgents.length > 0) {
      return revisionStalledCandidate(
        candidate,
        options.review_port.policy_version,
        reviewReports,
        pipelineInputHash,
        generationSpecHash,
        "REVIEW_REVISION_NOT_APPLIED",
        `外审修订未改变目标产物：${unappliedAgents.join(",")}`,
      )
    }

    let report: ContentReviewResult
    try {
      const request = buildReviewRequest(
        candidate,
        frozenInput,
        reviewEvidence,
        revisionRound,
        maxExternalRevisions,
        evidenceHash,
        pipelineInputHash,
        generationSpecHash,
      )
      const returned = await options.review_port.review(request)
      if (contentHash(frozenInput.evidence_pack) !== evidenceHash) {
        throw new Error("ROLE_C_REVIEW_EVIDENCE_MUTATED")
      }
      validateReviewResult(returned, request, options.review_port.policy_version)
      report = deepFreeze(structuredClone(returned))
      reviewReports.push(report)
    } catch (error) {
      const reviewFailure = reviewFailureCode(error)
      return failedCandidate(
        candidate,
        options.review_port.policy_version,
        reviewReports,
        "PROVIDER_ERROR",
        reviewFailure,
        pipelineInputHash,
        generationSpecHash,
      )
    }

    // 单调验收（改进方案4 第 6 节）：外审修订轮必须"问题单调减少"。
    // 非单调提案不能成为新的最佳候选；若还剩一次明确的局部修订机会，
    // 保留上一轮基准问题集并把本轮 finding 一并交给最后一次定向重写。
    // 只有预算耗尽或问题已升级到新证据/新规范时才终止。
    if (revisionRound > 0 && report.decision !== "pass") {
      const currentFingerprints = report.artifact_results.flatMap((result) =>
        result.findings.map((finding) => findingFingerprint(finding)))
      if (!revisionStrictlyImproves({
        beforeFingerprints: previousFindingFingerprints,
        afterFingerprints: currentFingerprints,
      })) {
        const unchanged = previousFindingFingerprints.filter((fp) => currentFingerprints.includes(fp))
        const regression = currentFingerprints.filter((fp) => !previousFindingFingerprints.includes(fp))
        const retryableInstructions = report.revision_instructions.filter(
          (instruction) => instruction.fix_scope === "artifact",
        )
        const hasCrossInputRequirement = report.revision_instructions.some(
          (instruction) => instruction.fix_scope !== "artifact",
        )
        const canRetryRejectedProposal = revisionRound < maxExternalRevisions
          && report.decision === "revise"
          && retryableInstructions.length > 0
          && !hasCrossInputRequirement
          && report.artifact_results
            .filter((result) => result.decision === "revise")
            .every((result) => result.can_revise)
        if (canRetryRejectedProposal) {
          cumulativeInstructions = mergeInstructions(
            cumulativeInstructions,
            retryableInstructions,
          )
          // Deliberately keep previousFindingFingerprints and
          // parentCandidateHashes: the rejected proposal is diagnostic input,
          // not the new accepted baseline.
          continue
        }
        return revisionStalledCandidate(
          candidate,
          options.review_port.policy_version,
          reviewReports,
          pipelineInputHash,
          generationSpecHash,
          unchanged.length > 0 ? "REVIEW_REVISION_NOT_APPLIED" : "REVIEW_REVISION_REGRESSION",
          unchanged.length > 0
            ? `外审修订未解决上一轮 ${unchanged.length} 个问题`
            : `外审修订引入 ${regression.length} 个新问题，未单调改善`,
        )
      }
    }
    previousFindingFingerprints = report.artifact_results.flatMap((result) =>
      result.findings.map((finding) => findingFingerprint(finding)))

    if (report.decision === "pass") {
      try {
        const actualRefs = await commitSecureArtifacts(
          candidate,
          temporaryStore,
          secureStore,
        )
        return {
          ...candidate,
          secure_refs: actualRefs,
          trace_events: reviewedReadyTrace(candidate, reviewReports),
          review_policy_version: options.review_port.policy_version,
          review_reports: reviewReports,
          pipeline_input_hash: pipelineInputHash,
          generation_spec_hash: generationSpecHash,
        }
      } catch (error) {
        return failedCandidate(
          candidate,
          options.review_port.policy_version,
          reviewReports,
          "SECURE_STORE_ERROR",
          "安全产物提交未完成",
          pipelineInputHash,
          generationSpecHash,
        )
      }
    }

    const artifactLocal = report.revision_instructions.filter(
      (instruction) => instruction.fix_scope === "artifact",
    )
    const requiresNewInput = report.revision_instructions.some(
      (instruction) => instruction.fix_scope !== "artifact",
    )
    const canRevise = report.decision === "revise"
      && revisionRound < maxExternalRevisions
      && artifactLocal.length > 0
      && !requiresNewInput
      && report.artifact_results
        .filter((result) => result.decision === "revise")
        .every((result) => result.can_revise)

    if (!canRevise) {
      return blockedCandidate(
        candidate,
        options.review_port.policy_version,
        reviewReports,
        pipelineInputHash,
        generationSpecHash,
      )
    }
    cumulativeInstructions = mergeInstructions(cumulativeInstructions, artifactLocal)
    // 记录本轮候选 hash 作为下一轮外审修订的 parent（用于 before/after 证明）。
    parentCandidateHashes = currentHashes
  }

  throw new Error("ROLE_C_REVIEW_UNREACHABLE")
}

function unsupportedTargetCandidate(
  candidate: CPipelineResult,
  input: CPipelineInput,
  policyVersion: string,
  maxRevisionRounds: 0 | 1 | 2,
  pipelineInputHash: string,
  generationSpecHash: string,
  evidenceHash: string,
): ReviewedCPipelineResult {
  const message = candidate.blocked_reason?.message
    ?? "当前 Provider 不支持该学习目标"
  const artifacts = [
    candidate.public_artifacts.concept_lesson
      ? {
          kind: "concept" as const,
          artifact: candidate.public_artifacts.concept_lesson,
        }
      : undefined,
    candidate.public_artifacts.code_lab
      ? {
          kind: "code_lab" as const,
          artifact: candidate.public_artifacts.code_lab,
        }
      : undefined,
    candidate.public_artifacts.assessment
      ? {
          kind: "assessment" as const,
          artifact: candidate.public_artifacts.assessment,
        }
      : undefined,
  ].filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
  const artifactResults = artifacts.map(({ kind, artifact }) => {
    const finding: ContentReviewFinding = {
      source: "review_adapter",
      code: "UNSUPPORTED_TARGET",
      artifact_kind: kind,
      artifact_id: artifact.artifact_id,
      message,
      proposed_action: "改用支持该目标的模型 Provider，或由 B 重新规划学习目标",
      fix_scope: "new_spec",
      evidence_refs: [artifact.artifact_id],
    }
    return {
      artifact_kind: kind,
      artifact_id: artifact.artifact_id,
      artifact_hash: contentHash(artifact),
      fact_status: artifact.status === "ready"
        ? "pass" as const
        : "reject" as const,
      teaching_status: "reject" as const,
      decision: "reject" as const,
      can_revise: false,
      findings: [finding],
      revision_instructions: [],
    }
  })
  const report: ContentReviewResult = {
    run_id: input.generation_spec.run_id,
    pipeline_input_hash: pipelineInputHash,
    generation_spec_hash: generationSpecHash,
    policy_version: policyVersion,
    revision_round: 0,
    max_revision_rounds: maxRevisionRounds,
    evidence_hash: evidenceHash,
    decision: "reject",
    artifact_results: artifactResults,
    revision_instructions: [],
    failed_dimensions: ["UNSUPPORTED_TARGET"],
    missing_prerequisite_source_ids: [],
    unknown_prerequisite_refs: [],
    required_action: "replan_path",
    fix_scope: "new_spec",
    can_recover: false,
  }
  return attachReviewMetadata(
    {
      ...candidate,
      blocked_reason: {
        code: "UNSUPPORTED_TARGET",
        message: `${message}，当前产物不可发布`,
        details: candidate.blocked_reason?.details,
      },
    },
    policyVersion,
    [deepFreeze(report)],
    pipelineInputHash,
    generationSpecHash,
  )
}

function buildReviewRequest(
  candidate: CPipelineResult,
  input: CPipelineInput,
  reviewEvidence: ReviewEvidencePack,
  revisionRound: number,
  maxRevisionRounds: 0 | 1 | 2,
  evidenceHash: string,
  pipelineInputHash: string,
  generationSpecHash: string,
): ContentReviewRequest {
  const concept = candidate.public_artifacts.concept_lesson
  const codeLab = candidate.public_artifacts.code_lab
  const assessment = candidate.public_artifacts.assessment
  if (!concept || !codeLab || !assessment) {
    throw new Error("ROLE_C_REVIEW_CANDIDATE_INCOMPLETE")
  }
  return deepFreeze({
    run_id: input.generation_spec.run_id,
    pipeline_input_hash: pipelineInputHash,
    generation_spec_hash: generationSpecHash,
    revision_round: revisionRound,
    max_revision_rounds: maxRevisionRounds,
    evidence_hash: evidenceHash,
    generation_spec: input.generation_spec,
    ...(input.next_round_context
      ? { next_round_context: input.next_round_context }
      : {}),
    evidence_pack: reviewEvidence,
    artifacts: [
      { kind: "concept" as const, artifact: concept, artifact_hash: contentHash(concept) },
      { kind: "code_lab" as const, artifact: codeLab, artifact_hash: contentHash(codeLab) },
      { kind: "assessment" as const, artifact: assessment, artifact_hash: contentHash(assessment) },
    ],
  })
}

function agentsWithReviewInstructions(
  agents: RoleCAgents,
  instructions: ContentRevisionInstruction[],
  revisionRound: 0 | 1 | 2,
): RoleCAgents {
  const objections = toAlignmentObjections(instructions)
  const forAgent = (agent: "concept-tutor" | "code-lab" | "tiered-evaluator") =>
    objections.filter((_, index) => instructions[index]?.target_agent === agent)
  return {
    concept_tutor: {
      generate: (request) => agents.concept_tutor.generate({
        ...request,
        revision_objections: mergeObjections(
          request.revision_objections ?? [],
          forAgent("concept-tutor"),
        ),
        external_revision_round: revisionRound,
      }),
    },
    code_lab: {
      generate: (request) => agents.code_lab.generate({
        ...request,
        revision_objections: mergeObjections(
          request.revision_objections ?? [],
          forAgent("code-lab"),
        ),
        external_revision_round: revisionRound,
      }),
    },
    tiered_evaluator: {
      generate: (request) => agents.tiered_evaluator.generate({
        ...request,
        revision_objections: mergeObjections(
          request.revision_objections ?? [],
          forAgent("tiered-evaluator"),
        ),
        external_revision_round: revisionRound,
      }),
    },
  }
}

function validateReviewResult(
  result: ContentReviewResult,
  request: ContentReviewRequest,
  policyVersion: string,
): void {
  if (!isReviewDecision(result.decision)) {
    throw new Error("ROLE_C_REVIEW_RESULT_DECISION_INVALID")
  }
  if (result.run_id !== request.run_id) throw new Error("ROLE_C_REVIEW_RESULT_RUN_MISMATCH")
  if (result.pipeline_input_hash !== request.pipeline_input_hash) {
    throw new Error("ROLE_C_REVIEW_RESULT_INPUT_HASH_MISMATCH")
  }
  if (result.generation_spec_hash !== request.generation_spec_hash) {
    throw new Error("ROLE_C_REVIEW_RESULT_SPEC_HASH_MISMATCH")
  }
  if (result.policy_version !== policyVersion) throw new Error("ROLE_C_REVIEW_RESULT_POLICY_MISMATCH")
  if (result.evidence_hash !== request.evidence_hash) throw new Error("ROLE_C_REVIEW_RESULT_EVIDENCE_MISMATCH")
  if (result.revision_round !== request.revision_round) throw new Error("ROLE_C_REVIEW_RESULT_ROUND_MISMATCH")
  if (result.max_revision_rounds !== request.max_revision_rounds) {
    throw new Error("ROLE_C_REVIEW_RESULT_MAX_ROUNDS_INVALID")
  }
  validateStructuredRecoveryFields(result)

  const expected = new Map(request.artifacts.map((target) => [
    target.artifact.artifact_id,
    { kind: target.kind, hash: target.artifact_hash },
  ]))
  if (result.artifact_results.length !== expected.size) {
    throw new Error("ROLE_C_REVIEW_RESULT_ARTIFACT_COUNT")
  }
  const seen = new Set<string>()
  const nestedInstructions: ContentRevisionInstruction[] = []
  for (const artifactResult of result.artifact_results) {
    if (seen.has(artifactResult.artifact_id)) throw new Error("ROLE_C_REVIEW_RESULT_DUPLICATE_ARTIFACT")
    seen.add(artifactResult.artifact_id)
    const expectedArtifact = expected.get(artifactResult.artifact_id)
    if (expectedArtifact?.kind !== artifactResult.artifact_kind
      || expectedArtifact.hash !== artifactResult.artifact_hash) {
      throw new Error("ROLE_C_REVIEW_RESULT_UNKNOWN_ARTIFACT")
    }
    if (!isReviewStatus(artifactResult.fact_status)
      || !isReviewStatus(artifactResult.teaching_status)
      || !isReviewDecision(artifactResult.decision)
      || typeof artifactResult.can_revise !== "boolean"
      || !Array.isArray(artifactResult.findings)
      || !Array.isArray(artifactResult.revision_instructions)) {
      throw new Error("ROLE_C_REVIEW_RESULT_ARTIFACT_SHAPE")
    }
    for (const finding of artifactResult.findings) {
      if (!validReviewFinding(finding)) {
        throw new Error(`ROLE_C_REVIEW_RESULT_FINDING_TARGET:INVALID_SHAPE:${finding.code || "unknown"}`)
      }
      if (finding.artifact_id !== artifactResult.artifact_id) {
        throw new Error(`ROLE_C_REVIEW_RESULT_FINDING_TARGET:ARTIFACT_ID:${finding.code}`)
      }
      if (finding.artifact_kind !== artifactResult.artifact_kind) {
        throw new Error(`ROLE_C_REVIEW_RESULT_FINDING_TARGET:ARTIFACT_KIND:${finding.code}`)
      }
    }
    for (const instruction of artifactResult.revision_instructions) {
      if (!validReviewFinding(instruction)
        || instruction.artifact_id !== artifactResult.artifact_id
        || instruction.target_artifact_id !== artifactResult.artifact_id
        || instruction.artifact_kind !== artifactResult.artifact_kind
        || !artifactResult.findings.some((finding) =>
          contentHash(findingIdentity(finding)) === contentHash(findingIdentity(instruction)))) {
        throw new Error("ROLE_C_REVIEW_RESULT_NESTED_INSTRUCTION_TARGET")
      }
      nestedInstructions.push(instruction)
    }
    // 仲裁 agent（independent-arbiter）独立裁决：decision 与 can_revise 由仲裁模型
    // 依据公开审核意见、回应与证据引用决定，不与 fact/teaching 状态的确定性推导强绑定。
    if (artifactResult.decision === "pass"
      && (artifactResult.findings.length > 0
        || artifactResult.revision_instructions.length > 0)) {
      throw new Error("ROLE_C_REVIEW_RESULT_PASS_WITH_FINDINGS")
    }
  }
  const expectedDecision = aggregateDecision(
    result.artifact_results.map((artifact) => artifact.decision),
  )
  if (result.decision !== expectedDecision) throw new Error("ROLE_C_REVIEW_RESULT_DECISION_MISMATCH")

  const instructionIds = new Set<string>()
  const objectiveIds = new Set(request.generation_spec.targets.map((target) => target.objective_id))
  for (const instruction of result.revision_instructions) {
    if (instructionIds.has(instruction.instruction_id)) {
      throw new Error("ROLE_C_REVIEW_RESULT_DUPLICATE_INSTRUCTION")
    }
    instructionIds.add(instruction.instruction_id)
    const kind = expected.get(instruction.target_artifact_id)?.kind
    const artifactDecision = result.artifact_results.find(
      (artifact) => artifact.artifact_id === instruction.target_artifact_id,
    )?.decision
    if (!kind || instruction.artifact_id !== instruction.target_artifact_id
      || instruction.artifact_kind !== kind
      || instruction.target_agent !== agentForReviewArtifact(kind)
      || (instruction.fix_scope === "artifact" && artifactDecision === "pass")
      || !objectiveIds.has(instruction.objective_id)
      || !["artifact", "new_evidence", "new_spec"].includes(instruction.fix_scope)
      || !instruction.instruction_id.trim()
      || !instruction.proposed_action.trim()) {
      throw new Error("ROLE_C_REVIEW_RESULT_INVALID_INSTRUCTION_TARGET")
    }
  }
  if (nestedInstructions.length !== result.revision_instructions.length
    || nestedInstructions.some((instruction) => {
      const topLevel = result.revision_instructions.find(
        (candidate) => candidate.instruction_id === instruction.instruction_id,
      )
      return !topLevel || contentHash(topLevel) !== contentHash(instruction)
    })) {
    throw new Error("ROLE_C_REVIEW_RESULT_INSTRUCTION_MISMATCH")
  }
  if (result.decision === "pass"
    && (result.revision_instructions.length > 0
      || result.artifact_results.some((artifact) => artifact.findings.length > 0))) {
    throw new Error("ROLE_C_REVIEW_RESULT_PASS_WITH_FINDINGS")
  }
}

function validateStructuredRecoveryFields(result: ContentReviewResult): void {
  // 仅对明确的 recover 路径做完整校验：B 审核适配器声明了 required_action，
  // 或明确 can_recover=true。普通 pass/revise（无恢复声明）不要求恢复字段齐全。
  const recoveryDeclared = result.required_action !== undefined || result.can_recover === true
  if (!recoveryDeclared) return

  if (!Array.isArray(result.failed_dimensions)
    || result.failed_dimensions.length === 0
    || result.failed_dimensions.some((dimension) => !nonEmpty(dimension))
    || new Set(result.failed_dimensions).size !== result.failed_dimensions.length
    || !Array.isArray(result.missing_prerequisite_source_ids)
    || result.missing_prerequisite_source_ids.some((sourceId) =>
      !isValidSourceId(sourceId))
    || new Set(result.missing_prerequisite_source_ids).size
      !== result.missing_prerequisite_source_ids.length
    || !Array.isArray(result.unknown_prerequisite_refs)
    || result.unknown_prerequisite_refs.some((reference) =>
      !nonEmpty(reference))
    || new Set(result.unknown_prerequisite_refs).size
      !== result.unknown_prerequisite_refs.length
    || !result.required_action
    || ![
      "adjust_content",
      "request_new_evidence",
      "replan_path",
      "reprofile_learner",
    ].includes(result.required_action)
    || !result.fix_scope
    || !["artifact", "new_evidence", "new_spec"].includes(result.fix_scope)
    || !recoveryActionMatchesScope(
      result.required_action,
      result.fix_scope,
    )
    || typeof result.can_recover !== "boolean"
    || (result.recommended_level !== undefined
      && !["beginner", "basic", "intermediate", "integrated"].includes(
        result.recommended_level,
      ))) {
    throw new Error("ROLE_C_REVIEW_RESULT_RECOVERY_FIELDS_INVALID")
  }
  if (result.decision === "pass") {
    throw new Error("ROLE_C_REVIEW_RESULT_PASS_WITH_RECOVERY")
  }
  if (result.can_recover
    && !result.revision_instructions.some((instruction) =>
      instruction.fix_scope === result.fix_scope)) {
    throw new Error("ROLE_C_REVIEW_RESULT_RECOVERY_INSTRUCTION_MISSING")
  }
}

function recoveryActionMatchesScope(
  action: NonNullable<ContentReviewResult["required_action"]>,
  scope: NonNullable<ContentReviewResult["fix_scope"]>,
): boolean {
  if (action === "adjust_content") return scope === "artifact"
  if (action === "request_new_evidence") return scope === "new_evidence"
  return scope === "new_spec"
}

function validReviewFinding(finding: ContentReviewFinding): boolean {
  const locator = finding.locator
  const locatorValid = locator === undefined || (
    (REVIEW_BLOCK_LOCATOR_FIELDS as readonly string[]).includes(locator.field)
    && nonEmpty(locator.ref_id)
    && optionalNonEmpty(locator.parent_block_id)
    && optionalNonEmpty(locator.objective_id)
  )
  return ["fact_audit", "teaching_audit", "review_adapter"].includes(finding.source)
    && ["concept", "code_lab", "assessment"].includes(finding.artifact_kind)
    && ["artifact", "new_evidence", "new_spec"].includes(finding.fix_scope)
    && nonEmpty(finding.code)
    && nonEmpty(finding.artifact_id)
    && nonEmpty(finding.message)
    && nonEmpty(finding.proposed_action)
    && Array.isArray(finding.evidence_refs)
    && finding.evidence_refs.length > 0
    && finding.evidence_refs.every(nonEmpty)
    && new Set(finding.evidence_refs).size === finding.evidence_refs.length
    && (finding.source_decision === undefined || ["revise", "reject"].includes(finding.source_decision))
    && locatorValid
}

function findingIdentity(finding: ContentReviewFinding): ContentReviewFinding {
  return {
    source: finding.source,
    code: finding.code,
    artifact_kind: finding.artifact_kind,
    artifact_id: finding.artifact_id,
    message: finding.message,
    proposed_action: finding.proposed_action,
    fix_scope: finding.fix_scope,
    locator: finding.locator ? structuredClone(finding.locator) : undefined,
    evidence_refs: [...finding.evidence_refs],
    source_decision: finding.source_decision,
  }
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function optionalNonEmpty(value: unknown): boolean {
  return value === undefined || nonEmpty(value)
}

async function commitSecureArtifacts(
  candidate: CPipelineResult,
  temporaryStore: SecureArtifactStore,
  actualStore: SecureArtifactStore,
): Promise<string[]> {
  const context = {
    principal: "role-c-pipeline" as const,
    run_id: candidate.generation_spec.run_id,
  }
  const artifacts = await Promise.all(
    candidate.secure_refs.map((ref) => temporaryStore.get(ref, context)),
  )
  assertSecurePair(artifacts)
  const refs = await actualStore.putBatch(artifacts, context)
  try {
    if (refs.length !== 2 || new Set(refs).size !== 2) {
      throw new Error("ROLE_C_REVIEW_SECURE_COMMIT_INVALID")
    }
    const committed = await Promise.all(refs.map((ref) => actualStore.get(ref, context)))
    assertSecurePair(committed)
    const expectedHashes = artifacts.map((artifact) => contentHash(artifact)).sort()
    const committedHashes = committed.map((artifact) => contentHash(artifact)).sort()
    if (!sameStrings(expectedHashes, committedHashes)) {
      throw new Error("ROLE_C_REVIEW_SECURE_COMMIT_MISMATCH")
    }
    return refs
  } catch (error) {
    // putBatch has returned, so every later validation failure must attempt to
    // remove the complete receiver batch before preserving the original error.
    const cleanupRefs = [...new Set(refs)]
    if (cleanupRefs.length > 0) {
      try {
        await actualStore.deleteBatch(cleanupRefs, context)
      } catch {
        // Cleanup is best-effort; the validation failure remains authoritative.
      }
    }
    throw error
  }
}

function assertSecurePair(artifacts: SecureArtifact[]): void {
  const types = new Set(artifacts.map((artifact) => artifact.artifact_type))
  if (artifacts.length !== 2
    || types.size !== 2
    || !types.has("code_lab_secure")
    || !types.has("assessment_secure")) {
    throw new Error("ROLE_C_REVIEW_TEMP_SECURE_PAIR_INVALID")
  }
}

function blockedCandidate(
  candidate: CPipelineResult,
  policyVersion: string,
  reports: ContentReviewResult[],
  pipelineInputHash: string,
  generationSpecHash: string,
): ReviewedCPipelineResult {
  const last = reports.at(-1)
  const details = last?.artifact_results.flatMap((result) =>
    result.findings.map((finding) =>
      `${result.artifact_kind}:${finding.code}`)) ?? []
  return {
    ...candidate,
    status: "blocked",
    state: "BLOCKED",
    secure_refs: [],
    blocked_reason: {
      code: "BLOCKED_CONTENT_REVIEW",
      message: last?.decision === "reject"
        ? "内容审核已驳回，当前产物不可发布"
        : "内容审核未在允许的外部修订轮次内通过",
      details,
    },
    failure_reason: undefined,
    trace_events: terminalTrace(candidate, "blocked", "内容审核未通过，未提交私有产物"),
    review_policy_version: policyVersion,
    review_reports: reports,
    pipeline_input_hash: pipelineInputHash,
    generation_spec_hash: generationSpecHash,
  }
}

/**
 * 修订停滞（未生效或回归）：外审修订未单调改善，停止盲目重跑并给出明确分类。
 */
function revisionStalledCandidate(
  candidate: CPipelineResult,
  policyVersion: string,
  reports: ContentReviewResult[],
  pipelineInputHash: string,
  generationSpecHash: string,
  reasonCode: "REVIEW_REVISION_NOT_APPLIED" | "REVIEW_REVISION_REGRESSION",
  message: string,
): ReviewedCPipelineResult {
  return {
    ...candidate,
    status: "blocked",
    state: "BLOCKED",
    secure_refs: [],
    blocked_reason: {
      code: "BLOCKED_CONTENT_REVIEW",
      message: `${reasonCode}：${message}`,
      details: [reasonCode],
    },
    failure_reason: undefined,
    trace_events: terminalTrace(candidate, "blocked", `${reasonCode}：${message}`),
    review_policy_version: policyVersion,
    review_reports: reports,
    pipeline_input_hash: pipelineInputHash,
    generation_spec_hash: generationSpecHash,
  }
}

function reviewFailureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : ""
  if (/MODEL_EXECUTION_BUDGET_EXCEEDED|模型执行预算/u.test(message)) {
    return "REVIEW_EXECUTION_BUDGET_EXCEEDED"
  }
  if (/EVIDENCE_MUTATED|EVIDENCE_MISMATCH/u.test(message)) return "REVIEW_EVIDENCE_MISMATCH"
  if (/RUN_MISMATCH|INPUT_HASH_MISMATCH|SPEC_HASH_MISMATCH|POLICY_MISMATCH|ROUND_MISMATCH/u.test(message)) return "REVIEW_IDENTITY_MISMATCH"
  const invalidResult = /ROLE_C_REVIEW_(RESULT_[A-Z_]+|INVALID_ARBITRATION|PASS_WITH_FINDINGS|INSTRUCTION_[A-Z_]+)(?::([A-Z_]+))?(?::([A-Za-z0-9_.-]+))?/u.exec(message)
  if (invalidResult) {
    return ["REVIEW_INVALID_RESULT", invalidResult[1], invalidResult[2], invalidResult[3]]
      .filter(Boolean)
      .join(":")
  }
  const semanticResult = /ROLE_C_SEMANTIC_AUDIT_(RESULT_[A-Z_]+)/u.exec(message)
  if (semanticResult) return `REVIEW_INVALID_RESULT:SEMANTIC_AUDIT_${semanticResult[1]}`
  if (/RESULT_|INVALID_ARBITRATION|PASS_WITH_FINDINGS|INSTRUCTION_/u.test(message)) return "REVIEW_INVALID_RESULT"
  return "REVIEW_TRANSPORT_ERROR"
}

function failedCandidate(
  candidate: CPipelineResult,
  policyVersion: string,
  reports: ContentReviewResult[],
  code: "PROVIDER_ERROR" | "SECURE_STORE_ERROR",
  message: string,
  pipelineInputHash: string,
  generationSpecHash: string,
): ReviewedCPipelineResult {
  return {
    ...candidate,
    status: "failed",
    state: "FAILED",
    secure_refs: [],
    blocked_reason: undefined,
    failure_reason: { code, message },
    trace_events: terminalTrace(candidate, "failed", message),
    review_policy_version: policyVersion,
    review_reports: reports,
    pipeline_input_hash: pipelineInputHash,
    generation_spec_hash: generationSpecHash,
  }
}

function terminalTrace(
  candidate: CPipelineResult,
  terminal: "blocked" | "failed",
  summary: string,
): CPipelineResult["trace_events"] {
  const retained = candidate.trace_events.filter((event) => event.event_type !== "c.pipeline.ready")
  const seq = retained.reduce((max, event) => Math.max(max, event.seq), 0) + 1
  return [
    ...retained,
    {
      schema_version: "1.0",
      seq,
      event_type: terminal === "blocked" ? "c.pipeline.blocked" : "c.pipeline.failed",
      run_id: candidate.generation_spec.run_id,
      status: terminal,
      input_refs: [
        candidate.generation_spec.spec_id,
        candidate.generation_spec.evidence_ref,
      ],
      summary,
      occurred_at: new Date().toISOString(),
      versions: candidate.generation_spec.versions,
    },
  ]
}

function reviewedReadyTrace(
  candidate: CPipelineResult,
  reports: ContentReviewResult[],
): CPipelineResult["trace_events"] {
  const retained = candidate.trace_events.filter((event) => event.event_type !== "c.pipeline.ready")
  let seq = retained.reduce((max, event) => Math.max(max, event.seq), 0)
  const reviewEvents = reports.map((report) => ({
    schema_version: "1.0" as const,
    seq: ++seq,
    event_type: report.decision === "pass"
      ? "c.review.passed" as const
      : "c.review.revision_requested" as const,
    run_id: candidate.generation_spec.run_id,
    status: "success" as const,
    input_refs: [
      candidate.generation_spec.spec_id,
      report.evidence_hash,
    ],
    summary: report.decision === "pass"
      ? `内容审核第 ${report.revision_round + 1} 轮通过`
      : `内容审核第 ${report.revision_round + 1} 轮要求修订`,
    occurred_at: new Date().toISOString(),
    attempt: report.revision_round + 1,
    versions: candidate.generation_spec.versions,
  }))
  return [
    ...retained,
    ...reviewEvents,
    {
      schema_version: "1.0",
      seq: ++seq,
      event_type: "c.pipeline.ready",
      run_id: candidate.generation_spec.run_id,
      status: "success",
      input_refs: [
        candidate.generation_spec.spec_id,
        candidate.generation_spec.evidence_ref,
        ...Object.values(candidate.public_artifacts)
          .filter((artifact): artifact is NonNullable<typeof artifact> => Boolean(artifact))
          .map((artifact) => artifact.artifact_id),
      ],
      summary: "A/B 内容审核通过，公开产物与私有产物已完成发布准备",
      occurred_at: new Date().toISOString(),
      versions: candidate.generation_spec.versions,
    },
  ]
}

function attachReviewMetadata(
  result: CPipelineResult,
  policyVersion: string,
  reports: ContentReviewResult[],
  pipelineInputHash: string,
  generationSpecHash: string,
): ReviewedCPipelineResult {
  return {
    ...result,
    review_policy_version: policyVersion,
    review_reports: reports,
    pipeline_input_hash: pipelineInputHash,
    generation_spec_hash: generationSpecHash,
  }
}

function basePipelineOptions(
  options: RunReviewedCPipelineOptions,
  revisionContext: ReviewRevisionContext,
): CPipelineOptions {
  return {
    ...(options.critic ? { critic: options.critic } : {}),
    ...(options.fact_audit_port ? { fact_audit_port: options.fact_audit_port } : {}),
    ...(options.trace_seq_start !== undefined ? { trace_seq_start: options.trace_seq_start } : {}),
    ...(options.checkpoint_store ? { checkpoint_store: options.checkpoint_store } : {}),
    ...(options.semantic_planner ? { semantic_planner: options.semantic_planner } : {}),
    review_revision_context: revisionContext,
    // READY cache is intentionally absent: reviewed candidates cannot consume a
    // historical release produced without the current review policy. A private
    // partial checkpoint only reuses stage-valid drafts; the completed candidate
    // still passes the current cross-artifact and A/B review before publication.
    // trace_store is also absent because a candidate's internal READY event must not
    // be persisted before the external publication gate has passed.
  }
}

function mergeInstructions(
  left: ContentRevisionInstruction[],
  right: ContentRevisionInstruction[],
): ContentRevisionInstruction[] {
  return [...new Map([...left, ...right].map((instruction) => [
    instruction.instruction_id,
    instruction,
  ])).values()]
}

/** 构造本轮外审修订身份（ReviewRevisionContext）。 */
function buildReviewRevisionContext(
  instructions: ContentRevisionInstruction[],
  revisionRound: 0 | 1 | 2,
  policyVersion: string,
  parentHashes: ReviewRevisionContext["parent_candidate_hashes"],
): ReviewRevisionContext {
  const byAgent = (agent: "concept-tutor" | "code-lab" | "tiered-evaluator") =>
    instructions.filter((instruction) => instruction.target_agent === agent)
  const affectedAgents = (
    ["concept-tutor", "code-lab", "tiered-evaluator"] as const
  ).filter((agent) => byAgent(agent).length > 0)
  return {
    revision_round: revisionRound,
    review_policy_version: policyVersion,
    instruction_hash: contentHash(instructions),
    instructions_by_agent: {
      concept_tutor: byAgent("concept-tutor"),
      code_lab: byAgent("code-lab"),
      tiered_evaluator: byAgent("tiered-evaluator"),
    },
    affected_agents: affectedAgents,
    parent_candidate_hashes: parentHashes,
  }
}

async function extractCandidateHashes(
  candidate: CPipelineResult,
  secureStore: SecureArtifactStore,
): Promise<ReviewRevisionContext["parent_candidate_hashes"]> {
  const secureArtifacts = await Promise.all(candidate.secure_refs.map((ref) =>
    secureStore.get(ref, {
      principal: "role-c-pipeline",
      run_id: candidate.generation_spec.run_id,
    })))
  const codeLabSecure = secureArtifacts.find((artifact) => artifact.artifact_type === "code_lab_secure")
  const assessmentSecure = secureArtifacts.find((artifact) => artifact.artifact_type === "assessment_secure")
  return {
    concept: candidate.public_artifacts.concept_lesson
      ? contentHash(candidate.public_artifacts.concept_lesson)
      : "",
    code_lab_public: candidate.public_artifacts.code_lab
      ? contentHash(candidate.public_artifacts.code_lab)
      : "",
    code_lab_secure: codeLabSecure ? contentHash(codeLabSecure) : "",
    assessment_public: candidate.public_artifacts.assessment
      ? contentHash(candidate.public_artifacts.assessment)
      : "",
    assessment_secure: assessmentSecure ? contentHash(assessmentSecure) : "",
  }
}

/** 生成 c.review.revision.applied trace，证明外审修订确实消费并改变了目标产物。 */
function revisionAppliedEvents(
  candidate: CPipelineResult,
  revisionContext: ReviewRevisionContext,
  parentHashes: ReviewRevisionContext["parent_candidate_hashes"],
  currentHashes: ReviewRevisionContext["parent_candidate_hashes"],
): CPipelineResult["trace_events"] {
  if (revisionContext.revision_round === 0 || revisionContext.affected_agents.length === 0) return []
  const events: CPipelineResult["trace_events"] = []
  for (const agent of revisionContext.affected_agents) {
    const pair = artifactHashPairForAgent(agent, parentHashes, currentHashes)
    const changed = pair.before !== pair.after
    events.push({
      schema_version: "1.0",
      seq: candidate.trace_events.reduce((max, event) => Math.max(max, event.seq), 0) + events.length + 1,
      event_type: "c.review.revision.applied",
      run_id: candidate.generation_spec.run_id,
      agent: agent as "concept-tutor" | "code-lab" | "tiered-evaluator",
      status: changed ? "success" : "blocked",
      input_refs: [candidate.generation_spec.spec_id],
      summary: changed
        ? `外审修订已应用：${agent} 产物 ${pair.before.slice(0, 12)} → ${pair.after.slice(0, 12)}`
        : `外审修订未产生变化：${agent} 产物 hash 与上轮一致`,
      occurred_at: new Date().toISOString(),
      versions: candidate.generation_spec.versions,
      ...(changed ? { revision_applied: { before_hash: pair.before, after_hash: pair.after, instruction_hash: revisionContext.instruction_hash } } : {}),
    })
  }
  return events
}

function artifactHashPairForAgent(
  agent: "concept-tutor" | "code-lab" | "tiered-evaluator",
  parentHashes: ReviewRevisionContext["parent_candidate_hashes"],
  currentHashes: ReviewRevisionContext["parent_candidate_hashes"],
): { before: string; after: string } {
  if (agent === "concept-tutor") return { before: parentHashes.concept, after: currentHashes.concept }
  if (agent === "code-lab") return {
    before: contentHash({ public: parentHashes.code_lab_public, secure: parentHashes.code_lab_secure }),
    after: contentHash({ public: currentHashes.code_lab_public, secure: currentHashes.code_lab_secure }),
  }
  return {
    before: contentHash({ public: parentHashes.assessment_public, secure: parentHashes.assessment_secure }),
    after: contentHash({ public: currentHashes.assessment_public, secure: currentHashes.assessment_secure }),
  }
}

function mergeObjections<T extends { objection_id: string }>(
  left: T[],
  right: T[],
): T[] {
  return [...new Map([...left, ...right].map((objection) => [
    objection.objection_id,
    objection,
  ])).values()]
}

function aggregateDecision(decisions: ContentReviewDecision[]): ContentReviewDecision {
  if (decisions.includes("reject")) return "reject"
  if (decisions.includes("revise")) return "revise"
  return "pass"
}

function isReviewDecision(value: unknown): value is ContentReviewDecision {
  return value === "pass" || value === "revise" || value === "reject"
}

function isReviewStatus(value: unknown): value is "pass" | "revise" | "reject" {
  return isReviewDecision(value)
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index])
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value
  Object.values(value as Record<string, unknown>).forEach(deepFreeze)
  return Object.freeze(value)
}
