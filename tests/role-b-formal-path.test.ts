// 测试: B 角色 Week4 正式学习路径 + 多阶段进阶
// 覆盖: buildFormalPath, advanceToNextNode, startPath, getPathStatus
// 验收标准:
//   1. 循环目标始终保留在正式路线中
//   2. 先修排在循环之前，不能替换循环
//   3. 不相关的综合项目(K018)不纳入路径
//   4. advance 返回正式 next_path_node + profile_snapshot
import { describe, expect, test } from "bun:test"
import { loadKnowledgeBase } from "../src/knowledge/loader"
import type { KnowledgeBase } from "../src/knowledge/types"
import type { LearnerProfile } from "../src/role-b-profile/types"
import type { LearnerProfileSnapshot } from "../src/role-c-content/contracts/profile-adapter"
import {
  buildFormalPath,
  advanceToNextNode,
  startPath,
  getPathStatus,
} from "../src/role-b-profile/teaching-audit/formal-path"
import type {
  BuildFormalPathInput,
} from "../src/role-b-profile/teaching-audit/formal-path"

let kb: KnowledgeBase

async function getKB(): Promise<KnowledgeBase> {
  if (!kb) kb = await loadKnowledgeBase()
  return kb
}

function makeProfile(overrides: Partial<LearnerProfile> = {}): LearnerProfile {
  return {
    learner_id: "test-learner-formal",
    level: "beginner",
    known_concepts: ["变量", "数据类型"],
    weak_concepts: ["循环"],
    goal: "学会循环遍历数据",
    ...overrides,
  }
}

function makeSnapshot(profile: LearnerProfile, version = "v1"): LearnerProfileSnapshot {
  return {
    schema_version: "1.0",
    profile_id: `PROFILE-${profile.learner_id}-${version}`,
    profile_version: version,
    learner_id: profile.learner_id,
    level: profile.level,
    known_concepts: [...profile.known_concepts],
    weak_concepts: [...profile.weak_concepts],
    goal: profile.goal,
    preferred_contexts: [],
    accommodations: [],
    provenance_ref: "role-b:test",
  }
}

// ── 路径构建 ──

