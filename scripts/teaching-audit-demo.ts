// 教学审核 + 仲裁 Demo（B 角色 Week2）
// 演示四种典型场景：双通过、教学驳回、教学需修订、仲裁多轮
// 无需模型凭证，纯确定性逻辑
import { loadKnowledgeBase } from "../src/knowledge/loader"
import { retrieveKnowledge } from "../src/rag/retriever"
import { auditGeneratedContent } from "../src/fact-audit/auditor"
import { auditTeaching } from "../src/role-b-profile/teaching-audit/auditor"
import { arbitrate } from "../src/role-b-profile/teaching-audit/arbitrator"

const kb = await loadKnowledgeBase()

// ── 场景 1: 理想情况 — 内容适合学习者，事实审核也通过 ──
console.log("=".repeat(60))
console.log("场景 1: 双通过 — 教学内容匹配学习者，事实引用正确")
console.log("=".repeat(60))

const rag1 = await retrieveKnowledge({ query: "初学者学习for循环遍历列表", learnerLevel: "beginner", topK: 3 })

// 用真实 RAG 结果中的 facts 构造 blocks，确保事实审核通过
const realFacts1 = rag1.results.flatMap(r => r.facts)
const block1 = realFacts1[0] ? {
  blockId: "claim-1",
  text: realFacts1[0].content,
  citations: [{ source_id: realFacts1[0].sourceId ?? realFacts1[0].source_id!, fact_id: realFacts1[0].factId ?? realFacts1[0].fact_id! }],
} : null
const block2 = realFacts1[1] ? {
  blockId: "claim-2",
  text: realFacts1[1].content,
  citations: [{ source_id: realFacts1[1].sourceId ?? realFacts1[1].source_id!, fact_id: realFacts1[1].factId ?? realFacts1[1].fact_id! }],
} : null

const factAudit1 = auditGeneratedContent({
  artifactId: "concept-for-loop",
  ragResult: rag1,
  generatedContent: {
    blocks: [block1, block2].filter((b): b is NonNullable<typeof b> => b != null),
  },
})

const citedSourceIds1 = [...new Set(factAudit1.checkedClaims.flatMap(c => c.citations.map(ci => ci.source_id)))]

const teachAudit1 = auditTeaching({
  artifactId: "concept-for-loop",
  learnerProfile: {
    learner_id: "demo-learner-1",
    level: "beginner",
    known_concepts: ["变量", "数据类型"],
    weak_concepts: ["循环"],
    goal: "学会循环遍历数据",
  },
  knowledgeBase: kb,
  citedSourceIds: citedSourceIds1,
})

const arb1 = arbitrate({
  artifactId: "concept-for-loop",
  factAuditStatus: factAudit1.status,
  teachingAuditStatus: teachAudit1.status,
  revisionRound: 0,
})

console.log(JSON.stringify({
  scenario: "ideal_dual_pass",
  factAudit: { status: factAudit1.status, checkedClaims: factAudit1.checkedClaims.length },
  teachingAudit: {
    status: teachAudit1.status,
    difficulty: teachAudit1.checks.difficulty.verdict,
    prerequisite: teachAudit1.checks.prerequisite.verdict,
    weakConcept: teachAudit1.checks.weakConcept.verdict,
    goal: teachAudit1.checks.goal.verdict,
  },
  arbitration: { decision: arb1.decision, reason: arb1.reason },
}, null, 2))

// ── 场景 2: 教学驳回 — 内容难度远超学习者水平 ──
console.log("\n" + "=".repeat(60))
console.log("场景 2: 教学驳回 — beginner 学习者被喂了 integrated 综合项目")
console.log("=".repeat(60))

const teachAudit2 = auditTeaching({
  artifactId: "project-too-hard",
  learnerProfile: {
    learner_id: "demo-learner-2",
    level: "beginner",
    known_concepts: ["变量", "数据类型"],
    weak_concepts: ["循环"],
    goal: "做一个成绩统计程序",
  },
  knowledgeBase: kb,
  citedSourceIds: ["K018"],  // 成绩统计器综合项目(integrated) — 远超 beginner
})

const arb2 = arbitrate({
  artifactId: "project-too-hard",
  factAuditStatus: "pass",  // 假设事实引用正确
  teachingAuditStatus: teachAudit2.status,
  revisionRound: 0,
})

console.log(JSON.stringify({
  scenario: "teaching_reject_difficulty",
  teachingAudit: {
    status: teachAudit2.status,
    difficulty: teachAudit2.checks.difficulty.verdict,
    reason: teachAudit2.checks.difficulty.reason,
  },
  arbitration: { decision: arb2.decision, reason: arb2.reason },
}, null, 2))

// ── 场景 3: 教学需修订 — 内容没错但没覆盖薄弱点 ──
console.log("\n" + "=".repeat(60))
console.log("场景 3: 教学需修订 — 学习者弱在循环，但内容讲的是变量基础")
console.log("=".repeat(60))

const teachAudit3 = auditTeaching({
  artifactId: "missed-weak-points",
  learnerProfile: {
    learner_id: "demo-learner-3",
    level: "beginner",
    known_concepts: ["变量", "数据类型", "条件判断"],
    weak_concepts: ["循环", "列表"],
    goal: "学会循环遍历数据",
  },
  knowledgeBase: kb,
  citedSourceIds: ["K001", "K002"],  // Python是什么 + 变量 — 无循环/列表
})

const arb3 = arbitrate({
  artifactId: "missed-weak-points",
  factAuditStatus: "pass",
  teachingAuditStatus: teachAudit3.status,
  revisionRound: 0,
})

console.log(JSON.stringify({
  scenario: "teaching_revise_weak",
  teachingAudit: {
    status: teachAudit3.status,
    weakConcept: teachAudit3.checks.weakConcept,
  },
  arbitration: { decision: arb3.decision, reason: arb3.reason, canRevise: arb3.canRevise },
  revisionHints: teachAudit3.revisionHints,
}, null, 2))

// ── 场景 4: 仲裁多轮 — 修订到第 2 轮仍 revise，转为 reject ──
console.log("\n" + "=".repeat(60))
console.log("场景 4: 仲裁多轮 — 第 2 轮修订后仍 revise → 转为 reject")
console.log("=".repeat(60))

for (let round = 0; round <= 2; round++) {
  const arb = arbitrate({
    artifactId: "stubborn-revision",
    factAuditStatus: "revise",
    teachingAuditStatus: "revise",
    revisionRound: round,
  })
  console.log(`  第 ${round} 轮修订后: 裁决=${arb.decision}, 可继续=${arb.canRevise}, 原因: ${arb.reason}`)
}

console.log("\n✅ Demo 完成。四种场景: 双通过 / 教学驳回 / 需修订 / 仲裁上限。")
