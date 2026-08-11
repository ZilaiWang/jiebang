import type { KnowledgeBase, KnowledgeItem } from "../../knowledge/types"
import { loadKnowledgeBase } from "../../knowledge/loader"
import {
  retrieveKnowledge,
  type RagResult,
  type RagResultItem,
} from "../../rag/retriever"
import { retrieveStructuredEvidenceFromKnowledgeBase } from "../../rag/structured-evidence"
import type { LearnerProfile } from "../../role-b-profile/types"
import { auditTeaching } from "../../role-b-profile/teaching-audit/auditor"
import type { TeachingAuditStatus } from "../../role-b-profile/teaching-audit/types"
import {
  GOLDEN_LEARNER_PROFILES,
  type Week3EvaluationCase,
  type Week3ResourceKind,
} from "../../evaluation/week3-evaluation"
import {
  generateRoleCForRoleDWithRuntime,
  type RoleCForRoleDRuntimeOptions,
} from "../../role-d-integration/role-c-service"
import type {
  RoleCForRoleDResult,
  RoleDGeneratedArtifact,
} from "../../role-d-integration/contracts"
import {
  defineLearningPathNode,
  InMemoryLearningCycleStore,
  InMemoryMasteryStateStore,
  InMemorySecureArtifactStore,
  stableId,
  type LearningPathNode,
  type ObservableBehavior,
} from "../index"

export type RoleCWeek3ExecutionMode = "model"
export type RoleCWeek3ArtifactKind = "lesson" | "lab" | "assessment"

export interface RoleCWeek3PreparedInput {
  profile: LearnerProfile
  ragResult: RagResult
  pathNode: LearningPathNode
  kbVersion: string
  knowledgeBase: KnowledgeBase
}

export interface RoleCWeek3ArtifactResult {
  kind: RoleCWeek3ArtifactKind
  present: boolean
  title?: string
  preview?: string
  citation_count: number
  cited_target_source_ids: string[]
  target_coverage: number
  item_count: number
}

export interface RoleCWeek3CaseResult {
  case_id: string
  learner_profile_id: string
  resource_kind: Week3ResourceKind
  execution_mode: RoleCWeek3ExecutionMode
  status: RoleCForRoleDResult["status"]
  duration_ms: number
  requested_target_source_ids: string[]
  final_target_source_ids: string[]
  prerequisite_source_ids: string[]
  artifacts: RoleCWeek3ArtifactResult[]
  all_three_artifacts_present: boolean
  target_citation_coverage: number
  review_decision: "pass" | "revise" | "reject" | "not_reached"
  checked_claims: number
  conflicting_claims: number
  hallucination_rate: number | null
  expected_difficulty: Week3EvaluationCase["expected_difficulty"]
  final_profile_level: LearnerProfile["level"] | null
  teaching_audit_status: TeachingAuditStatus | "not_reached"
  difficulty_matched: boolean | null
  prerequisite_covered: boolean | null
  weak_concepts_covered: boolean | null
  goal_aligned: boolean | null
  code_execution: "passed" | "failed" | "not_reached"
  recovery_code: "READY" | "BLOCKED" | "UNSUPPORTED_TARGET" | "not_used"
  recovery_attempts: number
  failure_stage?: string
  failure_reason?: string
}

export interface RoleCWeek3Report {
  workflow: "RoleC_Week3_Actual_Pipeline_Evaluation"
  generated_at: string
  execution_mode: RoleCWeek3ExecutionMode
  total_cases: number
  summary: {
    ready: number
    blocked: number
    failed: number
    ready_rate: number
    all_three_artifacts_rate: number
    target_citation_coverage: number
    grounded_claims: number
    conflicting_claims: number
    hallucination_rate: number | null
    teaching_audit_pass_rate: number | null
    difficulty_match_rate: number | null
    prerequisite_coverage: number | null
    weak_concept_coverage: number | null
    goal_alignment_rate: number | null
    average_duration_ms: number
  }
  case_results: RoleCWeek3CaseResult[]
}

