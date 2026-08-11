import { auditGeneratedContent } from "../../fact-audit/auditor"
import type {
  FactAuditResult,
  FactAuditStatus,
} from "../../fact-audit/types"
import type { KnowledgeBase } from "../../knowledge/types"
import type { RagResult } from "../../rag/retriever"
import { arbitrate } from "../../role-b-profile/teaching-audit/arbitrator"
import { auditTeaching } from "../../role-b-profile/teaching-audit/auditor"
import type {
  RequiredAction,
  TeachingAuditResult,
} from "../../role-b-profile/teaching-audit/types"
import { stableId } from "../contracts/common"
import { normalizeGroundedClaimText } from "../validators/claim-grounding"
import { extractReviewBlocks } from "./extract-review-blocks"
import { agentForReviewArtifact } from "./revision-mapper"
import type {
  ArtifactReviewResult,
  ContentReviewDecision,
  ContentReviewFinding,
  ContentReviewPort,
  ContentReviewRequest,
  ContentReviewResult,
  ContentRevisionInstruction,
  ReviewContentBlock,
  ReviewEvidencePack,
  ReviewFixScope,
  ReviewablePublicArtifact,
} from "./types"

export const LOCAL_AB_REVIEW_POLICY_VERSION = "role-c-local-ab-review-v2"

export interface LocalABContentReviewPortOptions {
  knowledge_base: KnowledgeBase
  /** Defaults to knowledge_base.version and must match the frozen C evidence version. */
  kb_version?: string
  policy_version?: string
}

export function createLocalABContentReviewPort(
  options: LocalABContentReviewPortOptions,
): ContentReviewPort {
  const knowledgeBase = structuredClone(options.knowledge_base)
  const kbVersion = options.kb_version ?? knowledgeBase.version
  if (kbVersion !== knowledgeBase.version) {
    throw new Error("ROLE_C_REVIEW_KB_VERSION_OVERRIDE_MISMATCH")
  }
  const policyVersion = options.policy_version
    ?? `${LOCAL_AB_REVIEW_POLICY_VERSION}:${kbVersion}`

  return {
    policy_version: policyVersion,
    async review(request): Promise<ContentReviewResult> {
      assertReviewContext(request, kbVersion)
      const ragResult = ragEvidencePackToRagResult(request.evidence_pack)
      const teachingAudit = auditPathTeaching(request, knowledgeBase)
      const reviewed = request.artifacts.map((target, index) =>
        reviewArtifact(
          target,
          request,
          ragResult,
          teachingAudit,
          index === 0,
        ))
      const artifactResults = reviewed.map((entry) => entry.result)
      const decision = aggregateDecision(artifactResults.map((result) => result.decision))
      const revisionInstructions = artifactResults.flatMap(
        (result) => result.revision_instructions,
      )
      return {
        run_id: request.run_id,
        pipeline_input_hash: request.pipeline_input_hash,
        generation_spec_hash: request.generation_spec_hash,
        policy_version: policyVersion,
        revision_round: request.revision_round,
        max_revision_rounds: request.max_revision_rounds,
        evidence_hash: request.evidence_hash,
        decision,
        artifact_results: artifactResults,
        revision_instructions: revisionInstructions,
        ...(decision === "pass"
          ? {}
          : structuredRecoveryFields(
              teachingAudit,
              revisionInstructions,
            )),
      }
    },
  }
}

