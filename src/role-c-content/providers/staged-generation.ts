import type {
  AnswerSpec,
  AssessmentItemPublic,
  AssessmentItemSecure,
  AssessmentPublicPayload,
  AssessmentSecurePayload,
  AssessmentStructureMeta,
  CodeLabPublicPayload,
  CodeLabSecurePayload,
  ConceptLessonPayload,
  ExecutionContract,
  RenderBlock,
  TestComparison,
} from "../contracts/artifacts"
export { classifyOutputContract } from "../contracts/output-contract"
import { classifyOutputContract } from "../contracts/output-contract"
import { stableId, type CitationRef } from "../contracts/common"
import type { RagEvidencePack } from "../contracts/evidence-pack"
import { selectEvidenceBundle } from "../../knowledge/capabilities"
import type { GenerationSpec } from "../contracts/generation-spec"
import { ModelOutputValidationError } from "../contracts/model-gateway"
import { PLATFORM_PYTHON_IMPORT_ALLOWLIST } from "../security/python-static-analyzer"
import {
  modalityMeasuresBehavior,
  preferredModalityForBehavior,
} from "../contracts/assessment-measurement"
import {
  claimTextMatchesFact,
  normalizeGroundedClaimText,
  visibleTeachingTextExpressesFact,
} from "../validators/claim-grounding"
import type { CodeLabRequest, ConceptTutorRequest, PriorAssessmentItem } from "../agents/types"
import {
  buildAssessmentPresentationPlan,
  validateAssessmentPresentationBalance,
} from "../planning/assessment-presentation"
import type {
  AssessmentCognitiveLevel,
  AssessmentDifficultyBand,
} from "../planning/assessment-taxonomy"
import {
  materializePracticalGuide,
  validatePracticalGuideAuthorAgainstPlan,
  type PracticalGuideAuthorPayload,
  type PracticalGuidePlan,
} from "../planning/practical-guide-plan"
import { failClosedStarterCode, validateGapLearnerContract, validateGapTemplate } from "../programming/gap-template"
import type { ProgrammingProblemBlueprint } from "../programming/contracts"

export interface ConceptSegmentRequest extends ConceptTutorRequest {
  segment_index: number
  segment_count: number
}

/** Compact pedagogical prose authored by the model before trusted IDs/citations are attached. */
export interface ConceptSegmentAuthorPayload {
  title: string
  objectives: Array<{
    explanation: string
    worked_example: string
    misconception: string
    micro_check_prompt: string
    micro_check_options: string[]
    /** 正确选项的原文（必须与 micro_check_options 中某项完全一致）。 */
    micro_check_answer: string
    /** 点击后的解析文本。 */
    micro_check_explanation: string
    hints: string[]
    summary: string
  }>
}

export interface CodeLabObjectivePlan {
  objective_id: string
  source_id: string
  instruction_block_id: string
  public_test_id: string
  citations: CitationRef[]
}

/** Compact public lab semantics before trusted identities and citations are attached. */
export interface CodeLabPublicAuthorPayload {
  title: string
  execution_contract: ExecutionContract
  starter_code: string
  objectives: Array<{
    instruction_text: string
    public_test: {
      description: string
      input: unknown
      expected_behavior: string
    }
    hints: string[]
    reflection_question: string
  }>
  practical_guide?: PracticalGuideAuthorPayload
  programming_task?: {
    statement: string
    input_description: string
    output_description: string
    constraints: string[]
    gap_template?: import("../contracts/artifacts").CodeGapTemplate
    additional_public_examples?: Array<{
      description: string
      input: unknown
      expected_behavior: string
    }>
  }
}

export interface CodeLabSecurePlan {
  hidden_tests: Array<{
    test_id: string
    objective_id: string
    case_kind: "normal" | "nominal" | "boundary" | "anti_hardcode" | "error_path"
    weight: number
  }>
  mutation_variants: Array<{
    mutation_id: string
    objective_ids: string[]
    must_fail_test_ids: string[]
    misconception_id: string
  }>
}

/** Minimal private patch authored after trusted execution; all identities stay frozen. */
export interface CodeLabExecutionRepairPatch {
  reference_solution: string | null
  hidden_test_repairs: Array<{
    test_id: string
    input: unknown
    /** Legacy callers may still send these; production schemas omit them. */
    expected?: unknown
    comparison?: TestComparison
  }>
  mutation_repairs: Array<{
    mutation_id: string
    code: string
  }>
}

/** Model-authored executable semantics before deterministic IDs and scoring are attached. */
export interface CodeLabSecureAuthorPayload {
  reference_solution: string
  secondary_reference_solution?: string
  hidden_tests: Array<{
    input: unknown
    /** Legacy fixtures may still carry expected; production schema omits it. */
    expected?: unknown
    comparison: TestComparison
    partition_id?: "nominal" | "boundary" | "anti_hardcode" | "error_path"
    note?: string
    misconception_tag: string
  }>
  mutation_variants: Array<{
    code: string
    misconception_tag: string
  }>
}

/** Model stage that owns executable solutions and mutation semantics only. */
export interface CodeLabReferenceAuthorPayload {
  reference_solution: string
  secondary_reference_solution?: string
  mutation_variants: Array<{
    code: string
    misconception_tag: string
  }>
}

/** Model stage that owns test inputs only. Expected values stay trust-plane owned. */
export interface CodeLabTestInputsAuthorPayload {
  hidden_tests: Array<{
    input: unknown
    partition_id: "nominal" | "boundary" | "anti_hardcode" | "error_path"
    note: string
    misconception_tag: string
  }>
}

export interface AssessmentItemPlan {
  item_id: string
  family_id: string
  variant_id: string
  display_no: number
  objective_id: string
  observation_key: string
  tier: 1 | 2 | 3
  difficulty_band?: AssessmentDifficultyBand
  cognitive_level?: AssessmentCognitiveLevel
  modality: AssessmentItemPublic["modality"]
  max_score: number
  citations: CitationRef[]
  cognitive_operation:
    | "recognize_fact"
    | "explain_reasoning"
    | "trace_execution"
    | "apply_rule"
    | "diagnose_error"
    | "construct_solution"
  /** Measurement design owned by planning, not inferred by the item author. */
  construct?: string
  evidence_of_mastery?: string
  cognitive_demand?: "understand" | "apply" | "analyze" | "transfer"
  /** Whether current cited evidence exposes a source-local misconception. */
  misconception_available?: boolean
  target_misconception_id?: string
  transfer_context?: string
  forbidden_clues?: string[]
  expected_difficulty?: number
  context_strategy: {
    kind: "preferred_context" | "neutral_context"
    value?: string
  }
  /**
   * 题目表现形式（改进方案5 第九节）：确定性分配，整卷完整场景题控制在 ~35%。
   * direct_fact 直接问定义/规则；scenario_transfer 才允许完整生活场景。
   */
  presentation_mode?:
    | "direct_fact"
    | "minimal_context"
    | "code_trace"
    | "error_diagnosis"
    | "comparison"
    | "scenario_transfer"
    | "construction"
}

/** Public question semantics before stable IDs, scoring, routing and citations are attached. */
export interface AssessmentPublicAuthorPayload {
  title: string
  items: Array<{
    prompt: string
    options: string[] | null
    starter_code: string | null
    structure_meta: AssessmentStructureMeta
  }>
}

/** Model-authored answer semantics before deterministic item and suite identities are attached. */
export interface AssessmentSecureAuthorPayload {
  items: Array<{
    answer_spec: AnswerSpec | null
    correct_option_id: string | null
    misconception_by_option: Record<string, string>
  }>
  code_test_suites: Array<{
    execution_contract: ExecutionContract
    reference_solution: string
    hidden_tests: Array<{
      input: unknown
      expected: unknown
      comparison: TestComparison
    }>
  }>
}

export function splitConceptRequest(
  request: ConceptTutorRequest,
  groupSize: number,
): ConceptSegmentRequest[] {
  const groups = chunk(request.generation_spec.targets, groupSize)
  return groups.map((targets, index) => {
    const targetSources = unique(targets.map((target) => target.source_id))
    const prerequisiteSources = index === 0
      ? request.generation_spec.path_node.prerequisite_source_ids
      : []
    const includedSources = new Set([...targetSources, ...prerequisiteSources])
    const results = request.evidence_pack.results
      .filter((entry) => includedSources.has(entry.source_id))
      .map((entry) => structuredClone(entry))
    const retrievalId = stableId("RAGSEG", {
      retrieval_id: request.evidence_pack.retrieval_id,
      objective_ids: targets.map((target) => target.objective_id),
      index,
    })
    const spec: GenerationSpec = {
      ...structuredClone(request.generation_spec),
      spec_id: stableId("SPECSEG", {
        spec_id: request.generation_spec.spec_id,
        objective_ids: targets.map((target) => target.objective_id),
        index,
      }),
      evidence_ref: retrievalId,
      path_node: {
        ...structuredClone(request.generation_spec.path_node),
        target_source_ids: targetSources,
        prerequisite_source_ids: [...prerequisiteSources],
      },
      targets: structuredClone(targets),
    }
    const evidencePack: RagEvidencePack = {
      ...structuredClone(request.evidence_pack),
      retrieval_id: retrievalId,
      query: `${request.evidence_pack.query} [concept segment ${index + 1}/${groups.length}]`,
      top_k: results.length,
      results,
    }
    return {
      ...request,
      generation_spec: spec,
      evidence_pack: evidencePack,
      segment_index: index,
      segment_count: groups.length,
    }
  })
}

/**
 * Tolerates json_object-mode concept authoring sloppiness that the deterministic
 * plan checks would otherwise reject: duplicated quiz options and surplus hints.
 * Genuine deficits (fewer than two options, fewer than three hints) stay failing.
 */
