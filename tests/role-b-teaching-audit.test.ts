// 测试: B 角色 Week2 教学审核 + 仲裁机制
// 覆盖: 四项审核维度 + 边界情况 + 仲裁合并逻辑
import { describe, expect, test } from "bun:test"
import { loadKnowledgeBase } from "../src/knowledge/loader"
import { auditTeaching } from "../src/role-b-profile/teaching-audit/auditor"
import { arbitrate } from "../src/role-b-profile/teaching-audit/arbitrator"
import { planRecoveryPath } from "../src/role-b-profile/teaching-audit/path-planner"
import { receiveLearningProgress } from "../src/role-b-profile/teaching-audit/progress-receiver"
import { RoleBLearningProgressAdapter } from "../src/role-b-profile/teaching-audit/learning-progress-adapter"
import type { LearnerProfile } from "../src/role-b-profile/types"
import type { KnowledgeBase } from "../src/knowledge/types"
import { contentHash } from "../src/role-c-content/contracts/common"
import {
  deliverRoleCToB,
  type RoleCLearningProgressDelivery,
} from "../src/role-c-content/contracts/external-api"
import type {
  LearningEvidenceEvent,
  ProfileDriftSuggestion,
} from "../src/role-c-content/contracts/learning-evidence-event"

let kb: KnowledgeBase

async function getKB(): Promise<KnowledgeBase> {
  if (!kb) kb = await loadKnowledgeBase()
  return kb
}

function makeProfile(overrides: Partial<LearnerProfile> = {}): LearnerProfile {
  return {
    learner_id: "test-learner-001",
    level: "beginner",
    known_concepts: ["变量", "数据类型"],
    weak_concepts: ["循环", "列表"],
    goal: "学会循环遍历数据",
    ...overrides,
  }
}