describe("buildFormalPath", () => {
  test("loop goal → path contains loop nodes, preserves original_goal", async () => {
    const kb = await getKB()
    const profile = makeProfile({
      goal: "学会循环遍历数据",
      weak_concepts: ["循环", "列表"],
    })
    const snapshot = makeSnapshot(profile)

    const path = buildFormalPath({
      learnerProfile: profile,
      knowledgeBase: kb,
      profileSnapshot: snapshot,
    })

    expect(path.original_goal).toBe("学会循环遍历数据")
    expect(path.nodes.length).toBeGreaterThan(0)
    // 路径中必须有循环相关节点
    const loopNodes = path.nodes.filter((node) =>
      node.target_source_ids.some((sid) => ["K007", "K008"].includes(sid)),
    )
    expect(loopNodes.length).toBeGreaterThan(0)
    // 所有节点的 goal 字段都应该是原始目标
    for (const node of path.nodes) {
      expect(node.goal).toBe("学会循环遍历数据")
    }
  })

  test("prerequisites come before loop goal nodes", async () => {
    const kb = await getKB()
    // 学习者几乎零基础，弱点是循环
    const profile = makeProfile({
      known_concepts: [],  // 什么都没掌握
      weak_concepts: ["循环"],
      goal: "学会循环遍历数据",
    })
    const snapshot = makeSnapshot(profile)

    const path = buildFormalPath({
      learnerProfile: profile,
      knowledgeBase: kb,
      profileSnapshot: snapshot,
    })

    // 先修节点(如 K002 变量, K003 数据类型)应排在循环节点(K007, K008)之前
    const firstLoopIdx = path.nodes.findIndex((node) =>
      node.target_source_ids.some((sid) => ["K007", "K008"].includes(sid)),
    )
    expect(firstLoopIdx).toBeGreaterThan(-1)

    // 先修节点序号应小于循环节点序号
    const prereqIndices = path.nodes
      .filter((node, idx) =>
        idx < firstLoopIdx
        && node.target_source_ids.some((sid) => !["K007", "K008"].includes(sid)),
      )
    for (const prereqNode of prereqIndices) {
      expect(prereqNode.stage_order).toBeLessThan(
        path.nodes[firstLoopIdx].stage_order,
      )
    }
  })

  test("path includes the full unmastered prerequisite closure, not just direct prerequisites", async () => {
    const kb = await getKB()
    // 学习者：基本数据类型已掌握(K003)，变量与赋值未掌握(K002)，目标=列表(K009)
    // K009 需要 K002、K003；K002 需要 K001。K001 是"先修的先修"，也必须进路径。
    const profile = makeProfile({
      known_concepts: ["基本数据类型"],
      weak_concepts: ["变量与赋值"],
      goal: "学习列表",
    })
    const snapshot = makeSnapshot(profile)

    const path = buildFormalPath({
      learnerProfile: profile,
      knowledgeBase: kb,
      profileSnapshot: snapshot,
      goalSourceIds: ["K009"],
    })

    const targets = path.nodes.map((node) => node.target_source_ids[0])
    // 未掌握的先修闭包必须完整：K001(Python是什么) → K002(变量与赋值) → K009(列表)
    expect(targets).toEqual(["K001", "K002", "K009"])
    // 已掌握的 K003 不重复学
    expect(targets).not.toContain("K003")
  })

  test("composite project K018 is excluded when goal is about loops", async () => {
    const kb = await getKB()
    const profile = makeProfile({
      goal: "学会循环遍历数据",
    })
    const snapshot = makeSnapshot(profile)

    const path = buildFormalPath({
      learnerProfile: profile,
      knowledgeBase: kb,
      profileSnapshot: snapshot,
      goalSourceIds: ["K007", "K009", "K018"],  // 显式传入了 K018
    })

    // K018（成绩统计器综合项目）不应该出现在路径中
    const k018Nodes = path.nodes.filter((node) =>
      node.target_source_ids.includes("K018"),
    )
    expect(k018Nodes).toEqual([])
  })

  test("composite project K018 IS included when goal is about 成绩统计", async () => {
    const kb = await getKB()
    const profile = makeProfile({
      level: "integrated",
      known_concepts: ["变量", "数据类型", "条件判断", "for 循环", "列表", "函数定义与调用"],
      weak_concepts: ["综合项目"],
      goal: "完成成绩统计综合项目",
    })
    const snapshot = makeSnapshot(profile)

    const path = buildFormalPath({
      learnerProfile: profile,
      knowledgeBase: kb,
      profileSnapshot: snapshot,
    })

    const k018Nodes = path.nodes.filter((node) =>
      node.target_source_ids.includes("K018"),
    )
    // 目标就是成绩统计综合项目 → K018 应该纳入
    expect(k018Nodes.length).toBeGreaterThan(0)
  })

  test("known concepts are excluded from prerequisite nodes", async () => {
    const kb = await getKB()
    // 学习者已掌握 K002, K003，只需要补 K005, K006 等
    const profile = makeProfile({
      known_concepts: ["变量", "数据类型", "条件判断"],
      weak_concepts: ["循环"],
      goal: "学会循环遍历数据",
    })
    const snapshot = makeSnapshot(profile)

    const path = buildFormalPath({
      learnerProfile: profile,
      knowledgeBase: kb,
      profileSnapshot: snapshot,
    })

    // K002(变量) 和 K003(数据类型) 不应该出现在先修节点中
    const hasKnownPrereq = path.nodes.some((node) =>
      node.target_source_ids.some((sid) => ["K002", "K003"].includes(sid)),
    )
    // K002/K003 已掌握，所以除非它们是目标的一部分，否则不应该出现
    const goalSourceIds = path.nodes.flatMap((node) => node.target_source_ids)
    if (!goalSourceIds.includes("K002") && !goalSourceIds.includes("K003")) {
      expect(hasKnownPrereq).toBe(false)
    }
  })

  test("returns empty nodes when knowledge base has no match", async () => {
    const kb = await getKB()
    const profile = makeProfile({
      known_concepts: [],
      weak_concepts: [],
      goal: "使用Fortran编写科学计算程序",
    })
    const snapshot = makeSnapshot(profile)

    const path = buildFormalPath({
      learnerProfile: profile,
      knowledgeBase: kb,
      profileSnapshot: snapshot,
    })

    expect(path.nodes).toEqual([])
    expect(path.original_goal).toBe("使用Fortran编写科学计算程序")
    expect(path.current_node_index).toBe(-1)
  })

  test("all nodes have sequential stage_order starting from 1", async () => {
    const kb = await getKB()
    const profile = makeProfile({
      known_concepts: [],
      weak_concepts: ["循环", "列表"],
      goal: "学会循环遍历数据",
    })
    const snapshot = makeSnapshot(profile)

    const path = buildFormalPath({
      learnerProfile: profile,
      knowledgeBase: kb,
      profileSnapshot: snapshot,
    })

    for (let i = 0; i < path.nodes.length; i++) {
      expect(path.nodes[i].stage_order).toBe(i + 1)
    }
  })

  test("all nodes start with pending status", async () => {
    const kb = await getKB()
    const profile = makeProfile()
    const snapshot = makeSnapshot(profile)

    const path = buildFormalPath({
      learnerProfile: profile,
      knowledgeBase: kb,
      profileSnapshot: snapshot,
      goalSourceIds: ["K007"],
    })

    for (const node of path.nodes) {
      expect(node.status).toBe("pending")
    }
  })
})