/** Lossless for A's current fact audit, which reads query metadata and facts only. */
export function ragEvidencePackToRagResult(pack: ReviewEvidencePack): RagResult {
  return {
    query: pack.query,
    learnerLevel: pack.learner_level,
    topK: pack.top_k,
    results: pack.results.map((item) => {
      const retrievalTrace = {
        matchedKeywords: [...item.retrieval_trace.matched_keywords],
        matchedFields: [...item.retrieval_trace.matched_fields],
        difficultyMatch: item.retrieval_trace.difficulty_match,
        scoreBreakdown: {
          keyword: item.retrieval_trace.score_breakdown.keyword,
          title: item.retrieval_trace.score_breakdown.title,
          facts: item.retrieval_trace.score_breakdown.facts,
          practiceTasks: item.retrieval_trace.score_breakdown.practice_tasks,
          difficulty: item.retrieval_trace.score_breakdown.difficulty,
          bonus: item.retrieval_trace.score_breakdown.bonus,
        },
      }
      return {
        sourceId: item.source_id,
        source_id: item.source_id,
        title: item.title,
        difficulty: item.difficulty,
        score: item.rank_score,
        reason: item.match_reason,
        snippet: item.snippet,
        facts: item.facts.map((fact) => ({
          sourceId: fact.source_id,
          factId: fact.fact_id,
          source_id: fact.source_id,
          fact_id: fact.fact_id,
          content: fact.content,
        })),
        examples: item.examples.map((example) => ({ ...example })),
        practiceTasks: [...item.practice_tasks],
        // A's fact auditor never reads answer-bearing quiz items.
        quizItems: [],
        file: item.source_file,
        retrievalTrace,
        retrieval_trace: {
          matched_keywords: [...retrievalTrace.matchedKeywords],
          matched_fields: [...retrievalTrace.matchedFields],
          difficulty_match: retrievalTrace.difficultyMatch,
          score_breakdown: { ...retrievalTrace.scoreBreakdown },
        },
      }
    }),
  }
}

function reviewArtifact(
  target: ContentReviewRequest["artifacts"][number],
  request: ContentReviewRequest,
  ragResult: RagResult,
  teachingAudit: TeachingAuditResult,
  includePathFindings: boolean,
): {
  result: ArtifactReviewResult
} {
  const blocks = extractReviewBlocks(target)
  const blocksById = new Map(blocks.map((block) => [block.review_block_id, block]))
  const claimBlocks = blocks.filter((block) => block.fact_audit_mode === "claim")
  const factAudit = auditGeneratedContent({
    artifactId: target.artifact.artifact_id,
    ragResult,
    generatedContent: {
      blocks: claimBlocks.map((block) => ({
        blockId: block.review_block_id,
        text: block.text,
        citations: block.citations.map(({ source_id, fact_id }) => ({ source_id, fact_id })),
      })),
    },
  })
  const citationAudit = auditCitationOnlyBlocks(
    blocks.filter((block) => block.fact_audit_mode === "citation_only"),
    request.evidence_pack,
    target,
  )
  const evidenceAnchorAudit = auditEvidenceAnchoredBlocks(
    blocks.filter((block) => block.fact_audit_mode === "evidence_anchored"),
    request.evidence_pack,
    target,
  )
  const localFactAuditStatus = artifactLocalFactAuditStatus(factAudit)
  const factStatus: FactAuditStatus = blocks.length === 0
    ? "reject"
    : aggregateFactStatus([
        localFactAuditStatus,
        citationAudit.status,
        evidenceAnchorAudit.status,
      ])
  const arbitration = arbitrate({
    artifactId: target.artifact.artifact_id,
    factAuditStatus: factStatus,
    teachingAuditStatus: teachingAudit.status,
    revisionRound: request.revision_round,
  })
  const decision = arbitration.decision === "revise"
    && request.revision_round >= request.max_revision_rounds
    ? "reject"
    : arbitration.decision
  const findings = [
    ...(blocks.length === 0 ? [emptyExtractionFinding(target)] : []),
    ...factFindings(target, factAudit, blocksById),
    ...citationAudit.findings,
    ...evidenceAnchorAudit.findings,
    ...(includePathFindings ? teachingFindings(target, teachingAudit) : []),
  ]
  const objectiveIds = request.generation_spec.targets.map((target) => target.objective_id)
  const instructions = findings.flatMap((finding) =>
    toInstructions(
      finding,
      finding.source === "teaching_audit"
        ? objectiveIds.slice(0, 1)
        : objectiveIds,
    ))
  return {
    result: {
      artifact_kind: target.kind,
      artifact_id: target.artifact.artifact_id,
      artifact_hash: target.artifact_hash,
      fact_status: factStatus,
      teaching_status: teachingAudit.status,
      decision,
      can_revise: decision === "revise" && arbitration.canRevise,
      findings,
      revision_instructions: instructions,
    },
  }
}