describe("teaching audit", () => {
  test("difficulty_alignment: beginner learner with beginner content passes", async () => {
    const kb = await getKB()
    // K007(for 循环, beginner) + K009(列表, basic), prereqs=K002+K003(known)
    // goal="学会循环遍历数据" matches K007 keywords
    const result = auditTeaching({
      artifactId: "test-1",
      learnerProfile: makeProfile(),
      knowledgeBase: kb,
      citedSourceIds: ["K007", "K009"],
    })
    expect(result.checks.difficulty.verdict).toBe("aligned")
    expect(result.checks.difficulty.contentMaxDifficulty).toBe("basic")
    expect(result.status).toBe("pass")
  })

  test("difficulty_alignment: beginner learner with integrated content is misaligned", async () => {
    const kb = await getKB()
    // K018(综合项目, integrated), prereqs need K007+K009+K013 — but difficulty is the blocking issue
    const result = auditTeaching({
      artifactId: "test-2",
      learnerProfile: makeProfile(),
      knowledgeBase: kb,
      citedSourceIds: ["K018"],
    })
    expect(result.checks.difficulty.verdict).toBe("misaligned")
    expect(result.status).toBe("reject")
  })

  test("difficulty_alignment: basic learner with intermediate content is within +1 range", async () => {
    const kb = await getKB()
    const result = auditTeaching({
      artifactId: "test-3",
      learnerProfile: makeProfile({ level: "basic", known_concepts: ["变量", "数据类型", "条件判断", "循环", "列表", "函数定义与调用"] }),
      knowledgeBase: kb,
      citedSourceIds: ["K015"],  // 文件读写(intermediate), basic+1=intermediate
    })
    expect(result.checks.difficulty.verdict).toBe("aligned")
  })

  test("prerequisite: K007(for 循环) with all prereqs known → aligned", async () => {
    const kb = await getKB()
    // K007 prereqs = [K002, K003]; both in known_concepts
    const result = auditTeaching({
      artifactId: "test-4",
      learnerProfile: makeProfile({ known_concepts: ["变量", "数据类型", "条件判断"] }),
      knowledgeBase: kb,
      citedSourceIds: ["K007"],
    })
    expect(result.checks.prerequisite.verdict).toBe("aligned")
  })

  test("prerequisite: an explicitly mastered target does not require its prerequisites again", async () => {
    const kb = await getKB()
    const result = auditTeaching({
      artifactId: "test-mastered-target",
      learnerProfile: makeProfile({
        known_concepts: ["变量", "数据类型", "条件判断"],
        weak_concepts: ["循环", "列表"],
      }),
      knowledgeBase: kb,
      citedSourceIds: ["K007", "K009", "K006"],
      targetSourceIds: ["K007", "K009", "K006"],
    })
    const masteredTarget = result.checks.prerequisite.checkedConcepts.find(
      (concept) => concept.sourceId === "K006",
    )
    expect(result.checks.prerequisite.verdict).toBe("aligned")
    expect(masteredTarget?.missingPrerequisites).toEqual([])
  })

  test("prerequisite: K018 requires K007+K009+K013 which learner doesn't know", async () => {
    const kb = await getKB()
    const result = auditTeaching({
      artifactId: "test-5",
      learnerProfile: makeProfile({ known_concepts: ["变量", "数据类型"] }),
      knowledgeBase: kb,
      citedSourceIds: ["K018"],
    })
    expect(result.checks.prerequisite.verdict).toBe("misaligned")
    expect(result.status).toBe("reject")
  })

  test("prerequisite: prerequisite being taught in the same batch does not count as missing", async () => {
    const kb = await getKB()
    // K018 needs K007+K009+K013; K007+K009+K013 are all in the teaching batch
    // K013 itself needs K006(条件判断) — must also be in the batch
    const result = auditTeaching({
      artifactId: "test-6",
      learnerProfile: makeProfile({ known_concepts: ["变量", "数据类型"] }),
      knowledgeBase: kb,
      citedSourceIds: ["K005", "K006", "K007", "K009", "K013", "K018"],
    })
    // K018 prereqs: K007(taught) + K009(taught) + K013(taught), K013 prereq: K006(taught) → all covered by batch
    expect(result.checks.prerequisite.verdict).toBe("aligned")
  })

  test("weak_concept: content covers learner's weak point 循环", async () => {
    const kb = await getKB()
    const result = auditTeaching({
      artifactId: "test-7",
      learnerProfile: makeProfile({ weak_concepts: ["循环"] }),
      knowledgeBase: kb,
      citedSourceIds: ["K007"],  // for 循环 → covers 循环
    })
    expect(result.checks.weakConcept.verdict).toBe("aligned")
    expect(result.checks.weakConcept.coveredWeakConcepts).toContain("循环")
  })

  test("weak_concept: content misses all weak points → revise", async () => {
    const kb = await getKB()
    const result = auditTeaching({
      artifactId: "test-8",
      learnerProfile: makeProfile({
        weak_concepts: ["循环", "列表"],
        goal: "学会循环遍历数据",  // match K001? 不匹配也没关系，goal变为revise
      }),
      knowledgeBase: kb,
      citedSourceIds: ["K001", "K002"],  // Python是什么、变量——跟薄弱点无关
    })
    expect(result.checks.weakConcept.verdict).toBe("incomplete")
    expect(result.checks.weakConcept.uncoveredWeakConcepts).toContain("循环")
    expect(result.checks.weakConcept.uncoveredWeakConcepts).toContain("列表")
    // weak concept incomplete → revise; goal 不匹配 → revise; 最终 revise
    expect(result.status).toBe("revise")
  })

  test("weak_concept: empty weak concepts is aligned", async () => {
    const kb = await getKB()
    const result = auditTeaching({
      artifactId: "test-9",
      learnerProfile: makeProfile({ weak_concepts: [] }),
      knowledgeBase: kb,
      citedSourceIds: ["K007"],
    })
    expect(result.checks.weakConcept.verdict).toBe("aligned")
  })

  test("weak_concept: unmapped free text does not require C to invent unsupported content", async () => {
    const kb = await getKB()
    const result = auditTeaching({
      artifactId: "test-9-unmapped",
      learnerProfile: makeProfile({
        level: "integrated",
        known_concepts: ["变量与赋值", "基本数据类型", "for 循环", "列表", "函数定义与调用"],
        weak_concepts: ["项目组织"],
        goal: "完成成绩统计程序，能够遍历列表并计算平均分",
      }),
      knowledgeBase: kb,
      citedSourceIds: ["K007", "K009", "K018"],
      targetSourceIds: ["K007", "K009", "K018"],
    })

    expect(result.checks.weakConcept).toMatchObject({
      verdict: "aligned",
      learnerWeakConcepts: ["项目组织"],
      coveredWeakConcepts: [],
      uncoveredWeakConcepts: [],
    })
    expect(result.status).toBe("pass")
  })

  test("goal: content keywords match learner's goal", async () => {
    const kb = await getKB()
    // K007 keywords: ["循环","遍历","重复执行"] → matches "学会循环遍历数据"
    const result = auditTeaching({
      artifactId: "test-10",
      learnerProfile: makeProfile({ goal: "学会循环遍历数据" }),
      knowledgeBase: kb,
      citedSourceIds: ["K007", "K009"],
    })
    expect(result.checks.goal.verdict).toBe("aligned")
  })

  test("goal: content unrelated to learner's goal → revise", async () => {
    const kb = await getKB()
    const result = auditTeaching({
      artifactId: "test-11",
      learnerProfile: makeProfile({ goal: "完成一个成绩统计小程序" }),
      knowledgeBase: kb,
      citedSourceIds: ["K001", "K003"],  // Python是什么 + 基本数据类型
    })
    expect(result.checks.goal.verdict).toBe("misaligned")
    // goal misaligned → revise (not reject, because content can be adjusted)
    expect(result.status).toBe("revise")
  })

  test("all checks pass → status is pass", async () => {
    const kb = await getKB()
    const result = auditTeaching({
      artifactId: "test-12",
      learnerProfile: makeProfile({
        level: "beginner",
        known_concepts: ["变量", "数据类型", "条件判断"],
        weak_concepts: ["循环"],
        goal: "学会循环遍历数据",
      }),
      knowledgeBase: kb,
      // K007 for 循环(beginner), prereq=K002+K003(both known), covers weak 循环, goal matches
      citedSourceIds: ["K007"],
    })
    expect(result.status).toBe("pass")
    expect(result.revisionHints).toEqual([])
  })

  test("status is reject when prerequisite check fails", async () => {
    const kb = await getKB()
    const result = auditTeaching({
      artifactId: "test-13",
      learnerProfile: makeProfile({ known_concepts: [] }),
      knowledgeBase: kb,
      citedSourceIds: ["K018"],
    })
    expect(result.status).toBe("reject")
  })

  test("status is revise when only weak concept is incomplete", async () => {
    const kb = await getKB()
    // K001 (Python是什么, beginner, no prereqs) + goal "学会循环遍历数据" → goal不匹配
    const result = auditTeaching({
      artifactId: "test-14",
      learnerProfile: makeProfile({
        level: "beginner",
        known_concepts: ["变量", "数据类型", "条件判断"],
        weak_concepts: ["循环", "列表"],
        goal: "学会循环遍历数据",
      }),
      knowledgeBase: kb,
      citedSourceIds: ["K001"],
    })
    // weak concept incomplete + goal misaligned → revise
    expect(result.status).toBe("revise")
    expect(result.revisionHints.length).toBeGreaterThan(0)
  })

  test("empty cited source IDs produces proper error messages", async () => {
    const kb = await getKB()
    const result = auditTeaching({
      artifactId: "test-15",
      learnerProfile: makeProfile(),
      knowledgeBase: kb,
      citedSourceIds: [],
    })
    expect(result.checks.difficulty.verdict).toBe("misaligned")
    expect(result.checks.goal.verdict).toBe("misaligned")
    // empty items → difficulty misaligned (no target items) → but it's "difficulty_alignment" so reject
    expect(result.status).toBe("reject")
  })

  test("summary is in Chinese and mentions failed dimensions", async () => {
    const kb = await getKB()
    const result = auditTeaching({
      artifactId: "test-16",
      learnerProfile: makeProfile({ level: "beginner", known_concepts: [] }),
      knowledgeBase: kb,
      citedSourceIds: ["K018"],
    })
    expect(result.summary).toContain("驳回")
    expect(result.summary.length).toBeGreaterThan(0)
  })
})

