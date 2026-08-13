// 输入: PlanRecoveryPathInput（学习者画像 + 审核结果 + 知识库 + 可选当前路径）
// 输出: PlanRecoveryPathResult（新 LearningPathNode + 是否需要A重新检索）
// 作用: B 角色路径规划——当教学审核驳回内容时，给出替代学习路径
// 规则:
//   1. 难度不匹配 → 降档选择目标知识点（从弱点和目标相关中筛选更低难度）
//   2. 前置知识缺失 → 先补前置知识点作为新路径目标
//   3. 薄弱点/目标问题 → 在当前难度档内替换知识点
// 这是 C 在收到 "replan_path" 动作后调用的接口
import type { KnowledgeBase, KnowledgeDifficulty, KnowledgeItem } from "../../knowledge/types"
import type { LearnerProfile } from "../types"
import type { TeachingAuditResult } from "./types"
import type { PlanRecoveryPathInput, PlanRecoveryPathResult } from "./types"
import type { LearningPathNode, LearningObjective, AssessmentBlueprint } from "../../role-c-content/contracts/profile-adapter"
import { canonicalizeConcept } from "../concept-canonicalizer"

const LEVEL_ORDER: KnowledgeDifficulty[] = ["beginner", "basic", "intermediate", "integrated"]

export function planRecoveryPath(input: PlanRecoveryPathInput): PlanRecoveryPathResult {
  const { learnerProfile, knowledgeBase, auditResult, currentPathNode } = input

  const failedDims = new Set(auditResult.failedDimensions)
  const currentTargetIds = new Set(currentPathNode?.target_source_ids ?? [])
  const currentGoal = currentPathNode?.goal ?? learnerProfile.goal

  // 情况 1：前置知识缺失 → 先补缺失的前置知识点（优先级高于难度，因为难度不匹配可能只是前置缺失的级联效应）
  if (failedDims.has("prerequisite_coverage") && auditResult.missingPrerequisiteSourceIds.length > 0) {
    return planPrerequisitePath(learnerProfile, knowledgeBase, auditResult.missingPrerequisiteSourceIds, currentPathNode)
  }

  // 情况 2：难度不匹配 → 降档选择更简单的目标
  if (failedDims.has("difficulty_alignment") && auditResult.recommendedLevel) {
    return planLowerDifficultyPath(learnerProfile, knowledgeBase, auditResult.recommendedLevel, currentGoal, currentTargetIds)
  }

  // 情况 3：薄弱点或目标对齐问题 → 在当前难度档内替换
  return planAdjustedContentPath(learnerProfile, knowledgeBase, currentGoal, currentTargetIds, auditResult)
}

function planLowerDifficultyPath(
  profile: LearnerProfile,
  kb: KnowledgeBase,
  targetLevel: KnowledgeDifficulty,
  goal: string,
  excludeIds: Set<string>,
): PlanRecoveryPathResult {
  const targetIdx = LEVEL_ORDER.indexOf(targetLevel)
  // 用于学习者水平及以下的知识点
  const levelItems = kb.items.filter((item) => {
    if (excludeIds.has(item.sourceId)) return false
    const itemIdx = LEVEL_ORDER.indexOf(item.difficulty)
    return itemIdx <= targetIdx
  })

  const selected = selectBestTargets(levelItems, profile, kb, goal, 3)
  if (selected.length === 0) {
    return buildUnsupportedPathResult(
      goal,
      `当前知识库中没有与学习目标或薄弱点相关、且不高于 ${targetLevel} 级别的可用知识点。`,
    )
  }

  return buildPathResult(selected, goal, `难度不匹配，推荐降至 ${targetLevel} 级别重新学习。新路径包含 ${selected.map((i) => i.title).join("、")}。`, true)
}

function planPrerequisitePath(
  profile: LearnerProfile,
  kb: KnowledgeBase,
  missingPrerequisiteIds: string[],
  currentPathNode?: PlanRecoveryPathInput["currentPathNode"],
): PlanRecoveryPathResult {
  const prereqItems = missingPrerequisiteIds
    .map((sid) => kb.items.find((item) => item.sourceId === sid))
    .filter((item): item is KnowledgeItem => item != null)

  if (prereqItems.length === 0) {
    // 知识库中找不到这些前置知识点（未知引用已经被标记为 unknownPrerequisiteRefs）
    return buildPathResult(
      [],
      currentPathNode?.goal ?? profile.goal,
      "缺失的前置知识点在知识库中不存在，无法自动规划路径。请人工检查知识库完整性。",
      currentPathNode !== undefined,
    )
  }

  // 前置知识点作为新路径目标，要学的知识点先放一放
  const allTargets = [...prereqItems]
  const rationale = `前置知识缺失，先学习 ${prereqItems.map((i) => `${i.sourceId} ${i.title}`).join("、")}。原目标知识点需在掌握前置知识后学习。`

  return buildPathResult(allTargets, profile.goal, rationale, currentPathNode !== undefined)
}