export function normalizeConceptSegmentAuthorPayloadLenient(
  payload: ConceptSegmentAuthorPayload,
): ConceptSegmentAuthorPayload {
  const normalized = structuredClone(payload)
  for (const entry of normalized.objectives) {
    const seen = new Set<string>()
    const deduped = entry.micro_check_options.filter((option) => {
      const key = option.trim().toLocaleLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    if (deduped.length >= 2) {
      entry.micro_check_options = deduped.length > 4 ? deduped.slice(0, 4) : deduped
    }
    if (entry.hints.length > 3) {
      entry.hints = entry.hints.slice(0, 3)
    }
  }
  return normalized
}

export function validateConceptSegmentAuthorAgainstRequest(
  request: ConceptTutorRequest,
  payload: ConceptSegmentAuthorPayload,
): string[] {
  const issues: string[] = []
  if (payload.objectives.length !== request.generation_spec.targets.length) {
    issues.push(
      `objectives 数量应为 ${request.generation_spec.targets.length}，实际 ${payload.objectives.length}`,
    )
  }
  payload.objectives.forEach((entry, index) => {
    if (entry.hints.length !== 3) {
      issues.push(`objectives[${index}].hints 必须恰好包含三级提示`)
    }
    if (entry.micro_check_options.length < 2
      || entry.micro_check_options.length > 4) {
      issues.push(`objectives[${index}].micro_check_options 必须包含 2..4 项`)
    }
    const normalizedOptions = entry.micro_check_options
      .map((option) => option.trim().toLocaleLowerCase())
    if (new Set(normalizedOptions).size !== normalizedOptions.length) {
      issues.push(`objectives[${index}].micro_check_options 不得重复`)
    }
    if (!entry.micro_check_answer?.trim()) {
      issues.push(`objectives[${index}].micro_check_answer 必须指定正确选项的原文`)
    } else if (!normalizedOptions.includes(
      entry.micro_check_answer.trim().toLocaleLowerCase(),
    )) {
      issues.push(`objectives[${index}].micro_check_answer 必须与某个 micro_check_options 完全一致`)
    }
    if (!entry.micro_check_explanation?.trim()) {
      issues.push(`objectives[${index}].micro_check_explanation 不能为空`)
    }
  })
  return issues
}

/** 解析 author 提供的正确选项文本，返回物化后的即时反馈答案字段。 */
function withMicroCheckAnswer(
  authored: ConceptSegmentAuthorPayload["objectives"][number],
  identity: { spec_id: string; objective_id: string; source_id: string },
): { answer_option_id: string; answer_explanation: string } | Record<string, never> {
  const optionIndex = authored.micro_check_options.findIndex((option) =>
    option.trim().toLocaleLowerCase()
      === authored.micro_check_answer?.trim().toLocaleLowerCase())
  if (optionIndex < 0) return {}
  return {
    answer_option_id: stableId("CONCEPT-CHECK-OPTION", {
      ...identity,
      option_index: optionIndex,
    }),
    answer_explanation: authored.micro_check_explanation.trim(),
  }
}

/**
 * Deterministically expands compact authored prose into the canonical lesson.
 * Evidence claims, citations, identities and coverage never rely on model output.
 */
export function materializeConceptSegmentAuthorPayload(
  request: ConceptTutorRequest,
  payload: ConceptSegmentAuthorPayload,
): ConceptLessonPayload {
  const facts = new Map(request.evidence_pack.results.flatMap((entry) =>
    entry.facts.map((fact) => [
      `${fact.source_id}:${fact.fact_id}`,
      fact.content,
    ] as const)))
  const explanationBlocks: ConceptLessonPayload["explanation_blocks"] = []
  const workedExamples: ConceptLessonPayload["worked_examples"] = []
  const misconceptions: ConceptLessonPayload["misconceptions"] = []
  const microChecks: ConceptLessonPayload["micro_checks"] = []
  const hintLadders: ConceptLessonPayload["hint_ladders"] = []
  const summary: ConceptLessonPayload["summary"] = []
  const objectiveCoverage: ConceptLessonPayload["objective_coverage"] = []

  request.generation_spec.targets.forEach((target, index) => {
    const authored = payload.objectives[index]!
    const identity = {
      spec_id: request.generation_spec.spec_id,
      objective_id: target.objective_id,
      source_id: target.source_id,
    }
    const citations = target.required_fact_ids.map((factId) => ({
      source_id: target.source_id,
      fact_id: factId,
      relation: "supports" as const,
    }))
    const targetFacts = target.required_fact_ids.map((factId) =>
      facts.get(`${target.source_id}:${factId}`) ?? "")
    const claims = (kind: string) => citations.map((citation, factIndex) => ({
      claim_id: stableId("CONCEPT-CLAIM", {
        ...identity,
        kind,
        fact_id: citation.fact_id,
        fact_index: factIndex,
      }),
      text: facts.get(`${citation.source_id}:${citation.fact_id}`) ?? "",
      citations: [structuredClone(citation)],
    }))
    const explanationId = stableId("CONCEPT-EXPLANATION", identity)
    const workedExampleId = stableId("CONCEPT-EXAMPLE", identity)
    const checkId = stableId("CONCEPT-CHECK", identity)
    const summaryId = stableId("CONCEPT-SUMMARY", identity)
    // 改进方案5：不再因为只有一条事实就把模型写的 explanation/example/summary
    // 整体替换成固定模板。模型输出通过后续事实审核才可发布；只有空输出才回退。
    explanationBlocks.push({
      block_id: explanationId,
      block_type: "paragraph",
      text: authored.explanation.trim() || deterministicFactFallback(targetFacts),
      claims: claims("explanation"),
    })
    workedExamples.push({
      block_id: workedExampleId,
      block_type: "paragraph",
      text: authored.worked_example.trim() || deterministicFactFallback(targetFacts),
      claims: claims("worked-example"),
    })
    misconceptions.push({
      misconception_tag: stableId("CONCEPT-MISCONCEPTION", identity),
      // 改进方案5：模型写的 misconception 通过定向校验后被采用；只有空/复制模板时回退。
      explanation: validateMisconceptionAgainstFacts(authored.misconception, targetFacts)
        ? authored.misconception.trim()
        : evidenceBoundedMisconception(targetFacts),
      objective_id: target.objective_id,
      citations: structuredClone(citations),
    })
    microChecks.push({
      block_id: checkId,
      block_type: "quiz",
      item_id: stableId("CONCEPT-CHECK-ITEM", identity),
      prompt: authored.micro_check_prompt.trim(),
      options: authored.micro_check_options.map((text, optionIndex) => ({
        option_id: stableId("CONCEPT-CHECK-OPTION", {
          ...identity,
          option_index: optionIndex,
        }),
        label: String.fromCharCode(65 + optionIndex),
        text: text.trim(),
      })),
      ...withMicroCheckAnswer(authored, identity),
      citations: citations.map((citation) => ({
        ...citation,
        relation: "derived_from" as const,
      })),
    })
    hintLadders.push({
      objective_id: target.objective_id,
      hints: authored.hints.map((text, hintIndex) => ({
        hint_level: (hintIndex + 1) as 1 | 2 | 3,
        text: text.trim(),
        citations: citations.map((citation) => ({
          ...citation,
          relation: "derived_from" as const,
        })),
      })),
    })
    summary.push({
      block_id: summaryId,
      block_type: "paragraph",
      text: authored.summary.trim() || deterministicFactFallback(targetFacts),
      claims: claims("summary"),
    })
    objectiveCoverage.push({
      objective_id: target.objective_id,
      block_ids: [explanationId, workedExampleId, checkId, summaryId],
    })
  })

  return normalizeConceptSegment(request, {
    title: payload.title.trim(),
    objective_ids: request.generation_spec.targets.map((target) =>
      target.objective_id),
    prerequisite_bridge: [],
    explanation_blocks: explanationBlocks,
    worked_examples: workedExamples,
    misconceptions,
    micro_checks: microChecks,
    hint_ladders: hintLadders,
    summary,
    objective_coverage: objectiveCoverage,
    used_evidence: [],
  })
}

function evidenceBoundedMisconception(facts: string[]): string {
  const groundedFacts = facts.map((fact) => fact.trim()).filter(Boolean)
  return [
    "可能误解：否认下面某条事实，或擅自把它扩大、缩小到证据没有说明的范围。",
    `纠正：当前可确认的事实是：${groundedFacts.join("；")}`,
    "自查：只依据这些事实判断，不添加证据未给出的条件、用途或例子。",
  ].join("\n")
}

/**
 * 判断模型写的 misconception 是否可被采用（改进方案5 第六节第 5 条）。
 * 只有空输出、或模型偷懒复制了统一 fallback 模板时才拒绝，改用确定性 fallback；
 * 否则保留模型针对具体知识点写的误区，让不同知识点有真实差异。
 * 判断模型写的误区是否有实质内容、且至少锚定一条当前事实（提及事实核心词）。
 * 这是"定向可用性"校验：拦截空输出、复制模板、以及完全脱离事实的臆造；
 * 误区与事实的最终语义一致性仍由后续 fact audit 把关（本函数不承诺语义校验）。
 */
function validateMisconceptionAgainstFacts(misconception: string, facts: string[]): boolean {
  const text = misconception.trim()
  if (text.length < 4) return false
  if (text.includes("否认下面某条事实") || text.includes("擅自把它扩大")) return false
  // 误区必须锚定至少一条事实的核心词（长度 >= 2 的非停用词），否则视为脱离事实的臆造。
  const contentWords = facts.flatMap((fact) => fact
    .split(/[，。！？；、：""''（）()\s]/u)
    .flatMap((segment) => segment.match(/[\u4e00-\u9fa5A-Za-z0-9]{2,}/g) ?? []))
  if (contentWords.length === 0) return true
  return contentWords.some((word) => text.includes(word))
}

/** 空输出的确定性事实回退：直接给出事实原意，而不是三句固定模板。 */
function deterministicFactFallback(facts: string[]): string {
  const grounded = facts.map((fact) => fact.trim()).filter(Boolean)
  return grounded.length > 0 ? grounded.join("；") : ""
}

export function mergeConceptSegments(
  request: ConceptTutorRequest,
  payloads: ConceptLessonPayload[],
): ConceptLessonPayload {
  if (payloads.length === 0) {
    throw new ModelOutputValidationError("concept.merge", ["没有可聚合的目标组输出"])
  }
  const segments = payloads.map((payload, index) => namespaceConceptPayload(payload, index))
  const merged: ConceptLessonPayload = {
    title: segments.length === 1 ? segments[0].title : `${segments[0].title}（组合讲义）`,
    objective_ids: request.generation_spec.targets.map((target) => target.objective_id),
    prerequisite_bridge: segments[0].prerequisite_bridge,
    explanation_blocks: segments.flatMap((segment) => segment.explanation_blocks),
    worked_examples: segments.flatMap((segment) => segment.worked_examples),
    misconceptions: segments.flatMap((segment) => segment.misconceptions),
    micro_checks: segments.flatMap((segment) => segment.micro_checks),
    hint_ladders: segments.flatMap((segment) => segment.hint_ladders),
    summary: segments.flatMap((segment) => segment.summary),
    objective_coverage: segments.flatMap((segment) => segment.objective_coverage),
    used_evidence: [],
  }
  merged.used_evidence = collectConceptCitations(merged)
  return merged
}

/** Freezes objective identity and rebuilds bookkeeping fields from authored content. */
export function normalizeConceptSegment(
  request: ConceptTutorRequest,
  payload: ConceptLessonPayload,
): ConceptLessonPayload {
  const normalized = structuredClone(payload)
  normalized.prerequisite_bridge = normalizePrerequisiteBridges(
    normalized.prerequisite_bridge,
    request,
  )
  freezeClaimTexts([
    ...normalized.prerequisite_bridge,
    ...normalized.explanation_blocks,
    ...normalized.worked_examples,
    ...normalized.summary,
  ], request.evidence_pack)
  anchorRenderedClaims([
    ...normalized.prerequisite_bridge,
    ...normalized.explanation_blocks,
    ...normalized.summary,
  ])
  anchorMisconceptionEvidence(normalized, request.evidence_pack)
  normalized.objective_ids = request.generation_spec.targets.map((target) => target.objective_id)
  const allBlocks = [
    ...normalized.prerequisite_bridge,
    ...normalized.explanation_blocks,
    ...normalized.worked_examples,
    ...normalized.micro_checks,
    ...normalized.summary,
  ]
  const validIds = new Set(allBlocks.map((block) => block.block_id))
  normalized.objective_coverage = request.generation_spec.targets.map((target) => {
    const existing = normalized.objective_coverage.find((entry) => entry.objective_id === target.objective_id)
    const groundedIds = allBlocks.filter((block) => citationsFromBlock(block).some((citation) =>
      citation.source_id === target.source_id && target.required_fact_ids.includes(citation.fact_id),
    )).map((block) => block.block_id)
    return {
      objective_id: target.objective_id,
      block_ids: unique([
        ...(existing?.block_ids ?? []).filter((id) => validIds.has(id)),
        ...groundedIds,
      ]),
    }
  })
  normalized.used_evidence = collectConceptCitations(normalized)
  return normalized
}

export type CodeLabExecutionMode = "function" | "stdin_stdout"

/**
 * 从 A 角色提供的知识点标题 + 事实文本，确定性推导 code lab 的执行方式。
 *
 * 为什么不用模型二选一：execution_mode 是"代码实验如何执行与判分"的结构决策，
 * 一旦让模型自由输出，它可能"选了 stdin_stdout 却按 function 习惯写 def/entry_point"，
 * 进而触发 STDIN_FUNCTION_CONTRACT_MISMATCH 门禁。把这一决策收敛为可复现的规则，
 * 让模型只负责"在既定模式下写内容"，才是稳定性的根本保证。
 *
 * 规则（确定性、可测试）：
 * 1. 教学主题围绕"函数/参数/返回值"（def、参数、返回值、lambda、封装）→ function；
 * 2. 否则主题围绕"输入输出/交互"（input、print、stdin、stdout、屏幕输出、读取用户输入）→ stdin_stdout；
 * 3. 都不命中（循环、列表、运算等中性知识点）→ 按学习者水平兜底：beginner/basic 用 stdin_stdout（更直观），
 *    intermediate/integrated 用 function（更贴近抽象）。
 */
export function deriveCodeLabExecutionMode(
  request: CodeLabRequest,
): CodeLabExecutionMode {
  const targetSources = new Set(request.generation_spec.path_node.target_source_ids)
  const evidence = request.evidence_pack.results.filter((item) => targetSources.has(item.source_id))
  const goal = (request.generation_spec.path_node.goal ?? "").normalize("NFKC").toLocaleLowerCase()
  const surface = [
    ...evidence.map((item) => item.title),
    ...evidence.flatMap((item) => item.facts.map((fact) => fact.content)),
  ].join(" ").normalize("NFKC").toLocaleLowerCase()

  // 强函数信号：代码关键字 def/return/lambda/回调，是"必须写函数"的硬信号。
  // 中文"函数/封装"只作为次强信号，因为它常是"可练习函数/封装可提升复用性"这类教学建议，
  // 而非任务接口要求——若把建议当接口，会把"成绩统计器"这类输出型综合任务误判成 function。
  const codeFunctionSignal = /\bdef\b|\breturn\b|lambda|回调/u.test(surface)
  const ioSignal = /(?:输入输出|标准输入|标准输出|stdin|stdout|读取用户输入|屏幕输出|交互式|\binput\b|\bprint\b)/u.test(surface)
  // 输出型任务信号：目标明确要求"读取/统计/输出/打印/程序/工具"等，是"产出可运行程序"的信号。
  const outputGoalSignal = /(?:读取|统计|输出|打印|显示|计算|制作|工具|程序|成绩|平均|总和|文件|写入)/u.test(goal)

  // 优先级：代码函数信号（函数专题）→ 输出型 goal（产出程序的综合任务）→ IO 信号 → 中文函数主题 → level 兜底
  if (codeFunctionSignal) return "function"
  if (outputGoalSignal) return "stdin_stdout"
  if (ioSignal) return "stdin_stdout"

  const chineseFunctionSignal = /(?:函数|参数|返回值|封装)/u.test(surface)
  if (chineseFunctionSignal) return "function"

  const level = request.generation_spec.learner_adaptation.level
  return level === "beginner" || level === "basic" ? "stdin_stdout" : "function"
}

/**
 * 用程序推导出的 execution_mode 冻结执行合同的"确定性骨架"，只保留模型的语义描述。
 *
 * - language：恒 python（模型无需输出）
 * - execution_mode：以程序推导为准（模型写错也强制修正）
 * - entry_point：stdin_stdout 强制移除；function 保留模型命名（其存在性由 analyzePythonSource 校验）
 * - resource_limits：钳制到 schema 合法范围（模型可填，但不会因越界而失败）
 * - input_contract/output_contract 的 type/constraints：保留模型（教学语义，贴合实时内容）
 */
export function freezeCodeLabExecutionContract(
  contract: ExecutionContract,
  mode: CodeLabExecutionMode,
  taskContract?: {
    learner_action: "recall_fact" | "implement_program" | "implement_function"
    input_form: "function_arguments" | "stdin_lines" | "none"
    entry_point?: string
  },
): ExecutionContract {
  const frozen: ExecutionContract = structuredClone(contract)
  const platformImports = new Set<string>(PLATFORM_PYTHON_IMPORT_ALLOWLIST)
  frozen.language = "python"
  frozen.execution_mode = mode
  // Import capability is a platform-owned security boundary. The model may
  // request modules needed by its task, but unsupported or duplicate entries
  // never become part of the executable contract.
  frozen.allowed_imports = [...new Set((Array.isArray(frozen.allowed_imports)
    ? frozen.allowed_imports
    : [])
    .map((entry) => entry.split(".")[0]!.trim())
    .filter((entry) => platformImports.has(entry)))]
  if (mode === "stdin_stdout") {
    delete frozen.entry_point
    // stdin_stdout 的输出就是标准输出文本，程序确定 kind=string，
    // 避免模型把"输出平均分"等写成数值语义，导致 hidden_tests[].expected 类型与输出合同错配。
    frozen.output_contract.kind = "string"
    if (taskContract?.input_form === "none") {
      frozen.input_contract = {
        type: "none",
        constraints: ["不读取标准输入；学习者只填写当前证据支持的事实文本"],
      }
    }
  }
  if (mode === "function" && taskContract?.entry_point) {
    frozen.entry_point = taskContract.entry_point
  }
  frozen.resource_limits = {
    timeout_ms: clampInt(frozen.resource_limits.timeout_ms, 100, 5000, 1000),
    memory_mb: clampInt(frozen.resource_limits.memory_mb, 32, 512, 64),
    max_output_bytes: clampInt(frozen.resource_limits.max_output_bytes, 256, 100_000, 1024),
  }
  return frozen
}

function clampInt(value: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

export function buildLabIdentity(spec: GenerationSpec) {
  const labId = stableId("LAB", {
    spec_id: spec.spec_id,
    seed: spec.policies.seed,
    version: "code-lab-staged-v1",
  })
  return {
    lab_id: labId,
    test_suite_id: stableId("TS", { lab_id: labId, version: "code-lab-staged-v1" }),
  }
}

export function buildCodeLabObjectivePlan(
  spec: GenerationSpec,
  evidence?: RagEvidencePack,
): CodeLabObjectivePlan[] {
  return spec.targets.map((target) => {
    const identity = {
      spec_id: spec.spec_id,
      objective_id: target.objective_id,
      source_id: target.source_id,
    }
    return {
      objective_id: target.objective_id,
      source_id: target.source_id,
      instruction_block_id: stableId("LAB-INSTRUCTION", identity),
      public_test_id: stableId("LAB-PUBLIC-TEST", identity),
      // GenerationSpec.required_fact_ids 是整轮目标的完整事实覆盖合同；代码实验
      // 只应携带足以完成当前练习的最小证据切片，否则一个简单练习会把整章事实
      // 全部堆进 instruction、公开测试和提示。讲义与测评仍负责完整覆盖。
      citations: codeLabFactIdsForTarget(target, evidence).map((factId) => ({
        source_id: target.source_id,
        fact_id: factId,
        relation: "derived_from" as const,
      })),
    }
  })
}

function codeLabFactIdsForTarget(
  target: GenerationSpec["targets"][number],
  evidence?: RagEvidencePack,
): string[] {
  const sourceFacts = evidence?.results.find((entry) =>
    entry.source_id === target.source_id)?.facts.filter((fact) =>
      target.required_fact_ids.includes(fact.fact_id))
  if (sourceFacts?.length) {
    const selected = selectEvidenceBundle({
      behavior: target.observable_behavior,
      facts: sourceFacts,
      preferred_fact_ids: target.required_fact_ids,
      max_facts: target.observable_behavior === "recognize" ? 1 : 4,
    })
    if (selected.fact_ids.length > 0) {
      const limit = target.observable_behavior === "recognize"
        ? 1
        : target.observable_behavior === "explain"
          ? 2
          : 6
      // Capability 的最小充分束保证“能测”，代码实验还需要把实际要调用的
      // 语法表面带给 author。优先补入带显式调用/运算/索引示例的事实，避免
      // 模型从知识点标题猜出一个未引用 API。
      const seenSurfaces = new Set(sourceFacts
        .filter((fact) => selected.fact_ids.includes(fact.fact_id))
        .flatMap((fact) => codeSurfaceKeys(fact.content)))
      const operational = sourceFacts.flatMap((fact) => {
        if (selected.fact_ids.includes(fact.fact_id) || !explicitCodeSurface(fact.content)) return []
        const keys = codeSurfaceKeys(fact.content)
        if (keys.length > 0 && keys.every((key) => seenSurfaces.has(key))) return []
        keys.forEach((key) => seenSurfaces.add(key))
        return [fact.fact_id]
      })
      return [...selected.fact_ids, ...operational].slice(0, limit)
    }
  }
  const limit = target.observable_behavior === "recognize"
    ? 1
    : target.observable_behavior === "explain"
      ? 2
      : 6
  return target.required_fact_ids.slice(0, limit)
}

function explicitCodeSurface(content: string): boolean {
  return /(?:[A-Za-z_][\w.]*\s*\([^)]*\)|(?:==|!=|<=|>=|\+=|-=|\*=|\/=|\*\*|\/\/)|\[[^\]]*\]|\{[^}]*\}|\s=\s|\b(?:for|while|if|elif|else|def|return|import|try|except|finally|with|break|continue|raise|del|print|input|len|sum|range)\b|调用函数|函数体|函数名.*(?:圆括号|冒号)|缩进)/u.test(content)
}

function codeSurfaceKeys(content: string): string[] {
  const keys = new Set<string>()
  for (const match of content.matchAll(/([A-Za-z_][\w.]*)\s*\(/gu)) keys.add(`call:${match[1]}`)
  if (/\b(?:for|while)\b/u.test(content)) keys.add("loop")
  if (/\b(?:if|elif|else)\b/u.test(content)) keys.add("branch")
  if (/\b(?:def|return)\b/u.test(content)) keys.add("function")
  if (/调用函数|函数调用/u.test(content)) keys.add("function_call")
  if (/函数体/u.test(content)) keys.add("function_body")
  if (/函数名.*(?:圆括号|冒号)/u.test(content)) keys.add("function_signature")
  if (/缩进/u.test(content)) keys.add("indentation")
  for (const name of ["print", "input", "len", "sum", "range"]) {
    if (new RegExp(`\\b${name}\\b`, "u").test(content)) keys.add(`call:${name}`)
  }
  if (/(?:list|列表|字符串|字典|元组)?\s*\[[^\]]+\]/u.test(content)) keys.add("index")
  else if (/\[\]/u.test(content)) keys.add("list_literal")
  if (/\{[^}]*\}/u.test(content)) keys.add("mapping_literal")
  if (/(?:==|!=|<=|>=|\+=|-=|\*=|\/=|\*\*|\/\/)/u.test(content)) keys.add("operator")
  if (/\s=\s/u.test(content)) keys.add("assignment")
  return [...keys]
}