describe("arbitration", () => {
  test("dual pass → pass", () => {
    const result = arbitrate({
      artifactId: "arb-1",
      factAuditStatus: "pass",
      teachingAuditStatus: "pass",
      revisionRound: 0,
    })
    expect(result.decision).toBe("pass")
    expect(result.reason).toContain("通过")
  })

  test("fact reject + teaching pass → reject", () => {
    const result = arbitrate({
      artifactId: "arb-2",
      factAuditStatus: "reject",
      teachingAuditStatus: "pass",
      revisionRound: 0,
    })
    expect(result.decision).toBe("reject")
    expect(result.canRevise).toBe(false)
  })

  test("fact pass + teaching revise → revise (round 0)", () => {
    const result = arbitrate({
      artifactId: "arb-3",
      factAuditStatus: "pass",
      teachingAuditStatus: "revise",
      revisionRound: 0,
    })
    expect(result.decision).toBe("revise")
    expect(result.canRevise).toBe(true)
  })

  test("fact revise + teaching revise → revise (round 1)", () => {
    const result = arbitrate({
      artifactId: "arb-4",
      factAuditStatus: "revise",
      teachingAuditStatus: "revise",
      revisionRound: 1,
    })
    expect(result.decision).toBe("revise")
    expect(result.canRevise).toBe(true)
  })

  test("fact revise → reject when at max round (round 2)", () => {
    const result = arbitrate({
      artifactId: "arb-5",
      factAuditStatus: "revise",
      teachingAuditStatus: "pass",
      revisionRound: 2,
    })
    expect(result.decision).toBe("reject")
    expect(result.canRevise).toBe(false)
    expect(result.reason).toContain("超出上限")
  })

  test("teach reject → reject regardless of fact", () => {
    const result = arbitrate({
      artifactId: "arb-6",
      factAuditStatus: "pass",
      teachingAuditStatus: "reject",
      revisionRound: 0,
    })
    expect(result.decision).toBe("reject")
  })

  test("round 0 revise returns canRevise true", () => {
    const result = arbitrate({
      artifactId: "arb-7",
      factAuditStatus: "revise",
      teachingAuditStatus: "pass",
      revisionRound: 0,
    })
    expect(result.canRevise).toBe(true)
    expect(result.maxRevisionRounds).toBe(2)
  })
})

// ── Week3: 结构化恢复信息 ──

