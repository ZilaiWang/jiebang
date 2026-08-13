// 输入: TeachingAuditInput（学习者画像 + 知识点引用 + 知识库）
// 输出: TeachingAuditResult（四个维度的教学审核结果 + 通过/修订/驳回 + 结构化恢复信息）
// 作用: B 角色 Week2 教学审核器——审核 C 生成内容的教学规范性
//       Week3 扩展——输出结构化失败信息（failed_dimensions, missing_prerequisite_source_ids,
//        required_action, fix_scope, recommended_level, can_recover），供 C 自动恢复
// 审核维度: 难度匹配、前置知识、薄弱点覆盖、目标对齐
// 与 A 的事实审核互补：A 审"引用了没"，B 审"教得对不对"
import type { KnowledgeBase, KnowledgeDifficulty, KnowledgeItem } from "../../knowledge/types"
import { canonicalizeConcept } from "../concept-canonicalizer"
import type {
  DifficultyCheck,
  FixScope,
  GoalCheck,
  PrerequisiteCheck,
  RequiredAction,
  TeachingAuditDimension,
  TeachingAuditInput,
  TeachingAuditResult,
  TeachingAuditStatus,
  TeachingAuditVerdict,
  WeakConceptCheck,
} from "./types"

const LEVEL_ORDER: KnowledgeDifficulty[] = ["beginner", "basic", "intermediate", "integrated"]

export { buildEvidenceIndex } from "../../fact-audit/auditor"
export type { TeachingAuditInput, TeachingAuditResult } from "./types"

export function auditTeaching(input: TeachingAuditInput): TeachingAuditResult {
  const targetIds = input.targetSourceIds ?? [...new Set(input.citedSourceIds)]
  const targetItems = targetIds
    .map((sid) => input.knowledgeBase.items.find((item) => item.sourceId === sid))
    .filter((item): item is KnowledgeItem => item != null)

  const difficultyCheck = checkDifficulty(input.learnerProfile.level, targetItems)
  const prerequisiteCheck = checkPrerequisites(targetItems, input.learnerProfile, input.knowledgeBase)
  const weakConceptCheck = checkWeakConcepts(input.learnerProfile, targetItems, input.knowledgeBase)
  const goalCheck = checkGoal(input.learnerProfile.goal, targetItems, input.contentSummary ?? null)

  const allChecks = [difficultyCheck, prerequisiteCheck, weakConceptCheck, goalCheck]
  const status = deriveTeachingStatus(allChecks)
  const revisionHints = collectRevisionHints(allChecks)

  // ── Week3：结构化失败信息 ──
  const failedDimensions = collectFailedDimensions(allChecks)
  const missingPrerequisiteSourceIds = collectMissingPrerequisiteIds(allChecks)
  const unknownPrerequisiteRefs = collectUnknownPrerequisiteRefs(prerequisiteCheck, input.knowledgeBase)
  const { requiredAction, fixScope } = deriveRecoveryAction(allChecks)
  const recommendedLevel = deriveRecommendedLevel(difficultyCheck, input.learnerProfile.level)
  const canRecover = status !== "reject"
    || (
      fixScope === "new_spec"
      && unknownPrerequisiteRefs.length === 0
      && (recommendedLevel !== null || missingPrerequisiteSourceIds.length > 0)
    )

  return {
    artifactId: input.artifactId,
    learnerId: input.learnerProfile.learner_id,
    status,
    checks: {
      difficulty: difficultyCheck,
      prerequisite: prerequisiteCheck,
      weakConcept: weakConceptCheck,
      goal: goalCheck,
    },
    summary: buildSummary(status, allChecks),
    revisionHints,
    // Week3 扩展
    failedDimensions,
    missingPrerequisiteSourceIds,
    unknownPrerequisiteRefs,
    requiredAction,
    fixScope,
    recommendedLevel,
    canRecover,
  }
}

