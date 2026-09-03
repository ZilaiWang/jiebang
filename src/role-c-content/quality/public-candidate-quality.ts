import { contentHash } from "../contracts/common"
import type { LearningDesignSpecV2 } from "../planning/learning-design-spec-v2"
import type { AssessmentItemPlan } from "../providers/staged-generation"
import type { ConceptSectionPlan } from "../planning/concept-section-plan"
import type {
  PublicArtifactKind,
  PublicCandidateEvaluation,
  QualityDimensionScore,
} from "./contracts"
import type { RoleCExpressionContext } from "../../role-b-profile/expression-context-contract"
import { evaluateExpressionAdaptation } from "./expression-adaptation"
import type { ProgrammingTaskKind } from "../programming/contracts"

const META_LANGUAGE = /(?:source[_ ]?id|fact[_ ]?id|\bRAG\b|evidence(?:_pack)?|知识库编号|内部审核|隐藏测试|正确答案|\bsource\s*:\s*K\d+|\bfact\s*:\s*F\d+)/iu
const VACUOUS_DISTRACTOR = /(?:不需要任何.{0,8}(?:依据|规则)|随机生成|只适用于界面|与题目无关|以上都[对错]|永远不会|什么都不做)/u

export function evaluatePublicAuthorCandidate(input: {
  candidate_id: string
  artifact_kind: PublicArtifactKind
  payload: unknown
  learning_design: LearningDesignSpecV2
  assessment_plan?: AssessmentItemPlan[]
  concept_section_plans?: ConceptSectionPlan[]
  hard_gate_issues?: string[]
  minimum_score?: number
  expression_context?: RoleCExpressionContext
  /** Frozen by planning; author payload intentionally does not repeat it. */
  code_lab_task_kind?: ProgrammingTaskKind
}): PublicCandidateEvaluation {
  const hardIssues = input.hard_gate_issues ?? []
  const text = collectText(input.payload)
  const metaLeak = META_LANGUAGE.test(text)
  const baseDimensions = input.artifact_kind === "concept_lesson"
    ? conceptDimensions(input.payload, input.learning_design, input.concept_section_plans ?? [])
    : input.artifact_kind === "code_lab"
      ? codeLabDimensions(input.payload, input.learning_design, input.code_lab_task_kind)
      : assessmentDimensions(input.payload, input.assessment_plan ?? [], input.learning_design)
  const expressionAudit = evaluateExpressionAdaptation(input.payload, input.expression_context)
  const dimensions = [
    ...baseDimensions,
    ...(expressionAudit.applicable
      ? [dimension(
          "background_expression_alignment",
          expressionAudit.score,
          0.75,
          false,
          "表达框架、术语桥接和任务语境遵循 B 的受控背景合同",
          true,
          expressionAudit.evidence_refs,
        )]
      : []),
  ]
  const overall = weightedMean(dimensions)
  const coreFailure = dimensions.some((dimension) =>
    dimension.applicable !== false && dimension.core && dimension.score < 0.48)
  const criticalFindings = [
    ...(metaLeak ? ["PUBLIC_INTERNAL_METADATA"] : []),
    ...expressionAudit.issue_codes,
    ...hardIssues.map((issue) => `HARD_GATE:${issue}`),
    ...(coreFailure ? ["CORE_QUALITY_DIMENSION_LOW"] : []),
  ]
  const minimum = input.minimum_score ?? 0.58
  return {
    candidate_id: input.candidate_id,
    artifact_kind: input.artifact_kind,
    hard_gates: [
      { gate: "existing_contract_validators", passed: hardIssues.length === 0, issue_codes: hardIssues },
      { gate: "public_internal_metadata", passed: !metaLeak, issue_codes: metaLeak ? ["PUBLIC_INTERNAL_METADATA"] : [] },
      { gate: "expression_safety", passed: expressionAudit.issue_codes.length === 0, issue_codes: expressionAudit.issue_codes },
    ],
    dimensions,
    overall_score: round(overall),
    release_eligible: hardIssues.length === 0 && !metaLeak && expressionAudit.issue_codes.length === 0 && !coreFailure && overall >= minimum,
    critical_findings: criticalFindings,
  }
}