describe("structured recovery fields", () => {
  test("passing audit has empty failedDimensions and canRecover true", async () => {
    const kb = await getKB()
    const result = auditTeaching({
      artifactId: "struct-1",
      learnerProfile: makeProfile({
        level: "beginner",
        known_concepts: ["变量", "数据类型", "条件判断"],
        weak_concepts: ["循环"],
        goal: "学会循环遍历数据",
      }),
      knowledgeBase: kb,
      citedSourceIds: ["K007"],
    })
    expect(result.status).toBe("pass")
    expect(result.failedDimensions).toEqual([])
    expect(result.missingPrerequisiteSourceIds).toEqual([])
    expect(result.unknownPrerequisiteRefs).toEqual([])
    expect(result.requiredAction).toBe("adjust_content")
    expect(result.fixScope).toBe("artifact")
    expect(result.recommendedLevel).toBeNull()
    expect(result.canRecover).toBe(true)
  })

  test("difficulty misaligned → replan_path + recommendedLevel + fixScope new_spec", async () => {
    const kb = await getKB()
    const result = auditTeaching({
      artifactId: "struct-2",
      learnerProfile: makeProfile(),
      knowledgeBase: kb,
      citedSourceIds: ["K018"],  // integrated, learner is beginner
    })
    expect(result.status).toBe("reject")
    expect(result.failedDimensions).toContain("difficulty_alignment")
    expect(result.requiredAction).toBe("replan_path")
    expect(result.fixScope).toBe("new_spec")
    expect(result.recommendedLevel).toBe("intermediate")  // integrated - 1 = intermediate
    expect(result.canRecover).toBe(true)
  })

  test("prerequisites missing → replan_path + missingPrerequisiteSourceIds populated", async () => {
    const kb = await getKB()
    const result = auditTeaching({
      artifactId: "struct-3",
      learnerProfile: makeProfile({ known_concepts: [] }),
      knowledgeBase: kb,
      citedSourceIds: ["K018"],
    })
    expect(result.status).toBe("reject")
    expect(result.failedDimensions).toContain("prerequisite_coverage")
    expect(result.failedDimensions).toContain("difficulty_alignment")
    expect(result.requiredAction).toBe("replan_path")
    expect(result.missingPrerequisiteSourceIds.length).toBeGreaterThan(0)
    // K018 prereqs: K007, K009, K013
    expect(result.missingPrerequisiteSourceIds).toContain("K007")
    expect(result.missingPrerequisiteSourceIds).toContain("K009")
    expect(result.missingPrerequisiteSourceIds).toContain("K013")
  })

  test("pure prerequisite failure is recoverable through a new path spec", async () => {
    const kb = await getKB()
    const result = auditTeaching({
      artifactId: "struct-4",
      learnerProfile: makeProfile({
        level: "integrated",
        known_concepts: [],
        weak_concepts: ["综合项目"],
        goal: "完成成绩统计综合项目",
      }),
      knowledgeBase: kb,
      citedSourceIds: ["K018"],
    })
    expect(result.status).toBe("reject")
    expect(result.failedDimensions).toEqual(["prerequisite_coverage"])
    expect(result.recommendedLevel).toBeNull()
    expect(result.fixScope).toBe("new_spec")
    expect(result.missingPrerequisiteSourceIds).toEqual(["K007", "K009", "K013"])
    expect(result.unknownPrerequisiteRefs).toEqual([])
    expect(result.canRecover).toBe(true)
  })

  test("unknown prerequisite refs remain canonical hard blockers", async () => {
    const kbWithUnknownPrerequisite = structuredClone(await getKB())
    const target = kbWithUnknownPrerequisite.items.find((item) => item.sourceId === "K007")
    if (!target) throw new Error("test knowledge item K007 missing")
    target.prerequisites = ["K999"]

    const result = auditTeaching({
      artifactId: "struct-unknown-prerequisite",
      learnerProfile: makeProfile({
        level: "beginner",
        known_concepts: [],
        weak_concepts: ["循环"],
        goal: "学会循环遍历数据",
      }),
      knowledgeBase: kbWithUnknownPrerequisite,
      citedSourceIds: ["K007"],
    })

    expect(result.status).toBe("reject")
    expect(result.failedDimensions).toEqual(["prerequisite_coverage"])
    expect(result.missingPrerequisiteSourceIds).toEqual([])
    expect(result.unknownPrerequisiteRefs).toEqual(["K999"])
    expect(result.checks.prerequisite.reason).toContain("K999")
    expect(result.canRecover).toBe(false)
  })

  test("weak concept incomplete → adjust_content + fixScope artifact + canRecover true", async () => {
    const kb = await getKB()
    const result = auditTeaching({
      artifactId: "struct-5",
      learnerProfile: makeProfile({
        level: "beginner",
        known_concepts: ["变量", "数据类型", "条件判断"],
        weak_concepts: ["循环", "列表"],
        goal: "学会循环遍历数据",
      }),
      knowledgeBase: kb,
      citedSourceIds: ["K001"],  // Python是什么 — unrelated to weak points
    })
    expect(result.status).toBe("revise")
    expect(result.failedDimensions).toContain("weak_concept_coverage")
    expect(result.requiredAction).toBe("adjust_content")
    expect(result.fixScope).toBe("artifact")
    expect(result.canRecover).toBe(true)
    expect(result.missingPrerequisiteSourceIds).toEqual([])
    expect(result.recommendedLevel).toBeNull()
  })
})

// ── Week3: 路径规划 ──