/**
 * B audits the frozen learning path once. Goal wording and weak-concept
 * preferences remain useful diagnostics, but they do not invalidate a path
 * whose objectives already have A-owned evidence. Difficulty, prerequisites
 * and unresolved path references are structural and request a new spec.
 */
function auditPathTeaching(
  request: ContentReviewRequest,
  knowledgeBase: KnowledgeBase,
): TeachingAuditResult {
  const targetSourceIds = unique(
    request.generation_spec.path_node.target_source_ids,
  )
  const raw = auditTeaching({
    artifactId: stableId("PATH-AUDIT", {
      run_id: request.run_id,
      generation_spec_hash: request.generation_spec_hash,
      revision_round: request.revision_round,
    }),
    learnerProfile: {
      learner_id: request.generation_spec.profile_ref.profile_id,
      level: request.generation_spec.learner_adaptation.level,
      known_concepts: [...request.generation_spec.learner_adaptation.known_concepts],
      weak_concepts: [...request.generation_spec.learner_adaptation.weak_concepts],
      goal: request.generation_spec.path_node.goal,
    },
    knowledgeBase,
    citedSourceIds: targetSourceIds,
    targetSourceIds,
  })

  const knownSourceIds = new Set(
    knowledgeBase.items.map((item) => item.sourceId),
  )
  const unknownTargetSourceIds = targetSourceIds.filter(
    (sourceId) => !knownSourceIds.has(sourceId),
  )
  const blockingDimensions = raw.failedDimensions.filter((dimension) =>
    dimension === "difficulty_alignment"
    || dimension === "prerequisite_coverage")
  if (unknownTargetSourceIds.length > 0
    && !blockingDimensions.includes("prerequisite_coverage")) {
    blockingDimensions.push("prerequisite_coverage")
  }

  if (blockingDimensions.length === 0) {
    return {
      ...raw,
      status: "pass",
      summary: "路径教学审核通过。",
      revisionHints: [],
      failedDimensions: [],
      missingPrerequisiteSourceIds: [],
      unknownPrerequisiteRefs: [],
      requiredAction: "adjust_content",
      fixScope: "artifact",
      recommendedLevel: null,
      canRecover: true,
    }
  }

  const unknownReferences = unique([
    ...raw.unknownPrerequisiteRefs,
    ...unknownTargetSourceIds,
  ])
  return {
    ...raw,
    status: "reject",
    summary: "路径教学审核需要重新规划。",
    revisionHints: raw.revisionHints.filter((hint) =>
      hint.includes("[difficulty_alignment]")
      || hint.includes("[prerequisite_coverage]")),
    failedDimensions: blockingDimensions,
    unknownPrerequisiteRefs: unknownReferences,
    requiredAction: "replan_path",
    fixScope: "new_spec",
    canRecover: unknownReferences.length === 0 && raw.canRecover,
  }
}

