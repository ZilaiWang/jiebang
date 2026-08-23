import { contentHash, stableId } from "../contracts/common"
import type {
  AssessmentPublicPayload,
  CodeLabPublicPayload,
  ConceptLessonPayload,
} from "../contracts/artifacts"
import {
  RESOURCE_FIT_POLICY_VERSION,
  type ArtifactResourceFit,
  type ChallengeVector,
  type ResourceFitKind,
  type ResourceFitReport,
  type ResourceFitVerdict,
  type SupportProfile,
} from "../contracts/resource-fit"
import type { ResourceDifficultyPlanEntry } from "../planning/resource-blueprint"
import {
  computeWeightedFit,
  overallFitScoreV2,
  type FitDimensionMeasurement,
} from "../planning/resource-fit-v2"

/**
 * Resource Difficulty Audit（规则可测 + 语义可补充）。
 *
 * 生成后的"实际难度（observed）"不是让模型自评，而是由确定性结构特征估计：
 *  - 讲义：段落/代码块/worked-example 步骤/误区/微检/hint 数
 *  - 代码实验：starter_code 完成度 / 公开测试数 / 反思题数 / 证据引用数 / hint 数
 *  - 测评：tier 分布 / modality / structure_meta（operation/reasoning/representation/context）
 *
 * 再与 target（difficulty_plan）比较得到 fit verdict。语义补充（模型判断
 * cognitive_demand / transfer_distance）通过 confidence 字段预留，当前为规则估计。
 */

export interface ResourceFitAuditInput {
  artifact_id: string
  kind: ResourceFitKind
  payload: ConceptLessonPayload | CodeLabPublicPayload | AssessmentPublicPayload
  target: ResourceDifficultyPlanEntry
}

const CLAMP = (value: number) => Math.max(0, Math.min(5, Math.round(value * 10) / 10))

export function auditResourceFit(input: ResourceFitAuditInput): ArtifactResourceFit {
  const observed = estimateObserved(input.kind, input.payload)
  const fit = computeFit(input.kind, observed, input.target)
  return {
    artifact_id: input.artifact_id,
    kind: input.kind,
    target: {
      challenge: input.target.challenge_target,
      support: input.target.support_target,
    },
    observed,
    fit,
  }
}

export function buildResourceFitReport(input: {
  run_id: string
  spec_id: string
  profile_ref: ResourceFitReport["profile_ref"]
  entries: ArtifactResourceFit[]
}): ResourceFitReport {
  const kinds = new Set(input.entries.map((entry) => entry.kind))
  if (input.entries.length !== 3
    || !["concept_lesson", "code_lab", "assessment"].every((kind) => kinds.has(kind as ResourceFitKind))) {
    throw new Error("RESOURCE_FIT_REQUIRES_THREE_ARTIFACT_KINDS")
  }
  const scores = input.entries.map((entry) => entry.fit.score)
  // Resource Fit v2 overall：加权 + weakest 上限，防止某资源被另两个高分掩盖。
  const lesson = input.entries.find((entry) => entry.kind === "concept_lesson")?.fit.score ?? 0
  const lab = input.entries.find((entry) => entry.kind === "code_lab")?.fit.score ?? 0
  const assessment = input.entries.find((entry) => entry.kind === "assessment")?.fit.score ?? 0
  const overallScore = overallFitScoreV2({ lesson, lab, assessment })
  return {
    schema_version: "1.0",
    run_id: input.run_id,
    spec_id: input.spec_id,
    profile_ref: input.profile_ref,
    policy_version: RESOURCE_FIT_POLICY_VERSION,
    resources: input.entries,
    overall: {
      verdict: overallVerdict(input.entries),
      score: Math.round(overallScore * 1000) / 1000,
    },
  }
}

// ── observed 估计 ──

interface Observed {
  challenge: ChallengeVector
  support: SupportProfile
  confidence: number
}

function estimateObserved(kind: ResourceFitKind, payload: unknown): Observed {
  if (kind === "concept_lesson") return estimateConceptLesson(payload as ConceptLessonPayload)
  if (kind === "code_lab") return estimateCodeLab(payload as CodeLabPublicPayload)
  return estimateAssessment(payload as AssessmentPublicPayload)
}