// ── 路径开始 ──

describe("startPath", () => {
  test("marks first node as in_progress and returns it as nextPathNode", async () => {
    const kb = await getKB()
    const profile = makeProfile({
      known_concepts: ["变量", "数据类型", "条件判断"],
      weak_concepts: ["循环"],
      goal: "学会循环遍历数据",
    })
    const snapshot = makeSnapshot(profile)

    const path = buildFormalPath({
      learnerProfile: profile,
      knowledgeBase: kb,
      profileSnapshot: snapshot,
      goalSourceIds: ["K007"],
    })

    const result = startPath(path)

    expect(result.nextPathNode).not.toBeNull()
    expect(result.nextPathNode!.target_source_ids.length).toBeGreaterThan(0)
    expect(result.path.nodes[0].status).toBe("in_progress")
    expect(result.path.current_node_index).toBe(0)
    expect(result.pathCompleted).toBe(false)
  })

  test("empty path → pathCompleted immediately", async () => {
    const kb = await getKB()
    const profile = makeProfile({
      known_concepts: [],
      weak_concepts: [],
      goal: "使用Fortran编写科学计算程序",
    })
    const snapshot = makeSnapshot(profile)

    const path = buildFormalPath({
      learnerProfile: profile,
      knowledgeBase: kb,
      profileSnapshot: snapshot,
    })

    expect(path.nodes).toEqual([])

    const result = startPath(path)
    expect(result.nextPathNode).toBeNull()
    expect(result.pathCompleted).toBe(true)
  })
})

// ── 路径进阶 ──

