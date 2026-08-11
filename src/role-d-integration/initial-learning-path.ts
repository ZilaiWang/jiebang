import type {
  KnowledgeBase,
  KnowledgeItem,
} from "../knowledge/types"
import {
  retrieveKnowledge,
  type RagResult,
  type RagResultItem,
  type RetrieveKnowledgeInput,
} from "../rag/retriever"
import {
  retrieveStructuredEvidenceFromKnowledgeBase,
  type StructuredEvidenceRetrievalPort,
} from "../rag/structured-evidence"
import type { LearnerProfile } from "../role-b-profile/types"
import { stableId } from "../role-c-content/contracts/canonical"
import { preferredModalityForBehavior } from "../role-c-content/contracts/assessment-measurement"
import {
  defineLearningPathNode,
  type AssessmentBlueprint,
  type LearningPathNode,
  type ObservableBehavior,
} from "../role-c-content/contracts/profile-adapter"

export type InitialRoleCContextResult =
  | {
      ok: true
      pathNode: LearningPathNode
      ragResult: RagResult
    }
  | {
      ok: false
      code: "NO_SUPPORTED_TARGET" | "PATH_TOO_LARGE" | "MISSING_PATH_EVIDENCE" | "INVALID_TARGET_EVIDENCE"
      reason: string
    }

export interface InitialRoleCRetrievalPort extends StructuredEvidenceRetrievalPort {
  retrieve(input: RetrieveKnowledgeInput): Promise<RagResult>
}

const MAX_A_TOP_K = 10

/**
 * Builds the formal B/A → C input used by the live D flow. Selection is driven
 * by the current KB vocabulary, learner intent and prerequisite graph; source
 * IDs are never enumerated in the algorithm.
 */
export async function buildInitialRoleCContext(input: {
  profile: LearnerProfile
  ragResult: RagResult
  knowledgeBase: KnowledgeBase
  /** Test/remote seam for A text recall and identity-based evidence access. */
  retrievalPort?: InitialRoleCRetrievalPort
}): Promise<InitialRoleCContextResult> {
  const byId = new Map(input.knowledgeBase.items.map((item) => [item.sourceId, item]))
  const intentEvidence = await recallIntentEvidence(
    input.profile,
    input.ragResult,
    input.retrievalPort,
  )
  const selected = selectTargetItems(
    intentEvidence,
    input.knowledgeBase,
  )
  if (selected.length === 0) {
    return {
      ok: false,
      code: "NO_SUPPORTED_TARGET",
      reason: "B 初始路径未从当前知识库词表中找到与学习目标或薄弱点直接对应的知识点。",
    }
  }
  if (selected.length > 30) {
    return {
      ok: false,
      code: "PATH_TOO_LARGE",
      reason: `B 初始路径本轮包含 ${selected.length} 个直接目标，超过 C 单轮协议上限 30。`,
    }
  }

  const targetIds = selected.map((entry) => entry.item.sourceId)
  const knownSourceIds = resolveKnownSourceIds(
    input.profile.known_concepts,
    input.knowledgeBase,
  )
  const prerequisiteResult = dependencyFirstPrerequisites(
    targetIds,
    knownSourceIds,
    byId,
  )
  if (!prerequisiteResult.ok) return prerequisiteResult

  const requiredSourceIds = [
    ...targetIds,
    ...prerequisiteResult.sourceIds,
  ]
  if (requiredSourceIds.length > 100) {
    return {
      ok: false,
      code: "PATH_TOO_LARGE",
      reason: `B 初始路径含 ${requiredSourceIds.length} 个目标与先修节点，超过 C 单轮证据包上限 100。`,
    }
  }
  const evidence = await ensurePathEvidence(
    intentEvidence.ragResult,
    requiredSourceIds,
    byId,
    input.retrievalPort,
    input.knowledgeBase,
  )
  if (!evidence.ok) return evidence

  const resultById = new Map(
    evidence.ragResult.results.map((item) => [sourceIdOf(item), item]),
  )
  const invalidTarget = targetIds.find((sourceId) => {
    const item = resultById.get(sourceId)
    return !item || item.facts.length === 0
  })
  if (invalidTarget) {
    return {
      ok: false,
      code: "INVALID_TARGET_EVIDENCE",
      reason: `A 返回的目标 ${invalidTarget} 没有可绑定事实，无法构造 C 生成目标。`,
    }
  }

  const primaryBehavior = behaviorFromGoal(input.profile.goal)
  const behaviors = targetIds.map((_, index) =>
    index === 0
      ? primaryBehavior
      : supportingBehavior(primaryBehavior))
  const objectives = targetIds.map((sourceId, index) => ({
    objective_id: stableId("OBJECTIVE", {
      learner_id: input.profile.learner_id,
      source_id: sourceId,
      goal: input.profile.goal,
    }),
    source_id: sourceId,
    required_fact_ids: selectRequiredFactIds(
      input.profile,
      byId.get(sourceId)!,
      resultById.get(sourceId)!,
    ),
    observable_behavior: behaviors[index]!,
    importance: "core" as const,
  }))
  const assessmentBlueprint = blueprintForBehaviors(behaviors)
  const pathNode = defineLearningPathNode({
    node_id: stableId("PATH", {
      learner_id: input.profile.learner_id,
      goal: input.profile.goal,
      target_source_ids: targetIds,
      prerequisite_source_ids: prerequisiteResult.sourceIds,
    }),
    target_source_ids: targetIds,
    prerequisite_source_ids: prerequisiteResult.sourceIds,
    goal: input.profile.goal,
    objectives,
    assessment_blueprint: assessmentBlueprint,
  })
  return { ok: true, pathNode, ragResult: evidence.ragResult }
}

