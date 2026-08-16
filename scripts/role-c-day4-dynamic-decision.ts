/**
 * Day 4 验收：动态诊断 + 画像反填 + 动态筛题。
 *
 * 用真实知识库跑三组不同学习者（零基础 / 基础薄弱 / 项目目标），
 * 证明系统真的个性化：不同学习者得到不同的画像反填结果和不同的诊断筛题。
 *
 * 产出（.tmp/competition-sprint/day4-dynamic-decision/）：
 *   - profile-from-diagnosis.json   画像反填结果（客观诊断覆盖自评 + 冲突记录）
 *   - dynamic-diagnosis-selection.json 动态筛题结果（画像薄弱 → 筛哪些知识点）
 *
 * 用法：bun scripts/role-c-day4-dynamic-decision.ts
 */
import { mkdir } from "node:fs/promises"
import { resolve } from "node:path"
import { loadKnowledgeBase } from "../src/knowledge/loader"
import { selectDiagnosticEvidenceTargets } from "../src/knowledge/diagnostic-selector"
import { synthesizeProfile } from "../src/role-b-profile/profile-synthesizer"
import type {
  BackgroundEvidence,
  DiagnosisVerdict,
  KnowledgeDifficulty,
  ObjectiveDiagnosisEvidence,
  SelfAssessmentEvidence,
} from "../src/role-b-profile/types"

interface Scenario {
  learner_id: string
  label: string
  goal: string
  self_rating: KnowledgeDifficulty
  claimed_known: string[]
  claimed_weak: string[]
  diagnosis: Array<{ source_id: string; verdict: DiagnosisVerdict }>
  target_source_ids: string[]
  prerequisite_source_ids: string[]
  max_items: number
}

const SCENARIOS: Scenario[] = [
  {
    learner_id: "golden-zero-beginner",
    label: "零基础学习者",
    goal: "从零开始学习 Python，能写一个简单的成绩统计程序",
    self_rating: "beginner",
    claimed_known: [],
    claimed_weak: [],
    diagnosis: [
      { source_id: "K004", verdict: "incorrect" },
      { source_id: "K007", verdict: "incorrect" },
      { source_id: "K009", verdict: "incorrect" },
    ],
    target_source_ids: ["K007", "K009", "K018"],
    prerequisite_source_ids: ["K002", "K003"],
    max_items: 5,
  },
  {
    learner_id: "golden-basic-weak",
    label: "基础薄弱学习者（自称会 for 但客观答错）",
    goal: "完成循环和列表的成绩统计练习，掌握函数封装",
    self_rating: "basic",
    claimed_known: ["变量与赋值", "for 循环"],
    claimed_weak: ["列表"],
    diagnosis: [
      { source_id: "K002", verdict: "correct" },
      { source_id: "K007", verdict: "incorrect" },
      { source_id: "K009", verdict: "incorrect" },
    ],
    target_source_ids: ["K007", "K009", "K018"],
    prerequisite_source_ids: ["K002", "K003"],
    max_items: 5,
  },
  {
    learner_id: "golden-project-goal",
    label: "项目目标学习者（三题全对）",
    goal: "用 Python 完成成绩统计器综合项目",
    self_rating: "intermediate",
    claimed_known: ["for 循环", "列表", "函数定义与调用"],
    claimed_weak: [],
    diagnosis: [
      { source_id: "K007", verdict: "correct" },
      { source_id: "K009", verdict: "correct" },
      { source_id: "K013", verdict: "correct" },
    ],
    target_source_ids: ["K018"],
    prerequisite_source_ids: ["K007", "K009", "K013"],
    max_items: 5,
  },
]

const outputDir = resolve(process.cwd(), ".tmp/competition-sprint/day4-dynamic-decision")
await mkdir(outputDir, { recursive: true })

const knowledgeBase = await loadKnowledgeBase()
const itemById = new Map(knowledgeBase.items.map((item) => [item.sourceId, item]))

const profileRows: unknown[] = []
const selectionRows: unknown[] = []