export interface RunRoleCWeek3CaseOptions {
  executionMode: RoleCWeek3ExecutionMode
  runtime: RoleCForRoleDRuntimeOptions
  /** A fresh benchmark run must not replay an older model gateway result. */
  runId?: string
  knowledgeBase?: KnowledgeBase
  profile?: LearnerProfile
}

/**
 * Converts A's evaluation case into the existing B/A → C public contract.
 * The requested source identities remain unchanged; no target-specific content
 * template is selected here.
 */
export async function prepareRoleCWeek3Input(
  evaluationCase: Week3EvaluationCase,
  options: Pick<RunRoleCWeek3CaseOptions, "knowledgeBase" | "profile"> = {},
): Promise<RoleCWeek3PreparedInput> {
  const knowledgeBase = options.knowledgeBase ?? await loadKnowledgeBase()
  const byId = new Map(knowledgeBase.items.map((item) => [item.sourceId, item]))
  const targetItems = evaluationCase.target_source_ids.map((sourceId) => {
    const item = byId.get(sourceId)
    if (!item) throw new Error(`WEEK3_UNKNOWN_TARGET:${sourceId}`)
    if (item.facts.length === 0) throw new Error(`WEEK3_TARGET_WITHOUT_FACTS:${sourceId}`)
    return item
  })
  const prerequisiteSourceIds = collectPrerequisites(
    evaluationCase.target_source_ids,
    byId,
  )
  const requiredSourceIds = [
    ...evaluationCase.target_source_ids,
    ...prerequisiteSourceIds,
  ]
  const query = [
    evaluationCase.query,
    `精确评测目标：${targetItems.map((item) => item.title).join("、")}`,
  ].join("；")
  const recalled = await retrieveKnowledge({
    query,
    learnerLevel: evaluationCase.learner_level,
    topK: knowledgeBase.items.length,
  })
  const structured = retrieveStructuredEvidenceFromKnowledgeBase(
    { source_ids: requiredSourceIds },
    knowledgeBase,
  )
  if (structured.missing_source_ids.length > 0) {
    throw new Error(`WEEK3_MISSING_EVIDENCE:${structured.missing_source_ids.join(",")}`)
  }
  const recalledById = new Map(
    recalled.results.map((item) => [sourceIdOf(item), item]),
  )
  const structuredById = new Map(
    structured.results.map((item) => [sourceIdOf(item), item]),
  )
  const exactResults = requiredSourceIds.map((sourceId) => {
    const exact = structuredById.get(sourceId)
    if (!exact) throw new Error(`WEEK3_MISSING_EVIDENCE:${sourceId}`)
    const matched = recalledById.get(sourceId)
    return matched ? withRetrievalTrace(exact, matched) : exact
  })
  const ragResult: RagResult = {
    query,
    learnerLevel: evaluationCase.learner_level,
    topK: exactResults.length,
    results: exactResults,
  }
  const profile = options.profile
    ?? structuredClone(GOLDEN_LEARNER_PROFILES[evaluationCase.learner_profile_id])
  const pathNode = defineLearningPathNode({
    node_id: stableId("PATH-WEEK3", {
      case_id: evaluationCase.case_id,
      learner_id: profile.learner_id,
      target_source_ids: evaluationCase.target_source_ids,
    }),
    target_source_ids: [...evaluationCase.target_source_ids],
    prerequisite_source_ids: prerequisiteSourceIds,
    goal: profile.goal,
    objectives: targetItems.map((item, index) => ({
      objective_id: stableId("OBJECTIVE-WEEK3", {
        case_id: evaluationCase.case_id,
        source_id: item.sourceId,
      }),
      source_id: item.sourceId,
      required_fact_ids: [item.facts[0]!.factId],
      observable_behavior: behaviorFor(
        evaluationCase.resource_kind,
        index,
        targetItems.length,
      ),
      importance: "core" as const,
    })),
    assessment_blueprint: assessmentBlueprint(
      targetItems.length,
      evaluationCase.resource_kind,
    ),
  })

  return {
    profile,
    ragResult,
    pathNode,
    kbVersion: knowledgeBase.version,
    knowledgeBase,
  }
}