interface RecalledIntent {
  kind: "goal" | "weak"
  text: string
  sourceIds: string[]
}

interface RecalledIntentEvidence {
  ragResult: RagResult
  intents: RecalledIntent[]
}

async function recallIntentEvidence(
  profile: LearnerProfile,
  initial: RagResult,
  retrievalPort?: InitialRoleCRetrievalPort,
): Promise<RecalledIntentEvidence> {
  const retrieve = retrievalPort?.retrieve.bind(retrievalPort) ?? retrieveKnowledge
  const intentInputs: Array<Pick<RecalledIntent, "kind" | "text">> = [
    { kind: "goal", text: profile.goal.trim() },
    ...profile.weak_concepts
      .map((text) => text.trim())
      .filter(Boolean)
      .map((text) => ({ kind: "weak" as const, text })),
  ]
  const uniqueIntents = intentInputs.filter((intent, index, values) =>
    values.findIndex((candidate) =>
      candidate.kind === intent.kind && normalize(candidate.text) === normalize(intent.text)) === index)
  const recalled = await Promise.all(uniqueIntents.map(async (intent) => ({
    ...intent,
    result: await retrieve({
      query: intent.kind === "goal"
        ? `学习目标：${intent.text}`
        : `薄弱点：${intent.text}`,
      learnerLevel: profile.level,
      topK: MAX_A_TOP_K,
    }),
  })))

  const mergedById = new Map<string, RagResultItem>()
  for (const item of initial.results) mergedById.set(sourceIdOf(item), item)
  for (const entry of recalled) {
    for (const item of entry.result.results.filter(hasSubstantiveMatch)) {
      const sourceId = sourceIdOf(item)
      if (!mergedById.has(sourceId)) mergedById.set(sourceId, item)
    }
  }
  const initialSourceIds = initial.results.map(sourceIdOf)
  const intents = recalled.map((entry) => ({
    kind: entry.kind,
    text: entry.text,
    sourceIds: unique([
      ...entry.result.results.filter(hasSubstantiveMatch).map(sourceIdOf),
      // Preserve injected/new-KB evidence that the process-local A instance may
      // not know yet. Intent scoring below still has to match it semantically.
      ...initialSourceIds,
    ]),
  }))
  const results = [...mergedById.values()]
  return {
    ragResult: {
      ...initial,
      topK: results.length,
      results,
    },
    intents,
  }
}