function conceptDimensions(
  payload: unknown,
  design: LearningDesignSpecV2,
  sectionPlans: ConceptSectionPlan[],
): QualityDimensionScore[] {
  const record = asRecord(payload)
  const objectives = Array.isArray(record.objectives) ? record.objectives.map(asRecord) : []
  const sections = objectives.flatMap((objective) => Array.isArray(objective.sections)
    ? objective.sections.map(asRecord)
    : [objective])
  const authoredSlotIds = new Set(sections.map((section) => String(section.slot_id ?? "")))
  const authoredKinds = sectionPlans.flatMap((plan) => plan.slots.flatMap((slot) =>
    authoredSlotIds.has(slot.slot_id) ? [slot.kind] : []))
  const text = collectText(payload)
  const sentences = meaningfulSentences(text)
  const uniqueRatio = ratio(new Set(sentences.map(normalize)).size, sentences.length)
  const hasExample = authoredKinds.some((kind) =>
    kind === "guided_example" || kind === "procedure_steps" || kind === "comparison")
    || /(?:例如|示例|观察|步骤)/u.test(text)
  const hasContrast = authoredKinds.includes("misconception")
    || /(?:误区|容易误以为|区别|对比)/u.test(text)
  const hasCheck = objectives.some((objective) => {
    const check = asRecord(objective.micro_check)
    return String(check.prompt ?? "").trim().length > 0
  }) || /(?:自查|判断|想一想)/u.test(text)
  const adaptationCount = design.objectives.flatMap((objective) => objective.adaptation_decisions).length
  return [
    dimension("objective_alignment", ratio(objectives.length, design.objectives.length), 1.3, true, "目标单元覆盖教学设计"),
    dimension("instructional_coherence", average([bool(hasExample), bool(hasCheck), clamp(sentences.length / Math.max(4, design.objectives.length * 4))]), 1.2, true, "解释、示例与即时检查形成教学链"),
    dimension("misconception_treatment", design.learner.misconceptions.length === 0 ? 0.85 : bool(hasContrast), 1, true, "显式辨析证据包中的误区"),
    dimension("cognitive_progression", average([bool(hasExample), bool(hasCheck), bool(authoredKinds.length >= design.objectives.length * 3)]), 1, false, "从解释逐步过渡到练习与检查"),
    dimension("learner_adaptation", adaptationCount > 0 ? clamp(0.55 + adaptationSignals(text) * 0.15) : 0.6, 1, true, "表达与脚手架体现统一教学决策"),
    dimension("readability", readability(text), 0.8, false, "句长和段落密度适合阅读"),
    dimension("non_template_narrative", clamp(uniqueRatio), 0.8, false, "减少重复句式和事实原句拼贴"),
  ]
}