describe("planRecoveryPath", () => {
  test("difficulty misaligned → lower-difficulty path", async () => {
    const kb = await getKB()
    // K015(文件读写, intermediate) — learner is beginner, but known_concepts cover prereqs
    // K015 prereqs: none explicitly, but let's verify
    const auditResult = auditTeaching({
      artifactId: "plan-1",
      learnerProfile: makeProfile({
        level: "beginner",
        known_concepts: ["变量", "数据类型", "条件判断"],
      }),
      knowledgeBase: kb,
      citedSourceIds: ["K015"],  // intermediate, learner is beginner → difficulty misaligned only
    })
    const result = planRecoveryPath({
      learnerProfile: makeProfile({ level: "beginner" }),
      knowledgeBase: kb,
      auditResult,
      currentPathNode: { target_source_ids: ["K015"], prerequisite_source_ids: [], goal: "学会文件操作" },
    })
    expect(result.pathNode.target_source_ids.length).toBeGreaterThan(0)
    expect(result.pathNode.target_source_ids).not.toContain("K015")  // K015 is excluded because difficulty too high
    expect(result.pathNode.node_id).toContain("RECOVERY")
    expect(result.requiresNewRag).toBe(true)
    expect(result.rationale.length).toBeGreaterThan(0)
  })

  test("prerequisites missing → prerequisite-first path", async () => {
    const kb = await getKB()
    const auditResult = auditTeaching({
      artifactId: "plan-2",
      learnerProfile: makeProfile({ known_concepts: ["变量", "数据类型"] }),
      knowledgeBase: kb,
      citedSourceIds: ["K018"],
    })
    const result = planRecoveryPath({
      learnerProfile: makeProfile({ known_concepts: ["变量", "数据类型"] }),
      knowledgeBase: kb,
      auditResult,
    })
    expect(result.pathNode.target_source_ids.length).toBeGreaterThan(0)
    // Should include the missing prereqs (K007, K009, K013)
    const targetIds = result.pathNode.target_source_ids
    const hasPrereq = targetIds.some((id) => ["K007", "K009", "K013"].includes(id))
    expect(hasPrereq).toBe(true)
    expect(result.rationale).toContain("前置知识缺失")
  })

  test("returns valid LearningPathNode structure", async () => {
    const kb = await getKB()
    const auditResult = auditTeaching({
      artifactId: "plan-3",
      learnerProfile: makeProfile(),
      knowledgeBase: kb,
      citedSourceIds: ["K018"],
    })
    const result = planRecoveryPath({
      learnerProfile: makeProfile(),
      knowledgeBase: kb,
      auditResult,
    })
    expect(result.pathNode.schema_version).toBe("1.0")
    expect(result.pathNode.objectives.length).toBeGreaterThan(0)
    expect(result.pathNode.assessment_blueprint).toBeDefined()
    expect(result.pathNode.assessment_blueprint.tier_1_count).toBeGreaterThan(0)
  })

  test("keeps only semantically related recovery targets instead of filling the target quota", async () => {
    const kb = await getKB()
    const learnerProfile = makeProfile({
      weak_concepts: ["字典"],
      goal: "掌握字典的键值查询",
    })
    const auditResult = auditTeaching({
      artifactId: "plan-semantic-target",
      learnerProfile,
      knowledgeBase: kb,
      citedSourceIds: ["K001"],
    })

    const result = planRecoveryPath({
      learnerProfile,
      knowledgeBase: kb,
      auditResult,
      currentPathNode: {
        target_source_ids: ["K001"],
        prerequisite_source_ids: [],
        goal: learnerProfile.goal,
      },
    })

    expect(result.pathNode.target_source_ids).toEqual(["K010"])
    expect(result.pathNode.target_source_ids).not.toContain("K009")
    expect(result.pathNode.target_source_ids).not.toContain("K011")
  })

  test("returns an explicit unsupported path when the knowledge base has no semantic match", async () => {
    const kb = await getKB()
    const learnerProfile = makeProfile({
      known_concepts: [],
      weak_concepts: ["React 组件", "CSS 网格"],
      goal: "使用 React 构建响应式网页",
    })
    const auditResult = auditTeaching({
      artifactId: "plan-unsupported-domain",
      learnerProfile,
      knowledgeBase: kb,
      citedSourceIds: ["K001"],
    })

    const result = planRecoveryPath({
      learnerProfile,
      knowledgeBase: kb,
      auditResult,
      currentPathNode: {
        target_source_ids: ["K001"],
        prerequisite_source_ids: [],
        goal: learnerProfile.goal,
      },
    })

    expect(result.pathNode.target_source_ids).toEqual([])
    expect(result.pathNode.objectives).toEqual([])
    expect(result.pathNode.node_id).toContain("RECOVERY-UNSUPPORTED")
    expect(result.requiresNewRag).toBe(false)
    expect(result.rationale).toContain("当前知识库中没有")
    expect(result.rationale).toContain("无法自动规划恢复路径")
  })
})

// ── Week3: 学习进展接收 ──

