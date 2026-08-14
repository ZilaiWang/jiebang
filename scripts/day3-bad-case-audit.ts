// 4号 Day3 验收脚本：构造坏样例（缺引用/引用造假/难度过高）+ 好样例对照 + 降级分支验证，
// 喂给 A 事实审核（auditGeneratedContent）、B 教学审核（auditTeaching）、
// B 学习进展接收器（applyProgressObservation 的降级逻辑），
// 记录期望 vs 实际，输出 bad-case-tests.json。
import { auditGeneratedContent } from "../src/fact-audit/auditor"
import { auditTeaching } from "../src/role-b-profile/teaching-audit"
import { applyProgressObservation } from "../src/role-b-profile/teaching-audit/progress-receiver"
import { PYTHON_BASIC_KNOWLEDGE_BASE } from "../src/knowledge/python-basic"
import { writeFileSync, mkdirSync } from "node:fs"
import { resolve } from "node:path"

const OUTPUT_DIR = resolve(process.cwd(), ".tmp/competition-sprint/day3-anti-hallucination")

// 用知识库全部 facts 构造 RAG 证据（buildEvidenceIndex 只吃 results[].facts）
const allFacts = PYTHON_BASIC_KNOWLEDGE_BASE.items.flatMap((item) => item.facts)
const ragResult = { results: [{ facts: allFacts }] } as any

type Case = {
  case_id: string
  kind: "fact_audit" | "teaching_audit" | "progress_downgrade"
  label: string
  description: string
  expected: { verdict: string; status: string }
  run: () => { verdict: string; status: string; detail: string }
}

const cases: Case[] = [
  // ── A 事实审核 ──
  {
    case_id: "bad-1-missing-citation",
    kind: "fact_audit",
    label: "坏样例1·缺引用",
    description: "讲义知识陈述完全没有 source_id/fact_id 引用",
    expected: { verdict: "missing_citation", status: "revise" },
    run: () => {
      const r = auditGeneratedContent({
        artifactId: "bad-1",
        ragResult,
        generatedContent: {
          blocks: [{
            blockId: "b1",
            text: "for 循环可以遍历列表中的元素，是 Python 最常用的循环结构。",
            citations: [],
          }],
        },
      })
      const c = r.checkedClaims[0]
      return { verdict: c?.verdict ?? "-", status: r.status, detail: c?.reason ?? "-" }
    },
  },
  {
    case_id: "bad-2-fake-citation",
    kind: "fact_audit",
    label: "坏样例2·引用造假（张冠李戴）",
    description: "引用 K001（Python是什么），但陈述的是 K010 字典的内容，引用不支持陈述",
    expected: { verdict: "unsupported", status: "reject" },
    run: () => {
      const r = auditGeneratedContent({
        artifactId: "bad-2",
        ragResult,
        generatedContent: {
          blocks: [{
            blockId: "b2",
            text: "字典使用键值对保存数据，适合根据唯一键快速查找对应值。",
            citations: [{ source_id: "K001", fact_id: "F001" }],
          }],
        },
      })
      const c = r.checkedClaims[0]
      return { verdict: c?.verdict ?? "-", status: r.status, detail: c?.reason ?? "-" }
    },
  },
  {
    case_id: "good-1-correct-citation",
    kind: "fact_audit",
    label: "好样例1·正确引用",
    description: "引用 K007:F001，陈述与引用事实词面一致",
    expected: { verdict: "supported", status: "pass" },
    run: () => {
      const r = auditGeneratedContent({
        artifactId: "good-1",
        ragResult,
        generatedContent: {
          blocks: [{
            blockId: "g1",
            text: "for 循环常用于遍历序列中的元素。",
            citations: [{ source_id: "K007", fact_id: "F001" }],
          }],
        },
      })
      const c = r.checkedClaims[0]
      return { verdict: c?.verdict ?? "-", status: r.status, detail: c?.reason ?? "-" }
    },
  },

  // ── B 教学审核 ──
  {
    case_id: "bad-3-difficulty-too-high",
    kind: "teaching_audit",
    label: "坏样例3·难度过高",
    description: "零基础学习者(beginner)被安排学习文件读写(intermediate)，跨 2 档",
    expected: { verdict: "misaligned", status: "reject" },
    run: () => {
      const r = auditTeaching({
        artifactId: "bad-3",
        learnerProfile: {
          learner_id: "zero-beginner",
          level: "beginner",
          known_concepts: [],
          weak_concepts: ["变量", "输入输出"],
          goal: "零基础学 Python 入门",
        },
        knowledgeBase: PYTHON_BASIC_KNOWLEDGE_BASE,
        citedSourceIds: ["K015"],
      })
      return {
        verdict: r.checks.difficulty.verdict,
        status: r.status,
        detail: r.checks.difficulty.reason,
      }
    },
  },
  {
    case_id: "good-2-correct-teaching",
    kind: "teaching_audit",
    label: "好样例2·正确教学",
    description: "beginner 学 for 循环(beginner)，前置已掌握，覆盖薄弱点，目标对齐",
    expected: { verdict: "aligned", status: "pass" },
    run: () => {
      const r = auditTeaching({
        artifactId: "good-2",
        learnerProfile: {
          learner_id: "cs-basic",
          level: "beginner",
          known_concepts: ["变量", "数据类型", "输入输出", "运算符"],
          weak_concepts: ["循环"],
          goal: "学习 for 循环遍历列表",
        },
        knowledgeBase: PYTHON_BASIC_KNOWLEDGE_BASE,
        citedSourceIds: ["K007"],
      })
      return {
        verdict: r.checks.difficulty.verdict,
        status: r.status,
        detail: r.summary,
      }
    },
  },

  // ── B 学习进展降级（Day3 "降级"分支）──
  {
    case_id: "downgrade-1-concept",
    kind: "progress_downgrade",
    label: "降级样例1·概念降级",
    description: "已知概念「变量」持续不达标(evidenceScore≤0.3)→ 降级为薄弱点",
    expected: { verdict: "concept_downgraded", status: "triggered" },
    run: () => {
      const r = applyProgressObservation({
        observation: {
          observationId: "downgrade-concept",
          action: "remediate",
          overallAccuracy: 0.5, // 故意设高，避免 level 也降，只测概念降级
          mastery: [],
          conceptEvidence: [{
            sourceId: "K002",
            concept: "变量",
            evidenceScore: 0.2, // ≤ 0.3 → 触发概念降级
            evidenceBatches: 2,
          }],
        },
        currentProfile: {
          learner_id: "downgrade-concept-learner",
          level: "basic",
          known_concepts: ["变量"],
          weak_concepts: [],
          goal: "学 Python",
        },
        profileVersion: "1",
      })
      const downgraded = r.profile.weak_concepts.includes("变量")
        && !r.profile.known_concepts.includes("变量")
      return {
        verdict: downgraded ? "concept_downgraded" : "no_downgrade",
        status: downgraded ? "triggered" : "not_triggered",
        detail: `known=[${r.profile.known_concepts.join(",")}] weak=[${r.profile.weak_concepts.join(",")}]`,
      }
    },
  },
  {
    case_id: "downgrade-2-level",
    kind: "progress_downgrade",
    label: "降级样例2·水平降档",
    description: "decision=remediate 且 accuracy<0.3 → 学习者水平降一档",
    expected: { verdict: "level_downgraded", status: "triggered" },
    run: () => {
      const r = applyProgressObservation({
        observation: {
          observationId: "downgrade-level",
          action: "remediate",
          overallAccuracy: 0.1, // < 0.3 → 触发 level 降级
          mastery: [],
          conceptEvidence: [], // 空，避免概念变化干扰
        },
        currentProfile: {
          learner_id: "downgrade-level-learner",
          level: "intermediate",
          known_concepts: [],
          weak_concepts: [],
          goal: "学 Python",
        },
        profileVersion: "1",
      })
      const downgraded = r.changes.levelChanged && r.changes.newLevel === "basic"
      return {
        verdict: downgraded ? "level_downgraded" : "no_downgrade",
        status: downgraded ? "triggered" : "not_triggered",
        detail: `level ${r.changes.oldLevel} → ${r.changes.newLevel}`,
      }
    },
  },
]