function codeLabDimensions(
  payload: unknown,
  design: LearningDesignSpecV2,
  frozenTaskKind?: ProgrammingTaskKind,
): QualityDimensionScore[] {
  const record = asRecord(payload)
  const programmingTask = asRecord(record.programming_task)
  const gapTemplate = asRecord(programmingTask.gap_template)
  const objectives = Array.isArray(record.objectives) ? record.objectives.map(asRecord) : []
  const text = collectText(payload)
  const starter = String(gapTemplate.template_code ?? record.starter_code ?? "")
  const hasIncompleteStarter = /TODO|pass|NotImplementedError|待完成|\{\{gap:/u.test(starter)
  const debuggingRepair = (frozenTaskKind ?? programmingTask.task_kind) === "debugging_repair"
  // An implementation exercise should expose a deliberate learner-owned gap.
  // A debugging exercise has the opposite contract: its starter must be a
  // complete, runnable *faulty* program.  Treating every full program as an
  // answer leak made valid debugging candidates fail the quality tournament.
  // Reproducibility and mutation count remain enforced by the code-lab
  // validators and secure-stage execution checks.
  const starterScaffolding = debuggingRepair
    ? bool(!hasIncompleteStarter
      && starter.length >= 8
      && /(?:if|elif|else|for|while|range|\[[^\]]+\]|return|print)/u.test(starter))
    : average([
        bool(hasIncompleteStarter),
        bool(starter.length >= 8),
        bool(!looksCompleteSolution(starter)),
      ])
  const tests = objectives.flatMap((objective) => objective.public_test ? [objective.public_test] : [])
  const reflections = objectives.filter((objective) => String(objective.reflection_question ?? "").trim().length > 0)
  const hints = objectives.flatMap((objective) => Array.isArray(objective.hints)
    ? objective.hints.map((hint) => String(hint))
    : [])
  const normalizedHints = hints.map(normalize).filter(Boolean)
  const hintUniqueness = ratio(new Set(normalizedHints).size, normalizedHints.length)
  const genericHintRate = ratio(hints.filter((hint) =>
    /(?:本目标要求表达的核心事实|事实中的主语、对象和关系|只替换\s*TODO\s*字符串)/u.test(hint)).length, hints.length)
  const hintProgression = hints.length === 0
    ? 0.35
    : average([
        clamp(hints.length / Math.max(3, objectives.length * 3)),
        hintUniqueness,
        1 - genericHintRate,
      ])
  return [
    dimension("objective_alignment", ratio(objectives.length, design.objectives.length), 1.3, true, "每个目标都有可执行练习职责"),
    dimension("task_authenticity", bool(/(?:实现|完成|输入|输出|返回|统计|处理|判断)/u.test(text)), 1, true, "任务要求学习者产出可观察结果"),
    dimension("starter_scaffolding", starterScaffolding, 1.1, true, debuggingRepair
      ? "调试 starter 是完整可运行的故障程序，故障由学习者定位与修复"
      : "starter 明确学习者负责区域且未泄露完整实现"),
    dimension("public_test_clarity", ratio(tests.length, Math.max(1, objectives.length)), 1, true, "公开测试描述可帮助学习者自查"),
    dimension("hint_fading", hintProgression, 0.8, false, "提示针对当前任务逐级增加信息且不复用通用模板"),
    dimension("reflection_value", ratio(reflections.length, Math.max(1, objectives.length)), 0.7, false, "反思问题连接实现与目标规则"),
  ]
}

function assessmentDimensions(
  payload: unknown,
  plan: AssessmentItemPlan[],
  design: LearningDesignSpecV2,
): QualityDimensionScore[] {
  const record = asRecord(payload)
  const items = Array.isArray(record.items) ? record.items.map(asRecord) : []
  const choicePlans = plan.filter((entry) => entry.modality === "mcq" || entry.modality === "true_false")
  const allOptions = items.flatMap((item) => Array.isArray(item.options) ? item.options.map(String) : [])
  const distractors = items.flatMap((item) => Array.isArray(item.options)
    ? item.options.map(String).slice(1)
    : [])
  const vacuousRate = ratio(distractors.filter((option) => VACUOUS_DISTRACTOR.test(option)).length, distractors.length)
  const lengthBalance = optionLengthBalance(items)
  const promptUniqueness = ratio(
    new Set(items.map((item) => normalize(String(item.prompt ?? "")))).size,
    items.length,
  )
  const constructCoverage = ratio(plan.filter((entry) => Boolean(entry.construct && entry.evidence_of_mastery)).length, plan.length)
  const misconceptionEligiblePlans = choicePlans.filter((entry) => entry.misconception_available)
  const misconceptionCoverage = misconceptionEligiblePlans.length === 0
    ? 1
    : ratio(
        misconceptionEligiblePlans.filter((entry) => entry.target_misconception_id).length,
        misconceptionEligiblePlans.length,
      )
  const tier3 = plan.filter((entry) => entry.tier === 3)
  const transferPlanned = tier3.filter((entry) =>
    entry.cognitive_demand === "transfer" || entry.cognitive_demand === "analyze")
  const genuineTransfer = transferPlanned.length === 0
    ? 0.85
    : ratio(transferPlanned.length, tier3.length)
  return [
    dimension("construct_validity", average([constructCoverage, bool(items.length === plan.length)]), 1.4, true, "每题对应明确构念与掌握证据"),
    dimension("distractor_quality", choicePlans.length === 0 ? 1 : clamp(average([1 - vacuousRate, lengthBalance, bool(allOptions.length > 0)])), 1.3, true, "干扰项可信且没有明显荒谬线索", choicePlans.length > 0),
    dimension(
      "misconception_alignment",
      misconceptionCoverage,
      1.1,
      true,
      "存在当前引用可支撑的知识库误区时，选择题必须显式绑定",
      misconceptionEligiblePlans.length > 0,
    ),
    dimension(
      "transfer_validity",
      transferPlanned.length === 0 ? 1 : genuineTransfer,
      1,
      true,
      "冻结为高阶测量的题目改变认知操作或任务结构",
      transferPlanned.length > 0,
    ),
    dimension("item_independence", promptUniqueness, 0.9, false, "同卷题目不重复同一骨架"),
    dimension("reading_load", readability(items.map((item) => String(item.prompt ?? "")).join("。")), 0.7, false, "题干没有无关故事和过长阅读负担"),
  ]
}

function dimension(
  name: string,
  score: number,
  weight: number,
  core: boolean,
  rationale: string,
  applicable = true,
  evidenceRefs: string[] = [name],
): QualityDimensionScore {
  return {
    dimension: name,
    applicable,
    score: round(clamp(score)),
    weight,
    confidence: 0.72,
    evidence_refs: evidenceRefs,
    rationale,
    core,
  }
}

function optionLengthBalance(items: Record<string, unknown>[]): number {
  const scores = items.flatMap((item) => {
    if (!Array.isArray(item.options) || item.options.length < 2) return []
    const lengths = item.options.map((option) => String(option).trim().length)
    const min = Math.min(...lengths)
    const max = Math.max(...lengths)
    return [max === 0 ? 0 : min / max]
  })
  return scores.length === 0 ? 0.8 : average(scores)
}

function looksCompleteSolution(starter: string): boolean {
  const meaningfulLines = starter.split("\n").map((line) => line.trim()).filter((line) =>
    line && !line.startsWith("#") && !/^(?:def |pass$|raise NotImplementedError)/.test(line))
  return meaningfulLines.length >= 5 && !/TODO|pass|NotImplementedError|待完成/u.test(starter)
}

function adaptationSignals(text: string): number {
  return [/(?:先|再|最后)/u, /(?:提示|自查|想一想)/u, /(?:误区|对比|区别)/u]
    .filter((pattern) => pattern.test(text)).length
}

function readability(text: string): number {
  const sentences = meaningfulSentences(text)
  if (sentences.length === 0) return 0
  const averageLength = sentences.reduce((sum, sentence) => sum + [...sentence].length, 0) / sentences.length
  if (averageLength <= 38) return 0.95
  if (averageLength <= 60) return 0.78
  if (averageLength <= 90) return 0.58
  return 0.35
}

function collectText(value: unknown): string {
  if (typeof value === "string") return value
  if (Array.isArray(value)) return value.map(collectText).join("\n")
  if (!value || typeof value !== "object") return ""
  return Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !/(?:id|citation|fact_ref|source_ref|hash)/i.test(key))
    .map(([, entry]) => collectText(entry))
    .join("\n")
}

function meaningfulSentences(text: string): string[] {
  return text.split(/[。！？!?\n]+/u).map((entry) => entry.trim()).filter((entry) => entry.length >= 4)
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function weightedMean(dimensions: QualityDimensionScore[]): number {
  const applicable = dimensions.filter((entry) => entry.applicable !== false)
  const weight = applicable.reduce((sum, entry) => sum + entry.weight, 0)
  return weight === 0 ? 0 : applicable.reduce((sum, entry) => sum + entry.score * entry.weight, 0) / weight
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator
}

function bool(value: boolean): number { return value ? 1 : 0 }
function clamp(value: number): number { return Math.max(0, Math.min(1, value)) }
function round(value: number): number { return Math.round(value * 10_000) / 10_000 }
function normalize(value: string): string { return value.normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase() }

export function candidateIdentity(kind: PublicArtifactKind, payload: unknown, variantIndex: number): string {
  return `candidate-${kind}-${variantIndex + 1}-${contentHash(payload).slice(-10)}`
}