// ── 维度 1：难度匹配 ──
// 规则：教学内容中最高难度的知识点不得超过学习者水平 +1 档
// "不得超过 +1 档"的理由：适度的挑战（最近发展区）是合理的，但跨两档以上说明内容选错了
function checkDifficulty(
  learnerLevel: KnowledgeDifficulty,
  targetItems: KnowledgeItem[],
): DifficultyCheck {
  if (targetItems.length === 0) {
    return {
      dimension: "difficulty_alignment",
      verdict: "misaligned",
      learnerLevel,
      contentMaxDifficulty: null,
      reason: "教学内容未引用任何知识库知识点，无法判断难度匹配。",
    }
  }

  const contentMaxIdx = Math.max(
    ...targetItems.map((item) => LEVEL_ORDER.indexOf(item.difficulty)).filter((idx) => idx >= 0),
  )
  const contentMaxDifficulty = LEVEL_ORDER[contentMaxIdx]
  const learnerIdx = LEVEL_ORDER.indexOf(learnerLevel)

  if (contentMaxIdx <= learnerIdx + 1) {
    return {
      dimension: "difficulty_alignment",
      verdict: "aligned",
      learnerLevel,
      contentMaxDifficulty,
      reason: `教学内容最高难度 ${contentMaxDifficulty}，在学习者水平 ${learnerLevel} 的可接受范围内（≤+1 档）。`,
    }
  }

  return {
    dimension: "difficulty_alignment",
    verdict: "misaligned",
    learnerLevel,
    contentMaxDifficulty,
    reason: `教学内容最高难度 ${contentMaxDifficulty} 超出学习者水平 ${learnerLevel} 超过一档（差距 ${contentMaxIdx - learnerIdx} 档），学习者可能无法跟上。`,
  }
}

// ── 维度 2：前置知识 ──
// 规则：每个被教授的知识点，其所有前置知识必须在学习者的 known_concepts 中
// 或者前置知识本身就是本轮教学内容之一（正在教的不算缺失）
function checkPrerequisites(
  targetItems: KnowledgeItem[],
  learnerProfile: { known_concepts: string[]; weak_concepts: string[] },
  knowledgeBase: KnowledgeBase,
): PrerequisiteCheck {
  const checkedConcepts: PrerequisiteCheck["checkedConcepts"] = []
  let hasBlocking = false
  const prereqItemsBySourceId = new Map(
    knowledgeBase.items.map((kbItem) => [kbItem.sourceId, kbItem] as const),
  )
  const taughtSourceIds = new Set(targetItems.map((item) => item.sourceId))
  const knownCanonicals = new Set(
    learnerProfile.known_concepts.flatMap((raw) =>
      canonicalizeConcept(raw, knowledgeBase).sourceIds),
  )
  const weakCanonicals = new Set(
    learnerProfile.weak_concepts.flatMap((raw) =>
      canonicalizeConcept(raw, knowledgeBase).sourceIds),
  )

  for (const item of targetItems) {
    const prereqIds = item.prerequisites ?? []
    if (prereqIds.length === 0) {
      checkedConcepts.push({
        sourceId: item.sourceId,
        title: item.title,
        prerequisites: [],
        missingPrerequisites: [],
      })
      continue
    }

    const unknownPrerequisiteRefs = prereqIds.filter(
      (sourceId) => !prereqItemsBySourceId.has(sourceId),
    )

    // 已明确掌握且不在薄弱点中的目标，不再要求重复验证其前置知识。
    // 无效的前置知识引用仍按知识库完整性问题处理。
    const targetIsExplicitlyMastered =
      knownCanonicals.has(item.sourceId) && !weakCanonicals.has(item.sourceId)

    const missingPrerequisites: string[] = []
    for (const prereqId of prereqIds) {
      const prereq = prereqItemsBySourceId.get(prereqId)
      if (!prereq) continue
      const isKnown = knownCanonicals.has(prereq.sourceId)
      const isBeingTaught = taughtSourceIds.has(prereq.sourceId)
      if (!targetIsExplicitlyMastered && !isKnown && !isBeingTaught) {
        missingPrerequisites.push(`${prereq.sourceId} ${prereq.title}`)
      }
    }

    checkedConcepts.push({
      sourceId: item.sourceId,
      title: item.title,
      prerequisites: prereqIds.map((sourceId) => {
        const prerequisite = prereqItemsBySourceId.get(sourceId)
        return prerequisite ? `${sourceId} ${prerequisite.title}` : sourceId
      }),
      missingPrerequisites,
    })

    if (missingPrerequisites.length > 0 || unknownPrerequisiteRefs.length > 0) {
      hasBlocking = true
    }
  }

  const totalMissing = checkedConcepts.reduce((sum, c) => sum + c.missingPrerequisites.length, 0)
  const unknownPrerequisiteRefs = collectUnknownPrerequisiteRefs(
    {
      dimension: "prerequisite_coverage",
      verdict: hasBlocking ? "misaligned" : "aligned",
      checkedConcepts,
      reason: "",
    },
    knowledgeBase,
  )

  if (!hasBlocking) {
    return {
      dimension: "prerequisite_coverage",
      verdict: "aligned",
      checkedConcepts,
      reason: "所有教学内容的前置知识已被学习者掌握或属于本轮教学内容。",
    }
  }

  return {
    dimension: "prerequisite_coverage",
    verdict: "misaligned",
    checkedConcepts,
    reason: [
      totalMissing > 0
        ? `存在 ${totalMissing} 项前置知识未被学习者掌握：${checkedConcepts
          .filter((c) => c.missingPrerequisites.length > 0)
          .map((c) => `${c.title} 缺少 ${c.missingPrerequisites.join(", ")}`)
          .join("；")}`
        : null,
      unknownPrerequisiteRefs.length > 0
        ? `知识库中不存在前置引用：${unknownPrerequisiteRefs.join("、")}`
        : null,
    ].filter((part): part is string => part !== null).join("；"),
  }
}