function selectTargetItems(
  recalled: RecalledIntentEvidence,
  knowledgeBase: KnowledgeBase,
): Array<{ item: KnowledgeItem; rag: RagResultItem; intentScore: number }> {
  const byId = new Map(knowledgeBase.items.map((item) => [item.sourceId, item]))
  const ragById = new Map(
    recalled.ragResult.results.map((item) => [sourceIdOf(item), item]),
  )
  const selectedById = new Map<
    string,
    { item: KnowledgeItem; rag: RagResultItem; intentScore: number }
  >()
  const goalIntent = recalled.intents.find((intent) => intent.kind === "goal")
  const goalCandidates = goalIntent
    ? bestCandidatesForIntent(goalIntent, byId, ragById)
    : []
  for (const candidate of goalCandidates) selectedById.set(candidate.item.sourceId, candidate)

  const goalCoverage = new Set(goalCandidates.flatMap((candidate) => [
    candidate.item.sourceId,
    ...transitivePrerequisites(candidate.item.sourceId, byId),
  ]))
  for (const intent of recalled.intents.filter((entry) => entry.kind === "weak")) {
    const candidates = bestCandidatesForIntent(intent, byId, ragById, goalCoverage)
    for (const candidate of candidates) {
      const existing = selectedById.get(candidate.item.sourceId)
      if (!existing || candidate.intentScore > existing.intentScore) {
        selectedById.set(candidate.item.sourceId, candidate)
      }
    }
  }

  const selected = [...selectedById.values()].sort((left, right) =>
    right.intentScore - left.intentScore
      || right.rag.score - left.rag.score
      || left.item.sourceId.localeCompare(right.item.sourceId))
  if (selected.length === 0) return []
  const candidateIds = new Set(selected.map((candidate) => candidate.item.sourceId))
  const prerequisiteOfStronger = new Set<string>()
  for (const candidate of selected) {
    for (const prerequisite of transitivePrerequisites(candidate.item.sourceId, byId)) {
      if (candidateIds.has(prerequisite)) prerequisiteOfStronger.add(prerequisite)
    }
  }
  const targets = selected.filter((candidate) =>
    !prerequisiteOfStronger.has(candidate.item.sourceId))
  return targets.length > 0 ? targets : selected
}

function bestCandidatesForIntent(
  intent: RecalledIntent,
  byId: Map<string, KnowledgeItem>,
  ragById: Map<string, RagResultItem>,
  preferredSourceIds?: Set<string>,
): Array<{ item: KnowledgeItem; rag: RagResultItem; intentScore: number }> {
  const candidateSourceIds = unique([
    ...intent.sourceIds,
  ])
  const candidates = candidateSourceIds.flatMap((sourceId) => {
    const item = byId.get(sourceId)
    if (!item) return []
    const rag = ragById.get(sourceId)
    if (!rag) return []
    if (!hasSubstantiveMatch(rag)) return []
    const score = textItemMatchScore(intent.text, item)
    if (score === 0) return []
    return [{
      item,
      rag,
      intentScore: score,
      directTitleMatch: normalize(intent.text).includes(normalize(item.title)),
      preferred: preferredSourceIds?.has(sourceId) === true,
    }]
  }).sort((left, right) =>
    Number(right.directTitleMatch) - Number(left.directTitleMatch)
      || Number(right.preferred) - Number(left.preferred)
      || right.intentScore - left.intentScore
      || right.rag.score - left.rag.score
      || left.item.sourceId.localeCompare(right.item.sourceId))
  if (candidates.length === 0) return []

  const directTitles = candidates.filter((candidate) => candidate.directTitleMatch)
  if (directTitles.length > 0) return directTitles
  const preferred = candidates.filter((candidate) => candidate.preferred)
  const pool = preferred.length > 0 ? preferred : candidates
  const strongest = pool[0]!.intentScore
  return pool.filter((candidate) => candidate.intentScore === strongest)
}