function planAdjustedContentPath(
  profile: LearnerProfile,
  kb: KnowledgeBase,
  goal: string,
  excludeIds: Set<string>,
  auditResult: TeachingAuditResult,
): PlanRecoveryPathResult {
  const profileLevel = LEVEL_ORDER.indexOf(profile.level)
  const levelItems = kb.items.filter((item) => {
    if (excludeIds.has(item.sourceId)) return false
    const itemIdx = LEVEL_ORDER.indexOf(item.difficulty)
    return itemIdx <= profileLevel + 1
  })

  const selected = selectBestTargets(levelItems, profile, kb, goal, 3)
  if (selected.length === 0) {
    return buildUnsupportedPathResult(
      goal,
      "当前知识库中没有与学习目标或薄弱点相关的替代知识点。",
    )
  }

  return buildPathResult(
    selected,
    goal,
    `薄弱点/目标对齐问题：原教学内容已替换为 ${selected.map((i) => i.title).join("、")}，覆盖学习者薄弱点并匹配学习目标。`,
    true,
  )
}

/** 从候选知识点中选择最佳目标：语义相关是入选前提，难度只用于相关候选之间的排序。 */
function selectBestTargets(
  candidates: KnowledgeItem[],
  profile: LearnerProfile,
  kb: KnowledgeBase,
  goal: string,
  maxCount: number,
): KnowledgeItem[] {
  if (candidates.length === 0) return []

  // 打分：薄弱点覆盖 +4，目标关联 +2，难度接近 +1。
  // 最后一项不构成语义证据，避免将“同难度”误当作“同主题”。
  const weakMapped = new Set(
    profile.weak_concepts.flatMap((raw) => {
      const mapped = canonicalizeConcept(raw, kb)
      return mapped.sourceIds
    }),
  )
  const goalMapped = sourceIdsRelevantToGoal(goal, kb)

  const scored = candidates.map((item) => {
    let semanticScore = 0
    // 薄弱点覆盖
    if (weakMapped.has(item.sourceId)) semanticScore += 4
    // 目标关联
    if (goalMapped.has(item.sourceId)) semanticScore += 2
    // 难度接近学习者水平
    const itemIdx = LEVEL_ORDER.indexOf(item.difficulty)
    const profileIdx = LEVEL_ORDER.indexOf(profile.level)
    const difficultyScore = itemIdx === profileIdx || itemIdx === profileIdx + 1 ? 1 : 0
    return { item, semanticScore, difficultyScore }
  })

  const relevant = scored.filter((entry) => entry.semanticScore > 0)
  relevant.sort((a, b) =>
    b.semanticScore - a.semanticScore
    || b.difficultyScore - a.difficultyScore
    || a.item.sourceId.localeCompare(b.item.sourceId),
  )
  return relevant.slice(0, maxCount).map((entry) => entry.item)
}

function sourceIdsRelevantToGoal(goal: string, kb: KnowledgeBase): Set<string> {
  const normalizedGoal = normalizeSemanticText(goal)
  const sourceIds = new Set(canonicalizeConcept(goal, kb).sourceIds)
  if (normalizedGoal.length === 0) return sourceIds

  for (const item of kb.items) {
    const terms = [item.title, ...(item.keywords ?? [])]
      .map(normalizeSemanticText)
      .filter((term) => term.length >= 2)
    if (terms.some((term) => normalizedGoal.includes(term))) {
      sourceIds.add(item.sourceId)
    }
  }
  return sourceIds
}

function normalizeSemanticText(value: string): string {
  return value.toLowerCase().replace(/[\s，,、。！？；："'`（）()[\]{}\-_/]+/g, "")
}

function buildUnsupportedPathResult(
  goal: string,
  rationale: string,
): PlanRecoveryPathResult {
  return buildPathResult(
    [],
    goal,
    `${rationale}无法自动规划恢复路径，请扩充知识库或调整学习目标。`,
    false,
  )
}

function buildPathResult(
  items: KnowledgeItem[],
  goal: string,
  rationale: string,
  requiresNewRag: boolean,
): PlanRecoveryPathResult {
  const targetSourceIds = items.map((item) => item.sourceId)
  const nodeId = targetSourceIds.length > 0
    ? `RECOVERY-${targetSourceIds.join("-")}-${Date.now()}`
    : `RECOVERY-UNSUPPORTED-${Date.now()}`

  const objectives: LearningObjective[] = items.map((item, index) => ({
    objective_id: `RO${index + 1}`,
    source_id: item.sourceId,
    required_fact_ids: [],
    observable_behavior: index === 0 ? "recognize" as const : index === 1 ? "apply" as const : "create" as const,
    importance: "core" as const,
  }))

  const blueprint: AssessmentBlueprint = items.length >= 3
    ? { tier_1_count: 2, tier_2_count: 2, tier_3_count: 1, required_modalities: ["mcq", "trace", "code"] }
    : items.length === 2
      ? { tier_1_count: 1, tier_2_count: 1, tier_3_count: 0, required_modalities: ["mcq", "trace"] }
      : { tier_1_count: 1, tier_2_count: 0, tier_3_count: 0, required_modalities: ["mcq"] }

  const prerequisiteSourceIds = items
    .flatMap((item) => item.prerequisites ?? [])
    .filter((pid) => !targetSourceIds.includes(pid))
    .filter((pid, idx, arr) => arr.indexOf(pid) === idx)

  const pathNode: LearningPathNode = {
    schema_version: "1.0",
    node_id: nodeId,
    target_source_ids: targetSourceIds,
    prerequisite_source_ids: prerequisiteSourceIds,
    goal,
    objectives,
    assessment_blueprint: blueprint,
  }

  return { pathNode, rationale, requiresNewRag }
}