// ── 维度 3：薄弱点覆盖 ──
// 规则：学习者的薄弱点中，至少有一个被教学内容覆盖
// "至少一个"的理由：一次教学不可能覆盖所有薄弱点，但不能完全无视薄弱点
function checkWeakConcepts(
  learnerProfile: { weak_concepts: string[] },
  targetItems: KnowledgeItem[],
  knowledgeBase: KnowledgeBase,
): WeakConceptCheck {
  const learnerWeak = learnerProfile.weak_concepts

  if (learnerWeak.length === 0) {
    return {
      dimension: "weak_concept_coverage",
      verdict: "aligned",
      learnerWeakConcepts: [],
      coveredWeakConcepts: [],
      uncoveredWeakConcepts: [],
      reason: "学习者无薄弱点记录，跳过此检查。",
    }
  }

  // 教学内容的 source_id 集合
  const taughtSourceIds = new Set(targetItems.map((item) => item.sourceId))

  // 只审核能映射到当前知识库的薄弱点。未映射的自由文本会继续保留在
  // B 画像中，但不能要求 C 在没有知识证据的情况下强行覆盖。
  const weakMapped = learnerWeak.map((raw) => {
    const mapped = canonicalizeConcept(raw, knowledgeBase)
    return { raw, matched: mapped.matched, sourceIds: mapped.sourceIds }
  })
  const auditableWeak = weakMapped.filter((item) =>
    item.matched && item.sourceIds.length > 0)

  if (auditableWeak.length === 0) {
    return {
      dimension: "weak_concept_coverage",
      verdict: "aligned",
      learnerWeakConcepts: learnerWeak,
      coveredWeakConcepts: [],
      uncoveredWeakConcepts: [],
      reason: `画像中的薄弱点尚未映射到当前知识库：${learnerWeak.join("、")}；本维度不要求 C 生成无证据内容。`,
    }
  }

  const covered: string[] = []
  const uncovered: string[] = []

  for (const wm of auditableWeak) {
    const isCovered = wm.sourceIds.some((sid) => taughtSourceIds.has(sid))
    if (isCovered) {
      covered.push(wm.raw)
    } else {
      uncovered.push(wm.raw)
    }
  }

  if (covered.length > 0) {
    return {
      dimension: "weak_concept_coverage",
      verdict: "aligned",
      learnerWeakConcepts: learnerWeak,
      coveredWeakConcepts: covered,
      uncoveredWeakConcepts: uncovered,
      reason: `教学内容覆盖了 ${covered.length}/${auditableWeak.length} 个可核验薄弱点：${covered.join("、")}。`,
    }
  }

  return {
    dimension: "weak_concept_coverage",
    verdict: "incomplete",
    learnerWeakConcepts: learnerWeak,
    coveredWeakConcepts: [],
    uncoveredWeakConcepts: uncovered,
    reason: `教学内容未覆盖任何可核验薄弱点。${uncovered.join("、")} 均未被涉及，建议调整教学内容。`,
  }
}