function hasSubstantiveMatch(item: RagResultItem): boolean {
  const substantiveFields = new Set([
    "keywords",
    "title",
    "facts",
    "practiceTasks",
    "taskIntent",
    "synonyms",
  ])
  const fields = item.retrievalTrace.matchedFields.filter((field) =>
    substantiveFields.has(field))
  const score = item.retrievalTrace.scoreBreakdown
  return fields.length > 0
    || item.retrievalTrace.matchedKeywords.length > 0
    || score.keyword > 0
    || score.title > 0
    || score.facts > 0
    || score.practiceTasks > 0
    || score.bonus > 0
}

function textItemMatchScore(text: string, item: KnowledgeItem): number {
  const terms = unique([item.title, ...item.keywords])
  return terms.reduce((score, term) => {
    if (!containsTerm(text, term)) return score
    const normalized = normalize(term)
    const specificity = Math.min(8, Math.max(1, [...normalized].length))
    return score + specificity + (normalize(text) === normalized ? 5 : 0)
  }, 0)
}

function containsTerm(text: string, term: string): boolean {
  const normalizedText = normalize(text)
  const normalizedTerm = normalize(term)
  if (!normalizedTerm) return false
  if (/^[a-z0-9_]+$/.test(normalizedTerm)) {
    return text.toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean)
      .includes(normalizedTerm)
  }
  return normalizedText.includes(normalizedTerm)
    || (normalizedText.length >= 2 && normalizedTerm.includes(normalizedText))
}

function resolveKnownSourceIds(
  concepts: string[],
  knowledgeBase: KnowledgeBase,
): Set<string> {
  const mastered = new Set<string>()
  for (const concept of concepts) {
    const exactTitles = knowledgeBase.items.filter((item) =>
      normalize(item.title) === normalize(concept))
    if (exactTitles.length === 1) {
      mastered.add(exactTitles[0]!.sourceId)
      continue
    }
    const scored = knowledgeBase.items.map((item) => ({
      sourceId: item.sourceId,
      score: textItemMatchScore(concept, item),
    })).filter((entry) => entry.score > 0)
    if (scored.length === 0) continue
    const max = Math.max(...scored.map((entry) => entry.score))
    const best = scored.filter((entry) => entry.score === max)
    if (best.length === 1) mastered.add(best[0]!.sourceId)
  }
  return mastered
}

function dependencyFirstPrerequisites(
  targetIds: string[],
  knownSourceIds: Set<string>,
  byId: Map<string, KnowledgeItem>,
): { ok: true; sourceIds: string[] } | Extract<InitialRoleCContextResult, { ok: false }> {
  const targets = new Set(targetIds)
  const ordered: string[] = []
  const permanent = new Set<string>()
  const visiting = new Set<string>()
  const visit = (sourceId: string): string | undefined => {
    if (permanent.has(sourceId) || knownSourceIds.has(sourceId)) return
    if (visiting.has(sourceId)) return `知识库先修关系存在循环：${sourceId}`
    const item = byId.get(sourceId)
    if (!item) return `知识库先修关系引用了未知知识点：${sourceId}`
    visiting.add(sourceId)
    for (const prerequisite of item.prerequisites) {
      const failure = visit(prerequisite)
      if (failure) return failure
    }
    visiting.delete(sourceId)
    permanent.add(sourceId)
    if (!targets.has(sourceId)) ordered.push(sourceId)
  }
  for (const targetId of targetIds) {
    const failure = visit(targetId)
    if (failure) {
      return {
        ok: false,
        code: "MISSING_PATH_EVIDENCE",
        reason: failure,
      }
    }
  }
  return { ok: true, sourceIds: ordered }
}