/** Runs one case through the same public service used by Role D. */
export async function runRoleCWeek3Case(
  evaluationCase: Week3EvaluationCase,
  options: RunRoleCWeek3CaseOptions,
): Promise<RoleCWeek3CaseResult> {
  const startedAt = performance.now()
  let prepared: RoleCWeek3PreparedInput | undefined
  try {
    prepared = await prepareRoleCWeek3Input(evaluationCase, options)
    const runtime: RoleCForRoleDRuntimeOptions = {
      ...options.runtime,
      providerMode: options.executionMode,
      learningPersistence: options.runtime.learningPersistence ?? {
        cycleStore: new InMemoryLearningCycleStore(),
        secureStore: new InMemorySecureArtifactStore(),
        masteryStore: new InMemoryMasteryStateStore(),
      },
    }
    const result = await generateRoleCForRoleDWithRuntime({
      profile: prepared.profile,
      ragResult: prepared.ragResult,
      kbVersion: prepared.kbVersion,
      runId: options.runId ?? `RUN-C-WEEK3-${evaluationCase.case_id}`,
      pathNode: prepared.pathNode,
    }, runtime)
    return summarizeCase(
      evaluationCase,
      options.executionMode,
      prepared,
      result,
      performance.now() - startedAt,
    )
  } catch (error) {
    return failedPreparation(
      evaluationCase,
      options.executionMode,
      prepared,
      error,
      performance.now() - startedAt,
    )
  }
}

export function buildRoleCWeek3Report(
  executionMode: RoleCWeek3ExecutionMode,
  caseResults: RoleCWeek3CaseResult[],
  generatedAt = new Date().toISOString(),
): RoleCWeek3Report {
  const total = caseResults.length
  const ready = caseResults.filter((item) => item.status === "ready").length
  const checkedClaims = sum(caseResults.map((item) => item.checked_claims))
  const conflicts = sum(caseResults.map((item) => item.conflicting_claims))
  const teachingStatuses = caseResults
    .map((item) => item.teaching_audit_status)
    .filter((value): value is TeachingAuditStatus => value !== "not_reached")
  return {
    workflow: "RoleC_Week3_Actual_Pipeline_Evaluation",
    generated_at: generatedAt,
    execution_mode: executionMode,
    total_cases: total,
    summary: {
      ready,
      blocked: caseResults.filter((item) => item.status === "blocked").length,
      failed: caseResults.filter((item) => item.status === "failed").length,
      ready_rate: ratio(ready, total),
      all_three_artifacts_rate: ratio(
        caseResults.filter((item) => item.all_three_artifacts_present).length,
        total,
      ),
      target_citation_coverage: average(
        caseResults.map((item) => item.target_citation_coverage),
      ),
      grounded_claims: Math.max(0, checkedClaims - conflicts),
      conflicting_claims: conflicts,
      hallucination_rate: checkedClaims === 0
        ? null
        : round4(conflicts / checkedClaims),
      teaching_audit_pass_rate: statusRate(teachingStatuses, "pass"),
      difficulty_match_rate: nullableBooleanRate(caseResults.map((item) => item.difficulty_matched)),
      prerequisite_coverage: nullableBooleanRate(caseResults.map((item) => item.prerequisite_covered)),
      weak_concept_coverage: nullableBooleanRate(caseResults.map((item) => item.weak_concepts_covered)),
      goal_alignment_rate: nullableBooleanRate(caseResults.map((item) => item.goal_aligned)),
      average_duration_ms: total === 0
        ? 0
        : Math.round(sum(caseResults.map((item) => item.duration_ms)) / total),
    },
    case_results: caseResults,
  }
}