// ── 维度 4：目标对齐 ──
// 规则：教学内容至少有一个知识点与学习目标相关
// 当前用关键词匹配 + 概念映射判断；Week 2 后续可用 LLM 做语义判断
function checkGoal(
  goal: string,
  targetItems: KnowledgeItem[],
  contentSummary: string | null,
): GoalCheck {
  if (!goal || goal.trim() === "") {
    return {
      dimension: "goal_alignment",
      verdict: "misaligned",
      learnerGoal: goal,
      reason: "学习者目标为空，无法判断教学内容是否对齐。",
    }
  }

  if (targetItems.length === 0) {
    return {
      dimension: "goal_alignment",
      verdict: "misaligned",
      learnerGoal: goal,
      reason: "教学内容未引用任何知识库知识点，无法判断目标对齐。",
    }
  }

  // 策略：知识点标题和关键词是否作为子串出现在学习目标中（双向匹配）
  // 中文无空格文本的特殊处理：先尝试分词，失败时退化为子串匹配
  const goalLower = goal.toLowerCase()
  const alignedItems = targetItems.filter((item) => {
    const searchText = [item.title, ...(item.keywords ?? [])].join(" ").toLowerCase()
    // 方案 A：目标拆词后匹配（适用于有空格的文本，如英文）
    const goalWords = goalLower.split(/[\s，,、。！？；：""''（）]+/).filter((w) => w.length >= 2)
    if (goalWords.some((word) => searchText.includes(word))) return true
    // 方案 B（中文回退）：目标中包含知识点关键词的任意子串
    for (const kw of item.keywords ?? []) {
      if (kw.length >= 2 && goalLower.includes(kw.toLowerCase())) return true
    }
    if (item.title.length >= 2 && goalLower.includes(item.title.toLowerCase())) return true
    return false
  })

  if (alignedItems.length > 0) {
    return {
      dimension: "goal_alignment",
      verdict: "aligned",
      learnerGoal: goal,
      reason: `教学内容中 ${alignedItems.length}/${targetItems.length} 个知识点与学习目标"${goal}"直接相关：${alignedItems.map((item) => item.title).join("、")}。`,
    }
  }

  return {
    dimension: "goal_alignment",
    verdict: "misaligned",
    learnerGoal: goal,
    reason: `教学内容的所有知识点均与学习目标"${goal}"无明显关联。建议重新选择教学内容。`,
  }
}

// ── 汇总 ──

interface CheckLike {
  dimension: TeachingAuditDimension
  verdict: TeachingAuditVerdict
  reason: string
}

function deriveTeachingStatus(checks: CheckLike[]): TeachingAuditStatus {
  // 难度或前置知识 misaligned → reject（根本性问题，无法通过修订解决）
  if (checks.some((c) => (c.dimension === "difficulty_alignment" || c.dimension === "prerequisite_coverage") && c.verdict === "misaligned")) return "reject"
  // 薄弱点或目标 misaligned/incomplete → revise（可通过调整内容解决）
  if (checks.some((c) => c.verdict === "misaligned" || c.verdict === "incomplete" || c.verdict === "overscaffolded")) return "revise"
  return "pass"
}

function collectRevisionHints(checks: CheckLike[]): string[] {
  return checks
    .filter((c) => c.verdict !== "aligned")
    .map((c) => `[${c.dimension}] ${c.reason}`)
}