async function ensurePathEvidence(
  ragResult: RagResult,
  requiredSourceIds: string[],
  byId: Map<string, KnowledgeItem>,
  retrievalPort: InitialRoleCRetrievalPort | undefined,
  knowledgeBase: KnowledgeBase,
): Promise<
  | { ok: true; ragResult: RagResult }
  | Extract<InitialRoleCContextResult, { ok: false }>
> {
  const requiredItems = requiredSourceIds.map((sourceId) => byId.get(sourceId))
  const unknown = requiredSourceIds.filter((_sourceId, index) => !requiredItems[index])
  if (unknown.length > 0) {
    return {
      ok: false,
      code: "MISSING_PATH_EVIDENCE",
      reason: `B 路径引用了知识库中不存在的节点：${unknown.join("、")}`,
    }
  }
  const structured = retrievalPort
    ? await retrievalPort.retrieveStructuredEvidence({
        source_ids: requiredSourceIds,
      })
    : retrieveStructuredEvidenceFromKnowledgeBase(
        { source_ids: requiredSourceIds },
        knowledgeBase,
      )
  const unexpected = structured.results.find((item) =>
    !requiredSourceIds.includes(sourceIdOf(item)))
  if (unexpected) {
    return {
      ok: false,
      code: "INVALID_TARGET_EVIDENCE",
      reason: `A 返回了 B 路径未请求的证据：${sourceIdOf(unexpected)}`,
    }
  }
  const exactById = new Map(
    structured.results.map((item) => {
      const recalled = ragResult.results.find((candidate) =>
        sourceIdOf(candidate) === sourceIdOf(item))
      return [
        sourceIdOf(item),
        recalled
          ? {
              ...item,
              score: recalled.score,
              reason: recalled.reason,
              retrievalTrace: structuredClone(recalled.retrievalTrace),
              retrieval_trace: structuredClone(recalled.retrieval_trace),
            }
          : item,
      ] as const
    }),
  )
  const unresolved = requiredSourceIds.filter((sourceId) => !exactById.has(sourceId))
  const missingSourceIds = unique([
    ...unresolved,
    ...structured.missing_source_ids,
  ])
  if (missingSourceIds.length > 0) {
    return {
      ok: false,
      code: "MISSING_PATH_EVIDENCE",
      reason: `A 未返回 B 路径所需的精确证据：${missingSourceIds.join("、")}`,
    }
  }
  if (structured.missing_fact_refs.length > 0) {
    return {
      ok: false,
      code: "MISSING_PATH_EVIDENCE",
      reason: `A 未返回 B 路径所需的事实：${structured.missing_fact_refs
        .map((ref) => `${ref.source_id}-${ref.fact_id}`)
        .join("、")}`,
    }
  }
  const results = requiredSourceIds.map((sourceId) => exactById.get(sourceId)!)
  return {
    ok: true,
    ragResult: {
      ...ragResult,
      topK: results.length,
      results,
    },
  }
}

function selectRequiredFactIds(
  profile: LearnerProfile,
  item: KnowledgeItem,
  evidence: RagResultItem,
): string[] {
  const intentText = [profile.goal, ...profile.weak_concepts].join(" ")
  const intentTerms = unique([
    item.title,
    ...item.keywords,
    ...evidence.retrievalTrace.matchedKeywords,
    ...extractIdentifierTerms(intentText),
  ]).filter((term) => containsTerm(intentText, term)
    || evidence.retrievalTrace.matchedKeywords.some((matched) =>
      normalize(matched) === normalize(term)))
  const ranked = evidence.facts.map((fact, index) => ({
    factId: fact.factId ?? fact.fact_id!,
    index,
    score: intentTerms.reduce((score, term) =>
      containsTerm(fact.content, term)
        ? score + Math.max(1, Math.min(8, [...normalize(term)].length))
        : score, 0),
  })).sort((left, right) =>
    right.score - left.score || left.index - right.index)
  const matched = ranked.filter((fact) => fact.score > 0).slice(0, 3)
  return (matched.length > 0 ? matched : ranked.slice(0, 1))
    .map((fact) => fact.factId)
}