export function renderRoleCWeek3Report(report: RoleCWeek3Report): string {
  const lines = [
    "# Role C Week 3 真实流水线评测",
    "",
    `- 运行模式：${report.execution_mode}`,
    `- 用例数：${report.total_cases}`,
    `- 就绪 / 阻塞 / 失败：${report.summary.ready} / ${report.summary.blocked} / ${report.summary.failed}`,
    `- 三类内容齐全率：${percent(report.summary.all_three_artifacts_rate)}`,
    `- 目标引用覆盖率：${percent(report.summary.target_citation_coverage)}`,
    `- 事实冲突率：${nullablePercent(report.summary.hallucination_rate)}`,
    `- 教学审核通过率：${nullablePercent(report.summary.teaching_audit_pass_rate)}`,
    `- 难度匹配率：${nullablePercent(report.summary.difficulty_match_rate)}`,
    `- 前置知识覆盖率：${nullablePercent(report.summary.prerequisite_coverage)}`,
    `- B 原始薄弱点诊断命中率：${nullablePercent(report.summary.weak_concept_coverage)}`,
    `- B 原始目标关键词命中率：${nullablePercent(report.summary.goal_alignment_rate)}`,
    `- 平均用时：${report.summary.average_duration_ms} ms`,
    "",
    "| 用例 | 画像 | 目标 | 状态 | 讲义 | 编程 | 测评 | 终局审核 | B 教学审核 | 引用覆盖 | 代码执行 | 用时 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...report.case_results.map((item) => {
      const present = new Map(item.artifacts.map((artifact) => [artifact.kind, artifact.present]))
      return [
        `| ${item.case_id}`,
        item.learner_profile_id,
        targetLabel(item),
        item.status,
        marker(present.get("lesson")),
        marker(present.get("lab")),
        marker(present.get("assessment")),
        item.review_decision,
        item.teaching_audit_status,
        percent(item.target_citation_coverage),
        item.code_execution,
        `${item.duration_ms} ms |`,
      ].join(" | ")
    }),
  ]
  const failures = report.case_results.filter((item) => item.failure_reason)
  if (failures.length > 0) {
    lines.push("", "## 未就绪原因", "")
    lines.push(...failures.map((item) =>
      `- ${item.case_id}（${item.failure_stage ?? "unknown"}）：${item.failure_reason}`))
  }
  const previews = report.case_results.filter((item) =>
    item.artifacts.some((artifact) => artifact.preview))
  if (previews.length > 0) {
    lines.push("", "## 发布内容预览", "")
    for (const item of previews) {
      lines.push(`### ${item.case_id}`, "")
      for (const artifact of item.artifacts) {
        if (!artifact.preview) continue
        lines.push(
          `- ${artifactLabel(artifact.kind)}：${artifact.title ?? "未命名"}`,
          `  ${artifact.preview}`,
        )
      }
      lines.push("")
    }
  }
  return `${lines.join("\n")}\n`
}

function targetLabel(item: RoleCWeek3CaseResult): string {
  const requested = item.requested_target_source_ids.join("/")
  const final = item.final_target_source_ids.join("/")
  return requested === final ? requested : `${requested} → ${final}`
}