function estimateConceptLesson(payload: ConceptLessonPayload): Observed {
  const codeBlocks = payload.explanation_blocks.filter((block) => "block_type" in block && block.block_type === "code").length
    + payload.worked_examples.filter((block) => "block_type" in block && block.block_type === "code").length
  const workedSteps = payload.worked_examples.reduce((sum, block) => {
    const text = learnerVisibleBlockText(block)
    const explicitSteps = text.split(/\r?\n/u).filter((line) => /^\s*(?:\d+[.)、]|[-*])\s+/u.test(line)).length
    return sum + Math.max(1, explicitSteps)
  }, 0)
  const misconceptionDepth = payload.misconceptions.length
  const hintCount = payload.hint_ladders.reduce((sum, ladder) => sum + ladder.hints.length, 0)
  const microCheckCount = payload.micro_checks.length
  const blockCount = payload.prerequisite_bridge.length
    + payload.explanation_blocks.length
    + payload.worked_examples.length
    + payload.summary.length
  const visibleBlocks = [
    payload.prerequisite_bridge,
    payload.explanation_blocks,
    payload.worked_examples,
    payload.summary,
  ].flat()
  const textLength = visibleBlocks.reduce((sum, block) =>
    sum + learnerVisibleBlockText(block).length, 0)
    + payload.misconceptions.reduce((sum, item) => sum + item.explanation.length, 0)
  const hintStrength = CLAMP(hintCount * 1.2)

  return {
    challenge: {
      domain_complexity: CLAMP(1 + payload.objective_ids.length * 0.5),
      cognitive_demand: CLAMP(1 + Math.min(2, codeBlocks / 3)),
      reasoning_steps: CLAMP(Math.min(5, workedSteps)),
      code_complexity: CLAMP(codeBlocks * 0.8),
      prerequisite_load: CLAMP(payload.prerequisite_bridge.length),
      transfer_distance: CLAMP(Math.max(0, payload.worked_examples.length - 1)),
      boundary_condition_density: CLAMP(misconceptionDepth),
      task_composition: CLAMP(Math.max(0, payload.objective_ids.length - 1)),
    },
    support: {
      scaffold_strength: CLAMP(hintStrength + microCheckCount * 0.4 + misconceptionDepth * 0.4),
      reading_density: readingDensity(textLength, blockCount),
      hint_strength: hintStrength,
      starter_support: 0,
    },
    confidence: 0.85,
  }
}

function estimateCodeLab(payload: CodeLabPublicPayload): Observed {
  const hintCount = payload.hint_ladders.reduce((sum, ladder) => sum + ladder.hints.length, 0)
  const starterSupport = estimateStarterSupport(payload.starter_code)
  const distinctSources = new Set(payload.used_evidence.map((entry) => entry.source_id)).size
  const visibleTextLength = payload.instructions.reduce((sum, block) =>
    sum + learnerVisibleBlockText(block).length, 0)
    + payload.hint_ladders.flatMap((ladder) => ladder.hints)
      .reduce((sum, hint) => sum + hint.text.length, 0)
    + payload.reflection_questions.reduce((sum, text) => sum + text.length, 0)
  const visibleBlockCount = payload.instructions.length + hintCount
    + payload.reflection_questions.length

  return {
    challenge: {
      domain_complexity: CLAMP(1 + payload.objective_ids.length * 0.5),
      cognitive_demand: CLAMP(1 + payload.public_tests.length * 0.4 + payload.reflection_questions.length * 0.3),
      reasoning_steps: CLAMP(1 + payload.instructions.length * 0.5 + payload.public_tests.length * 0.3),
      code_complexity: CLAMP(1 + payload.objective_ids.length * 0.5 + payload.public_tests.length * 0.35),
      prerequisite_load: CLAMP(Math.max(0, distinctSources - 1)),
      transfer_distance: CLAMP(payload.reflection_questions.length * 0.5),
      boundary_condition_density: CLAMP(Math.max(0, payload.public_tests.length - 1)),
      task_composition: CLAMP(Math.max(0, payload.objective_ids.length - 1)),
    },
    support: {
      scaffold_strength: CLAMP(hintCount * 0.8 + starterSupport * 0.5),
      reading_density: readingDensity(visibleTextLength, visibleBlockCount),
      hint_strength: CLAMP(hintCount * 1.2),
      starter_support: starterSupport,
    },
    confidence: 0.9,
  }
}

function estimateAssessment(payload: AssessmentPublicPayload): Observed {
  const items = payload.items
  const itemDemands = items.map(assessmentItemDemand)
  const distinctOperations = new Set(items.map((item) => item.structure_meta?.operation).filter(Boolean)).size
  const cognitiveDemand = itemDemands.length === 0
    ? 0
    : itemDemands.reduce((sum, item) => sum + item.cognitive, 0) / itemDemands.length
  const reasoningSteps = itemDemands.length === 0
    ? 0
    : Math.max(...itemDemands.map((item) => item.reasoning))
  const transferDistance = itemDemands.length === 0
    ? 0
    : Math.max(...itemDemands.map((item) => item.transfer))

  return {
    challenge: {
      domain_complexity: CLAMP(1 + payload.objective_ids.length * 0.5),
      // observed 读取真实题面/题型/结构元数据，不再由 Tier 数量复制 target。
      cognitive_demand: CLAMP(cognitiveDemand),
      reasoning_steps: CLAMP(reasoningSteps),
      code_complexity: CLAMP(items.filter((item) => item.modality === "code").length),
      prerequisite_load: CLAMP(Math.max(0,
        new Set(payload.used_evidence.map((entry) => entry.source_id)).size - 1,
      )),
      transfer_distance: transferDistance,
      task_composition: CLAMP(Math.max(0, distinctOperations - 1)),
    },
    support: {
      scaffold_strength: 0,
      reading_density: "high",
      hint_strength: 0,
      starter_support: 0,
    },
    confidence: 0.9,
  }
}