describe("receiveLearningProgress", () => {
  test("accepts valid DynamicFeedbackResult and returns updated profile", () => {
    const result = receiveLearningProgress({
      feedback: {
        schema_version: "1.0",
        feedback_id: "test-feedback-1",
        run_id: "test-run",
        session_id: "test-session",
        submission_id: "test-sub",
        learner_id_hash: "test-learner-001",
        profile_version: "test-run-profile-v1",
        path_node_id: "test-path",
        form_id: "test-form",
        attempt_no: 1,
        round_score: { raw_score: 8, max_score: 10, accuracy: 0.8, evidence_score: 0.75 },
        objective_results: [
          { objective_id: "O1", raw_score: 4, max_score: 5, accuracy: 0.8, evidence_score: 0.8, misconception_tags: [] },
        ],
        grade_result: {
          schema_version: "1.0",
          run_id: "test-run",
          artifact_id: "grade-1",
          artifact_type: "grade_result",
          agent: "tiered-evaluator",
          status: "ready",
          versions: {
            profile_version: "v1",
            kb_version: "v1",
            rag_version: "v1",
            prompt_version: "v1",
            model_config_hash: "abc",
            schema_version: "1.0",
          },
          seed: 42,
          input_refs: [],
          citations: [],
          quality: { schema_ok: true, citation_coverage: 1, objective_coverage: 1, alignment_score: 1 },
          payload: {
            form_id: "test-form",
            submission_id: "test-sub",
            score_frozen: true,
            raw_score: 8,
            max_score: 10,
            evidence_score: 0.75,
            recommendation: { action: "advance", confidence: 0.85, reason_codes: ["round_accuracy_at_or_above_advancement_threshold"] },
            item_results: [{ item_id: "I1", objective_id: "O1", raw_score: 4, max_score: 5, evidence_score: 0.8, grader_confidence: 0.9, hint_factor: 0, repeat_factor: 0, misconception_tags: [], feedback_code: "correct" }],
            feedback: { generated_after_score_freeze: true, mode: "formative", summary: "做得不错", item_feedback: [] },
          },
          trace_ref: "trace-1",
        },
        mastery_snapshot: [
          { objective_id: "O1", mastery: 0.8, evidence_batches: 2, observed_modalities: ["mcq", "trace"], revision: 1 },
        ],
        final_decision: {
          action: "advance",
          basis: "round_accuracy",
          confidence: 0.85,
          reason_codes: ["round_accuracy_at_or_above_advancement_threshold"],
          target_objective_ids: [],
          policy_ref: "role-c-round-accuracy-v1",
        },
      },
      currentProfile: makeProfile({ level: "beginner" }),
      profileVersion: "test-run-profile-v2",
    })

    expect(result.profile.learner_id).toBe("test-learner-001")
    expect(result.snapshot.profile_version).toBe("test-run-profile-v2")
    expect(result.snapshot.schema_version).toBe("1.0")
    expect(result.changes).toBeDefined()
  })

  test("advance action with high mastery promotes learner level", () => {
    const result = receiveLearningProgress({
      feedback: {
        schema_version: "1.0",
        feedback_id: "test-fb-2",
        run_id: "test-run",
        session_id: "test-session",
        submission_id: "test-sub",
        learner_id_hash: "test-learner-001",
        profile_version: "v1",
        path_node_id: "test-path",
        form_id: "test-form",
        attempt_no: 1,
        round_score: { raw_score: 10, max_score: 10, accuracy: 1.0, evidence_score: 0.9 },
        objective_results: [
          { objective_id: "O1", raw_score: 5, max_score: 5, accuracy: 1.0, evidence_score: 0.9, misconception_tags: [] },
        ],
        grade_result: {
          schema_version: "1.0", run_id: "test-run", artifact_id: "grade-2", artifact_type: "grade_result",
          agent: "tiered-evaluator", status: "ready",
          versions: { profile_version: "v1", kb_version: "v1", rag_version: "v1", prompt_version: "v1", model_config_hash: "abc", schema_version: "1.0" },
          seed: 42, input_refs: [], citations: [],
          quality: { schema_ok: true, citation_coverage: 1, objective_coverage: 1, alignment_score: 1 },
          payload: {
            form_id: "test-form", submission_id: "test-sub", score_frozen: true,
            raw_score: 10, max_score: 10, evidence_score: 0.9,
            recommendation: { action: "advance", confidence: 0.9, reason_codes: ["round_accuracy_at_or_above_advancement_threshold"] },
            item_results: [{ item_id: "I1", objective_id: "O1", raw_score: 5, max_score: 5, evidence_score: 0.9, grader_confidence: 0.95, hint_factor: 0, repeat_factor: 0, misconception_tags: [], feedback_code: "excellent" }],
            feedback: { generated_after_score_freeze: true, mode: "summative", summary: "完美", item_feedback: [] },
          },
          trace_ref: "trace-2",
        },
        mastery_snapshot: [
          { objective_id: "O1", mastery: 1.0, evidence_batches: 3, observed_modalities: ["mcq", "trace", "code"], revision: 1 },
        ],
        final_decision: {
          action: "advance", basis: "round_accuracy", confidence: 0.9,
          reason_codes: ["round_accuracy_at_or_above_advancement_threshold"], target_objective_ids: [], policy_ref: "role-c-round-accuracy-v1",
        },
      },
      currentProfile: makeProfile({ level: "beginner" }),
      profileVersion: "test-run-profile-v2",
    })

    expect(result.changes.levelChanged).toBe(true)
    expect(result.changes.oldLevel).toBe("beginner")
    expect(result.changes.newLevel).toBe("basic")
  })

  test("remediate action with low accuracy demotes learner level", () => {
    const result = receiveLearningProgress({
      feedback: {
        schema_version: "1.0",
        feedback_id: "test-fb-3",
        run_id: "test-run", session_id: "test-session", submission_id: "test-sub",
        learner_id_hash: "test-learner-001", profile_version: "v1", path_node_id: "test-path",
        form_id: "test-form", attempt_no: 1,
        round_score: { raw_score: 1, max_score: 10, accuracy: 0.1, evidence_score: 0.1 },
        objective_results: [
          { objective_id: "O1", raw_score: 1, max_score: 5, accuracy: 0.2, evidence_score: 0.1, misconception_tags: [] },
        ],
        grade_result: {
          schema_version: "1.0", run_id: "test-run", artifact_id: "grade-3", artifact_type: "grade_result",
          agent: "tiered-evaluator", status: "ready",
          versions: { profile_version: "v1", kb_version: "v1", rag_version: "v1", prompt_version: "v1", model_config_hash: "abc", schema_version: "1.0" },
          seed: 42, input_refs: [], citations: [],
          quality: { schema_ok: true, citation_coverage: 1, objective_coverage: 1, alignment_score: 1 },
          payload: {
            form_id: "test-form", submission_id: "test-sub", score_frozen: true,
            raw_score: 1, max_score: 10, evidence_score: 0.1,
            recommendation: { action: "remediate", confidence: 0.75, reason_codes: ["round_accuracy_below_remediation_threshold"] },
            item_results: [{ item_id: "I1", objective_id: "O1", raw_score: 1, max_score: 5, evidence_score: 0.1, grader_confidence: 0.6, hint_factor: 0, repeat_factor: 0, misconception_tags: ["K007"], feedback_code: "needs_review" }],
            feedback: { generated_after_score_freeze: true, mode: "formative", summary: "需加强", item_feedback: [] },
          },
          trace_ref: "trace-3",
        },
        mastery_snapshot: [
          { objective_id: "O1", mastery: 0.1, evidence_batches: 1, observed_modalities: ["mcq"], revision: 1 },
        ],
        final_decision: {
          action: "remediate", basis: "round_accuracy", confidence: 0.75,
          reason_codes: ["round_accuracy_below_remediation_threshold"],
          target_objective_ids: ["O1"], policy_ref: "role-c-round-accuracy-v1",
        },
      },
      currentProfile: makeProfile({ level: "basic" }),
      profileVersion: "v2",
    })

    expect(result.changes.levelChanged).toBe(true)
    expect(result.changes.oldLevel).toBe("basic")
    expect(result.changes.newLevel).toBe("beginner")
  })
})