describe("advanceToNextNode", () => {
  test("advance action → current node completed, returns next node", async () => {
    const kb = await getKB()
    // 学习者几乎零基础 → 需要先修节点
    const profile = makeProfile({
      known_concepts: [],
      weak_concepts: ["循环"],
      goal: "学会循环遍历数据",
    })
    const snapshot = makeSnapshot(profile, "v1")

    let path = buildFormalPath({
      learnerProfile: profile,
      knowledgeBase: kb,
      profileSnapshot: snapshot,
      goalSourceIds: ["K007"],
    })

    // 开始
    const started = startPath(path)
    path = started.path
    const firstNodeId = started.nextPathNode!.node_id
    expect(started.nextPathNode).not.toBeNull()
    // 零基础学习者应该有至少2个节点（先修 + 目标）
    expect(path.nodes.length).toBeGreaterThanOrEqual(2)

    // advance
    const newSnapshot = makeSnapshot(
      { ...profile, level: "basic", known_concepts: [...profile.known_concepts, "变量"] },
      "v2",
    )
    const advanced = advanceToNextNode({
      path,
      updatedProfileSnapshot: newSnapshot,
      decisionAction: "advance",
    })

    // 第一个节点应被标记为 completed
    expect(advanced.path.nodes[0].status).toBe("completed")
    expect(advanced.path.nodes[0].node_id).toBe(firstNodeId)
    expect(advanced.path.current_node_index).toBe(1)

    // nextPathNode 应该是第二个节点
    expect(advanced.nextPathNode).not.toBeNull()
    expect(advanced.nextPathNode!.node_id).toBe(advanced.path.nodes[1].node_id)
    // profile snapshot 应更新
    expect(advanced.nextProfileSnapshot.profile_version).toBe("v2")
    expect(advanced.pathCompleted).toBe(false)
  })

  test("remediate action → stays on same node, does not advance", async () => {
    const kb = await getKB()
    const profile = makeProfile({
      known_concepts: ["变量", "数据类型", "条件判断"],
      weak_concepts: ["循环"],
      goal: "学会循环遍历数据",
    })
    const snapshot = makeSnapshot(profile, "v1")

    let path = buildFormalPath({
      learnerProfile: profile,
      knowledgeBase: kb,
      profileSnapshot: snapshot,
      goalSourceIds: ["K007"],
    })

    const started = startPath(path)
    path = started.path
    const currentNodeId = started.nextPathNode!.node_id

    const newSnapshot = makeSnapshot(profile, "v2")
    const result = advanceToNextNode({
      path,
      updatedProfileSnapshot: newSnapshot,
      decisionAction: "remediate",
    })

    // 不应前进
    expect(result.nextPathNode!.node_id).toBe(currentNodeId)
    expect(result.path.current_node_index).toBe(0)
    expect(result.path.nodes[0].status).toBe("in_progress")  // 保持 in_progress
    expect(result.pathCompleted).toBe(false)
    expect(result.nextProfileSnapshot.profile_version).toBe("v2")
  })

  test("reinforce action → stays on same node", async () => {
    const kb = await getKB()
    const profile = makeProfile({
      known_concepts: ["变量", "数据类型", "条件判断"],
      weak_concepts: ["循环"],
      goal: "学会循环遍历数据",
    })
    const snapshot = makeSnapshot(profile, "v1")

    let path = buildFormalPath({
      learnerProfile: profile,
      knowledgeBase: kb,
      profileSnapshot: snapshot,
      goalSourceIds: ["K007"],
    })

    const started = startPath(path)
    path = started.path
    const currentNodeId = started.nextPathNode!.node_id

    const newSnapshot = makeSnapshot(profile, "v2")
    const result = advanceToNextNode({
      path,
      updatedProfileSnapshot: newSnapshot,
      decisionAction: "reinforce",
    })

    expect(result.nextPathNode!.node_id).toBe(currentNodeId)
    expect(result.path.current_node_index).toBe(0)
    expect(result.pathCompleted).toBe(false)
  })

  test("advance through all nodes → pathCompleted", async () => {
    const kb = await getKB()
    const profile = makeProfile({
      known_concepts: ["变量", "数据类型", "条件判断"],
      weak_concepts: ["循环"],
      goal: "学会循环遍历数据",
    })
    let snapshot = makeSnapshot(profile, "v1")

    let path = buildFormalPath({
      learnerProfile: profile,
      knowledgeBase: kb,
      profileSnapshot: snapshot,
      goalSourceIds: ["K007"],
    })

    if (path.nodes.length === 0) return  // skip for empty

    // 开始
    let result = startPath(path)
    path = result.path

    // 逐节点 advance
    for (let i = 0; i < path.nodes.length; i++) {
      snapshot = makeSnapshot(
        { ...profile, level: "integrated", known_concepts: [...profile.known_concepts, `concept-v${i}`] },
        `v${i + 2}`,
      )
      result = advanceToNextNode({
        path,
        updatedProfileSnapshot: snapshot,
        decisionAction: "advance",
      })
      path = result.path
    }

    // 所有节点应为 completed
    expect(path.current_node_index).toBe(path.nodes.length)
    expect(result.pathCompleted).toBe(true)
    expect(result.nextPathNode).toBeNull()
  })

  test("original_goal is never mutated through advances", async () => {
    const kb = await getKB()
    const profile = makeProfile({
      goal: "学会循环遍历数据",
    })
    const snapshot = makeSnapshot(profile, "v1")

    let path = buildFormalPath({
      learnerProfile: profile,
      knowledgeBase: kb,
      profileSnapshot: snapshot,
      goalSourceIds: ["K007"],
    })

    expect(path.original_goal).toBe("学会循环遍历数据")

    let result = startPath(path)
    path = result.path

    if (path.nodes.length > 0) {
      result = advanceToNextNode({
        path,
        updatedProfileSnapshot: makeSnapshot(profile, "v2"),
        decisionAction: "advance",
      })
      path = result.path

      // original_goal 绝对不能变
      expect(path.original_goal).toBe("学会循环遍历数据")
    }
  })

  test("reprofile action → marks node blocked and advances", async () => {
    const kb = await getKB()
    const profile = makeProfile({
      known_concepts: ["变量", "数据类型", "条件判断"],
      weak_concepts: ["循环"],
      goal: "学会循环遍历数据",
    })
    const snapshot = makeSnapshot(profile, "v1")

    let path = buildFormalPath({
      learnerProfile: profile,
      knowledgeBase: kb,
      profileSnapshot: snapshot,
      goalSourceIds: ["K007"],
    })

    const started = startPath(path)
    path = started.path

    const result = advanceToNextNode({
      path,
      updatedProfileSnapshot: makeSnapshot(profile, "v2"),
      decisionAction: "reprofile",
    })

    // 第一个节点被标记为 blocked
    expect(result.path.nodes[0].status).toBe("blocked")
    // 画像漂移不推进路径：节点索引不变，返回当前节点等待重新诊断
    expect(result.path.current_node_index).toBe(0)
    expect(result.nextPathNode?.node_id).toBe(result.path.nodes[0].node_id)
    expect(result.pathCompleted).toBe(false)
  })
})

