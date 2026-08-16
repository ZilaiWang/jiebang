/**
 * Day 4 真实模型验证：诊断题生成 → 画像反填 → 动态筛题的个性化闭环。
 *
 * 与 role-c-day4-dynamic-decision.ts（假数据构造 verdict）不同，本脚本用真实模型
 * （deepseek-v4-flash）生成诊断题，让两个学习者对同一套题作答（一个全对、一个全错），
 * 验证：答题差异 → 画像（known/weak）差异 → 动态筛题差异 这条个性化链路在真实模型下成立。
 *
 * 产出（.tmp/competition-sprint/day4-dynamic-decision/）：
 *   - real-model-diagnosis.json  真实模型生成的诊断题（含 answer，仅验收用）
 *   - real-model-profile-selection.json  两个学习者的画像 + 动态筛题对比
 *
 * 用法：bun scripts/role-c-day4-real-model.ts
 */
import { mkdir } from "node:fs/promises"
import { resolve } from "node:path"
import { loadKnowledgeBase } from "../src/knowledge/loader"
import { selectDiagnosticEvidenceTargets } from "../src/knowledge/diagnostic-selector"
import { synthesizeProfile } from "../src/role-b-profile/profile-synthesizer"
import { createRoleCModelGatewayFromEnv } from "../src/role-c-content"
import { ModelDiagnosticQuestionAuthor } from "../src/orchestration/diagnostic-question-author"
import type {
  BackgroundEvidence,
  ObjectiveDiagnosisEvidence,
  SelfAssessmentEvidence,
} from "../src/role-b-profile/types"

// 两个学习者用同一套诊断题、同一目标，只有答题不同，才能精确验证个性化来源。
const SCENARIOS = [
  {
    learner_id: "rm-zero-beginner",
    label: "零基础学习者（全错）",
    goal: "从零开始学习 Python，能写一个简单的成绩统计程序",
    self_rating: "beginner" as const,
    claimed_known: [] as string[],
    claimed_weak: [] as string[],
    answer_all_correct: false,
  },
  {
    learner_id: "rm-basic-confident",
    label: "基础学习者自称掌握（全对）",
    goal: "从零开始学习 Python，能写一个简单的成绩统计程序",
    self_rating: "basic" as const,
    claimed_known: ["输入输出", "for 循环", "列表"] as string[],
    claimed_weak: [] as string[],
    answer_all_correct: true,
  },
]

const TARGET_SOURCE_IDS = ["K004", "K007", "K009"]
const PREREQUISITE_SOURCE_IDS: string[] = ["K002", "K003"]

const outputDir = resolve(process.cwd(), ".tmp/competition-sprint/day4-dynamic-decision")
await mkdir(outputDir, { recursive: true })

// ---- 真实模型 gateway + 诊断题作者 ----
const configPath = resolve(process.cwd(), ".env.role-c.local")
const localEnv = await readEnvFile(configPath)
const gateway = createRoleCModelGatewayFromEnv({ ...localEnv, ...process.env }, {
  on_usage(event) {
    console.error(JSON.stringify({
      event: "role_c_model_usage",
      task: event.task,
      model_id: event.model_id,
      total_tokens: event.total_tokens,
    }))
  },
})
const diagnosticAuthor = new ModelDiagnosticQuestionAuthor(gateway)

const knowledgeBase = await loadKnowledgeBase()

// ---- 第一步：程序确定性筛出诊断目标（无历史薄弱） ----
const targets = selectDiagnosticEvidenceTargets({
  knowledgeBase,
  target_source_ids: TARGET_SOURCE_IDS,
  prerequisite_source_ids: PREREQUISITE_SOURCE_IDS,
  learner_memory: { weak_source_ids: [] },
  max_items: 5,
})
if (targets.length === 0) {
  throw new Error("没有筛出可诊断目标，检查 target_source_ids 是否命中知识库")
}

// ---- 第二步：真实模型生成诊断题 ----
let authored: Awaited<ReturnType<ModelDiagnosticQuestionAuthor["author"]>>
try {
  authored = await diagnosticAuthor.author({
    session_id: "DAY4-REAL-MODEL-SESSION",
    learner_goal: SCENARIOS[0]!.goal,
    targets,
    prior_public_items: [],
  })
} catch (error) {
  throw new Error(`真实模型诊断题生成失败：${error instanceof Error ? error.message : String(error)}`)
}