function assessmentItemDemand(item: AssessmentPublicPayload["items"][number]): {
  cognitive: number
  reasoning: number
  transfer: number
} {
  const meta = item.structure_meta
  const surface = [
    item.prompt,
    item.starter_code ?? "",
    meta?.operation ?? "",
    meta?.reasoning_pattern ?? "",
    meta?.answer_form ?? "",
  ].join(" ").toLocaleLowerCase()
  const direct = /直接|识别|判断|正误|single|fact|recall/u.test(surface)
  const multistep = /多步|链式|综合|compose|推导|逐步|trace|追踪/u.test(surface)
  const diagnosis = /诊断|纠错|debug|错误原因|修正/u.test(surface)
  const construction = item.modality === "code" || /构造|实现|编写|construction/u.test(surface)
  const cognitive = construction
    ? 4
    : diagnosis || multistep || item.modality === "trace"
      ? 3
      : direct
        ? 1
        : 2
  const reasoning = construction
    ? 4
    : multistep || diagnosis || item.modality === "trace"
      ? 3
      : direct
        ? 1
        : 2
  const context = meta?.context_family?.trim().toLocaleLowerCase() ?? ""
  const transfer = !context || context === "direct"
    ? 0
    : /迁移|综合|transfer/u.test(surface)
      ? 2
      : 1
  return { cognitive, reasoning, transfer }
}