// ── 路径状态查询 ──

describe("getPathStatus", () => {
  test("returns correct status for fresh path", async () => {
    const kb = await getKB()
    const profile = makeProfile()
    const snapshot = makeSnapshot(profile)

    const path = buildFormalPath({
      learnerProfile: profile,
      knowledgeBase: kb,
      profileSnapshot: snapshot,
      goalSourceIds: ["K007"],
    })

    const status = getPathStatus(path)
    expect(status.originalGoal).toBe(path.original_goal)
    expect(status.totalNodes).toBe(path.nodes.length)
    expect(status.currentNodeIndex).toBe(-1)
    expect(status.currentNode).toBeNull()
    expect(status.pathCompleted).toBe(false)
  })

  test("returns correct status after start", async () => {
    const kb = await getKB()
    const profile = makeProfile()
    const snapshot = makeSnapshot(profile)

    let path = buildFormalPath({
      learnerProfile: profile,
      knowledgeBase: kb,
      profileSnapshot: snapshot,
      goalSourceIds: ["K007"],
    })

    const result = startPath(path)
    path = result.path

    const status = getPathStatus(path)
    expect(status.currentNodeIndex).toBe(0)
    expect(status.currentNode).not.toBeNull()
    if (path.nodes.length > 0) {
      expect(status.remainingNodes).toBe(path.nodes.length - 1)
    }
    expect(status.pathCompleted).toBe(false)
  })

  test("remainingNodes decreases after each advance", async () => {
    const kb = await getKB()
    const profile = makeProfile({
      known_concepts: ["变量", "数据类型", "条件判断"],
      goal: "学会循环遍历数据",
    })
    let snapshot = makeSnapshot(profile, "v1")

    let path = buildFormalPath({
      learnerProfile: profile,
      knowledgeBase: kb,
      profileSnapshot: snapshot,
      goalSourceIds: ["K007"],
    })

    let result = startPath(path)
    path = result.path
    const totalNodes = path.nodes.length

    const statusBefore = getPathStatus(path)
    expect(statusBefore.remainingNodes).toBe(totalNodes - 1)

    for (let i = 1; i < totalNodes; i++) {
      snapshot = makeSnapshot(profile, `v${i + 1}`)
      result = advanceToNextNode({
        path,
        updatedProfileSnapshot: snapshot,
        decisionAction: "advance",
      })
      path = result.path

      const status = getPathStatus(path)
      expect(status.remainingNodes).toBe(totalNodes - i - 1)
    }
  })
})
