// 输入: LearnerProfile + KnowledgeBase → FormalLearningPath
// 输出: 可持久化的多阶段学习路线，保证先修顺序和原始目标不丢失
// 规则:
//   1. original_goal 不可变 —— "循环"永远就是"循环"
//   2. 先修节点(prerequisites)排在目标节点之前
//   3. 成绩统计器综合项目(K018)只在目标明确匹配时才纳入
//   4. 每轮 advance 返回正式 next_path_node + 最新 profile_snapshot
// 这是 D 调用 B 进行路径规划和进阶的主入口
import type { KnowledgeBase, KnowledgeItem } from "../../knowledge/types"
import type { LearnerProfile } from "../types"
import type {
  LearningPathNode,
  LearningObjective,
  AssessmentBlueprint,
  LearnerProfileSnapshot,
} from "../../role-c-content/contracts/profile-adapter"
import { canonicalizeConcept } from "../concept-canonicalizer"

// ── 正式路径类型 ──

export type FormalPathNodeStatus = "pending" | "in_progress" | "completed" | "blocked"

/** 继承 LearningPathNode，加上运行时状态和阶段顺序 */
export interface FormalPathNode extends LearningPathNode {
  status: FormalPathNodeStatus
  /** 从 1 开始的顺序编号，决定了 D 展示的路线阶段 */
  stage_order: number
}

/** 可持久化的多阶段学习路线 */
export interface FormalLearningPath {
  path_id: string
  learner_id: string
  /** 原始学习目标 —— 始终保留，永不替换 */
  original_goal: string
  /** 按学习顺序排列的节点列表 */
  nodes: FormalPathNode[]
  /** 当前进行中的节点索引（-1 表示尚未开始），指向 nodes 数组 */
  current_node_index: number
  /** 路径创建时的画像快照 */
  profile_snapshot: LearnerProfileSnapshot
  created_at: string
  updated_at: string
}

export interface BuildFormalPathInput {
  learnerProfile: LearnerProfile
  knowledgeBase: KnowledgeBase
  profileSnapshot: LearnerProfileSnapshot
  /** 初始目标 source_id 列表（通常来自 RAG 检索 top K） */
  goalSourceIds?: string[]
}

export interface AdvancePathInput {
  path: FormalLearningPath
  updatedProfileSnapshot: LearnerProfileSnapshot
  /** C 的动态反馈决策 action */
  decisionAction: "advance" | "remediate" | "reinforce" | "reprofile"
}

export interface AdvancePathResult {
  /** 下一阶段的路径节点（null 表示路径已完成） */
  nextPathNode: LearningPathNode | null
  /** 最新版画像快照 */
  nextProfileSnapshot: LearnerProfileSnapshot
  /** 更新后的完整路径 */
  path: FormalLearningPath
  /** 路径是否已完成 */
  pathCompleted: boolean
}

export interface FormalPathStatus {
  pathId: string
  originalGoal: string
  totalNodes: number
  currentNodeIndex: number
  currentNode: FormalPathNode | null
  remainingNodes: number
  pathCompleted: boolean
}

// ── 内部常量 ──

/** 作为"综合项目"的知识点 source_id，只在目标明确匹配时才纳入路径 */
const COMPOSITE_PROJECT_IDS = new Set(["K018"])

/** 综合项目关键词 —— 只有目标包含这些才纳入 K018 */
const COMPOSITE_PROJECT_KEYWORDS = [
  "综合项目", "成绩统计", "成绩统计器", "综合",
]

// ── 路径构建 ──

export function buildFormalPath(input: BuildFormalPathInput): FormalLearningPath {
  const { learnerProfile, knowledgeBase, profileSnapshot, goalSourceIds } = input

  // 解析原始目标
  const originalGoal = learnerProfile.goal || "掌握编程基础"
  const normalizedGoal = normalizeSemantic(originalGoal)

  // 确定目标知识点
  const goalItems = resolveGoalItems(
    learnerProfile,
    knowledgeBase,
    originalGoal,
    normalizedGoal,
    goalSourceIds,
  )

  // 构建有序节点列表：先修 → 目标
  const nodes = buildOrderedNodes(learnerProfile, knowledgeBase, goalItems, originalGoal)

  const pathId = `PATH-${learnerProfile.learner_id}-${Date.now()}`
  const now = new Date().toISOString()

  return {
    path_id: pathId,
    learner_id: learnerProfile.learner_id,
    original_goal: originalGoal,
    nodes,
    current_node_index: -1,
    profile_snapshot: profileSnapshot,
    created_at: now,
    updated_at: now,
  }
}

