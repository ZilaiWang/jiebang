import type {
  Difficulty,
  LearningArtifactView,
  LearningPathNodeView,
  LooseRecord,
  RetrievalItemView,
  RoleDSession,
  UnifiedBoundaryReport,
  UnifiedCitation,
  UnifiedHandoff,
  UnifiedRagResult,
  WorkflowEventView,
} from "./types"
import { UNIFIED_SCHEMA_VERSION } from "./types"

export function normalizeUnifiedHandoff(input: LooseRecord): UnifiedHandoff {
  const profile = input.b_profile ?? input.profile ?? {}
  const provenance = input.b_provenance ?? input.provenance ?? {}
  const rag = normalizeUnifiedRagResult(
    input.a_rag_result
      ?? input.rag_result
      ?? input.retrieval
      ?? { query: input.rag_query ?? "" },
  )
  const conflicts = provenance.conflicts ?? input.conflicts ?? []
  const validCitationIds = new Set<string>(rag.results.flatMap((item) => item.facts.map((fact) => `${fact.sourceId}-${fact.factId}`)))
  const artifacts = (input.c_artifacts ?? input.artifacts ?? []).map((artifact: LooseRecord) => normalizeUnifiedArtifact(artifact, validCitationIds))

  return {
    schemaVersion: UNIFIED_SCHEMA_VERSION,
    observedSegments: normalizeObservedSegments(input),
    version: 1,
    eventMode: input.eventMode === "live" ? "live" : "demo",
    sessionId: input.session_id ?? input.sessionId ?? `session-${profile.learner_id ?? profile.learnerId ?? "anonymous"}`,
    updatedAt: input.updated_at ?? input.updatedAt ?? new Date(0).toISOString(),
    profile: normalizeUnifiedProfile(profile),
    conflicts: conflicts.map((conflict: LooseRecord) => ({
      concept: conflict.concept,
      selfClaim: conflict.self_claim ?? conflict.selfClaim,
      objectiveVerdict: conflict.objective_verdict ?? conflict.objectiveVerdict,
      resolution: conflict.resolution,
      rule: conflict.rule,
    })),
    retrieval: {
      query: rag.query,
      topK: rag.topK,
      items: rag.results,
    },
    artifacts,
    ...(input.audit ? { audit: normalizeUnifiedAudit(input.audit) } : {}),
    ...(input.roleC ? { roleC: normalizeRoleCSession(input.roleC) } : {}),
    ...(input.feedback ? { feedback: input.feedback } : {}),
    evidenceGaps: artifacts.filter((artifact: LearningArtifactView) => artifact.evidenceStatus === "gap").map((artifact: LearningArtifactView) => artifact.id),
    workflow: (input.workflow_events ?? input.workflowEvents ?? input.workflow ?? []).map(normalizeUnifiedWorkflowEvent),
    path: (input.learning_path ?? input.learningPath ?? input.path ?? []).map(normalizeUnifiedPathNode),
    decision: {
      next: input.decision?.next ?? "remediate",
      reason: input.decision?.reason ?? "等待测评结果后由决策策略更新。",
    },
    assessmentGraded: input.assessmentGraded === true && Boolean(input.feedback),
    planSource: input.planSource === "real-ab" ? "real-ab" : "demo",
    planInput: {
      learnerId: input.planInput?.learnerId ?? profile.learner_id ?? profile.learnerId ?? "anonymous_learner",
      educationContext: input.planInput?.educationContext ?? "",
      timeBudget: input.planInput?.timeBudget ?? "",
      priorLanguages: input.planInput?.priorLanguages ?? [],
      knownConcepts: input.planInput?.knownConcepts ?? profile.known_concepts ?? profile.knownConcepts ?? [],
      weakConcepts: input.planInput?.weakConcepts ?? profile.weak_concepts ?? profile.weakConcepts ?? [],
    },
    diagnosis: normalizeUnifiedDiagnosis(input.diagnosis),
    view: {
      currentStage: input.view?.currentStage ?? "onboarding",
      maxUnlockedStage: input.view?.maxUnlockedStage ?? "onboarding",
      activeArtifactKind: input.view?.activeArtifactKind ?? "lesson",
      selectedSourceId: input.view?.selectedSourceId ?? rag.results[0]?.sourceId ?? "",
      remediationStarted: input.view?.remediationStarted ?? false,
      goalDraft: input.view?.goalDraft ?? profile.goal ?? "",
      selfRatingDraft: normalizeUnifiedDifficulty(input.view?.selfRatingDraft ?? profile.level),
      diagnosisAnswer: input.view?.diagnosisAnswer ?? "",
      diagnosisAnswers: input.view?.diagnosisAnswers ?? (input.view?.diagnosisAnswer ? { [`${input.diagnosis?.sourceId ?? "UNKNOWN"}-${input.diagnosis?.factId ?? "UNKNOWN"}-1`]: input.view.diagnosisAnswer } : {}),
      diagnosisSubmitted: input.view?.diagnosisSubmitted ?? false,
      assessmentAnswers: input.view?.assessmentAnswers ?? {},
      assessmentSubmitted: input.view?.assessmentSubmitted ?? false,
      assessmentStatus: input.view?.assessmentStatus ?? "idle",
      assessmentMessage: input.view?.assessmentMessage ?? "",
      detailDrawer: input.view?.detailDrawer === "agents" || input.view?.detailDrawer === "evidence" ? input.view.detailDrawer : "none",
    },
  }
}