// ---- 第三步：两个学习者作答（对同一套题） ----
const scenarioRows: unknown[] = []
for (const scenario of SCENARIOS) {
  const diagnosisItems = authored.map((item) => {
    // 全对：选 answer；全错：选第一个非 answer 的选项（保证错得有依据）
    const wrongOption = item.options.find((option) => option !== item.answer) ?? item.options[0]!
    const learnerAnswer = scenario.answer_all_correct ? item.answer : wrongOption
    const verdict = scenario.answer_all_correct ? "correct" : "incorrect"
    return {
      source_id: item.source_id,
      fact_id: item.fact_id,
      question: item.question,
      learner_answer: learnerAnswer,
      verdict,
      concept: item.concept,
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

  // 画像反填：诊断 verdict → 画像（known/weak + 冲突记录 + level 判定）
  const synthesis = synthesizeProfile({
    background,
    selfAssessment,
    objectiveDiagnosis,
    knowledgeBase,
  })

  // 动态筛题：画像薄弱概念作为「历史薄弱」来源，看筛题是否随画像变化。
  const weakSourceIds = [...new Set(
    synthesis.provenance.concepts
      .filter((concept) => concept.bucket === "weak")
      .flatMap((concept) => concept.matched_source_ids),
  )]
  const selection = selectDiagnosticEvidenceTargets({
    knowledgeBase,
    target_source_ids: TARGET_SOURCE_IDS,
    prerequisite_source_ids: PREREQUISITE_SOURCE_IDS,
    learner_memory: { weak_source_ids: weakSourceIds },
    max_items: 5,
  })

  scenarioRows.push({
    learner_id: scenario.learner_id,
    label: scenario.label,
    resolved_level: synthesis.profile.level,
    level_rule: synthesis.provenance.level.rule,
    known_concepts: synthesis.profile.known_concepts,
    weak_concepts: synthesis.profile.weak_concepts,
    conflicts: synthesis.provenance.conflicts,
    weak_source_ids: weakSourceIds,
    selected_targets: selection.map((target) => ({
      source_id: target.source_id,
      concept: target.concept,
      selection_reason: target.selection_reason,
    })),
    diagnosis_verdicts: diagnosisItems.map((item) => ({ source_id: item.source_id, verdict: item.verdict })),
  })
}

// ---- 落盘 + 个性化自检 ----
await Bun.write(
  resolve(outputDir, "real-model-diagnosis.json"),
  `${JSON.stringify({
    report_kind: "role_c_real_model_diagnosis",
    generated_at: new Date().toISOString(),
    kb_version: knowledgeBase.version,
    targets: targets.map((target) => ({ source_id: target.source_id, concept: target.concept, difficulty: target.difficulty })),
    authored_questions: authored.map((item) => ({
      source_id: item.source_id,
      fact_id: item.fact_id,
      question: item.question,
      options: item.options,
      answer: item.answer,
    })),
  }, null, 2)}\n`,
)

const selectionReport = {
  report_kind: "role_c_real_model_profile_selection",
  generated_at: new Date().toISOString(),
  kb_version: knowledgeBase.version,
  purpose: "真实模型诊断题 → 两学习者不同答题 → 画像反填 → 动态筛题的个性化对比",
  scenarios: scenarioRows,
}
await Bun.write(
  resolve(outputDir, "real-model-profile-selection.json"),
  `${JSON.stringify(selectionReport, null, 2)}\n`,
)

const rows = scenarioRows as Array<{
  learner_id: string
  label: string
  resolved_level: string
  known_concepts: string[]
  weak_concepts: string[]
  conflicts: unknown[]
  weak_source_ids: string[]
  selected_targets: Array<{ source_id: string; selection_reason: string }>
  diagnosis_verdicts: Array<{ source_id: string; verdict: string }>
}>

// 个性化判定：两个学习者的画像（known/weak）和筛题结果必须不同。
const profileSig = rows.map((row) => JSON.stringify({ level: row.resolved_level, known: row.known_concepts, weak: row.weak_concepts }))
const selectionSig = rows.map((row) => JSON.stringify(row.selected_targets))
const profileDistinct = new Set(profileSig).size === rows.length
const selectionDistinct = new Set(selectionSig).size === rows.length

// 薄弱优先判定：全错学习者（weak 非空）的筛题里应出现 selection_reason === "weak_history" 的薄弱点。
const wrongRow = rows.find((row) => row.weak_source_ids.length > 0)
const weakPrioritized = wrongRow
  ? wrongRow.selected_targets.some((target) => target.selection_reason === "weak_history")
  : false

console.log(JSON.stringify({
  status: profileDistinct && selectionDistinct ? "personalized" : "NOT_PERSONALIZED",
  real_model_questions: authored.length,
  scenarios: rows.map((row) => ({
    learner_id: row.learner_id,
    label: row.label,
    level: row.resolved_level,
    known: row.known_concepts,
    weak: row.weak_concepts,
    conflicts: row.conflicts.length,
    verdicts: row.diagnosis_verdicts.map((v) => v.verdict),
    selected: row.selected_targets.map((t) => `${t.source_id}:${t.selection_reason}`),
  })),
  profile_distinct: profileDistinct,
  selection_distinct: selectionDistinct,
  weak_prioritized: weakPrioritized,
  outputs: [
    resolve(outputDir, "real-model-diagnosis.json"),
    resolve(outputDir, "real-model-profile-selection.json"),
  ],
}, null, 2))

if (!profileDistinct || !selectionDistinct) process.exitCode = 1

async function readEnvFile(path: string): Promise<Record<string, string>> {
  const file = Bun.file(path)
  if (!await file.exists()) throw new Error(`MODEL_CONFIG_NOT_FOUND:${path}`)
  const parsed: Record<string, string> = {}
  for (const [lineNumber, sourceLine] of (await file.text()).split(/\r?\n/).entries()) {
    const line = sourceLine.trim()
    if (!line || line.startsWith("#")) continue
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/)
    if (!match) throw new Error(`INVALID_ENV_LINE:${lineNumber + 1}`)
    let value = match[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    parsed[match[1]] = value
  }
  return parsed
}