function auditEvidenceAnchoredBlocks(
  blocks: ReviewContentBlock[],
  evidence: ReviewEvidencePack,
  target: ReviewablePublicArtifact,
): { status: FactAuditStatus; findings: ContentReviewFinding[] } {
  const facts = new Map<string, string>(evidence.results.flatMap((item) =>
    item.facts.map((fact) => [
      `${fact.source_id}:${fact.fact_id}`,
      fact.content,
    ] as const)))
  const findings: ContentReviewFinding[] = []

  for (const block of blocks) {
    if (block.citations.length === 0) {
      findings.push({
        source: "fact_audit",
        code: "missing_citation",
        artifact_kind: target.kind,
        artifact_id: target.artifact.artifact_id,
        message: "教学正文未绑定当前冻结证据",
        proposed_action: "为正文绑定当前 evidence_pack 中存在的事实引用",
        fix_scope: "artifact",
        locator: block.locator,
        evidence_refs: [block.review_block_id],
      })
      continue
    }

    const rendered = normalizeGroundedClaimText(block.text)
    const missingFacts: Array<{
      key: string
      kind: "missing_citation" | "missing_anchor"
    }> = []
    for (const citation of block.citations) {
      const key = `${citation.source_id}:${citation.fact_id}`
      const fact = facts.get(key)
      if (!fact) missingFacts.push({ key, kind: "missing_citation" })
      else if (!rendered.includes(normalizeGroundedClaimText(fact))) {
        missingFacts.push({ key, kind: "missing_anchor" })
      }
    }
    if (missingFacts.length === 0) continue

    const hasUnknownCitation = missingFacts.some((entry) =>
      entry.kind === "missing_citation")
    findings.push({
      source: "fact_audit",
      code: hasUnknownCitation ? "unsupported_citation" : "missing_evidence_anchor",
      artifact_kind: target.kind,
      artifact_id: target.artifact.artifact_id,
      message: hasUnknownCitation
        ? `引用不存在于当前冻结证据：${missingFacts.map((entry) => entry.key).join("、")}`
        : `教学正文没有呈现已声明的证据事实：${missingFacts.map((entry) => entry.key).join("、")}`,
      proposed_action: hasUnknownCitation
        ? "改用当前 evidence_pack 中存在且与目标对应的引用"
        : "在教学正文中呈现对应的冻结事实，个性化说明可作为教学脚手架保留",
      fix_scope: "artifact",
      locator: block.locator,
      evidence_refs: [block.review_block_id, ...missingFacts.map((entry) => entry.key)],
    })
  }

  return {
    status: findings.some((finding) => finding.code === "unsupported_citation")
      ? "reject"
      : findings.length > 0
        ? "revise"
        : "pass",
    findings,
  }
}

function artifactLocalFactAuditStatus(result: FactAuditResult): FactAuditStatus {
  if (result.status !== "reject") return result.status
  const terminal = result.checkedClaims.some((claim) =>
    claim.verdict === "external_knowledge"
    || (claim.verdict === "unsupported"
      && claim.reason.startsWith("引用不存在于当前 RAG 结果")))
  return terminal ? "reject" : "revise"
}

function structuredRecoveryFields(
  teachingAudit: TeachingAuditResult,
  instructions: ContentRevisionInstruction[],
): Pick<
  ContentReviewResult,
  | "failed_dimensions"
  | "missing_prerequisite_source_ids"
  | "unknown_prerequisite_refs"
  | "required_action"
  | "fix_scope"
  | "recommended_level"
  | "can_recover"
> {
  const scopes = new Set(instructions.map((instruction) =>
    instruction.fix_scope))
  const fixScope: ReviewFixScope = scopes.has("new_spec")
    ? "new_spec"
    : scopes.has("new_evidence")
      ? "new_evidence"
      : "artifact"
  const matchingAudit = teachingAudit.fixScope === fixScope
    ? teachingAudit
    : undefined
  const requiredAction: RequiredAction = matchingAudit?.requiredAction
    ?? (fixScope === "new_spec"
      ? "replan_path"
      : fixScope === "new_evidence"
        ? "request_new_evidence"
        : "adjust_content")
  const relevantTeachingAudit = teachingAudit.fixScope === fixScope
    && teachingAudit.status !== "pass"
    ? teachingAudit
    : undefined
  const recommendedLevel = relevantTeachingAudit?.recommendedLevel ?? null
  return {
    failed_dimensions: unique([
      ...teachingAudit.failedDimensions,
      ...instructions
        .filter((instruction) => instruction.source !== "teaching_audit")
        .map((instruction) => instruction.code),
    ]),
    missing_prerequisite_source_ids: unique(
      teachingAudit.missingPrerequisiteSourceIds,
    ),
    unknown_prerequisite_refs: unique(
      teachingAudit.unknownPrerequisiteRefs,
    ),
    required_action: requiredAction,
    fix_scope: fixScope,
    ...(recommendedLevel ? { recommended_level: recommendedLevel } : {}),
    can_recover: fixScope === "new_spec"
      ? relevantTeachingAudit?.canRecover ?? false
      : true,
  }
}