export function normalizeUnifiedProfile(profile: LooseRecord): RoleDSession["profile"] {
  return {
    learnerId: profile.learner_id ?? profile.learnerId ?? "anonymous_learner",
    ...(profile.profile_version || profile.profileVersion ? {
      profileVersion: profile.profile_version ?? profile.profileVersion,
    } : {}),
    level: normalizeUnifiedDifficulty(profile.level),
    knownConcepts: profile.known_concepts ?? profile.knownConcepts ?? [],
    weakConcepts: profile.weak_concepts ?? profile.weakConcepts ?? [],
    goal: profile.goal ?? "未提供学习目标",
  }
}

export function normalizeUnifiedRagResult(rag: LooseRecord): UnifiedRagResult {
  const results = rag.results ?? rag.items ?? []

  return {
    query: rag.query ?? "",
    topK: rag.topK ?? rag.top_k ?? results.length,
    results: results.map(normalizeUnifiedRetrievalItem),
  }
}

export function normalizeUnifiedRetrievalItem(item: LooseRecord): RetrievalItemView {
  const trace = item.retrievalTrace ?? item.retrieval_trace ?? item.trace ?? {}
  const breakdown = trace.scoreBreakdown ?? trace.score_breakdown ?? {}

  return {
    sourceId: item.sourceId ?? item.source_id ?? "UNKNOWN",
    title: item.title ?? "未命名知识点",
    difficulty: normalizeUnifiedDifficulty(item.difficulty),
    score: item.score ?? item.rank_score ?? 0,
    reason: item.reason ?? item.match_reason ?? "无推荐说明",
    snippet: item.snippet ?? "",
    file: item.file ?? item.source_file ?? "",
    facts: (item.facts ?? []).map((fact: LooseRecord) => ({
      sourceId: fact.sourceId ?? fact.source_id ?? item.sourceId ?? item.source_id ?? "UNKNOWN",
      factId: fact.factId ?? fact.fact_id ?? "UNKNOWN",
      content: fact.content ?? "",
    })),
    examples: (item.examples ?? []).map((example: LooseRecord | string) => typeof example === "string"
      ? { title: "示例", code: example, explanation: "" }
      : { title: example.title ?? "示例", code: example.code ?? "", explanation: example.explanation ?? "" }),
    practiceTasks: item.practiceTasks ?? item.practice_tasks ?? [],
    quizItems: (item.quizItems ?? item.quiz_items ?? []).map((quiz: LooseRecord | string) => typeof quiz === "string"
      ? { level: 1, question: quiz, answer: "" }
      : { level: quiz.level ?? 1, question: quiz.question ?? "", answer: quiz.answer ?? "" }),
    trace: {
      matchedKeywords: trace.matchedKeywords ?? trace.matched_keywords ?? [],
      matchedFields: trace.matchedFields ?? trace.matched_fields ?? [],
      difficultyMatch: trace.difficultyMatch ?? trace.difficulty_match ?? false,
      scoreBreakdown: {
        keyword: breakdown.keyword ?? 0,
        title: breakdown.title ?? 0,
        facts: breakdown.facts ?? 0,
        practiceTasks: breakdown.practiceTasks ?? breakdown.practice_tasks ?? 0,
        difficulty: breakdown.difficulty ?? 0,
        bonus: breakdown.bonus ?? 0,
      },
    },
  }
}