function extractIdentifierTerms(text: string): string[] {
  return unique(text.toLowerCase().match(/[a-z_][a-z0-9_]*/g) ?? [])
    .filter((term) => term.length >= 2)
}

function behaviorFromGoal(goal: string): ObservableBehavior {
  const normalized = goal.toLowerCase()
  if (/(debug|调试|排错|修复|改错)/.test(normalized)) return "debug"
  if (/(create|implement|build|编写|实现|创建|完成|搭建|设计)/.test(normalized)) return "create"
  if (/(trace|追踪|追溯|预测输出|逐步分析)/.test(normalized)) return "trace"
  if (/(apply|use|使用|应用|计算|统计|处理|转换|读取|写入|查询)/.test(normalized)) return "apply"
  if (/(explain|解释|说明|理解|比较)/.test(normalized)) return "explain"
  return "recognize"
}

function supportingBehavior(primary: ObservableBehavior): ObservableBehavior {
  if (primary === "create" || primary === "debug") return "apply"
  return primary
}

function blueprintForBehaviors(behaviors: ObservableBehavior[]): AssessmentBlueprint {
  const modalities: AssessmentBlueprint["required_modalities"] = behaviors
    .map(preferredModalityForBehavior)
  // A small all-code node keeps a lower-tier anchor. At the protocol maximum,
  // the existing objective slots must be reused so the total remains <= 30.
  if (modalities.length < 30
    && modalities.every((modality): boolean => modality === "code")) {
    modalities.unshift("mcq")
  }
  const tierCounts = allocateAssessmentTierCounts(modalities)
  return {
    tier_1_count: tierCounts[1],
    tier_2_count: tierCounts[2],
    tier_3_count: tierCounts[3],
    required_modalities: unique(modalities),
  }
}

function allocateAssessmentTierCounts(
  modalities: AssessmentBlueprint["required_modalities"],
): Record<1 | 2 | 3, number> {
  const counts: Record<1 | 2 | 3, number> = { 1: 0, 2: 0, 3: 0 }
  const preferredTier: Record<
    AssessmentBlueprint["required_modalities"][number],
    1 | 2 | 3
  > = {
    mcq: 1,
    true_false: 1,
    trace: 2,
    short_answer: 2,
    code: 3,
  }
  const tierOrder: Record<1 | 2 | 3, Array<1 | 2 | 3>> = {
    1: [1, 2, 3],
    2: [2, 3, 1],
    3: [3, 2, 1],
  }

  for (const modality of modalities) {
    const tier = tierOrder[preferredTier[modality]]
      .find((candidate) => counts[candidate] < 20)
    if (tier === undefined) {
      throw new Error("评测蓝图题量超出三个层级的容量")
    }
    counts[tier] += 1
  }

  // GenerationSpec requires at least one Tier 1/2 anchor. A modality remains
  // measurable when its difficulty tier is lowered; C assigns the concrete
  // modality to this flexible slot when constructing the assessment plan.
  if (counts[1] + counts[2] === 0) {
    counts[3] -= 1
    counts[2] += 1
  }
  return counts
}

function transitivePrerequisites(
  sourceId: string,
  byId: Map<string, KnowledgeItem>,
): Set<string> {
  const result = new Set<string>()
  const queue = [...(byId.get(sourceId)?.prerequisites ?? [])]
  while (queue.length > 0) {
    const current = queue.shift()!
    if (result.has(current)) continue
    result.add(current)
    queue.push(...(byId.get(current)?.prerequisites ?? []))
  }
  return result
}

function sourceIdOf(item: RagResultItem): string {
  return item.sourceId ?? item.source_id
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "")
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}