describe("RoleBLearningProgressAdapter", () => {
  test("commits a C envelope once, updates concepts, and returns an exact duplicate ACK on replay", async () => {
    const kb = await getKB()
    const adapter = makeProgressAdapter(kb, {
      weak_concepts: ["for 循环"],
      level: "beginner",
    })
    const event = makeProgressEvent({
      eventId: "EVENT-ACCEPTED",
      evidenceScore: 0.9,
      action: "advance",
    })

    const accepted = await deliverRoleCToB(adapter, [event])
    const acceptedState = adapter.getCurrentState("learner-hash")

    expect(accepted).toEqual({
      schema_version: "1.0",
      delivery_kind: "learning_progress",
      delivery_id: accepted.delivery_id,
      status: "accepted",
    })
    expect(Object.keys(accepted).sort()).toEqual([
      "delivery_id",
      "delivery_kind",
      "schema_version",
      "status",
    ])
    expect(acceptedState?.profileRevision).toBe(2)
    expect(acceptedState?.profileVersion).toMatch(/^role-b-profile-v2-[a-f0-9]{12}$/)
    expect(acceptedState?.currentProfile.known_concepts).toContain("for 循环")
    expect(acceptedState?.currentProfile.weak_concepts).not.toContain("for 循环")
    // C 的事件信封没有完整轮次正确率，B 不据此推断 level。
    expect(acceptedState?.currentProfile.level).toBe("beginner")
    expect(adapter.getCurrentSnapshot("learner-hash")?.profile_version)
      .toBe(acceptedState?.profileVersion)

    const duplicate = await deliverRoleCToB(adapter, [structuredClone(event)])
    expect(duplicate).toEqual({
      schema_version: "1.0",
      delivery_kind: "learning_progress",
      delivery_id: accepted.delivery_id,
      status: "duplicate",
    })
    expect(adapter.getCurrentState("learner-hash")).toEqual(acceptedState)
  })

  test("serializes concurrent replays so exactly one commit advances the revision", async () => {
    const adapter = makeProgressAdapter(await getKB())
    const event = makeProgressEvent({ eventId: "EVENT-CONCURRENT" })

    const acknowledgements = await Promise.all([
      deliverRoleCToB(adapter, [structuredClone(event)]),
      deliverRoleCToB(adapter, [structuredClone(event)]),
    ])

    expect(acknowledgements.map((ack) => ack.status).sort()).toEqual(["accepted", "duplicate"])
    expect(adapter.getCurrentState("learner-hash")?.profileRevision).toBe(2)
  })

  test("does not demote mastered component concepts when a composite project is weak", async () => {
    const adapter = makeProgressAdapter(await getKB(), {
      known_concepts: ["列表", "函数"],
      weak_concepts: [],
    })

    await deliverRoleCToB(adapter, [
      makeProgressEvent({
        eventId: "EVENT-WEAK-PROJECT",
        sourceId: "K018",
        objectiveId: "OBJECTIVE-K018",
        evidenceScore: 0,
        action: "reinforce",
      }),
    ])

    const profile = adapter.getCurrentProfile("learner-hash")
    expect(profile?.known_concepts).toEqual(["列表", "函数"])
    expect(profile?.weak_concepts).toContain("成绩统计器综合项目")
  })

  test("matches an ambiguous component concept by knowledge semantics instead of source-id order", async () => {
    const adapter = makeProgressAdapter(await getKB(), {
      known_concepts: ["循环"],
      weak_concepts: [],
    })

    await deliverRoleCToB(adapter, [
      makeProgressEvent({
        eventId: "EVENT-WEAK-WHILE",
        sourceId: "K008",
        objectiveId: "OBJECTIVE-K008",
        evidenceScore: 0,
        action: "reinforce",
      }),
    ])

    const profile = adapter.getCurrentProfile("learner-hash")
    expect(profile?.known_concepts).not.toContain("循环")
    expect(profile?.weak_concepts).toContain("while 循环")
  })

  test("rejects a different delivery based on a stale profile version without changing state", async () => {
    const adapter = makeProgressAdapter(await getKB())
    await deliverRoleCToB(adapter, [
      makeProgressEvent({ eventId: "EVENT-FIRST", evidenceScore: 0.8 }),
    ])
    const committedState = adapter.getCurrentState("learner-hash")

    await expect(deliverRoleCToB(adapter, [
      makeProgressEvent({
        eventId: "EVENT-STALE",
        profileVersion: "profile-v1",
        evidenceScore: 0.2,
        action: "remediate",
      }),
    ])).rejects.toThrow("ROLE_B_PROGRESS_PROFILE_VERSION_MISMATCH")
    expect(adapter.getCurrentState("learner-hash")).toEqual(committedState)
  })

  test("accepts a drift-only envelope and produces the next B snapshot", async () => {
    const adapter = makeProgressAdapter(await getKB())
    const profileBefore = adapter.getCurrentProfile("learner-hash")
    const ack = await deliverRoleCToB(adapter, [], makeProfileDrift())

    expect(ack.status).toBe("accepted")
    expect(adapter.getCurrentProfile("learner-hash")).toEqual(profileBefore)
    expect(adapter.getCurrentState("learner-hash")?.profileRevision).toBe(2)
    expect(adapter.getCurrentSnapshot("learner-hash")?.provenance_ref)
      .toContain(ack.delivery_id)
  })

  test("rejects forged hashes, mixed identities, mixed recommendations, and unknown sources", async () => {
    const kb = await getKB()

    const forgedHashAdapter = makeProgressAdapter(kb)
    const forgedHash = makeProgressDelivery([
      makeProgressEvent({ eventId: "EVENT-FORGED-HASH" }),
    ])
    forgedHash.delivery_id = `sha256:${"0".repeat(64)}`
    await expect(forgedHashAdapter.publishLearningProgress(forgedHash))
      .rejects.toThrow("ROLE_B_PROGRESS_DELIVERY_HASH_MISMATCH")

    const mixedIdentityAdapter = makeProgressAdapter(kb)
    const mixedIdentity = makeProgressDelivery([
      makeProgressEvent({ eventId: "EVENT-IDENTITY-1" }),
      makeProgressEvent({
        eventId: "EVENT-IDENTITY-2",
        learnerIdHash: "another-learner",
      }),
    ])
    await expect(mixedIdentityAdapter.publishLearningProgress(mixedIdentity))
      .rejects.toThrow("ROLE_B_PROGRESS_EVENT_IDENTITY_MISMATCH")

    const mixedRecommendationAdapter = makeProgressAdapter(kb)
    const mixedRecommendation = makeProgressDelivery([
      makeProgressEvent({ eventId: "EVENT-ACTION-1", action: "advance" }),
      makeProgressEvent({ eventId: "EVENT-ACTION-2", action: "reinforce" }),
    ])
    await expect(mixedRecommendationAdapter.publishLearningProgress(mixedRecommendation))
      .rejects.toThrow("ROLE_B_PROGRESS_RECOMMENDATION_MISMATCH")

    const unknownSourceAdapter = makeProgressAdapter(kb)
    const unknownSource = makeProgressDelivery([
      makeProgressEvent({ eventId: "EVENT-UNKNOWN-SOURCE", sourceId: "K999" }),
    ])
    await expect(unknownSourceAdapter.publishLearningProgress(unknownSource))
      .rejects.toThrow("ROLE_B_PROGRESS_SOURCE_UNKNOWN:K999")
  })
})