// ── 路径进阶 ──

export function advanceToNextNode(input: AdvancePathInput): AdvancePathResult {
  const { path, updatedProfileSnapshot, decisionAction } = input

  // 深拷贝路径以保持不可变性
  const updatedPath = structuredClone(path)
  updatedPath.updated_at = new Date().toISOString()

  // 标记当前节点状态
  if (updatedPath.current_node_index >= 0 && updatedPath.current_node_index < updatedPath.nodes.length) {
    const currentNode = updatedPath.nodes[updatedPath.current_node_index]
    if (decisionAction === "advance") {
      currentNode.status = "completed"
    } else if (decisionAction === "remediate" || decisionAction === "reinforce") {
      // 需要重修或强化：节点保持 in_progress，不前进
      updatedPath.profile_snapshot = updatedProfileSnapshot
      const stayNode: LearningPathNode = {
        schema_version: currentNode.schema_version,
        node_id: currentNode.node_id,
        target_source_ids: [...currentNode.target_source_ids],
        prerequisite_source_ids: [...currentNode.prerequisite_source_ids],
        goal: currentNode.goal,
        objectives: currentNode.objectives.map((obj) => ({ ...obj })),
        assessment_blueprint: { ...currentNode.assessment_blueprint },
      }
      return {
        nextPathNode: stayNode,
        nextProfileSnapshot: updatedProfileSnapshot,
        path: updatedPath,
        pathCompleted: false,
      }
    } else {
      // reprofile：画像漂移，不前进节点；标记 blocked 由调用方触发重新诊断。
      currentNode.status = "blocked"
      updatedPath.profile_snapshot = updatedProfileSnapshot
      const stayNode: LearningPathNode = {
        schema_version: currentNode.schema_version,
        node_id: currentNode.node_id,
        target_source_ids: [...currentNode.target_source_ids],
        prerequisite_source_ids: [...currentNode.prerequisite_source_ids],
        goal: currentNode.goal,
        objectives: currentNode.objectives.map((obj) => ({ ...obj })),
        assessment_blueprint: { ...currentNode.assessment_blueprint },
      }
      return {
        nextPathNode: stayNode,
        nextProfileSnapshot: updatedProfileSnapshot,
        path: updatedPath,
        pathCompleted: false,
      }
    }
  }

  // 前进到下一节点
  updatedPath.current_node_index += 1

  // 检查是否已完成所有节点
  if (updatedPath.current_node_index >= updatedPath.nodes.length) {
    updatedPath.profile_snapshot = updatedProfileSnapshot
    return {
      nextPathNode: null,
      nextProfileSnapshot: updatedProfileSnapshot,
      path: updatedPath,
      pathCompleted: true,
    }
  }

  // 设置当前节点为 in_progress
  const nextNode = updatedPath.nodes[updatedPath.current_node_index]
  nextNode.status = "in_progress"
  updatedPath.profile_snapshot = updatedProfileSnapshot

  // 返回 next_path_node（去掉 status/stage_order，纯粹的 LearningPathNode）
  const cleanNode: LearningPathNode = {
    schema_version: nextNode.schema_version,
    node_id: nextNode.node_id,
    target_source_ids: [...nextNode.target_source_ids],
    prerequisite_source_ids: [...nextNode.prerequisite_source_ids],
    goal: nextNode.goal,
    objectives: nextNode.objectives.map((obj) => ({ ...obj })),
    assessment_blueprint: { ...nextNode.assessment_blueprint },
  }

  return {
    nextPathNode: cleanNode,
    nextProfileSnapshot: updatedProfileSnapshot,
    path: updatedPath,
    pathCompleted: false,
  }
}