function summarizeCase(
  evaluationCase: Week3EvaluationCase,
  executionMode: RoleCWeek3ExecutionMode,
  prepared: RoleCWeek3PreparedInput,
  result: RoleCForRoleDResult,
  durationMs: number,
): RoleCWeek3CaseResult {
  const finalTargets = result.status === "ready"
    ? result.finalContext.pathNode.target_source_ids
    : prepared.pathNode.target_source_ids
  const artifacts = (["lesson", "lab", "assessment"] as const).map((kind) =>
    summarizeArtifact(kind, result.artifacts.find((artifact) => artifact.kind === kind), finalTargets))
  const checkedClaims = sum(result.audit?.factAudits.map((item) => item.checkedClaims) ?? [])
  const conflictingClaims = sum(result.audit?.factAudits.map((item) => item.conflicts) ?? [])
  const workflowFailure = result.workflow.findLast((event) => event.status === "blocked")
  const reviewDecision = result.audit?.arbitration.decision ?? "not_reached"
  const profileLevel = result.status === "ready"
    ? result.finalContext.profileSnapshot.level
    : prepared.profile.level
  const teaching = summarizeTeachingAudit(result, prepared, finalTargets)
  return {
    case_id: evaluationCase.case_id,
    learner_profile_id: evaluationCase.learner_profile_id,
    resource_kind: evaluationCase.resource_kind,
    execution_mode: executionMode,
    status: result.status,
    duration_ms: Math.round(durationMs),
    requested_target_source_ids: [...evaluationCase.target_source_ids],
    final_target_source_ids: [...finalTargets],
    prerequisite_source_ids: [...prepared.pathNode.prerequisite_source_ids],
    artifacts,
    all_three_artifacts_present: artifacts.every((artifact) => artifact.present),
    target_citation_coverage: average(artifacts.map((artifact) => artifact.target_coverage)),
    review_decision: reviewDecision,
    checked_claims: checkedClaims,
    conflicting_claims: conflictingClaims,
    hallucination_rate: checkedClaims === 0 ? null : round4(conflictingClaims / checkedClaims),
    expected_difficulty: evaluationCase.expected_difficulty,
    final_profile_level: profileLevel,
    teaching_audit_status: teaching.status,
    difficulty_matched: teaching.difficultyMatched,
    prerequisite_covered: teaching.prerequisiteCovered,
    weak_concepts_covered: teaching.weakConceptsCovered,
    goal_aligned: teaching.goalAligned,
    code_execution: result.status === "ready"
      ? "passed"
      : result.workflow.some((event) =>
          event.status === "blocked"
          && (
            event.agent.toLowerCase().includes("docker")
            || /(参考实现|隐藏测试|执行验证|代码验证)/.test(`${event.stage}${event.summary}`)
          ))
        ? "failed"
        : "not_reached",
    recovery_code: result.recovery?.code ?? "not_used",
    recovery_attempts: result.recovery?.attempts ?? 0,
    ...(result.status === "ready" ? {} : {
      failure_stage: workflowFailure?.stage ?? "generation",
      failure_reason: result.reason,
    }),
  }
}

function failedPreparation(
  evaluationCase: Week3EvaluationCase,
  executionMode: RoleCWeek3ExecutionMode,
  prepared: RoleCWeek3PreparedInput | undefined,
  error: unknown,
  durationMs: number,
): RoleCWeek3CaseResult {
  const targets = prepared?.pathNode.target_source_ids
    ?? evaluationCase.target_source_ids
  return {
    case_id: evaluationCase.case_id,
    learner_profile_id: evaluationCase.learner_profile_id,
    resource_kind: evaluationCase.resource_kind,
    execution_mode: executionMode,
    status: "failed",
    duration_ms: Math.round(durationMs),
    requested_target_source_ids: [...evaluationCase.target_source_ids],
    final_target_source_ids: [...targets],
    prerequisite_source_ids: [...(prepared?.pathNode.prerequisite_source_ids ?? [])],
    artifacts: (["lesson", "lab", "assessment"] as const).map((kind) => ({
      kind,
      present: false,
      citation_count: 0,
      cited_target_source_ids: [],
      target_coverage: 0,
      item_count: 0,
    })),
    all_three_artifacts_present: false,
    target_citation_coverage: 0,
    review_decision: "not_reached",
    checked_claims: 0,
    conflicting_claims: 0,
    hallucination_rate: null,
    expected_difficulty: evaluationCase.expected_difficulty,
    final_profile_level: prepared?.profile.level ?? null,
    teaching_audit_status: "not_reached",
    difficulty_matched: null,
    prerequisite_covered: null,
    weak_concepts_covered: null,
    goal_aligned: null,
    code_execution: "not_reached",
    recovery_code: "not_used",
    recovery_attempts: 0,
    failure_stage: "preparation",
    failure_reason: error instanceof Error ? error.message : "unknown error",
  }
}