export function validateCodeLabPublicAuthorAgainstPlan(
  payload: CodeLabPublicAuthorPayload,
  plan: CodeLabObjectivePlan[],
  taskContract?: {
    learner_action: "recall_fact" | "implement_program" | "implement_function"
    learner_owned_region: "fact_literal" | "program_logic" | "function_body"
    input_form: "function_arguments" | "stdin_lines" | "none"
  },
  practicalGuidePlan?: PracticalGuidePlan,
  programmingProblem?: ProgrammingProblemBlueprint,
  evidence?: RagEvidencePack,
): string[] {
  const issues: string[] = []
  if (payload.objectives.length !== plan.length) {
    issues.push(`objectives 数量应为 ${plan.length}，实际 ${payload.objectives.length}`)
  }
  payload.objectives.forEach((entry, index) => {
    if (entry.hints.length !== 3) {
      issues.push(`objectives[${index}].hints 必须恰好包含三级提示`)
    }
    if (payload.execution_contract.execution_mode === "function"
      && !isFunctionInvocationEnvelope(entry.public_test.input)) {
      issues.push(
        `objectives[${index}].public_test.input 必须使用 {"args": [...], "kwargs"?: {...}} 调用封装`,
      )
    }
    if (taskContract?.learner_action === "recall_fact"
      && !isEmptyProgramInput(entry.public_test.input)) {
      issues.push(`objectives[${index}].public_test.input recall_fact 任务必须为空输入`)
    }
    const normalizedHints = entry.hints.map(normalizeHintText)
    if (new Set(normalizedHints).size !== normalizedHints.length) {
      issues.push(`objectives[${index}].hints 三级提示不得重复或只改标点`)
    }
    if (entry.hints.some((hint) => GENERIC_CODE_LAB_HINT.test(hint))) {
      issues.push(`objectives[${index}].hints 必须针对当前实验内容生成，不得使用通用占位提示`)
    }
    const hintAnchors = hintAnchorsForPlan(plan[index], evidence)
    if (hintAnchors.length > 0) {
      const anchoredCount = entry.hints.filter((hint) =>
        hintAnchors.some((anchor) => normalizeHintText(hint).includes(anchor))).length
      if (anchoredCount < 2) {
        issues.push(`objectives[${index}].hints 至少两级必须点明当前事实、概念或操作`)
      }
    }
  })
  const allHints = payload.objectives.flatMap((entry) => entry.hints.map(normalizeHintText))
  if (payload.objectives.length > 1 && new Set(allHints).size !== allHints.length) {
    issues.push("不同 objective 的提示不得复用同一套文案")
  }
  if (taskContract?.learner_action === "recall_fact") {
    const executable = payload.starter_code
      .split(/\r?\n/u)
      .map((line) => line.replace(/#.*$/u, "").trim())
      .filter(Boolean)
      .join("\n")
    if (taskContract.input_form !== "none"
      || /\binput\s*\(|^(?:if|elif|else|for|while|match|case)\b/mu.test(executable)) {
      issues.push("starter_code recall_fact 任务不得把输入解析、条件或循环留给学习者")
    }
    if (!/TODO|待填|补全/u.test(payload.starter_code)) {
      issues.push("starter_code recall_fact 任务必须明确标出事实文本待填区")
    }
    if (/raise\s+NotImplementedError/u.test(payload.starter_code)
      || !/=\s*["'][^"'\n]*(?:TODO|待填|补全)[^"'\n]*["']/u.test(payload.starter_code)
      || !/\bprint\s*\(/u.test(payload.starter_code)) {
      issues.push("starter_code recall_fact 任务必须提供事实文本赋值与 print 输出胶水，只保留字符串占位由学习者替换")
    }
  }
  if (practicalGuidePlan && !payload.practical_guide) {
    issues.push("缺少 practical_guide")
  } else if (practicalGuidePlan && payload.practical_guide) {
    issues.push(...validatePracticalGuideAuthorAgainstPlan(payload.practical_guide, practicalGuidePlan))
  }
  if (programmingProblem && !payload.programming_task) {
    issues.push("缺少 programming_task")
  } else if (programmingProblem && payload.programming_task) {
    const task = payload.programming_task
    if (!task.statement.trim()) issues.push("programming_task.statement 不能为空")
    if (!task.input_description.trim()) issues.push("programming_task.input_description 不能为空")
    if (!task.output_description.trim()) issues.push("programming_task.output_description 不能为空")
    if (task.constraints.length < 2) issues.push("programming_task.constraints 至少包含 2 条可核验约束")
    const publicInputs = [
      ...payload.objectives.map((objective) => objective.public_test.input),
      ...(task.additional_public_examples ?? []).map((example) => example.input),
    ]
    if (publicInputs.length < programmingProblem.public_case_count) {
      issues.push(`programming_task 公开样例至少需要 ${programmingProblem.public_case_count} 个`)
    }
    if (new Set(publicInputs.map((input) => JSON.stringify(input))).size !== publicInputs.length) {
      issues.push("programming_task 公开样例输入不得重复")
    }
    if (programmingProblem.submission_mode === "gap_answers") {
      if (!task.gap_template) issues.push("code_completion 缺少 gap_template")
      else {
        issues.push(...validateGapTemplate(task.gap_template).map((entry) => `gap_template: ${entry}`))
        issues.push(...validateGapLearnerContract({ ...task, gap_template: task.gap_template })
          .map((entry) => `learner_contract: ${entry}`))
      }
    } else if (task.gap_template) {
      issues.push(`${programmingProblem.task_kind} 不得返回 gap_template`)
    }
  }
  issues.push(...codeLabExecutionContractIssues(
    payload.execution_contract,
    "execution_contract",
    payload.objectives.flatMap((entry) => [
      entry.instruction_text,
      entry.public_test.description,
      entry.public_test.expected_behavior,
      ...entry.hints,
    ]),
    payload.starter_code,
  ))
  return issues
}

const GENERIC_CODE_LAB_HINT = /^(?:先定位本目标要求表达的核心事实|确认填写内容保留了事实中的主语、对象和关系|只替换\s*TODO\s*字符串|先找到题面中.*目标句子|输入框只填写等号右边的内容)/u

function normalizeHintText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[\s，。！？；：、,.!?;:'"“”‘’`()（）\[\]【】_-]+/gu, "")
}

function hintAnchorsForPlan(
  plan: CodeLabObjectivePlan | undefined,
  evidence: RagEvidencePack | undefined,
): string[] {
  if (!plan || !evidence) return []
  const cited = new Set(plan.citations.map((citation) => `${citation.source_id}:${citation.fact_id}`))
  const text = evidence.results.flatMap((source) => [
    ...(source.source_id === plan.source_id ? [source.title] : []),
    ...source.facts.flatMap((fact) => cited.has(`${fact.source_id}:${fact.fact_id}`) ? [fact.content] : []),
  ]).join(" ")
  const tokens = text.match(/[A-Za-z_][A-Za-z0-9_]{2,}|[\p{Script=Han}]{2,8}/gu) ?? []
  return [...new Set(tokens.map(normalizeHintText).filter((token) => token.length >= 2))].slice(0, 24)
}

function isEmptyProgramInput(value: unknown): boolean {
  return value === "" || value == null
}

export function materializeCodeLabPublicAuthorPayload(
  request: CodeLabRequest,
  payload: CodeLabPublicAuthorPayload,
  labId: string,
  plan: CodeLabObjectivePlan[],
  practicalGuidePlan?: PracticalGuidePlan,
  programmingProblem?: import("../programming/contracts").ProgrammingProblemBlueprint,
): CodeLabPublicPayload {
  const facts = new Map(request.evidence_pack.results.flatMap((entry) =>
    entry.facts.map((fact) => [
      `${fact.source_id}:${fact.fact_id}`,
      fact.content,
    ] as const)))
  const tests = plan.map((entry, index) => ({
    test_id: entry.public_test_id,
    objective_id: entry.objective_id,
    description: payload.objectives[index]!.public_test.description.trim(),
    input: structuredClone(payload.objectives[index]!.public_test.input),
    expected_behavior: payload.objectives[index]!.public_test.expected_behavior.trim(),
    citations: structuredClone(entry.citations),
  }))
  const publicPayload: CodeLabPublicPayload = {
    lab_id: labId,
    title: payload.title.trim(),
    objective_ids: request.generation_spec.targets.map((target) =>
      target.objective_id),
    instructions: plan.map((entry, index) => ({
      block_id: entry.instruction_block_id,
      block_type: "paragraph",
      text: payload.objectives[index]!.instruction_text.trim(),
      claims: entry.citations.map((citation, citationIndex) => ({
        claim_id: stableId("LAB-CLAIM", {
          spec_id: request.generation_spec.spec_id,
          objective_id: entry.objective_id,
          fact_id: citation.fact_id,
          citation_index: citationIndex,
        }),
        text: facts.get(`${citation.source_id}:${citation.fact_id}`) ?? "",
        citations: [{ ...citation, relation: "supports" as const }],
      })),
    })),
    execution_contract: structuredClone(payload.execution_contract),
    starter_code: programmingProblem?.submission_mode === "gap_answers"
      && payload.programming_task?.gap_template
      ? failClosedStarterCode(payload.programming_task.gap_template)
      : payload.starter_code,
    public_tests: tests,
    hint_ladders: plan.map((entry, index) => ({
      objective_id: entry.objective_id,
      hints: payload.objectives[index]!.hints.map((text, hintIndex) => ({
        hint_level: (hintIndex + 1) as 1 | 2 | 3,
        text: text.trim(),
        citations: structuredClone(entry.citations),
      })),
    })),
    reflection_questions: payload.objectives.map((entry) =>
      entry.reflection_question.trim()),
    ...(programmingProblem && payload.programming_task ? {
      programming_task: {
        schema_version: "programming-task.v1" as const,
        task_id: stableId("PROGRAMMING-TASK", {
          lab_id: labId,
          blueprint_id: programmingProblem.blueprint_id,
        }),
        blueprint_id: programmingProblem.blueprint_id,
        task_kind: programmingProblem.task_kind,
        submission_mode: programmingProblem.submission_mode,
        statement: payload.programming_task.statement.trim(),
        input_description: payload.programming_task.input_description.trim(),
        output_description: payload.programming_task.output_description.trim(),
        constraints: payload.programming_task.constraints.map((entry) => entry.trim()).filter(Boolean),
        ...(programmingProblem.submission_mode === "gap_answers" && payload.programming_task.gap_template
          ? { gap_template: structuredClone(payload.programming_task.gap_template) }
          : { starter_code: payload.starter_code }),
        public_examples: [
          ...tests.map((test) => ({
          case_id: test.test_id,
          description: test.description,
          input: structuredClone(test.input),
          expected_behavior: test.expected_behavior,
          })),
          ...(payload.programming_task.additional_public_examples ?? []).map((example, index) => ({
            case_id: stableId("PROGRAMMING-PUBLIC-EXAMPLE", { lab_id: labId, index }),
            description: example.description.trim(),
            input: structuredClone(example.input),
            expected_behavior: example.expected_behavior.trim(),
          })),
        ],
        hint_ladders: payload.objectives.flatMap((objective) =>
          objective.hints.map((text, index) => ({ level: (index + 1) as 1 | 2 | 3, text: text.trim() }))),
      },
    } : {}),
    ...(practicalGuidePlan && payload.practical_guide ? {
      practical_guide: materializePracticalGuide({
        plan: practicalGuidePlan,
        author: payload.practical_guide,
        execution_contract: payload.execution_contract,
        public_tests: tests,
      }),
    } : {}),
    objective_coverage: plan.map((entry) => ({
      objective_id: entry.objective_id,
      instruction_block_ids: [entry.instruction_block_id],
      public_test_ids: [entry.public_test_id],
    })),
    used_evidence: plan.flatMap((entry) => structuredClone(entry.citations)),
  }
  return normalizeCodeLabPublic(request, publicPayload, labId, plan)
}

export function validateCodeLabPublicAgainstPlan(
  payload: CodeLabPublicPayload,
  plan: CodeLabObjectivePlan[],
): string[] {
  const issues: string[] = []
  if (payload.instructions.length !== plan.length) {
    issues.push(`instructions 数量应为 ${plan.length}，实际 ${payload.instructions.length}`)
  }
  if (payload.public_tests.length !== plan.length) {
    issues.push(`public_tests 数量应为 ${plan.length}，实际 ${payload.public_tests.length}`)
  }
  if (payload.hint_ladders.length !== plan.length) {
    issues.push(`hint_ladders 数量应为 ${plan.length}，实际 ${payload.hint_ladders.length}`)
  }
  payload.instructions.forEach((block, index) => {
    if (!("claims" in block) || block.claims.length === 0) {
      issues.push(`instructions[${index}] 必须包含可绑定事实的 claims`)
    }
  })
  payload.hint_ladders.forEach((ladder, index) => {
    if (ladder.hints.length !== 3) {
      issues.push(`hint_ladders[${index}] 必须恰好包含三级提示`)
    }
  })
  issues.push(...codeLabExecutionContractIssues(
    payload.execution_contract,
    "execution_contract",
    [
      ...payload.instructions.map((block) => "text" in block ? block.text : ""),
      ...payload.public_tests.flatMap((test) => [test.description, test.expected_behavior]),
      ...payload.hint_ladders.flatMap((ladder) => ladder.hints.map((hint) => hint.text)),
    ],
    payload.starter_code,
  ))
  if (payload.execution_contract.execution_mode === "function") {
    payload.public_tests.forEach((test, index) => {
      if (!isFunctionInvocationEnvelope(test.input)) {
        issues.push(`public_tests[${index}].input 必须使用 {"args": [...], "kwargs"?: {...}} 调用封装`)
      }
    })
  }
  return issues
}

export function normalizeCodeLabPublic(
  request: CodeLabRequest,
  payload: CodeLabPublicPayload,
  labId: string,
  plan: CodeLabObjectivePlan[] = buildCodeLabObjectivePlan(
    request.generation_spec,
    request.evidence_pack,
  ),
): CodeLabPublicPayload {
  const normalized = structuredClone(payload)
  normalized.lab_id = labId
  normalized.objective_ids = request.generation_spec.targets.map((target) => target.objective_id)
  const facts = new Map(request.evidence_pack.results.flatMap((entry) =>
    entry.facts.map((fact) => [
      `${fact.source_id}:${fact.fact_id}`,
      fact.content,
    ] as const)))
  normalized.instructions = plan.map((entry, index) => {
    const block = structuredClone(payload.instructions[index]!)
    block.block_id = entry.instruction_block_id
    if ("claims" in block) {
      block.claims = entry.citations.map((citation, citationIndex) => ({
        claim_id: stableId("LAB-CLAIM", {
          spec_id: request.generation_spec.spec_id,
          objective_id: entry.objective_id,
          fact_id: citation.fact_id,
          citation_index: citationIndex,
        }),
        text: facts.get(`${citation.source_id}:${citation.fact_id}`) ?? "",
        citations: [{ ...citation, relation: "supports" as const }],
      }))
      anchorRenderedClaim(block)
    }
    return block
  })
  normalized.public_tests = plan.map((entry, index) => ({
    ...structuredClone(payload.public_tests[index]!),
    test_id: entry.public_test_id,
    objective_id: entry.objective_id,
    citations: structuredClone(entry.citations),
  }))
  normalized.hint_ladders = plan.map((entry, index) => ({
    ...structuredClone(payload.hint_ladders[index]!),
    objective_id: entry.objective_id,
    hints: payload.hint_ladders[index]!.hints.map((hint, hintIndex) => ({
      ...structuredClone(hint),
      hint_level: (hintIndex + 1) as 1 | 2 | 3,
      citations: structuredClone(entry.citations),
    })),
  }))
  normalized.objective_coverage = plan.map((entry) => ({
    objective_id: entry.objective_id,
    instruction_block_ids: [entry.instruction_block_id],
    public_test_ids: [entry.public_test_id],
  }))
  normalized.used_evidence = collectCodeLabCitations(normalized)
  normalizeGuidedFactOutputTask(request, normalized, plan, facts)
  return normalized
}

/**
 * A recognize/explain objective without executable evidence becomes a guided
 * first-run exercise.  Freeze its learner wording here so the page always says
 * exactly what to enter and why, instead of exposing model jargon or asking the
 * learner to guess a hidden sentence.
 */
function normalizeGuidedFactOutputTask(
  request: CodeLabRequest,
  payload: CodeLabPublicPayload,
  plan: CodeLabObjectivePlan[],
  facts: Map<string, string>,
): void {
  const contract = request.resource_blueprint?.code_lab.task_contract
  const task = payload.programming_task
  if (contract?.learner_action !== "recall_fact"
    || !task?.gap_template
    || task.gap_template.gaps.length !== 1) return
  const primaryPlan = plan.find((entry) => entry.objective_id === contract.primary_objective_id)
    ?? plan[0]
  const citation = primaryPlan?.citations[0]
  const fact = citation ? facts.get(`${citation.source_id}:${citation.fact_id}`)?.trim() : undefined
  if (!fact) return
  const sourceTitle = request.evidence_pack.results.find((entry) =>
    entry.source_id === citation!.source_id)?.title?.trim()
    ?? request.generation_spec.path_node.goal?.trim()
    ?? "本节知识"
  const gap = task.gap_template.gaps[0]!
  payload.title = `${sourceTitle}：完成第一次输出`
  task.statement = [
    "这是一道引导式运行练习，不需要你猜答案，也不需要编写整段程序。",
    `请在右侧唯一的输入框中填写一个带引号的 Python 字符串，让程序输出：${fact}`,
    "系统会把你填写的内容放到等号右边，然后运行完整程序。",
  ].join("\n")
  task.input_description = "本题没有外部输入；你只填写右侧的一个空格。"
  task.output_description = `程序应完整输出：${fact}`
  task.constraints = [
    "只填写等号右边的内容，不要输入 fact_text =，也不要复制 print 语句",
    "填写内容必须带英文单引号或双引号，例如：\"一行文字\"",
  ]
  gap.label = "要输出的文字（需要包含引号）"
  gap.kind = "expression"
  gap.answer_format = "python_string_literal"
  gap.max_lines = 1
  gap.placeholder = "例如：\"一行文字\""
  const authoredLadder = payload.hint_ladders.find((ladder) =>
    ladder.objective_id === primaryPlan?.objective_id) ?? payload.hint_ladders[0]
  task.hint_ladders = authoredLadder?.hints.map((hint, index) => ({
    level: (index + 1) as 1 | 2 | 3,
    text: hint.text,
  })) ?? []
  payload.instructions = payload.instructions.map((block) => {
    if (block.block_type !== "paragraph") return block
    block.text = "本题的目标是完成一次清晰的“填写—运行—核对输出”操作。你只需填写一个带引号的字符串，程序的赋值和输出结构已经提供。"
    anchorRenderedClaim(block)
    return block
  })
  payload.public_tests = payload.public_tests.map((test) => ({
    ...test,
    description: "运行填写后的完整程序",
    expected_behavior: `标准输出应为：${fact}`,
  }))
  task.public_examples = task.public_examples.map((example) => ({
    ...example,
    description: "运行填写后的完整程序",
    expected_behavior: `标准输出应为：${fact}`,
  }))
  payload.reflection_questions = ["运行前，你填写的是完整代码，还是只填写等号右边的字符串？"]
}

/**
 * Freezes secure identities and coverage without fabricating executable
 * semantics. The model authors tests, expected values and reference code; the
 * isolated runner proves them afterwards. Mutation diagnostics are optional.
 */
export function buildCodeLabSecurePlan(
  spec: GenerationSpec,
  suiteId: string,
  misconceptionIdsByObjective: Record<string, string> = {},
  programmingProblem?: ProgrammingProblemBlueprint,
): CodeLabSecurePlan {
  if (spec.targets.length === 0) {
    throw new ModelOutputValidationError("code-lab.secure.plan", ["GenerationSpec 没有可规划的目标"])
  }
  const caseKinds: CodeLabSecurePlan["hidden_tests"][number]["case_kind"][] = programmingProblem
    ? programmingProblem.test_partitions.flatMap((partition) =>
        Array.from({ length: partition.minimum_cases }, () => partition.kind)).slice(0, programmingProblem.hidden_case_count)
    : spec.targets.map(() => "normal" as const)
  while (programmingProblem && caseKinds.length < programmingProblem.hidden_case_count) {
    caseKinds.push("anti_hardcode")
  }
  const objectiveWeight = 1 / caseKinds.length
  const hiddenTests = caseKinds.map((caseKind, index) => {
    const target = spec.targets[index % spec.targets.length]!
    return {
      test_id: stableId("LAB-HIDDEN-TEST", {
        test_suite_id: suiteId,
        objective_id: target.objective_id,
        case_kind: caseKind,
        case_index: index,
      }),
      objective_id: target.objective_id,
      case_kind: caseKind,
      weight: objectiveWeight,
    }
  })
  const mutationCount = programmingProblem?.required_mutation_count ?? spec.targets.length
  return {
    hidden_tests: hiddenTests,
    mutation_variants: Array.from({ length: mutationCount }, (_, index) => {
      const target = spec.targets[index % spec.targets.length]!
      const targetTests = hiddenTests.filter((test) => test.objective_id === target.objective_id)
      return {
      mutation_id: stableId("LAB-MUTATION", {
        test_suite_id: suiteId,
        objective_id: target.objective_id,
        mutation_index: index,
      }),
      objective_ids: [target.objective_id],
      must_fail_test_ids: [targetTests[index % targetTests.length]!.test_id],
      misconception_id: misconceptionIdsByObjective[target.objective_id]
        ?? `MIS-${target.objective_id}-COMMON-ERROR`,
      }
    }),
  }
}

export function validateCodeLabSecureAgainstPlan(
  payload: CodeLabSecurePayload,
  plan: CodeLabSecurePlan,
): string[] {
  const issues: string[] = []
  if (payload.hidden_tests.length !== plan.hidden_tests.length) {
    issues.push(`hidden_tests 数量应为 ${plan.hidden_tests.length}，实际 ${payload.hidden_tests.length}`)
  }
  plan.hidden_tests.forEach((expected, index) => {
    const actual = payload.hidden_tests[index]
    if (!actual) return
    if (actual.test_id !== expected.test_id) issues.push(`hidden_tests[${index}].test_id 未按 objective_plan 返回`)
    if (actual.objective_id !== expected.objective_id) issues.push(`hidden_tests[${index}].objective_id 未按 objective_plan 返回`)
  })
  const mappings = new Map<string, number>()
  payload.misconception_map.forEach((entry) => {
    mappings.set(entry.failed_test_id, (mappings.get(entry.failed_test_id) ?? 0) + 1)
  })
  for (const test of plan.hidden_tests) {
    if (mappings.get(test.test_id) !== 1) {
      issues.push(`misconception_map 必须恰好映射一次计划测试 ${test.test_id}`)
    }
  }
  if (payload.mutation_variants.length !== plan.mutation_variants.length) {
    issues.push(`mutation_variants 数量应为 ${plan.mutation_variants.length}，实际 ${payload.mutation_variants.length}`)
  }
  plan.mutation_variants.forEach((expected, index) => {
    const actual = payload.mutation_variants[index]
    if (!actual) return
    if (actual.mutation_id !== expected.mutation_id) issues.push(`mutation_variants[${index}].mutation_id 未按计划返回`)
    if (actual.misconception_tag !== expected.misconception_id) issues.push(`mutation_variants[${index}] 未绑定计划误区`)
  })
  if (payload.execution_contract.execution_mode === "function") {
    payload.hidden_tests.forEach((test, index) => {
      if (!isFunctionInvocationEnvelope(test.input)) {
        issues.push(`hidden_tests[${index}].input 必须使用 {"args": [...], "kwargs"?: {...}} 调用封装`)
      }
    })
  }
  return issues
}

/**
 * Tolerates json_object-mode authoring sloppiness that would otherwise fail the
 * staged gate: sloppy comparison objects, string-typed numeric expected values,
 * bare (non-envelope) function inputs, and surplus hidden tests. The strict
 * materialized draft and the trusted runner still own semantic correctness.
 */
export function normalizeCodeLabSecureAuthorPayloadLenient(
  payload: CodeLabSecureAuthorPayload,
  plan: CodeLabSecurePlan,
  executionMode: CodeLabPublicPayload["execution_contract"]["execution_mode"],
  _publicInputs: unknown[] = [],
  outputContract?: CodeLabPublicPayload["execution_contract"]["output_contract"],
): CodeLabSecureAuthorPayload {
  const normalized = structuredClone(payload)
  if (normalized.hidden_tests.length > plan.hidden_tests.length) {
    normalized.hidden_tests = normalized.hidden_tests.slice(0, plan.hidden_tests.length)
  }
  for (const test of normalized.hidden_tests) {
    test.comparison ??= { kind: "exact" }
    if (test.expected !== undefined) {
      const outputKind = outputContract ? classifyOutputContract(outputContract) : undefined
      test.comparison = outputKind === "number"
        ? { kind: "numeric", abs_tolerance: 1e-9, rel_tolerance: 1e-9 }
        : outputKind && outputKind !== "unknown"
          ? { kind: "exact" }
          : canonicalizeTestComparison(test.comparison as unknown, test.expected)
      if (test.comparison.kind === "numeric" && typeof test.expected === "string") {
        const coerced = Number(test.expected.trim())
        if (Number.isFinite(coerced)) test.expected = coerced
      }
      if (executionMode === "stdin_stdout" && typeof test.expected !== "string") {
        test.expected = Array.isArray(test.expected) || (test.expected && typeof test.expected === "object")
          ? JSON.stringify(test.expected)
          : String(test.expected)
      }
    }
    if (executionMode === "function") {
      // Shape normalization must not rewrite executable semantics: changing a
      // hidden input without recomputing expected creates a different test.
      // Public/private disjointness is repaired by the model with both fields.
      test.input = coerceFunctionInvocation(test.input)
    } else {
      // stdin_stdout 模式：模型常按函数习惯写 args 封装，必须转换为 stdin 文本，
      // 否则 harness 无输入、reference 无输出，可信执行必然失败。
      test.input = asStandardInput(test.input)
    }
  }
  return normalized
}

/** Maps model-authored comparison shapes onto the strict TestComparison contract. */
export function canonicalizeTestComparison(value: unknown, expected: unknown): TestComparison {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    const kind = typeof record.kind === "string" ? record.kind : undefined
    if (kind === "exact") return { kind: "exact" }
    if (kind === "numeric") {
      const tolerance = finiteNumber(record.tolerance)
      const abs = finiteNumber(record.abs_tolerance)
        ?? finiteNumber(record.absTolerance)
        ?? tolerance
        ?? 1e-9
      const rel = finiteNumber(record.rel_tolerance)
        ?? finiteNumber(record.relTolerance)
        ?? tolerance
        ?? 1e-9
      return { kind: "numeric", abs_tolerance: abs, rel_tolerance: rel }
    }
  }
  return typeof expected === "number"
    || (typeof expected === "string" && Number.isFinite(Number(expected.trim())))
    ? { kind: "numeric", abs_tolerance: 1e-9, rel_tolerance: 1e-9 }
    : { kind: "exact" }
}

/**
 * Wraps bare model-authored inputs into the {"args": [...], "kwargs": {}} call
 * envelope required by function-mode execution. Bare objects with a single key
 * (e.g. {"scores": [...]}) are treated as one named parameter whose value is
 * passed positionally; multi-key objects remain a single dict argument.
 */
function flattenInputScalars(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(flattenInputScalars)
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).flatMap(flattenInputScalars)
  return value === undefined ? [] : [value]
}

export function chooseDistinctFunctionInput(
  input: unknown,
  publicInputs: unknown[],
): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input
  const record = structuredClone(input) as Record<string, unknown>
  if (!Array.isArray(record.args)) return input
  const candidate = { ...record, args: [...record.args] }
  const used = new Set(publicInputs.map((value) => JSON.stringify(value)))
  const publicScalars = new Set(publicInputs.flatMap(flattenInputScalars).map((value) => JSON.stringify(value)))
  const conflicts = () => used.has(JSON.stringify(candidate))
    || flattenInputScalars(candidate).some((value) => publicScalars.has(JSON.stringify(value)))
  for (let attempt = 0; attempt < 20 && conflicts(); attempt += 1) {
    candidate.args = candidate.args.map((value, index) => {
      if (index !== 0) return value
      if (typeof value === "number") return value + 1 + attempt
      if (typeof value === "string") return `${value}_hidden_${attempt + 1}`
      if (typeof value === "boolean") return !value
      if (Array.isArray(value)) return [...value, attempt + 1]
      if (value && typeof value === "object") return { ...(value as Record<string, unknown>), __case: attempt + 1 }
      return attempt + 1
    })
  }
  return candidate
}

export function coerceFunctionInvocation(input: unknown): unknown {
  if (input === null || input === undefined) return { args: [], kwargs: {} }
  if (Array.isArray(input)) return { args: [input], kwargs: {} }
  if (typeof input !== "object") return { args: [input], kwargs: {} }
  const record = input as Record<string, unknown>
  const keys = Object.keys(record)
  if (keys.length === 0) return { args: [], kwargs: {} }
  if (isFunctionInvocationEnvelope(record)) return input
  const kwargs = typeof record.kwargs === "object"
    && record.kwargs !== null
    && !Array.isArray(record.kwargs)
    ? record.kwargs
    : {}
  if (keys.length === 1 && keys[0] !== "kwargs") {
    return { args: [record[keys[0]!]], kwargs }
  }
  return { args: [record], kwargs: {} }
}

export function validateCodeLabSecureAuthorAgainstPlan(
  payload: CodeLabSecureAuthorPayload,
  plan: CodeLabSecurePlan,
  executionMode: CodeLabPublicPayload["execution_contract"]["execution_mode"],
  programmingProblem?: ProgrammingProblemBlueprint,
): string[] {
  const issues: string[] = []
  if (payload.hidden_tests.length !== plan.hidden_tests.length) {
    issues.push(`hidden_tests 数量应为 ${plan.hidden_tests.length}，实际 ${payload.hidden_tests.length}`)
  }
  if (executionMode === "function") {
    payload.hidden_tests.forEach((test, index) => {
      if (!isFunctionInvocationEnvelope(test.input)) {
        issues.push(`hidden_tests[${index}].input 必须使用 {"args": [...], "kwargs"?: {...}} 调用封装`)
      }
    })
  }
  if (payload.mutation_variants.length !== plan.mutation_variants.length) {
    issues.push(`mutation_variants 数量应为 ${plan.mutation_variants.length}，实际 ${payload.mutation_variants.length}`)
  }
  if (programmingProblem?.require_secondary_oracle && !payload.secondary_reference_solution?.trim()) {
    issues.push("当前 programming_problem 要求 secondary_reference_solution")
  }
  if (!programmingProblem?.require_secondary_oracle && payload.secondary_reference_solution) {
    issues.push("当前 programming_problem 不需要 secondary_reference_solution")
  }
  if (programmingProblem) {
    payload.hidden_tests.forEach((test, index) => {
      const expectedKind = plan.hidden_tests[index]?.case_kind
      if (test.partition_id !== expectedKind) {
        issues.push(`hidden_tests[${index}].partition_id 应为 ${expectedKind}，实际 ${test.partition_id ?? "missing"}`)
      }
      if (!test.note?.trim()) issues.push(`hidden_tests[${index}].note 不能为空`)
    })
  }
  return issues
}

export function materializeCodeLabSecureAuthorPayload(
  spec: GenerationSpec,
  payload: CodeLabSecureAuthorPayload,
  publicPayload: CodeLabPublicPayload,
  suiteId: string,
  plan: CodeLabSecurePlan = buildCodeLabSecurePlan(spec, suiteId),
  trustedExpectedMaterialization = false,
): CodeLabSecurePayload {
  const draft: CodeLabSecurePayload = {
    lab_id: publicPayload.lab_id,
    test_suite_id: suiteId,
    execution_contract: structuredClone(publicPayload.execution_contract),
    reference_solution: payload.reference_solution,
    ...(payload.secondary_reference_solution
      ? { secondary_reference_solution: payload.secondary_reference_solution }
      : {}),
    hidden_tests: plan.hidden_tests.map((entry, index) => ({
      test_id: entry.test_id,
      objective_id: entry.objective_id,
      weight: entry.weight,
      input: structuredClone(payload.hidden_tests[index]!.input),
      expected: trustedExpectedMaterialization
        ? { __trusted_expected_pending__: true }
        : structuredClone(payload.hidden_tests[index]!.expected),
      comparison: trustedExpectedMaterialization
        ? classifyOutputContract(publicPayload.execution_contract.output_contract) === "number"
          ? { kind: "numeric" as const, abs_tolerance: 1e-9, rel_tolerance: 1e-9 }
          : { kind: "exact" as const }
        : structuredClone(payload.hidden_tests[index]!.comparison ?? { kind: "exact" as const }),
      ...(payload.hidden_tests[index]!.partition_id
        ? { partition_id: payload.hidden_tests[index]!.partition_id }
        : {}),
      ...(payload.hidden_tests[index]!.note
        ? { note: payload.hidden_tests[index]!.note!.trim() }
        : {}),
    })),
    scoring_groups: [],
    misconception_map: plan.hidden_tests.map((entry, index) => ({
      failed_test_id: entry.test_id,
      misconception_tag: payload.hidden_tests[index]!.misconception_tag,
    })),
    mutation_variants: plan.mutation_variants.map((entry, index) => ({
      mutation_id: entry.mutation_id,
      objective_ids: [...entry.objective_ids],
      must_fail_test_ids: [...entry.must_fail_test_ids],
      code: payload.mutation_variants[index]!.code,
      misconception_tag: entry.misconception_id,
    })),
    objective_coverage: [],
  }
  return normalizeCodeLabSecure(spec, draft, publicPayload, suiteId, plan)
}

/**
 * A recall-fact lab has a fully frozen execution meaning: empty stdin and one
 * authoritative fact printed to stdout. The model still authors the learner-
 * facing task, but must not invent the private executable oracle for this
 * contract; doing so previously allowed loops or input reads to turn a valid
 * fact exercise into a trusted-runner timeout.
 */
export function materializeRecallFactSecureAuthorPayload(
  request: CodeLabRequest,
  plan: CodeLabSecurePlan,
): CodeLabSecureAuthorPayload {
  const primary = request.generation_spec.targets.find((target) => target.is_primary)
    ?? request.generation_spec.targets[0]
  if (!primary) throw new ModelOutputValidationError("role-c.code-lab.secure", ["recall_fact 缺少主目标"])
  const evidence = request.evidence_pack.results.find((item) => item.source_id === primary.source_id)
  const factId = primary.required_fact_ids[0]
  const fact = evidence?.facts.find((entry) => entry.fact_id === factId)
  if (!fact) {
    throw new ModelOutputValidationError("role-c.code-lab.secure", [
      `recall_fact 缺少权威事实 ${primary.source_id}:${factId ?? "unknown"}`,
    ])
  }
  const literal = JSON.stringify(fact.content)
  const referenceSolution = `fact_text = ${literal}\nprint(fact_text)`
  const misconception = evidence?.misconceptions?.find((entry) =>
    entry.factRefs.some((reference) =>
      reference.sourceId === primary.source_id && reference.factId === factId))
  // A mutation represents a completed but conceptually wrong learner answer,
  // never the public TODO skeleton.  Reusing TODO here made the private
  // mutation byte-for-byte visible in the public starter and correctly
  // triggered MUTATION_CODE_LEAK on every recall-fact lab.
  const incorrectText = misconception?.incorrectBelief
    ?? `错误说法：${fact.content}`
  const mutationCode = `fact_text = ${JSON.stringify(incorrectText)}\nprint(fact_text)`
  return {
    reference_solution: referenceSolution,
    hidden_tests: plan.hidden_tests.map((entry) => ({
      input: "",
      expected: `${fact.content}\n`,
      comparison: { kind: "exact" },
      misconception_tag: plan.mutation_variants.find((mutation) =>
        mutation.objective_ids.includes(entry.objective_id))?.misconception_id
        ?? `MIS-${entry.objective_id}`,
    })),
    mutation_variants: plan.mutation_variants.map((entry) => ({
      code: mutationCode,
      misconception_tag: entry.misconception_id,
    })),
  }
}

function normalizeCodeLabSecureHiddenInputs(
  payload: CodeLabSecurePayload,
  publicPayload: CodeLabPublicPayload,
): CodeLabSecurePayload {
  const normalized = structuredClone(payload)
  if (normalized.execution_contract.execution_mode === "function") {
    normalized.hidden_tests = normalized.hidden_tests.map((test) => ({
      ...test,
      input: coerceFunctionInvocation(test.input),
    }))
  }
  return normalized
}

export function normalizeCodeLabSecure(
  spec: GenerationSpec,
  payload: CodeLabSecurePayload,
  publicPayload: CodeLabPublicPayload,
  suiteId: string,
  plan: CodeLabSecurePlan = buildCodeLabSecurePlan(spec, suiteId),
): CodeLabSecurePayload {
  const normalized = normalizeCodeLabSecureHiddenInputs(payload, publicPayload)
  normalized.lab_id = publicPayload.lab_id
  normalized.test_suite_id = suiteId
  normalized.execution_contract = structuredClone(publicPayload.execution_contract)
  normalized.hidden_tests = plan.hidden_tests.map((entry, index) => {
    const { case_kind: _caseKind, ...identity } = entry
    return {
      ...structuredClone(payload.hidden_tests[index]!),
      ...identity,
    }
  })
  if (normalized.execution_contract.execution_mode === "function") {
    normalized.hidden_tests = normalized.hidden_tests.map((test) => ({
      ...test,
      input: coerceFunctionInvocation(test.input),
    }))
  }
  normalized.mutation_variants = plan.mutation_variants.length > 0
    ? plan.mutation_variants.map((entry, index) => ({
        ...structuredClone(payload.mutation_variants[index]!),
        mutation_id: entry.mutation_id,
        objective_ids: [...entry.objective_ids],
        must_fail_test_ids: [...entry.must_fail_test_ids],
        misconception_tag: entry.misconception_id,
      }))
    : structuredClone(payload.mutation_variants)
  normalized.scoring_groups = spec.targets.map((target) => {
    const tests = normalized.hidden_tests.filter((test) => test.objective_id === target.objective_id)
    return {
      group_id: stableId("GROUP", { test_suite_id: suiteId, objective_id: target.objective_id }),
      objective_id: target.objective_id,
      test_ids: tests.map((test) => test.test_id),
      weight: tests.reduce((sum, test) => sum + test.weight, 0),
    }
  })
  normalized.misconception_map = normalized.hidden_tests.map((test) => {
    const mutation = normalized.mutation_variants.find((entry) =>
      entry.objective_ids.includes(test.objective_id))
    const authored = payload.misconception_map.find((entry) =>
      entry.failed_test_id === test.test_id)
    return {
      failed_test_id: test.test_id,
      misconception_tag: authored?.misconception_tag
        ?? mutation?.misconception_tag
        ?? `objective_${test.objective_id}_misconception`,
    }
  })
  normalized.objective_coverage = spec.targets.map((target) => {
    const hiddenTestIds = unique(normalized.hidden_tests
      .filter((test) => test.objective_id === target.objective_id)
      .map((test) => test.test_id))
    const scoringGroupIds = unique(normalized.scoring_groups
      .filter((group) => group.objective_id === target.objective_id)
      .map((group) => group.group_id))
    const mutationIds = unique(normalized.mutation_variants
      .filter((mutation) => mutation.objective_ids.includes(target.objective_id))
      .map((mutation) => mutation.mutation_id))
    return {
      objective_id: target.objective_id,
      hidden_test_ids: hiddenTestIds,
      scoring_group_ids: scoringGroupIds,
      mutation_ids: mutationIds,
    }
  })
  return normalized
}

export function expectedOnlyReferenceFailureCodes(feedback: { reference_failure_codes?: string[]; issues?: string[] }): string[] {
  return feedback.reference_failure_codes
    ?? (feedback.issues ?? []).flatMap((entry) => {
      if (!entry.includes("reference_solution 未通过")) return []
      const separator = entry.indexOf("：")
      return separator >= 0 ? entry.slice(separator + 1).split(/、/).map((part) => part.trim()).filter(Boolean) : []
    })
}

export function isExpectedOnlyReferenceFailure(failureCodes: string[] | undefined): boolean {
  return Boolean(failureCodes?.length)
    && failureCodes!.every((code) => {
      const prefix = ":assertion_failed:expected="
      const actualMarker = ":actual="
      const prefixIndex = code.indexOf(prefix)
      const actualIndex = code.indexOf(actualMarker, prefixIndex + prefix.length)
      if (prefixIndex <= 0 || actualIndex < 0) return false
      try {
        JSON.parse(code.slice(actualIndex + actualMarker.length))
        return true
      } catch {
        return false
      }
    })
}

export function patchExpectedFromReferenceFailures<T extends { hidden_tests: Array<{ test_id: string; expected: unknown; comparison: TestComparison }> }>(
  securePayload: T,
  failureCodes: string[],
): T {
  const patched = structuredClone(securePayload)
  const byId = new Map(patched.hidden_tests.map((test) => [test.test_id, test]))
  for (const code of failureCodes) {
    const prefix = ":assertion_failed:expected="
    const prefixIndex = code.indexOf(prefix)
    const actualMarker = ":actual="
    const actualIndex = code.indexOf(actualMarker, prefixIndex + prefix.length)
    if (prefixIndex <= 0 || actualIndex < 0) continue
    const testId = code.slice(0, prefixIndex)
    const actualJson = code.slice(actualIndex + actualMarker.length)
    const target = byId.get(testId)
    if (!target) continue
    try {
      target.expected = JSON.parse(actualJson)
      target.comparison = canonicalizeTestComparison(target.comparison, target.expected)
    } catch {
      // Keep the original expected value when the runner did not emit JSON.
    }
  }
  return patched
}

/** Applies only executable semantics selected by stable IDs; structural fields remain prior-owned. */
export function applyCodeLabExecutionRepairPatch(
  prior: CodeLabSecurePayload,
  patch: CodeLabExecutionRepairPatch,
): CodeLabSecurePayload {
  const repaired = structuredClone(prior)
  if (patch.reference_solution !== null) {
    repaired.reference_solution = patch.reference_solution
  }
  const hiddenById = new Map(repaired.hidden_tests.map((entry) => [entry.test_id, entry]))
  for (const entry of patch.hidden_test_repairs) {
    const target = hiddenById.get(entry.test_id)
    if (!target) continue
    target.input = structuredClone(entry.input)
    // Changing an input always invalidates its old expected. The model never
    // owns the replacement; TrustedCodeLabVerifier re-derives it in Docker.
    target.expected = { __trusted_expected_pending__: true }
    target.comparison = { kind: "exact" }
  }
  return repaired
}

export function assessmentStarterIsIncomplete(starter: string | null | undefined): boolean {
  if (!starter?.trim()) return false
  const normalized = starter.normalize("NFKC")
  if (/TODO|待完成|pass\b|NotImplementedError|补全|写出你的代码/u.test(normalized)) return true
  if (/^\s*(?:print|console\.log)\s*\(/mu.test(normalized) && !/def\s+\w+\s*\(/u.test(normalized)) return false
  return false
}

/** 确定性修复：保留已有或题面约定的函数签名，替换为未完成骨架。 */
export function deterministicAssessmentStarterRepair(
  starter: string | null | undefined,
  prompt?: string | null,
): string {
  const source = starter?.trim() ?? ""
  const lines = source.split(/\r?\n/)
  // 提取函数签名行（def 行 + 可能的装饰器）
  const sigIndex = lines.findIndex((line) => /^\s*def\s+\w+\s*\(/.test(line))
  const promptSignature = prompt?.match(/\bdef\s+([A-Za-z_]\w*)\s*\(([^)\n]*)\)\s*(?:->\s*[^：:，。\n]+)?/u)
    ?? prompt?.match(/函数\s*[`'“"]?([A-Za-z_]\w*)[`'”"]?\s*\(([^)\n]*)\)/u)
  const sig = sigIndex >= 0
    ? lines[sigIndex]!
    : promptSignature
      ? `def ${promptSignature[1]}(${promptSignature[2]}):`
      : "def solve(data):"
  const indent = sig.match(/^(\s*)/)?.[1] ?? ""
  const normalizedSig = sig.trimEnd().endsWith(":") ? sig.trimEnd() : `${sig.trimEnd()}:`
  return `${normalizedSig}\n${indent}    # TODO: 补全你的代码实现\n${indent}    pass\n`
}

export function assessmentCompositionForBehavior(behavior: GenerationSpec["targets"][number]["observable_behavior"]): AssessmentItemPublic["modality"][] {
  const compositions: Record<GenerationSpec["targets"][number]["observable_behavior"], AssessmentItemPublic["modality"][]> = {
    recognize: ["mcq", "true_false", "mcq", "true_false", "mcq"],
    explain: ["mcq", "short_answer", "short_answer", "short_answer", "short_answer"],
    trace: ["mcq", "trace", "trace", "trace", "code"],
    apply: ["mcq", "true_false", "trace", "short_answer", "code"],
    debug: ["mcq", "trace", "code", "code", "code"],
    create: ["mcq", "short_answer", "code", "code", "code"],
  }
  return [...compositions[behavior]]
}

export function buildAssessmentItemPlan(spec: GenerationSpec, evidence?: RagEvidencePack): AssessmentItemPlan[] {
  const tiers: Array<1 | 2 | 3> = [
    ...Array.from({ length: spec.assessment_blueprint.tier_1_count }, () => 1 as const),
    ...Array.from({ length: spec.assessment_blueprint.tier_2_count }, () => 2 as const),
    ...Array.from({ length: spec.assessment_blueprint.tier_3_count }, () => 3 as const),
  ]
  if (tiers.length === 0) {
    throw new ModelOutputValidationError("assessment.plan", ["正式测评至少需要一道题"])
  }
  const modalities = buildAssessmentModalities(spec, tiers)

  const assignments = assignObjectives(spec, modalities)
  const preferredContexts = spec.learner_adaptation?.preferred_contexts ?? []
  const baseItems = tiers.map((tier, index) => {
    const objective = assignments[index]
    const modality = modalities[index]
    const objectiveOccurrence = assignments
      .slice(0, index)
      .filter((entry) => entry.objective_id === objective.objective_id)
      .length
    const cognitiveOperation = cognitiveOperationFor(
      objective.observable_behavior,
      modality,
    )
    const evidenceFacts = evidence?.results.find((entry) =>
      entry.source_id === objective.source_id)?.facts
    // Tier is the order inside this learner's form, not an absolute difficulty
    // label.  An explain/recognize objective remains an understanding check in
    // Tier 2; combining two rules would silently turn a remedial form into a
    // basic transfer task.
    const evidenceTier = tier === 2
      && (objective.observable_behavior === "recognize" || objective.observable_behavior === "explain")
      ? 1
      : tier
    const plannedFactIds = assessmentFactIdsForItem(
      objective.required_fact_ids,
      evidenceTier,
      objectiveOccurrence,
      evidenceFacts,
      cognitiveOperation,
    )
    const identity = { spec_id: spec.spec_id, index, objective_id: objective.objective_id, tier, modality }
    return {
      item_id: stableId("ITEM", identity),
      family_id: stableId("FAMILY", { objective_id: objective.objective_id, modality }),
      variant_id: stableId("VARIANT", { ...identity, seed: spec.policies.seed }),
      display_no: index + 1,
      objective_id: objective.objective_id,
      observation_key: assessmentObservationKey(objective),
      tier,
      modality,
      max_score: tier === 1 ? 1 : tier === 2 ? 2 : 4,
      cognitive_operation: cognitiveOperation,
      citations: plannedFactIds.map((factId) => ({
        source_id: objective.source_id,
        fact_id: factId,
        relation: "derived_from" as const,
      })),
    }
  })
  // 题目表现形式：确定性分配场景额度，避免每道题都套同一个 preferred context。
  const presentationPlan = buildAssessmentPresentationPlan(
    baseItems.map((item) => ({
      item_id: item.item_id,
      family_id: item.family_id,
      variant_id: item.variant_id,
      display_no: item.display_no,
      objective_id: item.objective_id,
      observation_key: item.observation_key,
      tier: item.tier,
      modality: item.modality,
      max_score: item.max_score,
      citations: item.citations,
      cognitive_operation: item.cognitive_operation,
      context_strategy: { kind: "neutral_context" as const },
    })),
    preferredContexts,
  )
  return baseItems.map((item, index) => {
    const presentation = presentationPlan[index]!
    const objective = spec.targets.find((target) => target.objective_id === item.objective_id)!
    const evidenceItem = evidence?.results.find((entry) => entry.source_id === objective.source_id)
    const misconceptions = (evidenceItem?.misconceptions ?? []).filter((entry) =>
      entry.factRefs.length === 0
        || entry.factRefs.some((reference) => item.citations.some((citation) =>
          citation.source_id === reference.sourceId && citation.fact_id === reference.factId)))
    const cognitiveDemand = item.tier === 1
      ? "understand" as const
      : item.tier === 2
        ? objective.observable_behavior === "recognize" || objective.observable_behavior === "explain"
          ? "understand" as const
          : "apply" as const
        : presentation.mode === "scenario_transfer"
          ? "transfer" as const
          : "analyze" as const
    return {
      ...item,
      presentation_mode: presentation.mode,
      context_strategy: presentation.mode === "scenario_transfer" && presentation.context
        ? { kind: "preferred_context" as const, value: presentation.context }
        : { kind: "neutral_context" as const },
      construct: `${objective.observable_behavior}:${item.cognitive_operation}`,
      evidence_of_mastery: masteryEvidenceFor(item.modality, item.cognitive_operation),
      cognitive_demand: cognitiveDemand,
      misconception_available: misconceptions.length > 0,
      ...(misconceptions.length > 0
        ? { target_misconception_id: misconceptions[index % misconceptions.length]!.misconceptionId }
        : {}),
      ...(presentation.mode === "scenario_transfer" && presentation.context
        ? { transfer_context: presentation.context }
        : {}),
      forbidden_clues: ["source_id", "fact_id", "RAG", "evidence", "知识库", "以上都对", "以上都错"],
      expected_difficulty: item.tier === 1 ? 0.3 : item.tier === 2 ? 0.58 : 0.78,
    }
  })
}

function masteryEvidenceFor(
  modality: AssessmentItemPublic["modality"],
  operation: AssessmentItemPlan["cognitive_operation"],
): string {
  if (modality === "code") return "学习者提交的函数在公开与隐藏测试中表现出目标行为"
  if (modality === "trace") return "学习者能够逐步追踪状态或输出并给出可复核结果"
  if (operation === "diagnose_error") return "学习者能够定位错误机制并给出依据"
  if (operation === "construct_solution") return "学习者能够构造满足冻结目标与事实边界的答案"
  return "学习者能够仅依据当前证据作出唯一、可解释的判断"
}

/**
 * Give each item the smallest evidence surface that can support its tier.
 * Tier 1 rotates one fact, Tier 2 may combine two, and Tier 3 may synthesize
 * the whole target. This prevents parallel authors from all writing the same
 * all-facts question while preserving AI-authored task content.
 */
export function assessmentFactIdsForItem(
  factIds: string[],
  tier: 1 | 2 | 3,
  objectiveOccurrence: number,
  evidenceFacts?: Array<{ fact_id: string; content?: string; capabilities?: string[] }>,
  operation?: AssessmentItemPlan["cognitive_operation"],
): string[] {
  if (factIds.length <= 1 || tier === 3) return [...factIds]
  const preferredCapabilities: Record<AssessmentItemPlan["cognitive_operation"], string[]> = {
    recognize_fact: ["definition", "rule", "contrast"],
    explain_reasoning: ["definition", "rule", "contrast", "boundary"],
    trace_execution: ["state_transition", "procedure", "boundary", "example"],
    apply_rule: ["procedure", "rule", "io_contract", "state_transition", "example"],
    diagnose_error: ["boundary", "contrast", "state_transition", "procedure", "rule"],
    construct_solution: ["procedure", "io_contract", "rule", "state_transition", "example"],
  }
  const capabilityOrder = operation ? preferredCapabilities[operation] : []
  const factById = new Map((evidenceFacts ?? []).map((fact) => [fact.fact_id, fact]))
  const ordered = [...factIds].sort((left, right) => {
    const score = (factId: string) => {
      const capabilities = factById.get(factId)?.capabilities ?? []
      return capabilityOrder.reduce((total, capability, index) =>
        total + (capabilities.includes(capability) ? capabilityOrder.length - index : 0), 0)
    }
    return score(right) - score(left) || factIds.indexOf(left) - factIds.indexOf(right)
  })
  const start = objectiveOccurrence % ordered.length
  const count = tier === 1 ? 1 : Math.min(2, factIds.length)
  const selected = Array.from({ length: count }, (_, offset) =>
    ordered[(start + offset) % ordered.length]!)
  return closeExecutableFactDependencies(selected, ordered, factById)
}

/**
 * A procedure fact may name an API without defining how concrete arguments map
 * to a result. Item authors naturally turn such facts into executable
 * instances, so include the same objective's own call/rule fact in the local
 * evidence surface. The closure never imports another objective or an
 * unrequested fact.
 */
function closeExecutableFactDependencies(
  selectedFactIds: string[],
  orderedFactIds: string[],
  factById: Map<string, { fact_id: string; content?: string; capabilities?: string[] }>,
): string[] {
  const selected = [...selectedFactIds]
  for (const factId of selectedFactIds) {
    const content = factById.get(factId)?.content ?? ""
    for (const identifier of executableIdentifiers(content)) {
      if (containsConcreteCall(content, identifier)) continue
      const companion = orderedFactIds.find((candidateId) => {
        if (selected.includes(candidateId)) return false
        const candidate = factById.get(candidateId)
        const candidateContent = candidate?.content ?? ""
        if (!containsIdentifier(candidateContent, identifier)
          || !containsConcreteCall(candidateContent, identifier)) return false
        return (candidate?.capabilities ?? []).some((capability) =>
          capability === "rule"
          || capability === "boundary"
          || capability === "state_transition"
          || capability === "example")
      })
      if (companion) selected.push(companion)
    }
  }
  return selected
}

const EXECUTABLE_IDENTIFIER = /\b[A-Za-z_][A-Za-z0-9_]*\b/gu
const NON_EXECUTABLE_IDENTIFIERS = new Set([
  "and", "as", "break", "class", "continue", "def", "else", "false", "for",
  "from", "if", "import", "in", "is", "none", "not", "or", "pass", "return",
  "true", "while", "with", "yield",
])

function executableIdentifiers(content: string): string[] {
  return [...new Set((content.match(EXECUTABLE_IDENTIFIER) ?? [])
    .map((identifier) => identifier.toLocaleLowerCase())
    .filter((identifier) => !NON_EXECUTABLE_IDENTIFIERS.has(identifier)))]
}

function containsIdentifier(content: string, identifier: string): boolean {
  return new RegExp(`\\b${escapeRegExp(identifier)}\\b`, "iu").test(content)
}

function containsConcreteCall(content: string, identifier: string): boolean {
  return new RegExp(`\\b${escapeRegExp(identifier)}\\s*\\([^)]*[^\\s)]`, "iu").test(content)
}

/** 同一知识来源上的同一可观察行为在路径/轮次变化后仍保持同一测量语义。 */
export function assessmentObservationKey(objective: Pick<
  GenerationSpec["targets"][number],
  "source_id" | "observable_behavior"
>): string {
  return stableId("OBSERVATION", {
    source_id: objective.source_id,
    observable_behavior: objective.observable_behavior,
  })
}

function buildAssessmentModalities(
  spec: GenerationSpec,
  tiers: Array<1 | 2 | 3>,
): AssessmentItemPublic["modality"][] {
  const objectives = [
    ...spec.targets.filter((target) => target.importance === "core"),
    ...spec.targets.filter((target) => target.importance !== "core"),
  ]
  const modalities = tiers.map((tier, index) => {
    const target = objectives[index % objectives.length]!
    const contractPreferences = spec.learner_adaptation?.pedagogy_contract?.assessment.preferred_modalities ?? []
    return contractPreferences.find((modality) =>
      modalityAllowedAtTier(modality, tier)
      && modalityMeasuresBehavior(target.observable_behavior, modality))
      ?? preferredModalityForTier(target.observable_behavior, tier)
  })
  ensureRequiredModalities(
    modalities,
    tiers,
    spec.assessment_blueprint.required_modalities,
  )
  return modalities
}

function modalityAllowedAtTier(
  modality: AssessmentItemPublic["modality"],
  tier: 1 | 2 | 3,
): boolean {
  if (tier === 1) return modality === "mcq" || modality === "true_false"
  if (tier === 2) return modality !== "code"
  return true
}

function preferredModalityForTier(
  behavior: GenerationSpec["targets"][number]["observable_behavior"],
  tier: 1 | 2 | 3,
): AssessmentItemPublic["modality"] {
  const preferences: Record<
    GenerationSpec["targets"][number]["observable_behavior"],
    Record<1 | 2 | 3, AssessmentItemPublic["modality"]>
  > = {
    recognize: { 1: "mcq", 2: "true_false", 3: "mcq" },
    explain: { 1: "true_false", 2: "short_answer", 3: "short_answer" },
    trace: { 1: "mcq", 2: "trace", 3: "code" },
    apply: { 1: "mcq", 2: "trace", 3: "code" },
    debug: { 1: "mcq", 2: "trace", 3: "code" },
    create: { 1: "mcq", 2: "short_answer", 3: "code" },
  }
  return preferences[behavior][tier]
}

function cognitiveOperationFor(
  behavior: GenerationSpec["targets"][number]["observable_behavior"],
  modality: AssessmentItemPublic["modality"],
): AssessmentItemPlan["cognitive_operation"] {
  if (behavior === "debug") return "diagnose_error"
  if (behavior === "create") return "construct_solution"
  if (modality === "trace" || behavior === "trace") return "trace_execution"
  if (behavior === "explain" || modality === "short_answer") return "explain_reasoning"
  if (behavior === "apply" || modality === "code") return "apply_rule"
  return "recognize_fact"
}

export function buildAssessmentFormId(spec: GenerationSpec): string {
  return stableId("FORM", {
    spec_id: spec.spec_id,
    seed: spec.policies.seed,
    version: "assessment-staged-v1",
  })
}

export function validateAssessmentPublicAuthorAgainstPlan(
  payload: AssessmentPublicAuthorPayload,
  plan: AssessmentItemPlan[],
): string[] {
  const issues: string[] = []
  if (payload.items.length !== plan.length) {
    issues.push(`items 数量应为 ${plan.length}，实际 ${payload.items.length}`)
    return issues
  }
  payload.items.forEach((item, index) => {
    const expected = plan[index]!
    const isChoice = expected.modality === "mcq"
      || expected.modality === "true_false"
    if (isChoice) {
      if (!item.options) {
        issues.push(`items[${index}] 选择题缺少 options`)
      } else {
        const expectedCount = expected.modality === "true_false" ? 2 : undefined
        if (expectedCount && item.options.length !== expectedCount) {
          issues.push(`items[${index}] true_false 必须恰好包含 2 个选项`)
        }
        const normalized = item.options.map((option) =>
          option.normalize("NFKC").trim().toLocaleLowerCase())
        if (new Set(normalized).size !== normalized.length) {
          issues.push(`items[${index}].options 不得重复`)
        }
      }
    } else if (item.options !== null) {
      issues.push(`items[${index}] 非选择题的 options 必须为 null`)
    }
    if (expected.modality === "code") {
      if (!assessmentStarterIsIncomplete(item.starter_code)) {
        issues.push(`items[${index}] 代码题必须提供明确未完成的函数 starter_code，不能直接给出完整答案`)
      }
    } else if (item.starter_code !== null) {
      issues.push(`items[${index}] 非代码题的 starter_code 必须为 null`)
    }
    if ((expected.cognitive_operation === "recognize_fact"
      || expected.cognitive_operation === "explain_reasoning")
      && (/(?:举出?|给出|列举).{0,12}(?:例子|示例|用途|应用)/u.test(item.prompt)
        || /(?:说明|解释).{0,28}(?:体现|表现).{0,8}(?:方面|场景|用途)/u.test(item.prompt))) {
      issues.push(`items[${index}] 事实识别/解释题不得要求补充 evidence 未提供的例子、用途或具体体现`)
    }
  })
  return issues
}

/**
 * The model may echo read-only item_plan fields in json_object mode. Only the
 * four semantic author fields cross this boundary; plan-owned fields are
 * materialized from ResourceBlueprint afterwards.
 */
export function projectAssessmentPublicAuthorPayload(
  payload: AssessmentPublicAuthorPayload,
): AssessmentPublicAuthorPayload {
  return {
    title: payload.title,
    items: Array.isArray(payload.items)
      ? payload.items.map((item) => ({
          prompt: item?.prompt,
          options: item?.options,
          starter_code: item?.starter_code,
          structure_meta: item?.structure_meta,
        }))
      : payload.items,
  } as AssessmentPublicAuthorPayload
}

/**
 * 结构级去重的时间/数量窗口：同一 observation_key 内最近 N 条历史参与结构去重。
 * 更早的历史（纵向复测）与跨 observation_key 的结构复用不 hard block。
 */
export const STRUCTURAL_NOVELTY_WINDOW = 5

/**
 * Rejects a verbatim or cosmetically reformatted reuse of an already published
 * public question. Similar questions are allowed, but an objective identity
 * change cannot make an otherwise identical public task new.
 */
export function validateAssessmentNovelty(
  payload: Pick<AssessmentPublicPayload, "items">,
  history: PriorAssessmentItem[],
): string[] {
  const issues: string[] = []
  const priorByPrompt = new Map(history.map((item) => [
    assessmentPromptSignature(item),
    `${item.form_id}:${item.item_id}`,
  ]))
  const priorBySignature = new Map(history.map((item) => [
    assessmentItemSignature(item),
    `${item.form_id}:${item.item_id}`,
  ]))
  // 旧历史没有 structure_meta 时仍按 observation_key + 最近窗口约束文本结构，
  // 不能退回成跨所有目标、永久 hard 的统一结构门禁。
  const priorByStructure = new Map<string, string>()
  // 结构元数据签名（GPT 评审）：模型命制时显式填写的
  // (operation + reasoning_pattern + representation + context_family + answer_form)。
  // 结构级去重按 observation_key 分组 + 最近窗口：同一测量目标内、最近窗口内
  // 的结构重复 hard；更早的历史（纵向复测）与跨 observation_key 的结构复用均允许。
  const priorByMeta = new Map<string, string>()
  {
    const seenByObservation = new Map<string, number>()
    for (let i = history.length - 1; i >= 0; i -= 1) {
      const item = history[i]!
      const observationKey = item.observation_key ?? item.objective_id
      const count = seenByObservation.get(observationKey) ?? 0
      if (count >= STRUCTURAL_NOVELTY_WINDOW) continue
      seenByObservation.set(observationKey, count + 1)
      const identity = `${item.form_id}:${item.item_id}`
      if (item.structure_meta) {
        const key = `${observationKey}\u0000${assessmentNoveltyStructureSignature(item.structure_meta)}`
        if (!priorByMeta.has(key)) priorByMeta.set(key, identity)
      } else {
        const key = `${observationKey}\u0000${assessmentStructureSignature(item)}`
        if (!priorByStructure.has(key)) priorByStructure.set(key, identity)
      }
    }
  }
  const currentPrompts = new Map<string, number>()
  const current = new Map<string, number>()
  const currentStructures = new Map<string, number>()
  const currentMetaStructures = new Map<string, number>()
  const currentPromptsByObservation: Array<{
    index: number
    modality: string
    observationKey: string
    surface: string
  }> = []
  payload.items.forEach((item, index) => {
    const promptSignature = assessmentPromptSignature(item)
    const signature = assessmentItemSignature({
      objective_id: item.objective_id,
      modality: item.modality,
      prompt: item.prompt,
      options: item.options?.map((option) => option.text) ?? [],
      starter_code: item.starter_code,
    })
    const structureSignature = assessmentStructureSignature({
      modality: item.modality,
      prompt: item.prompt,
      starter_code: item.starter_code,
    })
    const metaSignature = item.structure_meta
      ? `${item.observation_key ?? item.objective_id}\u0000${assessmentNoveltyStructureSignature(item.structure_meta)}`
      : null
    const priorIdentity = priorByPrompt.get(promptSignature) ?? priorBySignature.get(signature)
    if (priorIdentity) {
      issues.push(`items[${index}] 与已发布题目 ${priorIdentity} 重复，必须由模型重新命制题面和任务材料`)
    }
    const priorStructure = metaSignature
      ? undefined
      : priorByStructure.get(`${item.observation_key ?? item.objective_id}\u0000${structureSignature}`)
    const priorMeta = metaSignature ? priorByMeta.get(metaSignature) : undefined
    if (priorMeta && priorMeta !== priorIdentity) {
      issues.push(`items[${index}] 与已发布题目 ${priorMeta} 任务结构重复（目标/操作/推理/表示/情境/作答全部一致），必须生成新的任务变式`)
    } else if (!priorMeta && !priorIdentity && priorStructure) {
      issues.push(`items[${index}] 与已发布题目 ${priorStructure} 任务结构重复（仅数字/取值不同，非真正变式），必须改变操作、情境或推理模式`)
    }
    const samePromptIndex = currentPrompts.get(promptSignature)
    const sameFormIndex = current.get(signature)
    if (samePromptIndex !== undefined || sameFormIndex !== undefined) {
      issues.push(`items[${index}] 与本卷 items[${samePromptIndex ?? sameFormIndex}] 重复`)
    } else {
      currentPrompts.set(promptSignature, index)
      current.set(signature, index)
    }
    const sameStructureIndex = metaSignature ? undefined : currentStructures.get(structureSignature)
    if (!metaSignature && sameStructureIndex !== undefined && sameStructureIndex !== samePromptIndex) {
      issues.push(`items[${index}] 与本卷 items[${sameStructureIndex}] 任务结构重复（仅数字/取值不同）`)
    }
    if (!metaSignature) currentStructures.set(structureSignature, index)
    if (item.structure_meta) {
      const localMetaSignature = assessmentNoveltyStructureSignature(item.structure_meta)
      const sameMetaIndex = currentMetaStructures.get(localMetaSignature)
      if (sameMetaIndex !== undefined && sameMetaIndex !== samePromptIndex) {
        issues.push(`items[${index}] 与本卷 items[${sameMetaIndex}] 任务结构重复（操作/推理/表示/情境/作答全部一致）`)
      } else {
        currentMetaStructures.set(localMetaSignature, index)
      }
    }
    const observationKey = item.observation_key ?? item.objective_id
    const nearDuplicate = currentPromptsByObservation.find((prior) =>
      prior.modality === item.modality
      && prior.observationKey === observationKey
      && assessmentPromptNearDuplicate(
        prior.surface,
        assessmentItemSimilaritySurface(item),
      ))
    if (nearDuplicate
      && samePromptIndex === undefined
      && sameFormIndex === undefined
      && sameStructureIndex === undefined) {
      issues.push(
        `items[${index}] 与本卷 items[${nearDuplicate.index}] 题干语义结构近乎重复，不能仅改写措辞或 structure_meta`,
      )
    }
    currentPromptsByObservation.push({
      index,
      modality: item.modality,
      observationKey,
      surface: assessmentItemSimilaritySurface(item),
    })
  })
  return issues
}

function assessmentItemSimilaritySurface(item: {
  prompt: string
  options?: Array<{ text: string }>
  starter_code?: string
}): string {
  return [
    item.prompt,
    ...(item.options?.map((option) => option.text) ?? []),
    item.starter_code ?? "",
  ].join("\n")
}

/**
 * structure_meta 是模型描述，不能单独作为去重事实。这里用实际题干
 * 的字符二元组覆盖度识别“大段相同、只换问法”的同卷近重复。
 * 仅在同 observation + 同题型内使用，避免跨目标误伤。
 */
export function assessmentPromptNearDuplicate(left: string, right: string): boolean {
  const a = normalizeAssessmentSurface(left)
  const b = normalizeAssessmentSurface(right)
  if (a.length < 24 || b.length < 24) return false
  const aGrams = characterNgrams(a, 2)
  const bGrams = characterNgrams(b, 2)
  if (aGrams.size === 0 || bGrams.size === 0) return false
  let shared = 0
  for (const gram of aGrams) if (bGrams.has(gram)) shared += 1
  return shared / Math.min(aGrams.size, bGrams.size) >= 0.84
}

function characterNgrams(value: string, size: number): Set<string> {
  const grams = new Set<string>()
  for (let index = 0; index <= value.length - size; index += 1) {
    grams.add(value.slice(index, index + size))
  }
  return grams
}

/**
 * 任务结构签名（不含 objective_id）：operation + reasoning_pattern +
 * representation + context_family + answer_form。配合 observation_key 分组，
 * 结构级去重只在同一测量目标内生效；跨测量目标允许结构复用。
 */
function assessmentNoveltyStructureSignature(
  meta: AssessmentStructureMeta,
): string {
  return [
    normalizeAssessmentSurface(meta.operation),
    normalizeAssessmentSurface(meta.reasoning_pattern),
    normalizeAssessmentSurface(meta.representation),
    normalizeAssessmentSurface(meta.context_family),
    normalizeAssessmentSurface(meta.answer_form),
  ].join("\u0000")
}

function assessmentPromptSignature(item: {
  modality: string
  prompt: string
}): string {
  return [item.modality, normalizeAssessmentSurface(item.prompt)].join("\u0000")
}

function assessmentItemSignature(item: {
  objective_id: string
  modality: string
  prompt: string
  options: string[]
  starter_code?: string
}): string {
  const options = item.options.map(normalizeAssessmentSurface).sort()
  return [
    item.modality,
    normalizeAssessmentSurface(item.prompt),
    options.join("|"),
    normalizeAssessmentSurface(item.starter_code ?? ""),
  ].join("\u0000")
}

/**
 * 任务结构签名：把 prompt 中的列表字面量、字符串字面量和数字抽象为占位符，
 * 比较"任务结构"而非"文字"。例：`range(2,5)` 与 `range(3,6)` 结构相同，
 * 只换数字不是真正的变式；reinforce 的"新变式"必须改变操作、情境或推理模式。
 */
function assessmentStructureSignature(item: {
  modality: string
  prompt: string
  starter_code?: string
}): string {
  return [
    item.modality,
    normalizeAssessmentSurface(abstractAssessmentValues(item.prompt)),
    normalizeAssessmentSurface(abstractAssessmentValues(item.starter_code ?? "")),
  ].join("\u0000")
}

function abstractAssessmentValues(value: string): string {
  return value
    .replace(/\[[^\]]*\]/g, "〔list〕")
    .replace(/['"][^'"]*['"]/g, "〔str〕")
    .replace(/[-+]?\d+(?:\.\d+)?/g, "〔num〕")
}

function normalizeAssessmentSurface(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase()
    .replace(/[\s，,。！？；：“”"'、`()\[\]{}\-_]+/g, "")
}

export function materializeAssessmentPublicAuthorPayload(
  spec: GenerationSpec,
  payload: AssessmentPublicAuthorPayload,
  plan: AssessmentItemPlan[],
  formId: string,
): AssessmentPublicPayload {
  const items = payload.items.map((authored, index): AssessmentItemPublic => {
    const expected = plan[index]!
    const options = authored.options?.map((text, optionIndex) => ({
      option_id: stableId("OPTION", {
        item_id: expected.item_id,
        option_index: optionIndex,
      }),
      label: "ABCD"[optionIndex]!,
      text,
    }))
    return {
      item_id: expected.item_id,
      family_id: expected.family_id,
      variant_id: expected.variant_id,
      display_no: expected.display_no,
      objective_id: expected.objective_id,
      observation_key: expected.observation_key,
      tier: expected.tier,
      difficulty_band: expected.difficulty_band!,
      cognitive_level: expected.cognitive_level!,
      modality: expected.modality,
      max_score: expected.max_score,
      citations: structuredClone(expected.citations),
      prompt: authored.prompt,
      ...(options ? { options } : {}),
      ...(authored.starter_code ? { starter_code: authored.starter_code } : {}),
      ...(authored.structure_meta ? { structure_meta: structuredClone(authored.structure_meta) } : {}),
    }
  })
  return {
    form_id: formId,
    title: payload.title,
    objective_ids: spec.targets.map((target) => target.objective_id),
    items,
    submission_policy: { max_attempts: 3, formative: true },
    routing: deterministicRouting(items),
    objective_coverage: assessmentPublicCoverage(spec, items),
    used_evidence: deduplicate(items.flatMap((item) => item.citations)),
  }
}

export function validateAssessmentPublicAgainstPlan(
  payload: AssessmentPublicPayload,
  plan: AssessmentItemPlan[],
): string[] {
  const issues: string[] = []
  if (payload.items.length !== plan.length) {
    issues.push(`items 数量应为 ${plan.length}，实际 ${payload.items.length}`)
    return issues
  }
  const presentationPlan = plan.map((item) => ({
    item_id: item.item_id,
    mode: item.presentation_mode ?? "minimal_context",
    ...(item.context_strategy.kind === "preferred_context" && item.context_strategy.value
      ? { context: item.context_strategy.value }
      : {}),
    variation_axis: "operation" as const,
  }))
  issues.push(...validateAssessmentPresentationBalance(payload, presentationPlan)
    .map((entry) => `[${entry.code}] ${entry.path} ${entry.message}`))
  payload.items.forEach((item, index) => {
    const expected = plan[index]
    if (item.modality !== expected.modality) {
      issues.push(`items[${index}].modality 应为 ${expected.modality}`)
    }
    if ((expected.modality === "mcq" || expected.modality === "true_false") && !item.options) {
      issues.push(`items[${index}] 选择题缺少 options`)
    }
    if (expected.modality === "code" && !item.starter_code) {
      issues.push(`items[${index}] 代码题缺少 starter_code`)
    }
    if (item.difficulty_band !== expected.difficulty_band || item.cognitive_level !== expected.cognitive_level) {
      issues.push(`items[${index}] 双重分阶未按 item plan 冻结`)
    }
  })
  return issues
}

export function normalizeAssessmentPublic(
  spec: GenerationSpec,
  payload: AssessmentPublicPayload,
  plan: AssessmentItemPlan[],
  formId: string,
): AssessmentPublicPayload {
  const items = payload.items.map((item, index): AssessmentItemPublic => {
    const expected = plan[index]
    const options = item.options?.map((option, optionIndex) => ({
      ...option,
      option_id: stableId("OPTION", { item_id: expected.item_id, option_index: optionIndex }),
      label: "ABCD"[optionIndex],
    }))
    return {
      ...structuredClone(item),
      ...structuredClone(expected),
      ...(options ? { options } : {}),
    }
  })
  return {
    form_id: formId,
    title: payload.title,
    objective_ids: spec.targets.map((target) => target.objective_id),
    items,
    submission_policy: { max_attempts: 3, formative: true },
    routing: deterministicRouting(items),
    objective_coverage: assessmentPublicCoverage(spec, items),
    used_evidence: deduplicate(items.flatMap((item) => item.citations)),
  }
}

export function validateAssessmentSecureAgainstPublic(
  payload: AssessmentSecurePayload,
  publicPayload: AssessmentPublicPayload,
): string[] {
  const issues: string[] = []
  if (payload.items.length !== publicPayload.items.length) {
    issues.push(`secure items 数量应为 ${publicPayload.items.length}，实际 ${payload.items.length}`)
  }
  const codeCount = publicPayload.items.filter((item) => item.modality === "code").length
  if (payload.code_test_suites.length !== codeCount) {
    issues.push(`code_test_suites 数量应为 ${codeCount}，实际 ${payload.code_test_suites.length}`)
  }
  payload.items.forEach((item, index) => {
    const publicItem = publicPayload.items[index]
    if (!publicItem) return
    if (item.item_id !== publicItem.item_id) {
      issues.push(`items[${index}].item_id 未与 public_payload 对齐`)
    }
    for (const key of ["objective_id", "tier", "difficulty_band", "cognitive_level", "modality", "max_score"] as const) {
      if (item[key] !== publicItem[key]) {
        issues.push(`items[${index}].${key} 未与 public_payload 对齐`)
      }
    }
    const isChoice = publicItem.modality === "mcq" || publicItem.modality === "true_false"
    const optionIds = new Set(publicItem.options?.map((option) => option.option_id) ?? [])
    if (isChoice) {
      if (!item.correct_option_id || !optionIds.has(item.correct_option_id)) {
        issues.push(`items[${index}].correct_option_id 不是当前公开题的选项`)
      }
      const invalidMapIds = Object.keys(item.misconception_by_option).filter((optionId) =>
        !optionIds.has(optionId) || optionId === item.correct_option_id)
      if (invalidMapIds.length > 0) {
        issues.push(`items[${index}].misconception_by_option 包含无效或正确选项`)
      }
    } else if (item.correct_option_id || Object.keys(item.misconception_by_option).length > 0) {
      issues.push(`items[${index}] 非选择题不得返回选项答案映射`)
    }
  })
  payload.code_test_suites.forEach((suite, suiteIndex) => {
    issues.push(...functionOutputContractIssues(
      suite.execution_contract,
      `code_test_suites[${suiteIndex}].execution_contract`,
    ))
    if (suite.execution_contract.execution_mode !== "function") return
    suite.hidden_tests.forEach((test, testIndex) => {
      if (!isFunctionInvocationEnvelope(test.input)) {
        issues.push(`code_test_suites[${suiteIndex}].hidden_tests[${testIndex}].input 必须使用 {"args": [...], "kwargs"?: {...}} 调用封装`)
      }
    })
  })
  return issues
}

function functionOutputContractIssues(
  contract: ExecutionContract,
  path: string,
  learnerVisibleText: string[] = [],
): string[] {
  if (contract.execution_mode !== "function") return []
  const outputContract = [
    contract.output_contract.type,
    ...(contract.output_contract.constraints ?? []),
  ].join(" ").normalize("NFKC").toLocaleLowerCase()
  const visible = learnerVisibleText.join(" ")
    .normalize("NFKC")
    .toLocaleLowerCase()
  if (/^(?:none|null|void)(?:\s|$)/u.test(outputContract)
    || /(?:标准输出|打印|stdout|\bprint\b)/u.test(`${outputContract} ${visible}`)) {
    return [
      `FUNCTION_OUTPUT_CONTRACT_MISMATCH: ${path} 的 function 模式只校验入口函数返回值；请改为可 JSON 序列化的返回值，或将纯打印任务改为 stdin_stdout 模式`,
    ]
  }
  return []
}

function codeLabExecutionContractIssues(
  contract: ExecutionContract,
  path: string,
  learnerVisibleText: string[],
  starterCode: string,
): string[] {
  const issues = functionOutputContractIssues(contract, path, learnerVisibleText)
  if (contract.execution_mode === "function") {
    const entryPoint = contract.entry_point?.trim()
    if (!entryPoint || !new RegExp(`^\\s*def\\s+${escapeRegExp(entryPoint)}\\s*\\(`, "mu").test(starterCode)) {
      issues.push(`${path} 的 function 模式必须在 starter_code 中提供与 entry_point 一致的函数签名`)
    }
    return issues
  }
  const contractText = [
    contract.input_contract.type,
    ...contract.input_contract.constraints,
    contract.output_contract.type,
    ...(contract.output_contract.constraints ?? []),
  ].join(" ").normalize("NFKC").toLocaleLowerCase()
  const visibleText = learnerVisibleText.join(" ").normalize("NFKC").toLocaleLowerCase()
  const requestsFunctionWork = /(?:编写|定义|实现|提交)\s*(?:(?:一个|一个名为|名为|名叫|指定的)\s*)?(?:[A-Za-z_]\w*\s*)?(?:函数|function)/iu.test(visibleText)
  const declaresFunctionAsExternalInterface = /(?:只需|仅需|只|仅|单独)?\s*提交.{0,20}(?:函数|function)|(?:判题器|测试).{0,20}(?:调用|入口函数)|(?:函数|function).{0,20}(?:返回值|return\s+value).{0,20}(?:评分|判题|结果)/iu.test(visibleText)
  const invokesNamedFunctionAsExternalInterface = /(?:调用|执行|测试)\s*(?:函数\s*)?[A-Za-z_]\w*\s*\([^)]*\).{0,30}(?:返回|得到|应为|结果)/iu.test(visibleText)
  const describesWholeProgramInterface = /(?:完整(?:的)?程序|标准输入|标准输出|stdin|stdout|读取.{0,12}输入|打印|print\s*\()/iu.test(visibleText)
  const explicitFunctionTask = declaresFunctionAsExternalInterface
    || invokesNamedFunctionAsExternalInterface
    || (requestsFunctionWork && !describesWholeProgramInterface)
  const hasFunctionContract = /(?:function\s*(?:arguments?|call|return(?:\s+value)?)|函数(?:参数|调用|返回值)|入口函数|函数调用封装)/iu.test(contractText)
  const starterDefinesFunction = /^\s*(?:async\s+)?def\s+\w+\s*\(/mu.test(starterCode)
  const starterOwnsProgramIo = /(?:^|\n)\s*(?:\w+\s*=\s*)?(?:input\s*\(|sys\.stdin\b)|(?:^|\n)\s*(?:print\s*\(|sys\.stdout\b)/mu.test(starterCode)
  const hasFunctionStarter = starterDefinesFunction && !starterOwnsProgramIo
  if (contract.entry_point?.trim()) {
    issues.push(`STDIN_FUNCTION_CONTRACT_MISMATCH: ${path}.entry_point 仅属于 function 模式，stdin_stdout 模式不得设置`)
  }
  if (hasFunctionContract) {
    issues.push(`STDIN_FUNCTION_CONTRACT_MISMATCH: ${path} 的 stdin_stdout 输入输出合同不得使用函数参数、调用或返回值作为执行接口`)
  }
  if (hasFunctionStarter) {
    issues.push(`STDIN_FUNCTION_CONTRACT_MISMATCH: starter_code 只定义了函数，没有提供从标准输入读取并向标准输出写入的完整程序骨架`)
  }
  if (explicitFunctionTask) {
    issues.push(`STDIN_FUNCTION_CONTRACT_MISMATCH: 公开任务要求学习者以函数作为外部提交接口，与 stdin_stdout 的完整程序接口冲突：${visibleText.slice(0, 120)}`)
  }
  return issues
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export function validateAssessmentSecureAuthorAgainstPublic(
  payload: AssessmentSecureAuthorPayload,
  publicPayload: AssessmentPublicPayload,
): string[] {
  const issues: string[] = []
  if (payload.items.length !== publicPayload.items.length) {
    issues.push(`secure items 数量应为 ${publicPayload.items.length}，实际 ${payload.items.length}`)
    return issues
  }
  const codeItems = publicPayload.items.filter((item) => item.modality === "code")
  if (payload.code_test_suites.length !== codeItems.length) {
    issues.push(`code_test_suites 数量应为 ${codeItems.length}，实际 ${payload.code_test_suites.length}`)
  }
  payload.items.forEach((item, index) => {
    const publicItem = publicPayload.items[index]!
    const isChoice = publicItem.modality === "mcq" || publicItem.modality === "true_false"
    if (isChoice) {
      const optionIds = new Set(publicItem.options?.map((option) => option.option_id) ?? [])
      if (!item.correct_option_id || !optionIds.has(item.correct_option_id)) {
        issues.push(`items[${index}].correct_option_id 不是当前公开题的选项`)
      }
      if (item.answer_spec !== null) {
        issues.push(`items[${index}] 选择题 answer_spec 必须交由编排器构造并返回 null`)
      }
      return
    }
    if (item.correct_option_id !== null || Object.keys(item.misconception_by_option).length > 0) {
      issues.push(`items[${index}] 非选择题不得返回选项答案映射`)
    }
    if (publicItem.modality === "code") {
      if (item.answer_spec !== null) {
        issues.push(`items[${index}] 代码题 answer_spec 必须交由编排器绑定 suite 并返回 null`)
      }
    } else if (!item.answer_spec || item.answer_spec.kind === "code") {
      issues.push(`items[${index}] ${publicItem.modality} 缺少可验证 answer_spec`)
    }
  })
  payload.code_test_suites.forEach((suite, suiteIndex) => {
    issues.push(...functionOutputContractIssues(
      suite.execution_contract,
      `code_test_suites[${suiteIndex}].execution_contract`,
    ))
    if (suite.execution_contract.execution_mode !== "function") return
    suite.hidden_tests.forEach((test, testIndex) => {
      if (!isFunctionInvocationEnvelope(test.input)) {
        issues.push(`code_test_suites[${suiteIndex}].hidden_tests[${testIndex}].input 必须使用 {"args": [...], "kwargs"?: {...}} 调用封装`)
      }
    })
  })
  return issues
}

export function materializeAssessmentSecureAuthorPayload(
  spec: GenerationSpec,
  publicPayload: AssessmentPublicPayload,
  payload: AssessmentSecureAuthorPayload,
): AssessmentSecurePayload {
  const codeItems = publicPayload.items.filter((item) => item.modality === "code")
  const suiteIds = codeItems.map((item) => stableId("TS", {
    form_id: publicPayload.form_id,
    item_id: item.item_id,
  }))
  let codeIndex = 0
  const items: AssessmentItemSecure[] = publicPayload.items.map((publicItem, index) => {
    const authored = payload.items[index]!
    const isChoice = publicItem.modality === "mcq" || publicItem.modality === "true_false"
    let answerSpec: AnswerSpec
    if (isChoice) {
      answerSpec = {
        kind: "exact_set",
        accepted: [authored.correct_option_id!],
        normalization: ["trim", "casefold", "unicode", "collapse_whitespace"],
      }
    } else if (publicItem.modality === "code") {
      answerSpec = { kind: "code", test_suite_id: suiteIds[codeIndex++]! }
    } else {
      answerSpec = structuredClone(authored.answer_spec!)
    }
    return {
      item_id: publicItem.item_id,
      objective_id: publicItem.objective_id,
      tier: publicItem.tier,
      difficulty_band: publicItem.difficulty_band,
      cognitive_level: publicItem.cognitive_level,
      modality: publicItem.modality,
      max_score: publicItem.max_score,
      answer_spec: answerSpec,
      ...(isChoice ? { correct_option_id: authored.correct_option_id! } : {}),
      misconception_by_option: structuredClone(authored.misconception_by_option),
      evidence_weight: 1,
    }
  })
  const codeTestSuites = payload.code_test_suites.map((suite, suiteIndex) => {
    const publicItem = codeItems[suiteIndex]!
    const testSuiteId = suiteIds[suiteIndex]!
    const weight = 1 / suite.hidden_tests.length
    return {
      test_suite_id: testSuiteId,
      execution_contract: structuredClone(suite.execution_contract),
      reference_solution: suite.reference_solution,
      hidden_tests: suite.hidden_tests.map((test, testIndex) => ({
        test_id: stableId("ASSESSMENT-HIDDEN-TEST", {
          test_suite_id: testSuiteId,
          item_id: publicItem.item_id,
          test_index: testIndex,
        }),
        input: structuredClone(test.input),
        expected: structuredClone(test.expected),
        objective_id: publicItem.objective_id,
        weight,
        comparison: structuredClone(test.comparison),
      })),
    }
  })
  return normalizeAssessmentPair(spec, publicPayload, {
    form_id: publicPayload.form_id,
    items,
    option_order_seed: spec.policies.seed,
    code_test_suites: codeTestSuites,
    objective_coverage: [],
  }).secure_payload
}

export function normalizeAssessmentPair(
  spec: GenerationSpec,
  publicPayload: AssessmentPublicPayload,
  securePayload: AssessmentSecurePayload,
): { public_payload: AssessmentPublicPayload; secure_payload: AssessmentSecurePayload } {
  const codeItems = publicPayload.items.filter((item) => item.modality === "code")
  const suites = securePayload.code_test_suites.map((suite, index) => ({
    ...structuredClone(suite),
    test_suite_id: stableId("TS", { form_id: publicPayload.form_id, item_id: codeItems[index].item_id }),
  }))
  const suiteByItemId = new Map(codeItems.map((item, index) => [item.item_id, suites[index].test_suite_id]))
  const secureItems = securePayload.items.map((item, index): AssessmentItemSecure => {
    const publicItem = publicPayload.items[index]
    const base = {
      ...structuredClone(item),
      item_id: publicItem.item_id,
      objective_id: publicItem.objective_id,
      tier: publicItem.tier,
      difficulty_band: publicItem.difficulty_band,
      cognitive_level: publicItem.cognitive_level,
      modality: publicItem.modality,
      max_score: publicItem.max_score,
    }
    if (publicItem.modality === "code") {
      return {
        ...base,
        answer_spec: { kind: "code", test_suite_id: suiteByItemId.get(publicItem.item_id)! },
        misconception_by_option: {},
      }
    }
    if (publicItem.modality === "mcq" || publicItem.modality === "true_false") {
      const wrongOptions = (publicItem.options ?? []).filter((option) =>
        option.option_id !== base.correct_option_id)
      return {
        ...base,
        answer_spec: {
          kind: "exact_set",
          accepted: base.correct_option_id ? [base.correct_option_id] : [],
          normalization: ["trim", "casefold", "unicode", "collapse_whitespace"],
        },
        misconception_by_option: Object.fromEntries(wrongOptions.map((option, optionIndex) => [
          option.option_id,
          base.misconception_by_option[option.option_id]?.trim()
            || `unclassified_${publicItem.objective_id}_incorrect_option_${optionIndex + 1}`,
        ])),
      }
    }
    const { correct_option_id: _correct, ...nonChoice } = base
    return { ...nonChoice, misconception_by_option: {} }
  })
  const normalizedPublic = reorderChoiceOptions(publicPayload, secureItems, spec.policies.seed)
  const normalizedSecure: AssessmentSecurePayload = {
    form_id: normalizedPublic.form_id,
    items: secureItems,
    option_order_seed: spec.policies.seed,
    code_test_suites: suites,
    objective_coverage: assessmentSecureCoverage(spec, secureItems),
  }
  return { public_payload: normalizedPublic, secure_payload: normalizedSecure }
}

export async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const limit = Math.max(1, Math.min(Math.floor(concurrency), values.length || 1))
  const output = new Array<R>(values.length)
  let cursor = 0
  await Promise.all(Array.from({ length: limit }, async () => {
    while (true) {
      const index = cursor
      cursor += 1
      if (index >= values.length) return
      output[index] = await mapper(values[index], index)
    }
  }))
  return output
}

function namespaceConceptPayload(payload: ConceptLessonPayload, index: number): ConceptLessonPayload {
  const prefix = `SEG${index + 1}`
  const blockMap = new Map<string, string>()
  const mapBlock = (block: RenderBlock): RenderBlock => {
    const mappedId = `${prefix}-${block.block_id}`
    blockMap.set(block.block_id, mappedId)
    const clone = structuredClone(block)
    clone.block_id = mappedId
    if ("claims" in clone) {
      clone.claims = clone.claims.map((claim) => ({ ...claim, claim_id: `${prefix}-${claim.claim_id}` }))
    }
    if (clone.block_type === "quiz") {
      clone.item_id = `${prefix}-${clone.item_id}`
      clone.options = clone.options?.map((option) => ({ ...option, option_id: `${prefix}-${option.option_id}` }))
      if (clone.answer_option_id) {
        clone.answer_option_id = `${prefix}-${clone.answer_option_id}`
      }
    }
    return clone
  }
  const prerequisite = payload.prerequisite_bridge.map(mapBlock)
  const explanations = payload.explanation_blocks.map(mapBlock)
  const examples = payload.worked_examples.map(mapBlock)
  const checks = payload.micro_checks.map((block) => mapBlock(block) as typeof block)
  const summary = payload.summary.map(mapBlock)
  return {
    ...structuredClone(payload),
    prerequisite_bridge: prerequisite,
    explanation_blocks: explanations,
    worked_examples: examples,
    misconceptions: payload.misconceptions.map((entry) => ({
      ...structuredClone(entry),
      misconception_tag: `${prefix}-${entry.misconception_tag}`,
    })),
    micro_checks: checks,
    summary,
    objective_coverage: payload.objective_coverage.map((entry) => ({
      ...structuredClone(entry),
      block_ids: entry.block_ids.map((id) => blockMap.get(id) ?? `${prefix}-${id}`),
    })),
  }
}

function collectConceptCitations(payload: ConceptLessonPayload): CitationRef[] {
  const blocks = [
    ...payload.prerequisite_bridge,
    ...payload.explanation_blocks,
    ...payload.worked_examples,
    ...payload.micro_checks,
    ...payload.summary,
  ]
  return deduplicate([
    ...blocks.flatMap(citationsFromBlock),
    ...payload.misconceptions.flatMap((entry) => entry.citations),
    ...payload.hint_ladders.flatMap((entry) => entry.hints.flatMap((hint) => hint.citations)),
  ])
}

function collectCodeLabCitations(payload: CodeLabPublicPayload): CitationRef[] {
  return deduplicate([
    ...payload.instructions.flatMap(citationsFromBlock),
    ...payload.public_tests.flatMap((test) => test.citations),
    ...payload.hint_ladders.flatMap((entry) => entry.hints.flatMap((hint) => hint.citations)),
    ...(payload.practical_guide?.used_evidence ?? []),
  ])
}

function citationsFromBlock(block: RenderBlock): CitationRef[] {
  if ("claims" in block) return block.claims.flatMap((claim) => claim.citations)
  if ("citations" in block) return block.citations
  return []
}

function normalizePrerequisiteBridges(
  blocks: RenderBlock[],
  request: ConceptTutorRequest,
): RenderBlock[] {
  const prerequisiteSources = new Set(request.generation_spec.path_node.prerequisite_source_ids)
  const factsBySource = new Map(request.evidence_pack.results
    .filter((entry) => prerequisiteSources.has(entry.source_id) && entry.facts.length > 0)
    .map((entry) => [entry.source_id, entry.facts[0]] as const))
  const normalized = blocks.map((block) => {
    const clone = structuredClone(block)
    if ("claims" in clone) {
      clone.claims = clone.claims.map((claim) => ({
        ...claim,
        citations: claim.citations.map((citation) => prerequisiteSources.has(citation.source_id)
          ? { ...citation, relation: "prerequisite" as const }
          : citation),
      }))
    }
    if ("citations" in clone) {
      clone.citations = clone.citations.map((citation) => prerequisiteSources.has(citation.source_id)
        ? { ...citation, relation: "prerequisite" as const }
        : citation)
    }
    return clone
  })
  const covered = new Set(normalized.flatMap(citationsFromBlock)
    .filter((citation) => citation.relation === "prerequisite")
    .map((citation) => citation.source_id))
  for (const [sourceId, fact] of factsBySource) {
    if (covered.has(sourceId)) continue
    const identity = {
      spec_id: request.generation_spec.spec_id,
      source_id: sourceId,
      fact_id: fact.fact_id,
    }
    normalized.push({
      block_id: stableId("PREREQ-BLOCK", identity),
      block_type: "paragraph",
      text: `先修知识连接：${fact.content}`,
      claims: [{
        claim_id: stableId("PREREQ-CLAIM", identity),
        text: fact.content,
        citations: [{ source_id: sourceId, fact_id: fact.fact_id, relation: "prerequisite" }],
      }],
    })
  }
  return normalized
}

function freezeClaimTexts(blocks: RenderBlock[], evidence: RagEvidencePack): void {
  const facts = new Map(evidence.results.flatMap((entry) =>
    entry.facts.map((fact) => [`${fact.source_id}:${fact.fact_id}`, fact.content] as const),
  ))
  for (const block of blocks) {
    if (!("claims" in block)) continue
    block.claims = block.claims.map((claim) => {
      const fact = claim.citations.map((citation) => facts.get(`${citation.source_id}:${citation.fact_id}`))
        .find((content): content is string => Boolean(content))
      if (!fact) return claim
      return claimTextMatchesFact(claim.text, fact)
        ? { ...claim, text: claim.text.trim() }
        : { ...claim, text: fact }
    })
  }
}

function anchorRenderedClaims(blocks: RenderBlock[]): void {
  for (const block of blocks) anchorRenderedClaim(block)
}

function anchorRenderedClaim(block: RenderBlock): void {
  if (!("claims" in block) || block.block_type === "code") return
  const rendered = renderedTextForAnchor(block)
  const missing = unique(block.claims.map((claim) => claim.text).filter((claimText) =>
    !visibleTeachingTextExpressesFact(rendered, claimText)))
  if (missing.length === 0) return
  const anchor = missing.join("；")
  if (block.block_type === "paragraph" || block.block_type === "callout") {
    block.text = `${block.text.trim()}\n${anchor}`
    return
  }
  if (block.block_type === "comparison") {
    const column = block.columns[0]
    if (column) column.content = `${column.content.trim()}\n${anchor}`
  }
}

function renderedTextForAnchor(block: RenderBlock): string {
  if (block.block_type === "heading") return block.text
  if (block.block_type === "paragraph" || block.block_type === "callout") {
    return block.text
  }
  if (block.block_type === "comparison") {
    return [block.title, ...block.columns.flatMap((column) => [
      column.heading,
      column.content,
    ])].join("\n")
  }
  if (block.block_type === "code") return [block.caption, block.code].filter(Boolean).join("\n")
  if (block.block_type === "hint") return block.text
  if (block.block_type === "quiz") return block.prompt
  return ""
}

function anchorMisconceptionEvidence(
  payload: ConceptLessonPayload,
  evidence: RagEvidencePack,
): void {
  const facts = new Map(evidence.results.flatMap((entry) =>
    entry.facts.map((fact) => [
      `${fact.source_id}:${fact.fact_id}`,
      fact.content,
    ] as const)))
  for (const misconception of payload.misconceptions) {
    const rendered = normalizeGroundedClaimText(misconception.explanation)
    const missing = unique(misconception.citations.flatMap((citation) => {
      const fact = facts.get(`${citation.source_id}:${citation.fact_id}`)
      return fact && !rendered.includes(normalizeGroundedClaimText(fact))
        ? [fact]
        : []
    }))
    if (missing.length > 0) {
      misconception.explanation = `${misconception.explanation.trim()}\n${missing.join("；")}`
    }
  }
}

function ensureRequiredModalities(
  modalities: AssessmentItemPublic["modality"][],
  tiers: Array<1 | 2 | 3>,
  required: AssessmentItemPublic["modality"][],
): void {
  const preferredTier: Record<AssessmentItemPublic["modality"], 1 | 2 | 3> = {
    mcq: 1,
    true_false: 1,
    trace: 2,
    short_answer: 2,
    code: 3,
  }
  for (const modality of required) {
    if (modalities.includes(modality)) continue
    const replaceable = modalities.findIndex((current, index) =>
      tiers[index] === preferredTier[modality]
      && (!required.includes(current) || modalities.filter((entry) => entry === current).length > 1),
    )
    const fallback = modalities.findIndex((current) =>
      !required.includes(current) || modalities.filter((entry) => entry === current).length > 1,
    )
    const index = replaceable >= 0 ? replaceable : fallback
    if (index < 0) throw new ModelOutputValidationError("assessment.plan", [`无法安置必需题型 ${modality}`])
    modalities[index] = modality
  }
}

function assignObjectives(
  spec: GenerationSpec,
  modalities: AssessmentItemPublic["modality"][],
): GenerationSpec["targets"] {
  const assignments: Array<GenerationSpec["targets"][number] | undefined> = Array(modalities.length)
  const protectedSlots = new Set<number>()
  for (const required of spec.assessment_blueprint.required_modalities) {
    const index = modalities.findIndex((modality, slot) =>
      modality === required && !protectedSlots.has(slot))
    if (index >= 0) protectedSlots.add(index)
  }
  const core = spec.targets.filter((target) => target.importance === "core")
    .sort((left, right) =>
      compatibleCount(left.observable_behavior, modalities)
      - compatibleCount(right.observable_behavior, modalities)
      || left.objective_id.localeCompare(right.objective_id))
  for (const target of core) {
    const compatibleSlots = modalities.flatMap((modality, slot) =>
      !assignments[slot]
        && modalityMeasuresBehavior(target.observable_behavior, modality)
        ? [slot]
        : [])
      .sort((left, right) =>
        Number(!protectedSlots.has(left)) - Number(!protectedSlots.has(right))
        || left - right)
    let index = compatibleSlots[0] ?? -1
    if (index < 0) {
      index = modalities.findIndex((_modality, slot) =>
        !assignments[slot] && !protectedSlots.has(slot))
      if (index >= 0) {
        modalities[index] = preferredModalityForBehavior(
          target.observable_behavior,
        )
      }
    }
    if (index < 0) {
      throw new ModelOutputValidationError("assessment.plan", [
        `蓝图的必选题型占满槽位，无法直接测量核心目标 ${target.objective_id}/${target.observable_behavior}`,
      ])
    }
    assignments[index] = target
  }
  let cursor = 0
  for (let index = 0; index < assignments.length; index += 1) {
    if (assignments[index]) continue
    const compatible = spec.targets.filter((target) =>
      modalityMeasuresBehavior(target.observable_behavior, modalities[index]))
    if (compatible.length === 0) {
      const fallbackTarget = spec.targets[cursor % spec.targets.length]!
      modalities[index] = preferredModalityForBehavior(fallbackTarget.observable_behavior)
      assignments[index] = fallbackTarget
      cursor += 1
      continue
    }
    assignments[index] = compatible[cursor % compatible.length]
    cursor += 1
  }
  return assignments as GenerationSpec["targets"]
}

function compatibleCount(
  behavior: GenerationSpec["targets"][number]["observable_behavior"],
  modalities: AssessmentItemPublic["modality"][],
): number {
  return modalities.filter((modality) =>
    modalityMeasuresBehavior(behavior, modality)).length
}

function deterministicRouting(items: AssessmentItemPublic[]): AssessmentPublicPayload["routing"] {
  const anchors = items.filter((item) => item.tier <= 2).slice(0, 3).map((item) => item.item_id)
  if (anchors.length === 0) anchors.push(items[0].item_id)
  return {
    anchor_item_ids: anchors,
    rules: [
      { route_id: "ROUTE-REMEDIATE", min_anchor_score_ratio: 0, max_anchor_score_ratio: 0.4, action: "remediate", reveal_tiers: [1] },
      { route_id: "ROUTE-REINFORCE", min_anchor_score_ratio: 0.4, max_anchor_score_ratio: 0.8, action: "reinforce", reveal_tiers: [1, 2] },
      { route_id: "ROUTE-ADVANCE", min_anchor_score_ratio: 0.8, max_anchor_score_ratio: 1, action: "advance", reveal_tiers: [2, 3] },
    ],
  }
}

function assessmentPublicCoverage(spec: GenerationSpec, items: AssessmentItemPublic[]) {
  return spec.targets.flatMap((target) => {
    const selected = items.filter((item) => item.objective_id === target.objective_id)
    if (selected.length === 0) return []
    return [{
      objective_id: target.objective_id,
      item_ids: selected.map((item) => item.item_id),
      modalities: unique(selected.map((item) => item.modality)),
    }]
  })
}

function assessmentSecureCoverage(spec: GenerationSpec, items: AssessmentItemSecure[]) {
  return spec.targets.flatMap((target) => {
    const selected = items.filter((item) => item.objective_id === target.objective_id)
    if (selected.length === 0) return []
    return [{
      objective_id: target.objective_id,
      item_ids: selected.map((item) => item.item_id),
      answer_kinds: unique(selected.map((item) => item.answer_spec.kind)),
    }]
  })
}

function reorderChoiceOptions(
  payload: AssessmentPublicPayload,
  secureItems: AssessmentItemSecure[],
  seed: number,
): AssessmentPublicPayload {
  let ordinal = 0
  const secureById = new Map(secureItems.map((item) => [item.item_id, item]))
  const items = payload.items.map((item) => {
    if (!item.options) return structuredClone(item)
    const correctId = secureById.get(item.item_id)?.correct_option_id
    const correct = item.options.find((option) => option.option_id === correctId)
    if (!correct) return structuredClone(item)
    const others = item.options.filter((option) => option.option_id !== correctId)
    const targetPosition = (positiveModulo(seed, item.options.length) + ordinal) % item.options.length
    ordinal += 1
    const options = [...others]
    options.splice(targetPosition, 0, correct)
    return { ...structuredClone(item), options: options.map((option, index) => ({ ...option, label: "ABCD"[index] })) }
  })
  return { ...structuredClone(payload), items }
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor
}

function deduplicate(citations: CitationRef[]): CitationRef[] {
  return [...new Map(citations.map((entry) => [
    `${entry.source_id}:${entry.fact_id}:${entry.relation}`,
    structuredClone(entry),
  ])).values()]
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

/** Converts model-authored inputs into the stdin text contract used by stdin_stdout mode. */
export function asStandardInput(input: unknown): string {
  if (typeof input === "string") return input
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return input === undefined || input === null ? "" : `${String(input)}\n`
  }
  const envelope = input as { args?: unknown[]; kwargs?: Record<string, unknown> }
  if (!Array.isArray(envelope.args)) return `${JSON.stringify(input)}\n`
  const lines = [
    ...envelope.args,
    ...Object.values(envelope.kwargs ?? {}),
  ].map((value) => typeof value === "string" ? value : JSON.stringify(value))
  return lines.length > 0 ? `${lines.join("\n")}\n` : ""
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function isFunctionInvocationEnvelope(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  return keys.length > 0
    && keys.every((key) => key === "args" || key === "kwargs")
    && Array.isArray(record.args)
    && (record.kwargs === undefined
      || (record.kwargs !== null
        && typeof record.kwargs === "object"
        && !Array.isArray(record.kwargs)))
}

function chunk<T>(values: readonly T[], size: number): T[][] {
  const normalized = Math.max(1, Math.floor(size))
  const output: T[][] = []
  for (let index = 0; index < values.length; index += normalized) {
    output.push(values.slice(index, index + normalized))
  }
  return output
}