function buildSummary(status: TeachingAuditStatus, checks: CheckLike[]): string {
  const statusText = { pass: "通过", revise: "需修订", reject: "驳回" }[status]
  const failedChecks = checks.filter((c) => c.verdict !== "aligned")
  if (failedChecks.length === 0) return `教学审核${statusText}：四项检查全部通过。`
  return `教学审核${statusText}：${failedChecks.map((c) => c.dimension).join("、")} 未通过。`
}

// ── Week3：结构化恢复信息 ──

function collectFailedDimensions(checks: CheckLike[]): TeachingAuditDimension[] {
  return checks
    .filter((c) => c.verdict !== "aligned")
    .map((c) => c.dimension)
}

function collectMissingPrerequisiteIds(checks: CheckLike[]): string[] {
  const prereqCheck = checks.find((c) => c.dimension === "prerequisite_coverage") as PrerequisiteCheck | undefined
  if (!prereqCheck || prereqCheck.verdict === "aligned") return []
  const missing: string[] = []
  for (const concept of prereqCheck.checkedConcepts) {
    for (const missingEntry of concept.missingPrerequisites) {
      // extract source_id from "K007 for 循环" format
      const sourceId = missingEntry.split(" ")[0]
      if (sourceId && /^K\d+$/.test(sourceId)) {
        missing.push(sourceId)
      }
    }
  }
  return [...new Set(missing)]
}

/** 收集所有被引用的前置知识 ID 中，在知识库中不存在的（未知引用） */
function collectUnknownPrerequisiteRefs(prereqCheck: PrerequisiteCheck, kb: KnowledgeBase): string[] {
  const kbSourceIds = new Set(kb.items.map((item) => item.sourceId))
  const unknown: string[] = []
  for (const concept of prereqCheck.checkedConcepts) {
    for (const prereq of concept.prerequisites) {
      const sourceId = prereq.trim().split(/\s+/)[0]
      if (sourceId && !kbSourceIds.has(sourceId) && !unknown.includes(sourceId)) {
        unknown.push(sourceId)
      }
    }
  }
  return unknown
}

function deriveRecoveryAction(checks: CheckLike[]): { requiredAction: RequiredAction; fixScope: FixScope } {
  const hasDifficultyFailure = checks.some((c) => c.dimension === "difficulty_alignment" && c.verdict !== "aligned")
  const hasPrereqFailure = checks.some((c) => c.dimension === "prerequisite_coverage" && c.verdict !== "aligned")

  // 难度不匹配 → 需要重新规划路径
  if (hasDifficultyFailure) {
    return { requiredAction: "replan_path", fixScope: "new_spec" }
  }

  // 前置知识缺失 → 需要重新规划路径（先补前置）
  if (hasPrereqFailure) {
    return { requiredAction: "replan_path", fixScope: "new_spec" }
  }

  // 薄弱点或目标问题 → artifact 范围内修订即可
  const hasGoalFailure = checks.some((c) => c.dimension === "goal_alignment" && c.verdict !== "aligned")
  const hasWeakFailure = checks.some((c) => c.dimension === "weak_concept_coverage" && c.verdict !== "aligned")
  if (hasGoalFailure || hasWeakFailure) {
    return { requiredAction: "adjust_content", fixScope: "artifact" }
  }

  return { requiredAction: "adjust_content", fixScope: "artifact" }
}

function deriveRecommendedLevel(difficultyCheck: DifficultyCheck, learnerLevel: KnowledgeDifficulty): KnowledgeDifficulty | null {
  if (difficultyCheck.verdict !== "misaligned" || difficultyCheck.contentMaxDifficulty === null) return null
  // 推荐比内容最高难度低一档（最近发展区上限）
  const contentIdx = LEVEL_ORDER.indexOf(difficultyCheck.contentMaxDifficulty)
  const recommendedIdx = Math.max(0, contentIdx - 1)
  const recommended = LEVEL_ORDER[recommendedIdx]
  if (recommended === learnerLevel) return null // 当前水平已是最佳
  return recommended
}