function summarizeTeachingAudit(
  result: RoleCForRoleDResult,
  prepared: RoleCWeek3PreparedInput,
  finalTargetSourceIds: string[],
): {
  status: TeachingAuditStatus | "not_reached"
  difficultyMatched: boolean | null
  prerequisiteCovered: boolean | null
  weakConceptsCovered: boolean | null
  goalAligned: boolean | null
} {
  if (result.status !== "ready") {
    return {
      status: result.audit?.teachingAudit.status ?? "not_reached",
      difficultyMatched: null,
      prerequisiteCovered: null,
      weakConceptsCovered: null,
      goalAligned: null,
    }
  }
  const citedSourceIds = [...new Set(result.artifacts.flatMap((artifact) =>
    artifact.citations.map((citation) => citation.source_id)))]
  const finalProfile = snapshotToProfile(result.finalContext.profileSnapshot)
  finalProfile.goal = result.finalContext.pathNode.goal
  const teachingAudit = auditTeaching({
    artifactId: `week3:${result.runId}`,
    learnerProfile: finalProfile,
    knowledgeBase: prepared.knowledgeBase,
    citedSourceIds,
    targetSourceIds: finalTargetSourceIds,
    contentSummary: summarizePublishedContent(result.artifacts),
  })
  return {
    status: result.audit?.teachingAudit.status ?? teachingAudit.status,
    difficultyMatched: teachingAudit.checks.difficulty.verdict === "aligned",
    prerequisiteCovered: teachingAudit.checks.prerequisite.verdict === "aligned",
    weakConceptsCovered: teachingAudit.checks.weakConcept.verdict === "aligned",
    goalAligned: teachingAudit.checks.goal.verdict === "aligned",
  }
}

function snapshotToProfile(
  snapshot: Extract<RoleCForRoleDResult, { status: "ready" }>["finalContext"]["profileSnapshot"],
): LearnerProfile {
  return {
    learner_id: snapshot.learner_id,
    level: snapshot.level,
    known_concepts: [...snapshot.known_concepts],
    weak_concepts: [...snapshot.weak_concepts],
    goal: snapshot.goal,
  }
}

function summarizePublishedContent(artifacts: RoleDGeneratedArtifact[]): string {
  return artifacts.flatMap((artifact) => [
    artifact.title,
    artifact.content,
    ...artifact.items.map((item) => item.prompt),
  ]).filter(Boolean).join("\n")
}

function summarizeArtifact(
  kind: RoleCWeek3ArtifactKind,
  artifact: RoleDGeneratedArtifact | undefined,
  targetSourceIds: string[],
): RoleCWeek3ArtifactResult {
  const citedTargets = artifact
    ? targetSourceIds.filter((sourceId) =>
        artifact.citations.some((citation) => citation.source_id === sourceId))
    : []
  return {
    kind,
    present: Boolean(artifact),
    ...(artifact ? {
      title: artifact.title,
      preview: artifactPreview(artifact),
    } : {}),
    citation_count: artifact?.citations.length ?? 0,
    cited_target_source_ids: citedTargets,
    target_coverage: ratio(citedTargets.length, targetSourceIds.length),
    item_count: artifact?.items.length ?? 0,
  }
}