for (const scenario of SCENARIOS) {
  const diagnosisItems = scenario.diagnosis.map((entry) => {
    const item = itemById.get(entry.source_id)
    if (!item) throw new Error(`知识库缺少 ${entry.source_id}`)
    return {
      source_id: entry.source_id,
      fact_id: item.facts[0]?.factId ?? null,
      question: `诊断题：${item.title}`,
      learner_answer: entry.verdict === "unanswered" ? null : (entry.verdict === "correct" ? "正确答案" : "错误答案"),
      verdict: entry.verdict,
      concept: item.title,
      difficulty: item.difficulty,
    }
  })

  const background: BackgroundEvidence = {
    evidence_type: "background",
    learner_id: scenario.learner_id,
    education_context: null,
    prior_languages: [],
    prior_topics: [],
    goal_raw: scenario.goal,
    time_budget: null,
    quotes: [],
  }
  const selfAssessment: SelfAssessmentEvidence = {
    evidence_type: "self_assessment",
    self_rating: scenario.self_rating,
    claimed_known: [...scenario.claimed_known],
    claimed_weak: [...scenario.claimed_weak],
    quotes: [],
  }
  const objectiveDiagnosis: ObjectiveDiagnosisEvidence = {
    evidence_type: "objective_diagnosis",
    items: diagnosisItems,
    quotes: [],
  }

  const synthesis = synthesizeProfile({
    background,
    selfAssessment,
    objectiveDiagnosis,
    knowledgeBase,
  })

  // 动态筛题：以「画像反填后的薄弱概念」作为历史薄弱来源，看筛题是否随画像变化。
  // 这是跨轮次闭环的关键：诊断结果反填进画像的 weak，画像的 weak 再驱动下一轮筛题。
  const weakSourceIds = [...new Set(
    synthesis.provenance.concepts
      .filter((concept) => concept.bucket === "weak")
      .flatMap((concept) => concept.matched_source_ids),
  )]
  const selection = selectDiagnosticEvidenceTargets({
    knowledgeBase,
    target_source_ids: [...scenario.target_source_ids],
    prerequisite_source_ids: [...scenario.prerequisite_source_ids],
    learner_memory: { weak_source_ids: weakSourceIds },
    max_items: scenario.max_items,
  })

  profileRows.push({
    learner_id: scenario.learner_id,
    label: scenario.label,
    goal: scenario.goal,
    self_rating: scenario.self_rating,
    claimed_known: scenario.claimed_known,
    claimed_weak: scenario.claimed_weak,
    diagnosis_verdicts: scenario.diagnosis.map((entry) => ({ source_id: entry.source_id, verdict: entry.verdict })),
    resolved_level: synthesis.profile.level,
    level_rule: synthesis.provenance.level.rule,
    known_concepts: synthesis.profile.known_concepts,
    weak_concepts: synthesis.profile.weak_concepts,
    conflicts: synthesis.provenance.conflicts,
    ability_dimensions: synthesis.profile.ability_dimensions,
  })

  selectionRows.push({
    learner_id: scenario.learner_id,
    label: scenario.label,
    weak_source_ids: weakSourceIds,
    selected_targets: selection.map((target) => ({
      source_id: target.source_id,
      concept: target.concept,
      difficulty: target.difficulty,
      selection_reason: target.selection_reason,
    })),
  })
}

const profileReport = {
  report_kind: "role_b_profile_from_diagnosis",
  generated_at: new Date().toISOString(),
  kb_version: knowledgeBase.version,
  purpose: "用客观诊断结果反填画像：答对进已掌握、答错进薄弱、客观覆盖自评并记录冲突",
  scenarios: profileRows,
}
const selectionReport = {
  report_kind: "role_c_dynamic_diagnosis_selection",
  generated_at: new Date().toISOString(),
  kb_version: knowledgeBase.version,
  purpose: "根据画像薄弱点动态筛题：目标 → 历史薄弱 → 先修（薄弱点优先诊断，个性化筛题）",
  scenarios: selectionRows,
}

await Bun.write(resolve(outputDir, "profile-from-diagnosis.json"), `${JSON.stringify(profileReport, null, 2)}\n`)
await Bun.write(resolve(outputDir, "dynamic-diagnosis-selection.json"), `${JSON.stringify(selectionReport, null, 2)}\n`)

// 个性化自检：三个学习者的画像与筛题必须不同。
const profiles = profileRows.map((row) => JSON.stringify({
  level: (row as { resolved_level: unknown }).resolved_level,
  known: (row as { known_concepts: unknown }).known_concepts,
  weak: (row as { weak_concepts: unknown }).weak_concepts,
}))
const selections = selectionRows.map((row) => JSON.stringify(
  (row as { selected_targets: unknown }).selected_targets,
))
const profileDistinct = new Set(profiles).size === profiles.length
const selectionDistinct = new Set(selections).size === selections.length

console.log(JSON.stringify({
  status: profileDistinct && selectionDistinct ? "personalized" : "NOT_PERSONALIZED",
  scenarios: profileRows.map((row) => ({
    learner_id: (row as { learner_id: unknown }).learner_id,
    label: (row as { label: unknown }).label,
    level: (row as { resolved_level: unknown }).resolved_level,
    known: (row as { known_concepts: unknown }).known_concepts,
    weak: (row as { weak_concepts: unknown }).weak_concepts,
    conflicts: (row as { conflicts: unknown[] }).conflicts.length,
  })),
  profile_distinct: profileDistinct,
  selection_distinct: selectionDistinct,
  outputs: [
    resolve(outputDir, "profile-from-diagnosis.json"),
    resolve(outputDir, "dynamic-diagnosis-selection.json"),
  ],
}, null, 2))

if (!profileDistinct || !selectionDistinct) process.exitCode = 1