function makeProgressAdapter(
  knowledgeBase: KnowledgeBase,
  profileOverrides: Partial<LearnerProfile> = {},
): RoleBLearningProgressAdapter {
  return new RoleBLearningProgressAdapter({
    knowledgeBase,
    learners: [{
      learnerIdHash: "learner-hash",
      currentProfile: makeProfile(profileOverrides),
      profileVersion: "profile-v1",
      profileRevision: 1,
    }],
  })
}

function makeProgressEvent(options: {
  eventId: string
  learnerIdHash?: string
  profileVersion?: string
  sourceId?: string
  objectiveId?: string
  evidenceScore?: number
  action?: LearningEvidenceEvent["recommendation"]["action"]
}): LearningEvidenceEvent {
  const learnerIdHash = options.learnerIdHash ?? "learner-hash"
  const profileVersion = options.profileVersion ?? "profile-v1"
  const sourceId = options.sourceId ?? "K007"
  const objectiveId = options.objectiveId ?? "OBJECTIVE-K007"
  const evidenceScore = options.evidenceScore ?? 0.8
  const action = options.action ?? "reinforce"
  return {
    schema_version: "1.0",
    event_id: options.eventId,
    learner_id_hash: learnerIdHash,
    profile_version: profileVersion,
    path_node_id: "PATH-1",
    objective_id: objectiveId,
    source_id: sourceId,
    evidence: {
      modality: "mcq",
      raw_score: evidenceScore,
      evidence_score: evidenceScore,
      grader_confidence: 0.9,
      hint_level: 0,
      attempt_no: 1,
    },
    misconceptions: evidenceScore <= 0.3 ? ["concept_not_yet_mastered"] : [],
    recommendation: {
      action,
      confidence: 0.9,
      reason_codes: [`test_${action}`],
    },
    provenance: {
      artifact_id: `GRADE-${options.eventId}`,
      idempotency_key: contentHash({ eventId: options.eventId }),
      item_id: `ITEM-${options.eventId}`,
      grader_version: "test-grader-v1",
    },
  }
}

function makeProfileDrift(): ProfileDriftSuggestion {
  return {
    schema_version: "1.0",
    suggestion_id: "DRIFT-1",
    learner_id_hash: "learner-hash",
    profile_version: "profile-v1",
    conflicting_objective_ids: ["OBJECTIVE-K007"],
    reason_codes: ["repeated_profile_evidence_conflict"],
    confidence: 0.9,
    action: "reprofile",
  }
}

function makeProgressDelivery(
  events: LearningEvidenceEvent[],
  drift?: ProfileDriftSuggestion,
): RoleCLearningProgressDelivery {
  if (events.length === 0 && !drift) throw new Error("test delivery cannot be empty")
  const identity = events[0] ?? drift!
  const base = {
    schema_version: "1.0" as const,
    delivery_kind: "learning_progress" as const,
    learner_id_hash: identity.learner_id_hash,
    profile_version: identity.profile_version,
  }
  const body = events.length > 0
    ? {
      ...base,
      evidence_events: structuredClone(events) as [LearningEvidenceEvent, ...LearningEvidenceEvent[]],
      ...(drift ? { profile_drift_suggestion: structuredClone(drift) } : {}),
    }
    : {
      ...base,
      evidence_events: [] as [],
      profile_drift_suggestion: structuredClone(drift!),
    }
  return {
    ...body,
    delivery_id: contentHash(body),
  }
}