function artifactPreview(artifact: RoleDGeneratedArtifact): string {
  const text = [
    artifact.content,
    ...artifact.items.slice(0, 3).map((item) => item.prompt),
  ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim()
  return text.length <= 240 ? text : `${text.slice(0, 237)}...`
}

function artifactLabel(kind: RoleCWeek3ArtifactKind): string {
  if (kind === "lesson") return "讲义"
  if (kind === "lab") return "编程练习"
  return "分阶测评"
}

function collectPrerequisites(
  targetSourceIds: string[],
  byId: Map<string, KnowledgeItem>,
): string[] {
  const targets = new Set(targetSourceIds)
  const ordered: string[] = []
  const visited = new Set<string>()
  const visiting = new Set<string>()
  const visit = (sourceId: string): void => {
    if (visited.has(sourceId)) return
    if (visiting.has(sourceId)) throw new Error(`WEEK3_PREREQUISITE_CYCLE:${sourceId}`)
    const item = byId.get(sourceId)
    if (!item) throw new Error(`WEEK3_UNKNOWN_PREREQUISITE:${sourceId}`)
    visiting.add(sourceId)
    for (const prerequisite of item.prerequisites) visit(prerequisite)
    visiting.delete(sourceId)
    visited.add(sourceId)
    if (!targets.has(sourceId)) ordered.push(sourceId)
  }
  for (const target of targetSourceIds) visit(target)
  return ordered
}

function behaviorFor(
  kind: Week3ResourceKind,
  index: number,
  targetCount: number,
): ObservableBehavior {
  if (targetCount > 1) {
    return (["trace", "apply", "create"] as const)[index]
      ?? "apply"
  }
  if (kind === "concept") return "explain"
  if (kind === "code_lab") return "create"
  return "apply"
}

function assessmentBlueprint(
  targetCount: number,
  focus: Week3ResourceKind,
): LearningPathNode["assessment_blueprint"] {
  if (targetCount === 1 && focus === "concept") {
    return {
      tier_1_count: 1,
      tier_2_count: 1,
      tier_3_count: 0,
      required_modalities: ["short_answer"],
    }
  }
  if (targetCount === 1 && focus === "assessment") {
    return {
      tier_1_count: 1,
      tier_2_count: 2,
      tier_3_count: 0,
      required_modalities: ["mcq", "trace", "short_answer"],
    }
  }
  if (targetCount === 1) {
    return {
      tier_1_count: 1,
      tier_2_count: 1,
      tier_3_count: 1,
      required_modalities: ["mcq", "trace", "code"],
    }
  }
  if (targetCount <= 3) {
    return {
      tier_1_count: 2,
      tier_2_count: 2,
      tier_3_count: 1,
      required_modalities: ["mcq", "trace", "code"],
    }
  }
  const total = Math.min(30, Math.max(targetCount, 3))
  const tier1 = Math.min(10, Math.max(1, Math.ceil(total * 0.3)))
  const tier3 = Math.min(10, Math.max(1, Math.floor(total * 0.2)))
  return {
    tier_1_count: tier1,
    tier_2_count: total - tier1 - tier3,
    tier_3_count: tier3,
    required_modalities: [],
  }
}

function withRetrievalTrace(
  exact: RagResultItem,
  recalled: RagResultItem,
): RagResultItem {
  return {
    ...exact,
    score: recalled.score,
    reason: recalled.reason,
    retrievalTrace: structuredClone(recalled.retrievalTrace),
    retrieval_trace: structuredClone(recalled.retrieval_trace),
  }
}

function sourceIdOf(item: RagResultItem): string {
  return item.source_id ?? item.sourceId
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : round4(numerator / denominator)
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : round4(sum(values) / values.length)
}

function nullableBooleanRate(values: Array<boolean | null>): number | null {
  const measured = values.filter((value): value is boolean => value !== null)
  return measured.length === 0
    ? null
    : ratio(measured.filter(Boolean).length, measured.length)
}

function statusRate<T extends string>(values: T[], expected: T): number | null {
  return values.length === 0
    ? null
    : ratio(values.filter((value) => value === expected).length, values.length)
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

function nullablePercent(value: number | null): string {
  return value === null ? "未计算" : percent(value)
}

function marker(value: boolean | undefined): string {
  return value ? "✓" : "—"
}
