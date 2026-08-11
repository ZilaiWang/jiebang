import type { KnowledgeBase } from "../../knowledge/types"
import { planRecoveryPath } from "../../role-b-profile/teaching-audit/path-planner"
import type {
  TeachingAuditDimension,
  TeachingAuditResult,
} from "../../role-b-profile/teaching-audit/types"
import type { LearnerProfile } from "../../role-b-profile/types"
import { canonicalizeConcept } from "../../role-b-profile/concept-canonicalizer"
import type {
  RoleBPathPlanningPort,
  RoleBPathPlanningRequest,
  RoleBPathPlanningResult,
} from "../contracts/recovery"
import { stableId } from "../contracts/common"

/**
 * Adapts B's current in-process planner to C's recovery boundary.
 * Structured audit fields from the request are passed through to B without
 * rerunning the teaching audit or choosing another recovery action.
 */
export function createLocalBPathPlanningPort(
  knowledgeBase: KnowledgeBase,
): RoleBPathPlanningPort {
  const localKnowledgeBase = structuredClone(knowledgeBase)
  return {
    async replanLearningPath(
      request: RoleBPathPlanningRequest,
    ): Promise<RoleBPathPlanningResult> {
      if (request.required_action !== "replan_path"
        || request.fix_scope !== "new_spec") {
        return blockedResult(
          request,
          "BLOCKED",
          "本地 B 路径规划仅接受 replan_path/new_spec 请求",
        )
      }
      try {
        const prerequisitePlan = request.failed_dimensions.includes(
          "prerequisite_coverage",
        ) && request.missing_prerequisite_source_ids.length > 0
          ? unresolvedPrerequisiteClosure(
              localKnowledgeBase,
              request.profile_snapshot.known_concepts,
              request.profile_snapshot.weak_concepts,
              request.missing_prerequisite_source_ids,
            )
          : undefined
        if (prerequisitePlan && !prerequisitePlan.ok) {
          return blockedResult(
            request,
            "BLOCKED",
            prerequisitePlan.reason,
          )
        }
        const planned = planRecoveryPath({
          learnerProfile: profileForB(request),
          knowledgeBase: localKnowledgeBase,
          auditResult: auditForB(
            request,
            prerequisitePlan?.source_ids.slice(0, 1),
          ),
          currentPathNode: {
            target_source_ids: [
              ...request.current_path_node.target_source_ids,
            ],
            prerequisite_source_ids: [
              ...request.current_path_node.prerequisite_source_ids,
            ],
            goal: request.current_path_node.goal,
          },
        })
        if (planned.pathNode.target_source_ids.length === 0
          || planned.pathNode.objectives.length === 0) {
          return blockedResult(
            request,
            "UNSUPPORTED_TARGET",
            "B 路径规划未找到可用的目标知识点",
            "UNSUPPORTED_TARGET",
          )
        }
        const blueprintIssue = ensureAssessmentCapacity(planned.pathNode)
        if (blueprintIssue) {
          return blockedResult(
            request,
            "UNSUPPORTED_TARGET",
            blueprintIssue,
            "UNSUPPORTED_TARGET",
          )
        }
        // Advance success path: the learner passed all dimensions and is ready
        // for the next node. Return a fresh profile snapshot so that the caller
        // can validate the updated state before proceeding.
        if (request.failed_dimensions.length === 0) {
          return {
            status: "ready",
            request_id: request.request_id,
            path_draft: structuredClone(planned.pathNode),
            profile_snapshot: {
              ...structuredClone(request.profile_snapshot),
              profile_version: stableId("PROFILE-ADVANCE", {
                source_profile_version:
                  request.profile_snapshot.profile_version,
                source_spec_id: request.current_spec_id,
                target_source_ids: planned.pathNode.target_source_ids,
              }),
            },
          }
        }
        if (prerequisitePlan) {
          const prerequisiteItems = planned.pathNode.target_source_ids.map(
            (sourceId) => localKnowledgeBase.items.find(
              (item) => item.sourceId === sourceId,
            ),
          )
          if (prerequisiteItems.some((item) => item === undefined)) {
            return blockedResult(
              request,
              "BLOCKED",
              "B 递归先修路径中存在无法解析的知识点",
            )
          }
          const titles = prerequisiteItems.map((item) => item!.title)
          const stageGoal = prerequisiteStageGoal(
            request.profile_snapshot.goal,
            titles,
          )
          planned.pathNode.goal = stageGoal
          const stageProfile = prerequisiteStageProfileIfNeeded(
            request,
            localKnowledgeBase,
            titles,
            planned.pathNode.target_source_ids,
          )
          return {
            status: "ready",
            request_id: request.request_id,
            path_draft: structuredClone(planned.pathNode),
            ...(stageProfile
              ? { profile_snapshot: stageProfile }
              : {}),
          }
        }
        return {
          status: "ready",
          request_id: request.request_id,
          path_draft: structuredClone(planned.pathNode),
        }
      } catch {
        return blockedResult(
          request,
          "BLOCKED",
          "本地 B 路径规划执行失败",
        )
      }
    },
  }
}