/** 初始化路径：标记第一个节点为 in_progress 并返回 */
export function startPath(path: FormalLearningPath): AdvancePathResult {
  if (path.nodes.length === 0) {
    return {
      nextPathNode: null,
      nextProfileSnapshot: path.profile_snapshot,
      path,
      pathCompleted: true,
    }
  }

  const updatedPath = structuredClone(path)
  updatedPath.current_node_index = 0
  updatedPath.nodes[0].status = "in_progress"
  updatedPath.updated_at = new Date().toISOString()

  const firstNode = updatedPath.nodes[0]
  const cleanNode: LearningPathNode = {
    schema_version: firstNode.schema_version,
    node_id: firstNode.node_id,
    target_source_ids: [...firstNode.target_source_ids],
    prerequisite_source_ids: [...firstNode.prerequisite_source_ids],
    goal: firstNode.goal,
    objectives: firstNode.objectives.map((obj) => ({ ...obj })),
    assessment_blueprint: { ...firstNode.assessment_blueprint },
  }

  return {
    nextPathNode: cleanNode,
    nextProfileSnapshot: updatedPath.profile_snapshot,
    path: updatedPath,
    pathCompleted: false,
  }
}

/** 查询路径状态 */
export function getPathStatus(path: FormalLearningPath): FormalPathStatus {
  const currentNode = path.current_node_index >= 0 && path.current_node_index < path.nodes.length
    ? path.nodes[path.current_node_index]
    : null

  return {
    pathId: path.path_id,
    originalGoal: path.original_goal,
    totalNodes: path.nodes.length,
    currentNodeIndex: path.current_node_index,
    currentNode,
    remainingNodes: Math.max(0, path.nodes.length - path.current_node_index - 1),
    pathCompleted: path.current_node_index >= path.nodes.length,
  }
}

// ── 内部实现 ──

function resolveGoalItems(
  profile: LearnerProfile,
  kb: KnowledgeBase,
  originalGoal: string,
  normalizedGoal: string,
  goalSourceIds?: string[],
): KnowledgeItem[] {
  const isCompositeGoal = COMPOSITE_PROJECT_KEYWORDS.some(
    (keyword) => normalizedGoal.includes(normalizeSemantic(keyword)),
  )

  // 如果调用方直接提供了目标 source_ids
  if (goalSourceIds && goalSourceIds.length > 0) {
    const items = goalSourceIds
      .map((sid) => kb.items.find((item) => item.sourceId === sid))
      .filter((item): item is KnowledgeItem => item != null)

    // 过滤掉不相关的综合项目
    if (!isCompositeGoal) {
      return items.filter((item) => !COMPOSITE_PROJECT_IDS.has(item.sourceId))
    }
    return items
  }

  // 从语义关键词匹配解析目标知识点（不用 canonicalizeConcept 做全句匹配——太容易伪阳性）
  const goalSourceIdsSet = sourceIdsRelevantToGoal(originalGoal, kb)

  // 从薄弱点中补充相关知识点（individual concepts，canonicalize 在这里是安全的）
  for (const weakConcept of profile.weak_concepts) {
    const mapped = canonicalizeConcept(weakConcept, kb)
    for (const sid of mapped.sourceIds) {
      goalSourceIdsSet.add(sid)
    }
  }

  const items = [...goalSourceIdsSet]
    .map((sid) => kb.items.find((item) => item.sourceId === sid))
    .filter((item): item is KnowledgeItem => item != null)

  // 过滤综合项目
  if (!isCompositeGoal) {
    return items.filter((item) => !COMPOSITE_PROJECT_IDS.has(item.sourceId))
  }
  return items
}