function auditCitationOnlyBlocks(
  blocks: ReviewContentBlock[],
  evidence: ReviewEvidencePack,
  target: ReviewablePublicArtifact,
): { status: FactAuditStatus; findings: ContentReviewFinding[] } {
  const factKeys = new Set(evidence.results.flatMap((item) =>
    item.facts.map((fact) => `${fact.source_id}:${fact.fact_id}`)))
  const findings: ContentReviewFinding[] = []
  for (const block of blocks) {
    if (block.citations.length === 0) {
      findings.push({
        source: "fact_audit",
        code: "missing_citation",
        artifact_kind: target.kind,
        artifact_id: target.artifact.artifact_id,
        message: "教学提示或题目未绑定当前冻结证据",
        proposed_action: "补充当前 evidence_pack 中存在的 source_id/fact_id 引用",
        fix_scope: "artifact",
        locator: block.locator,
        evidence_refs: [block.review_block_id],
      })
      continue
    }
    const missing = block.citations.filter((citation) =>
      !factKeys.has(`${citation.source_id}:${citation.fact_id}`))
    if (missing.length > 0) {
      findings.push({
        source: "fact_audit",
        code: "unsupported_citation",
        artifact_kind: target.kind,
        artifact_id: target.artifact.artifact_id,
        message: `引用不存在于当前冻结证据：${missing
          .map((citation) => `${citation.source_id}:${citation.fact_id}`)
          .join("、")}`,
        proposed_action: "改用当前 evidence_pack 中存在且与该目标对应的引用",
        fix_scope: "artifact",
        locator: block.locator,
        evidence_refs: missing.map((citation) => `${citation.source_id}:${citation.fact_id}`),
      })
    }
  }
  return {
    status: findings.some((finding) => finding.code === "unsupported_citation")
      ? "reject"
      : findings.length > 0
        ? "revise"
        : "pass",
    findings,
  }
}

function aggregateFactStatus(statuses: FactAuditStatus[]): FactAuditStatus {
  if (statuses.includes("reject")) return "reject"
  if (statuses.includes("revise")) return "revise"
  return "pass"
}

function factFindings(
  target: ReviewablePublicArtifact,
  result: FactAuditResult,
  blocksById: Map<string, ReviewContentBlock>,
): ContentReviewFinding[] {
  return result.checkedClaims.flatMap((claim) => {
    if (claim.verdict === "supported") return []
    const block = blocksById.get(claim.blockId)
    const fixScope = claim.verdict === "external_knowledge" ? "new_evidence" as const : "artifact" as const
    return [{
      source: "fact_audit" as const,
      code: claim.verdict,
      artifact_kind: target.kind,
      artifact_id: target.artifact.artifact_id,
      message: claim.reason,
      proposed_action: claim.verdict === "missing_citation"
        ? "删除非知识性陈述，或使用本次冻结证据中的事实重写并附准确引用"
        : claim.verdict === "external_knowledge"
          ? "移除证据范围外知识；如确有必要，结束本轮并申请新的证据包"
          : "依据本次冻结证据重写该内容，并修正或移除无效引用",
      fix_scope: fixScope,
      locator: block?.locator,
      evidence_refs: [
        claim.blockId,
        ...claim.citations.map((citation) => `${citation.source_id}:${citation.fact_id}`),
      ],
    }]
  })
}