export function normalizeUnifiedArtifact(artifact: LooseRecord, validCitationIds: Set<string>): LearningArtifactView {
  const citations: UnifiedCitation[] = (artifact.citations ?? [])
    .map((citation: LooseRecord) => normalizeUnifiedCitation(citation))
  const citationsAreValid = citations.length > 0
    && citations.every((citation: UnifiedCitation) => validCitationIds.has(`${citation.sourceId}-${citation.factId}`))

  return {
    id: artifact.id,
    kind: artifact.kind,
    title: artifact.title,
    status: artifact.status ?? "mock",
    content: artifact.content ?? "",
    options: artifact.options ?? [],
    items: (artifact.items ?? []).map((item: LooseRecord) => ({
      id: item.id ?? "",
      tier: item.tier,
      modality: item.modality,
      prompt: item.prompt ?? "",
      options: item.options ?? [],
      ...(item.optionIds || item.option_ids ? { optionIds: item.optionIds ?? item.option_ids } : {}),
      ...(item.maxScore || item.max_score ? { maxScore: item.maxScore ?? item.max_score } : {}),
      ...(item.starterCode || item.starter_code ? { starterCode: item.starterCode ?? item.starter_code } : {}),
      citations: (item.citations ?? []).map((citation: LooseRecord) => normalizeUnifiedCitation(citation)),
    })),
    sections: (artifact.sections ?? []).map((section: LooseRecord) => ({
      id: section.id ?? "",
      title: section.title ?? "",
      kind: section.kind ?? "paragraph",
      ...(section.text ? { text: section.text } : {}),
      ...(section.code ? { code: section.code } : {}),
      ...(section.language ? { language: section.language } : {}),
      citations: (section.citations ?? []).map((citation: LooseRecord) => normalizeUnifiedCitation(citation)),
    })),
    citations,
    evidenceStatus: citationsAreValid ? "grounded" : "gap",
  }
}

export function normalizeUnifiedCitation(citation: LooseRecord): UnifiedCitation {
  return {
    sourceId: citation.sourceId ?? citation.source_id ?? "UNKNOWN",
    factId: citation.factId ?? citation.fact_id ?? "UNKNOWN",
  }
}

export function unifiedBoundaryReport(handoff: UnifiedHandoff): UnifiedBoundaryReport {
  const boundary = handoff.observedSegments.content
    ? handoff.observedSegments.retrieval && handoff.observedSegments.profile
      ? "A_B_C_D_FULL_HANDOFF"
      : "C_ARTIFACTS_TO_D_SESSION"
    : handoff.observedSegments.retrieval
      ? "A_RAG_RESULT_TO_C_CONTENT"
      : "B_PROFILE_TO_A_RAG_REQUEST"
  const canonicalFields = boundary === "B_PROFILE_TO_A_RAG_REQUEST"
    ? ["profile", "conflicts"]
    : boundary === "A_RAG_RESULT_TO_C_CONTENT"
      ? ["profile", "retrieval", "evidenceGaps"]
      : boundary === "C_ARTIFACTS_TO_D_SESSION"
        ? ["artifacts", "workflow", "evidenceGaps"]
        : ["profile", "retrieval", "artifacts", "workflow", "evidenceGaps"]
  return {
    boundary,
    schemaVersion: handoff.schemaVersion,
    canonicalFields,
    evidenceGaps: handoff.evidenceGaps,
  }
}

function normalizeObservedSegments(input: LooseRecord): UnifiedHandoff["observedSegments"] {
  const previous = input.observedSegments
  if (previous && typeof previous === "object") {
    return {
      profile: previous.profile === true
        || hasOwn(input, "b_profile"),
      retrieval: previous.retrieval === true
        || hasOwn(input, "a_rag_result")
        || hasOwn(input, "rag_result"),
      content: previous.content === true
        || hasOwn(input, "c_artifacts"),
    }
  }
  return {
    profile: hasOwn(input, "b_profile") || hasOwn(input, "profile"),
    retrieval: hasOwn(input, "a_rag_result")
      || hasOwn(input, "rag_result")
      || hasOwn(input, "retrieval"),
    content: hasOwn(input, "c_artifacts")
      || hasOwn(input, "artifacts")
      || hasOwn(input, "roleC"),
  }
}

function hasOwn(input: LooseRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, key)
}