function profileForB(request: RoleBPathPlanningRequest): LearnerProfile {
  return {
    learner_id: request.profile_snapshot.learner_id,
    level: request.profile_snapshot.level,
    known_concepts: [...request.profile_snapshot.known_concepts],
    weak_concepts: [...request.profile_snapshot.weak_concepts],
    goal: request.profile_snapshot.goal,
  }
}

function auditForB(
  request: RoleBPathPlanningRequest,
  missingPrerequisiteSourceIds = request.missing_prerequisite_source_ids,
): TeachingAuditResult {
  const failed = new Set(request.failed_dimensions)
  const difficultyFailed = failed.has("difficulty_alignment")
  const prerequisiteFailed = failed.has("prerequisite_coverage")
  const weakConceptFailed = failed.has("weak_concept_coverage")
  const goalFailed = failed.has("goal_alignment")
  return {
    artifactId: request.current_spec_id,
    learnerId: request.profile_snapshot.learner_id,
    status: "reject",
    checks: {
      difficulty: {
        dimension: "difficulty_alignment",
        verdict: difficultyFailed ? "misaligned" : "aligned",
        learnerLevel: request.profile_snapshot.level,
        contentMaxDifficulty: null,
        reason: "由 C 恢复请求中的结构化审核字段提供",
      },
      prerequisite: {
        dimension: "prerequisite_coverage",
        verdict: prerequisiteFailed ? "misaligned" : "aligned",
        checkedConcepts: [],
        reason: "由 C 恢复请求中的结构化审核字段提供",
      },
      weakConcept: {
        dimension: "weak_concept_coverage",
        verdict: weakConceptFailed ? "incomplete" : "aligned",
        learnerWeakConcepts: [
          ...request.profile_snapshot.weak_concepts,
        ],
        coveredWeakConcepts: [],
        uncoveredWeakConcepts: weakConceptFailed
          ? [...request.profile_snapshot.weak_concepts]
          : [],
        reason: "由 C 恢复请求中的结构化审核字段提供",
      },
      goal: {
        dimension: "goal_alignment",
        verdict: goalFailed ? "misaligned" : "aligned",
        learnerGoal: request.profile_snapshot.goal,
        reason: "由 C 恢复请求中的结构化审核字段提供",
      },
    },
    summary: "使用 C 恢复请求携带的结构化 B 审核结果规划路径",
    revisionHints: [...request.review_instruction_ids],
    failedDimensions: [
      ...request.failed_dimensions,
    ] as TeachingAuditDimension[],
    missingPrerequisiteSourceIds: [
      ...missingPrerequisiteSourceIds,
    ],
    unknownPrerequisiteRefs: [],
    requiredAction: request.required_action,
    fixScope: request.fix_scope,
    recommendedLevel: request.recommended_level ?? null,
    canRecover: true,
  }
}

type PrerequisiteClosureResult =
  | { ok: true; source_ids: string[] }
  | { ok: false; reason: string }

/**
 * Expands every unresolved prerequisite to a dependency-first closure. The
 * planner consumes only the first unresolved node for the current learning
 * stage; the remainder stays ordered for later stages instead of becoming one
 * oversized mixed target set.
 * Explicitly mastered concepts terminate traversal, while concepts that are
 * simultaneously marked weak remain teachable gaps. Unknown references and
 * cycles are knowledge-graph integrity failures and therefore fail closed.
 */
function unresolvedPrerequisiteClosure(
  knowledgeBase: KnowledgeBase,
  knownConcepts: string[],
  weakConcepts: string[],
  rootSourceIds: string[],
): PrerequisiteClosureResult {
  const itemsById = new Map<string, KnowledgeBase["items"][number]>()
  for (const item of knowledgeBase.items) {
    if (itemsById.has(item.sourceId)) {
      return {
        ok: false,
        reason: `知识库中存在重复的 source_id：${item.sourceId}`,
      }
    }
    itemsById.set(item.sourceId, item)
  }

  const knownSourceIds = conceptSourceIds(
    knownConcepts,
    knowledgeBase,
    itemsById,
  )
  const weakSourceIds = conceptSourceIds(
    weakConcepts,
    knowledgeBase,
    itemsById,
  )
  const masteredSourceIds = new Set(
    [...knownSourceIds].filter((sourceId) => !weakSourceIds.has(sourceId)),
  )
  const roots = new Set(rootSourceIds)
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const path: string[] = []
  const ordered: string[] = []

  const visit = (sourceId: string): string | undefined => {
    if (visited.has(sourceId)) return undefined
    if (masteredSourceIds.has(sourceId) && !roots.has(sourceId)) {
      return undefined
    }
    const item = itemsById.get(sourceId)
    if (!item) return `知识库中不存在先修知识点：${sourceId}`
    if (visiting.has(sourceId)) {
      const cycleStart = path.indexOf(sourceId)
      const cycle = [...path.slice(Math.max(0, cycleStart)), sourceId]
      return `知识库先修关系存在循环：${cycle.join(" -> ")}`
    }

    visiting.add(sourceId)
    path.push(sourceId)
    for (const prerequisiteId of item.prerequisites ?? []) {
      const issue = visit(prerequisiteId)
      if (issue) return issue
    }
    path.pop()
    visiting.delete(sourceId)
    visited.add(sourceId)
    ordered.push(sourceId)
    return undefined
  }

  for (const sourceId of rootSourceIds) {
    const issue = visit(sourceId)
    if (issue) return { ok: false, reason: issue }
  }
  return { ok: true, source_ids: ordered }
}