function teachingFindings(
  target: ReviewablePublicArtifact,
  result: TeachingAuditResult,
): ContentReviewFinding[] {
  if (result.status === "pass") return []

  // 使用 B 输出的 structured action/fix_scope 而非内部推断
  const fixScope: "artifact" | "new_evidence" | "new_spec" = result.fixScope
  const actionLabel: Record<string, string> = {
    adjust_content: "在当前 GenerationSpec 允许的目标内调整内容，使其覆盖学习者薄弱点和学习目标",
    request_new_evidence: "请求 A 补充缺失的证据后重跑内容生成",
    replan_path: "调用 B 路径规划接口获取新的 LearningPathNode，然后创建新的 GenerationSpec 重跑",
    reprofile_learner: "学习者画像已过时，需先更新画像再重新生成",
  }
  const proposedAction = actionLabel[result.requiredAction]
    ?? "保持当前产物不发布，由上游调整学习路径或目标后创建新的 GenerationSpec"

  // 附加恢复信息到 proposed_action，告诉 C 具体该做什么
  const extras: string[] = []
  if (result.missingPrerequisiteSourceIds.length > 0) {
    extras.push(`缺失前置知识: ${result.missingPrerequisiteSourceIds.join(", ")}`)
  }
  if (result.unknownPrerequisiteRefs.length > 0) {
    extras.push(`未知前置引用(知识库中不存在): ${result.unknownPrerequisiteRefs.join(", ")}`)
  }
  if (result.recommendedLevel) {
    extras.push(`建议学习者水平: ${result.recommendedLevel}`)
  }

  const findings = result.failedDimensions.map((dim) => {
    const key = dimensionToCheckKey(dim)
    const check = result.checks[key]
    const message = check && "reason" in check ? (check as { reason: string }).reason : dim
    return {
      source: "teaching_audit" as const,
      code: dim,
      artifact_kind: target.kind,
      artifact_id: target.artifact.artifact_id,
      message,
      proposed_action: extras.length > 0
        ? `${proposedAction}。${extras.join("；")}`
        : proposedAction,
      fix_scope: fixScope,
      evidence_refs: [target.artifact.artifact_id],
    }
  })

  return findings
}

function emptyExtractionFinding(
  target: ReviewablePublicArtifact,
): ContentReviewFinding {
  return {
    source: "review_adapter",
    code: "no_reviewable_content",
    artifact_kind: target.kind,
    artifact_id: target.artifact.artifact_id,
    message: "公开产物没有可送审的带定位内容",
    proposed_action: "补充可定位的知识性内容和引用后重新生成",
    fix_scope: "artifact",
    evidence_refs: [target.artifact.artifact_id],
  }
}

function toInstructions(
  finding: ContentReviewFinding,
  objectiveIds: string[],
): ContentRevisionInstruction[] {
  const targets = finding.locator?.objective_id
    ? [finding.locator.objective_id]
    : objectiveIds
  return [...new Set(targets)].map((objectiveId) => {
    const core = {
      ...finding,
      target_agent: agentForReviewArtifact(finding.artifact_kind),
      target_artifact_id: finding.artifact_id,
      objective_id: objectiveId,
    }
    return {
      instruction_id: stableId("REV", core),
      ...core,
    }
  })
}

function aggregateDecision(decisions: ContentReviewDecision[]): ContentReviewDecision {
  if (decisions.includes("reject")) return "reject"
  if (decisions.includes("revise")) return "revise"
  return "pass"
}

function assertReviewContext(request: ContentReviewRequest, kbVersion: string): void {
  if (request.revision_round < 0 || !Number.isSafeInteger(request.revision_round)) {
    throw new Error("ROLE_C_REVIEW_INVALID_ROUND")
  }
  if (request.generation_spec.run_id !== request.run_id) {
    throw new Error("ROLE_C_REVIEW_RUN_MISMATCH")
  }
  if (request.generation_spec.evidence_ref !== request.evidence_pack.retrieval_id) {
    throw new Error("ROLE_C_REVIEW_EVIDENCE_REF_MISMATCH")
  }
  if (request.generation_spec.evidence_content_hash !== request.evidence_hash) {
    throw new Error("ROLE_C_REVIEW_EVIDENCE_HASH_MISMATCH")
  }
  if (request.generation_spec.versions.kb_version !== request.evidence_pack.kb_version
    || request.evidence_pack.kb_version !== kbVersion) {
    throw new Error("ROLE_C_REVIEW_KB_VERSION_MISMATCH")
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

/** Mapping from TeachingAuditDimension to TeachingAuditResult.checks keys */
function dimensionToCheckKey(dim: string): "difficulty" | "prerequisite" | "weakConcept" | "goal" {
  const map: Record<string, "difficulty" | "prerequisite" | "weakConcept" | "goal"> = {
    difficulty_alignment: "difficulty",
    prerequisite_coverage: "prerequisite",
    weak_concept_coverage: "weakConcept",
    goal_alignment: "goal",
  }
  return map[dim] ?? "difficulty"
}