function normalizeUnifiedAudit(audit: LooseRecord): RoleDSession["audit"] {
  return {
    factStatus: normalizeUnifiedAuditStatus(audit.factStatus ?? audit.fact_status),
    factAudits: (audit.factAudits ?? audit.fact_audits ?? []).map((item: LooseRecord) => ({
      artifactId: item.artifactId ?? item.artifact_id ?? "",
      artifactTitle: item.artifactTitle ?? item.artifact_title ?? "未命名内容",
      artifactKind: normalizeUnifiedArtifactKind(item.artifactKind ?? item.artifact_kind),
      status: normalizeUnifiedAuditStatus(item.status),
      checkedClaims: item.checkedClaims ?? item.checked_claims ?? 0,
      conflicts: item.conflicts ?? 0,
      notes: item.notes ?? [],
    })),
    teachingAudit: {
      artifactId: audit.teachingAudit?.artifactId ?? audit.teaching_audit?.artifact_id ?? "",
      status: normalizeUnifiedAuditStatus(audit.teachingAudit?.status ?? audit.teaching_audit?.status),
      summary: audit.teachingAudit?.summary ?? audit.teaching_audit?.summary ?? "教学审核未返回摘要。",
      revisionHints: audit.teachingAudit?.revisionHints ?? audit.teaching_audit?.revision_hints ?? [],
    },
    arbitration: {
      artifactId: audit.arbitration?.artifactId ?? audit.arbitration?.artifact_id ?? "",
      decision: normalizeUnifiedAuditStatus(audit.arbitration?.decision),
      revisionRound: audit.arbitration?.revisionRound ?? audit.arbitration?.revision_round ?? 0,
      maxRevisionRounds: audit.arbitration?.maxRevisionRounds ?? audit.arbitration?.max_revision_rounds ?? 2,
      canRevise: audit.arbitration?.canRevise ?? audit.arbitration?.can_revise ?? false,
      reason: audit.arbitration?.reason ?? "仲裁未返回说明。",
    },
  }
}

function normalizeRoleCSession(value: LooseRecord) {
  return {
    runId: value.runId ?? value.run_id ?? "",
    learningSessionId: value.learningSessionId ?? value.learning_session_id ?? value.sessionId ?? value.session_id ?? "",
    formId: value.formId ?? value.form_id ?? "",
    attemptNo: value.attemptNo ?? value.attempt_no ?? 1,
  }
}

function normalizeUnifiedDiagnosis(diagnosis: LooseRecord = {}): RoleDSession["diagnosis"] {
  return {
    availability: diagnosis.availability
      ?? (Array.isArray(diagnosis.items) && diagnosis.items.length === 0 ? "unavailable" : "available"),
    ...(diagnosis.unavailableReason || diagnosis.unavailable_reason ? {
      unavailableReason: diagnosis.unavailableReason ?? diagnosis.unavailable_reason,
    } : {}),
    items: diagnosis.items?.map((item: LooseRecord, index: number) => ({
      id: item.id ?? `${item.sourceId ?? item.source_id ?? "UNKNOWN"}-${item.factId ?? item.fact_id ?? "UNKNOWN"}-${index + 1}`,
      sourceId: item.sourceId ?? item.source_id ?? "UNKNOWN",
      factId: item.factId ?? item.fact_id ?? "UNKNOWN",
      concept: item.concept ?? "未提供诊断知识点",
      difficulty: normalizeUnifiedDifficulty(item.difficulty ?? "beginner"),
      question: item.question ?? "",
      options: item.options ?? [],
      answer: item.answer ?? "",
    })),
    sourceId: diagnosis.sourceId ?? diagnosis.source_id ?? "UNKNOWN",
    factId: diagnosis.factId ?? diagnosis.fact_id ?? "UNKNOWN",
    concept: diagnosis.concept ?? "未提供诊断知识点",
    difficulty: normalizeUnifiedDifficulty(diagnosis.difficulty ?? "beginner"),
    question: diagnosis.question ?? "",
    options: diagnosis.options ?? [],
    answer: diagnosis.answer ?? "",
  }
}

function normalizeUnifiedWorkflowEvent(event: LooseRecord): WorkflowEventView {
  return {
    id: event.id,
    agent: event.agent,
    stage: event.stage,
    status: event.status,
    summary: event.summary,
    timestamp: event.timestamp,
  }
}

function normalizeUnifiedPathNode(node: LooseRecord): LearningPathNodeView {
  return {
    id: node.id,
    title: node.title,
    difficulty: normalizeUnifiedDifficulty(node.difficulty),
    status: node.status,
    reason: node.reason,
  }
}

function normalizeUnifiedAuditStatus(value: unknown): "pass" | "revise" | "reject" {
  return value === "pass" || value === "revise" || value === "reject" ? value : "revise"
}

function normalizeUnifiedArtifactKind(value: unknown): "lesson" | "lab" | "assessment" {
  return value === "lesson" || value === "lab" || value === "assessment" ? value : "lesson"
}

function normalizeUnifiedDifficulty(value: unknown): Difficulty {
  return value === "beginner" || value === "basic" || value === "intermediate" || value === "integrated" ? value : "beginner"
}