function estimateStarterSupport(starterCode: string): number {
  const lines = starterCode.split("\n").map((line) => line.trim()).filter(Boolean)
  if (lines.length === 0) return 0
  const guidedPlaceholders = lines.filter((line) => /^#.*TODO\s*:\s*\S+/u.test(line)).length
  const placeholders = lines.filter((line) => /TODO|^pass$|^\.\.\.$/u.test(line)).length
  const providedStructure = lines.length - placeholders
  // 函数签名、输入输出外壳、初始化代码都属于真实支架；TODO 本身只标出工作位，
  // 不能反向当成“完成度越低、支持越强”。
  const barePlaceholders = Math.max(0, placeholders - guidedPlaceholders)
  return CLAMP(
    providedStructure * 0.8
      + guidedPlaceholders * 0.8
      + Math.min(1, barePlaceholders) * 0.5,
  )
}

function learnerVisibleBlockText(block: unknown): string {
  if (!block || typeof block !== "object" || Array.isArray(block)) return ""
  const record = block as Record<string, unknown>
  return [record.text, record.caption, record.prompt, record.code]
    .filter((value): value is string => typeof value === "string")
    .join("\n")
}

function readingDensity(textLength: number, blockCount: number): SupportProfile["reading_density"] {
  const average = textLength / Math.max(1, blockCount)
  if (average <= 500) return "low"
  if (average <= 1_000) return "medium"
  return "high"
}

// ── fit 判定 ──

function computeFit(
  kind: ResourceFitKind,
  observed: Observed,
  target: ResourceDifficultyPlanEntry,
): ArtifactResourceFit["fit"] {
  const mismatched: string[] = []
  const reasons: string[] = []
  const hardSignals: string[] = []
  const easySignals: string[] = []
  const dimensions: FitDimensionMeasurement[] = []

  for (const dimension of CHALLENGE_DIMENSIONS) {
    const targetValue = target.challenge_target[dimension]
    if (targetValue === undefined) continue
    const observedValue = observed.challenge[dimension] ?? 0
    const gap = observedValue - targetValue
    dimensions.push({
      name: dimension,
      family: "challenge",
      target: targetValue,
      observed: observedValue,
      applicable: challengeDimensionApplicable(kind, dimension, targetValue, observedValue),
      weight: 1,
      tolerance: 2,
      direction: "higher_is_harder",
      basis: [{ feature: dimension, value: observedValue }],
    })
    if (Math.abs(gap) <= 1) continue
    mismatched.push(dimension)
    reasons.push(`${dimension}_${observedValue}_vs_target_${targetValue}`)
    ;(gap > 0 ? hardSignals : easySignals).push(dimension)
  }

  for (const dimension of SUPPORT_DIMENSIONS) {
    const targetValue = target.support_target[dimension]
    const observedValue = observed.support[dimension]
    const gap = observedValue - targetValue
    dimensions.push({
      name: dimension,
      family: "support",
      target: targetValue,
      observed: observedValue,
      applicable: supportDimensionApplicable(kind, dimension),
      weight: 1,
      tolerance: 2,
      direction: "higher_is_more_supportive",
      basis: [{ feature: dimension, value: observedValue }],
    })
    if (Math.abs(gap) <= 1.5) continue
    mismatched.push(dimension)
    reasons.push(`${dimension}_${observedValue}_vs_target_${targetValue}`)
    // 支持不足会让资源偏难；支持过强会让资源偏易。
    ;(gap < 0 ? hardSignals : easySignals).push(dimension)
  }

  const readingGap = readingSupport(observed.support.reading_density)
    - readingSupport(target.support_target.reading_density)
  dimensions.push({
    name: "reading_density",
    family: "support",
    target: readingSupport(target.support_target.reading_density),
    observed: readingSupport(observed.support.reading_density),
    // 阅读密度对三类公开资源都适用；即使完全匹配也应作为真实适用维度计入。
    applicable: true,
    weight: 1,
    tolerance: 2,
    direction: "higher_is_more_supportive",
    basis: [{ feature: "reading_density", value: observed.support.reading_density }],
  })
  if (Math.abs(readingGap) > 1) {
    mismatched.push("reading_density")
    reasons.push(`reading_density_${observed.support.reading_density}_vs_target_${target.support_target.reading_density}`)
    ;(readingGap < 0 ? hardSignals : easySignals).push("reading_density")
  }

  const verdict = fitVerdict(hardSignals.length, easySignals.length, observed.confidence)
  // Resource Fit v2：只统计适用维度，penalty = (gap/tolerance)² × weight。
  const score = computeWeightedFit(dimensions)

  return {
    verdict,
    score,
    mismatched_dimensions: mismatched,
    reason_codes: reasons,
  }
}

function challengeDimensionApplicable(
  kind: ResourceFitKind,
  dimension: typeof CHALLENGE_DIMENSIONS[number],
  target: number,
  observed: number,
): boolean {
  if (["domain_complexity", "cognitive_demand", "reasoning_steps", "prerequisite_load"].includes(dimension)) {
    return true
  }
  if (kind === "concept_lesson" && dimension === "code_complexity") return target !== 0 || observed !== 0
  return target !== 0 || observed !== 0
}

function supportDimensionApplicable(
  kind: ResourceFitKind,
  dimension: typeof SUPPORT_DIMENSIONS[number],
): boolean {
  if (kind === "assessment") return false
  if (kind === "concept_lesson" && dimension === "starter_support") return false
  return true
}

const CHALLENGE_DIMENSIONS = [
  "domain_complexity", "cognitive_demand", "reasoning_steps", "code_complexity",
  "prerequisite_load", "transfer_distance", "boundary_condition_density", "task_composition",
] as const

const SUPPORT_DIMENSIONS = ["scaffold_strength", "hint_strength", "starter_support"] as const

function readingSupport(value: SupportProfile["reading_density"]): number {
  return value === "low" ? 5 : value === "medium" ? 3 : 1
}

function fitVerdict(hardCount: number, easyCount: number, confidence: number): ResourceFitVerdict {
  if (confidence < 0.5) return "uncertain"
  if (hardCount > 0 && easyCount > 0) return "uncertain"
  if (hardCount > 0) return "too_hard"
  if (easyCount > 0) return "too_easy"
  return "fit"
}

function overallVerdict(entries: ArtifactResourceFit[]): ResourceFitVerdict {
  if (entries.length === 0) return "uncertain"
  const verdicts = entries.map((entry) => entry.fit.verdict)
  const hasHard = verdicts.includes("too_hard")
  const hasEasy = verdicts.includes("too_easy")
  if (hasHard && hasEasy) return "uncertain"
  if (hasHard) return "too_hard"
  if (hasEasy) return "too_easy"
  if (verdicts.every((verdict) => verdict === "fit")) return "fit"
  return "uncertain"
}

/** 资源适配审计的稳定指纹，用于 trace / 幂等。 */
export function resourceFitAuditFingerprint(entry: ArtifactResourceFit): string {
  return contentHash({
    artifact_id: entry.artifact_id,
    kind: entry.kind,
    observed: entry.observed,
    fit: entry.fit,
  })
}

export function resourceFitAuditId(entry: ArtifactResourceFit): string {
  return stableId("RESOURCE-FIT", { artifact_id: entry.artifact_id, kind: entry.kind })
}