const results = cases.map((c) => {
  const actual = c.run()
  const hit =
    (actual.verdict === c.expected.verdict || c.expected.verdict === "*") &&
    actual.status === c.expected.status
  return {
    case_id: c.case_id,
    kind: c.kind,
    label: c.label,
    description: c.description,
    expected: c.expected,
    actual,
    hit,
  }
})

const badCases = results.filter((r) => r.case_id.startsWith("bad-"))
const goodCases = results.filter((r) => r.case_id.startsWith("good-"))
const downgradeCases = results.filter((r) => r.case_id.startsWith("downgrade-"))
const badHit = badCases.filter((r) => r.hit).length
const goodHit = goodCases.filter((r) => r.hit).length
const downgradeHit = downgradeCases.filter((r) => r.hit).length

const summary = {
  total_cases: results.length,
  bad_cases: badCases.length,
  bad_cases_detected: badHit,
  good_cases: goodCases.length,
  good_cases_passed: goodHit,
  downgrade_cases: downgradeCases.length,
  downgrade_cases_triggered: downgradeHit,
  all_pass: results.every((r) => r.hit),
}

const output = {
  workflow: "Day3_Bad_Case_Acceptance",
  generated_at: new Date().toISOString(),
  summary,
  results,
}

mkdirSync(OUTPUT_DIR, { recursive: true })
writeFileSync(resolve(OUTPUT_DIR, "bad-case-tests.json"), JSON.stringify(output, null, 2), "utf-8")

// 控制台摘要
console.log("\n========== Day3 坏样例验收结果 ==========")
for (const r of results) {
  const mark = r.hit ? "✅ 命中" : "❌ 未命中"
  console.log(`${mark}  ${r.label}`)
  console.log(`      期望: ${r.expected.verdict}/${r.expected.status} → 实际: ${r.actual.verdict}/${r.actual.status}`)
  if (!r.hit) console.log(`      实际详情: ${r.actual.detail}`)
}
console.log(`\n坏样例命中 ${badHit}/${badCases.length}，好样例通过 ${goodHit}/${goodCases.length}，降级触发 ${downgradeHit}/${downgradeCases.length}`)
console.log(summary.all_pass ? "✅ 全部符合预期" : "❌ 存在不符合预期的样例")
console.log("==========================================\n")