function conceptSourceIds(
  concepts: string[],
  knowledgeBase: KnowledgeBase,
  itemsById: Map<string, KnowledgeBase["items"][number]>,
): Set<string> {
  const sourceIds = new Set<string>()
  for (const concept of concepts) {
    if (itemsById.has(concept)) sourceIds.add(concept)
    for (const sourceId of canonicalizeConcept(concept, knowledgeBase).sourceIds) {
      sourceIds.add(sourceId)
    }
  }
  return sourceIds
}

function prerequisiteStageGoal(
  originalGoal: string,
  prerequisiteTitles: string[],
): string {
  return `先掌握${prerequisiteTitles.join("、")}，为后续学习“${originalGoal}”打好基础`
}

function prerequisiteStageProfileIfNeeded(
  request: RoleBPathPlanningRequest,
  knowledgeBase: KnowledgeBase,
  prerequisiteTitles: string[],
  targetSourceIds: string[],
): RoleBPathPlanningRequest["profile_snapshot"] | undefined {
  const current = request.profile_snapshot
  const targetSet = new Set(targetSourceIds)
  const auditableWeak = current.weak_concepts.map((concept) =>
    canonicalizeConcept(concept, knowledgeBase))
    .filter((concept) => concept.matched && concept.sourceIds.length > 0)
  if (auditableWeak.length === 0 || auditableWeak.some((concept) =>
    concept.sourceIds.some((sourceId) => targetSet.has(sourceId)))) {
    return undefined
  }
  const weakConcepts = unique([
    ...current.weak_concepts,
    ...prerequisiteTitles.filter((title) =>
      !current.known_concepts.includes(title)),
  ])
  return {
    ...structuredClone(current),
    profile_version: stableId("PROFILE-PREREQ", {
      source_profile_version: current.profile_version,
      source_spec_id: request.current_spec_id,
      target_source_ids: targetSourceIds,
    }),
    level: request.recommended_level ?? current.level,
    weak_concepts: weakConcepts,
  }
}

function ensureAssessmentCapacity(
  pathNode: {
    objectives: Array<{ importance: string }>
    assessment_blueprint: {
      tier_1_count: number
      tier_2_count: number
      tier_3_count: number
    }
  },
): string | undefined {
  const coreCount = pathNode.objectives.filter(
    (objective) => objective.importance === "core",
  ).length
  if (coreCount > 30) {
    return `递归先修闭包包含 ${coreCount} 个核心目标，超过单轮评估上限 30`
  }

  const blueprint = pathNode.assessment_blueprint
  let remaining = coreCount - (
    blueprint.tier_1_count
    + blueprint.tier_2_count
    + blueprint.tier_3_count
  )
  for (const tier of [
    "tier_1_count",
    "tier_2_count",
    "tier_3_count",
  ] as const) {
    if (remaining <= 0) break
    const increment = Math.min(20 - blueprint[tier], remaining)
    blueprint[tier] += increment
    remaining -= increment
  }
  return remaining > 0
    ? "递归先修闭包无法在单轮评估题量上限内完整覆盖"
    : undefined
}

function blockedResult(
  request: RoleBPathPlanningRequest,
  code: "BLOCKED" | "UNSUPPORTED_TARGET",
  reason: string,
  extraDimension?: string,
): RoleBPathPlanningResult {
  return {
    status: "blocked",
    request_id: request.request_id,
    code,
    reason,
    failed_dimensions: unique([
      ...request.failed_dimensions,
      ...(extraDimension ? [extraDimension] : []),
    ]),
    missing_prerequisite_source_ids: [
      ...request.missing_prerequisite_source_ids,
    ],
    ...(request.recommended_level
      ? { recommended_level: request.recommended_level }
      : {}),
    can_recover: false,
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}