function buildOrderedNodes(
  profile: LearnerProfile,
  kb: KnowledgeBase,
  goalItems: KnowledgeItem[],
  originalGoal: string,
): FormalPathNode[] {
  if (goalItems.length === 0) {
    // 找不到匹配知识点时返回空列表
    return []
  }

  const goalSourceIds = new Set(goalItems.map((item) => item.sourceId))

  // 递归收集所有未掌握的先修闭包（含"先修的先修"），保证路径覆盖完整依赖链
  const allPrereqs = new Map<string, KnowledgeItem>()
  const visited = new Set(goalSourceIds)
  const pending = [...goalItems]
  while (pending.length > 0) {
    const item = pending.shift()!
    for (const prereqId of item.prerequisites ?? []) {
      if (visited.has(prereqId)) continue
      visited.add(prereqId)
      const prereqItem = kb.items.find((k) => k.sourceId === prereqId)
      if (!prereqItem) continue

      // 检查学习者是否已掌握
      const isKnown = profile.known_concepts.some((concept) => {
        const canonical = canonicalizeConcept(concept, kb)
        return canonical.sourceIds.includes(prereqId)
      })
      if (isKnown) continue

      allPrereqs.set(prereqId, prereqItem)
      pending.push(prereqItem)
    }
  }

  // 去重目标知识点（按难度 + sourceId 排序）
  const sortedGoalItems = [...goalItems].sort((a, b) => {
    const diffOrder: Record<string, number> = { beginner: 0, basic: 1, intermediate: 2, integrated: 3 }
    const da = diffOrder[a.difficulty] ?? 0
    const db = diffOrder[b.difficulty] ?? 0
    if (da !== db) return da - db
    return a.sourceId.localeCompare(b.sourceId)
  })

  // 构建节点：先修节点在前，目标节点在后
  const nodes: FormalPathNode[] = []
  let stage = 1

  // 先修节点（按难度排序）
  const sortedPrereqs = [...allPrereqs.values()].sort((a, b) => {
    const diffOrder: Record<string, number> = { beginner: 0, basic: 1, intermediate: 2, integrated: 3 }
    const da = diffOrder[a.difficulty] ?? 0
    const db = diffOrder[b.difficulty] ?? 0
    if (da !== db) return da - db
    return a.sourceId.localeCompare(b.sourceId)
  })

  for (const prereq of sortedPrereqs) {
    // 再次检查学习者是否已掌握（防止信息不对称）
    const isKnown = profile.known_concepts.some((concept) => {
      const canonical = canonicalizeConcept(concept, kb)
      return canonical.sourceIds.includes(prereq.sourceId)
    })
    if (isKnown) continue

    nodes.push(createFormalNode(prereq, originalGoal, stage++, "pending"))
  }

  // 目标节点
  for (const item of sortedGoalItems) {
    nodes.push(createFormalNode(item, originalGoal, stage++, "pending"))
  }

  return nodes
}

function createFormalNode(
  item: KnowledgeItem,
  goal: string,
  stageOrder: number,
  status: FormalPathNodeStatus,
): FormalPathNode {
  const nodeId = `FN-${item.sourceId}-S${stageOrder}-${Date.now()}`

  const objectives: LearningObjective[] = [{
    objective_id: `OBJ-${item.sourceId}`,
    source_id: item.sourceId,
    required_fact_ids: [],
    observable_behavior: stageOrder <= 3 ? "recognize" as const : "apply" as const,
    importance: "core" as const,
  }]

  const blueprint: AssessmentBlueprint = {
    tier_1_count: 2,
    tier_2_count: 2,
    tier_3_count: 1,
    required_modalities: ["mcq", "trace", "code"],
  }

  return {
    schema_version: "1.0",
    node_id: nodeId,
    target_source_ids: [item.sourceId],
    prerequisite_source_ids: (item.prerequisites ?? []).filter(
      (pid) => pid !== item.sourceId,
    ),
    goal,
    objectives,
    assessment_blueprint: blueprint,
    status,
    stage_order: stageOrder,
  }
}

function sourceIdsRelevantToGoal(goal: string, kb: KnowledgeBase): Set<string> {
  const normalizedGoal = normalizeSemantic(goal)
  if (normalizedGoal.length === 0) return new Set()

  // 只用关键词子串匹配，不调用 canonicalizeConcept 做全句映射
  //（全句 canonicalize 会把 "Fortran"→"for"→K007，产生伪阳性）
  const sourceIds = new Set<string>()
  for (const item of kb.items) {
    const terms = [item.title, ...(item.keywords ?? [])]
      .map(normalizeSemantic)
      .filter((term) => {
        if (term.length < 2) return false
        // 纯 ASCII 短词（如 "for"）在子串匹配中太容易伪阳性
        if (/^[a-z0-9]+$/.test(term) && term.length < 4) return false
        return true
      })
    if (terms.some((term) => normalizedGoal.includes(term))) {
      sourceIds.add(item.sourceId)
    }
  }
  return sourceIds
}

function normalizeSemantic(value: string): string {
  return value.toLowerCase().replace(/[\s，,、。！？；："'`（）()[\]{}\-_/]+/g, "")
}
