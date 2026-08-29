import { stableId } from "../contracts/common"
import { factKey } from "../../knowledge/identifiers"
import type { CitationRef } from "../contracts/common"
import type { ConceptLessonPayload, QuizBlock, RenderBlock, Claim } from "../contracts/artifacts"
import type { ConceptTutorRequest } from "../agents/types"
import type { ObjectiveSupportPlan } from "./artifact-feasibility"
import { assessObjectiveSupport } from "./artifact-feasibility"
import type { ObservableBehavior } from "../contracts/profile-adapter"
import {
  normalizeGroundedClaimText,
  visibleTeachingTextExpressesFact,
} from "../validators/claim-grounding"
import {
  inferFactCapabilities,
  selectEvidenceBundle,
  type CapabilityFactLike,
} from "../../knowledge/capabilities"
import {
  executableExampleFactIds,
  isSubstantivePythonExample,
} from "../../knowledge/example-code"
import type { RoleCPedagogyContract } from "../../role-b-profile/pedagogy-contract"
import {
  buildTeachingUnitContract,
  validateTeachingUnitPlan,
  type TeachingUnitContract,
} from "./teaching-unit-contract"

/**
 * 讲义 Section Plan（改进方案5 第六节）。
 *
 * 讲义太少不是提示词问题，而是内部 author payload 每个部分只能写一个字符串，
 * 模型无法展开多个细粒度教学单元。Section Plan 把每个 objective 的讲义结构
 * 冻结为有序的 section slot，模型只能逐 slot 填写，citation/block ID/coverage
 * 仍由程序物化。这样"每一块更精细"由 Schema 保证，而不是靠提示词喊"写长一点"。
 */

export type ConceptAuthoringMode =
  | "definition_only"
  | "guided_explanation"
  | "procedural"
  | "comparative"

export type AllowedContentMove =
  | "direct_paraphrase"
  | "plain_language_explanation"
  | "direct_instance"
  | "fact_negation"
  | "recognition_check"
  | "procedure_trace"
  | "explicit_comparison"
  | "boundary_explanation"

export interface ConceptSectionSlot {
  slot_id: string
  kind:
    | "overview"
    | "fact_explanation"
    | "guided_example"
    | "procedure_steps"
    | "comparison"
    | "boundary"
    | "misconception"
    | "recap"
  fact_ids: string[]
  allowed_moves: AllowedContentMove[]
  required: boolean
  min_sentences: number
  max_sentences: number
  allowed_block_types: Array<"paragraph" | "code" | "callout" | "comparison">
  /** A grounded code example exists in the current fact closure. */
  requires_executable_code?: boolean
}

export interface ConceptSectionPlan {
  objective_id: string
  mode: ConceptAuthoringMode
  slots: ConceptSectionSlot[]
  micro_check: {
    mode: "recognition" | "guided_application" | "transfer"
    fact_ids: string[]
    minimum_reasoning_steps: 1 | 2 | 3
  }
  teaching_unit_contract?: TeachingUnitContract
}

const MAX_FACTS_PER_EXPLANATION_SLOT = 3

function chunkFactIds(factIds: string[]): string[][] {
  const chunks: string[][] = []
  for (let index = 0; index < factIds.length; index += MAX_FACTS_PER_EXPLANATION_SLOT) {
    chunks.push(factIds.slice(index, index + MAX_FACTS_PER_EXPLANATION_SLOT))
  }
  return chunks
}

function slot(
  kind: ConceptSectionSlot["kind"],
  overrides: Partial<ConceptSectionSlot> & { fact_ids: string[] },
): ConceptSectionSlot {
  return {
    slot_id: stableId("CONCEPT-SLOT", { kind, fact_ids: overrides.fact_ids }),
    kind,
    allowed_moves: [],
    required: true,
    min_sentences: 1,
    max_sentences: 4,
    allowed_block_types: ["paragraph"],
    ...overrides,
  }
}

/** 由 ObjectiveSupportPlan 判定讲义创作模式（单一权威，消除关键词判断的冲突）。 */
export function conceptModeForSupport(
  support: ObjectiveSupportPlan,
  factCount: number,
): ConceptAuthoringMode {
  const behaviors = support.supported_behaviors
  if (support.artifact_support.concept === "unsupported") return "definition_only"
  if (support.allowed_content_moves.includes("explicit_comparison") && factCount >= 2) return "comparative"
  if (behaviors.includes("trace") && !behaviors.includes("create")) return "procedural"
  if (factCount <= 2) return "definition_only"
  return "guided_explanation"
}

/** 由 ObjectiveSupportPlan 生成 Section Plan（复用可行性结论，不再用 facts.length 重判）。 */
export function buildConceptSectionPlan(input: {
  objective_id: string
  observable_behavior: ObservableBehavior
  fact_ids: string[]
  support: ObjectiveSupportPlan
  learner_level?: "beginner" | "basic" | "intermediate" | "integrated"
  micro_check_fact_ids?: string[]
  executable_example_fact_ids?: string[]
  pedagogy_contract?: RoleCPedagogyContract
  teaching_unit_contract?: TeachingUnitContract
  has_boundary_support?: boolean
}): ConceptSectionPlan {
  const { fact_ids } = input
  const mode = conceptModeForSupport(input.support, fact_ids.length)

  const factGroups = chunkFactIds(fact_ids)
  const primaryFactGroup = factGroups[0] ?? []
  const executableExampleFactIds = input.executable_example_fact_ids?.filter((factId) =>
    fact_ids.includes(factId)) ?? []
  const requiresExecutableCode = executableExampleFactIds.length > 0

  const commonSlots: ConceptSectionSlot[] = [
    slot("overview", {
      fact_ids: fact_ids.slice(0, 1),
      allowed_moves: ["direct_paraphrase", "plain_language_explanation"],
      min_sentences: 1,
      max_sentences: 2,
      allowed_block_types: ["paragraph"],
    }),
    ...factGroups.map((group) => slot("fact_explanation", {
      fact_ids: group,
      allowed_moves: ["direct_paraphrase", "plain_language_explanation", "direct_instance"],
      min_sentences: 2,
      max_sentences: Math.max(4, group.length * 2 + 1),
      allowed_block_types: ["paragraph", "callout"],
    })),
  ]

  const primaryModeSlots: ConceptSectionSlot[] = mode === "procedural"
    ? [slot("procedure_steps", {
        fact_ids: requiresExecutableCode ? executableExampleFactIds : primaryFactGroup,
        allowed_moves: ["procedure_trace", "direct_instance"],
        min_sentences: 1,
        max_sentences: 6,
        allowed_block_types: ["paragraph", "code"],
        ...(requiresExecutableCode ? { requires_executable_code: true } : {}),
      })]
    : mode === "comparative"
      ? [slot("comparison", {
          fact_ids: primaryFactGroup,
          allowed_moves: ["explicit_comparison", "direct_instance"],
          min_sentences: 2,
          max_sentences: 6,
          allowed_block_types: ["comparison", "paragraph"],
        })]
      : [slot("guided_example", {
          // A guided explanation may combine any facts already frozen for the
          // objective. Restricting it to the first (usually definition-only)
          // chunk forced basic learners back into a recall-only example even
          // when later facts exposed safe application behavior.
          fact_ids: requiresExecutableCode ? executableExampleFactIds : fact_ids,
          allowed_moves: ["direct_instance", "recognition_check"],
          min_sentences: 1,
          max_sentences: Math.max(4, Math.min(8, fact_ids.length + 2)),
          // Only procedural evidence may author executable Python.  A pure
          // definition/example objective otherwise tends to invent print,
          // variables or string syntax merely to satisfy a code-shaped slot.
          allowed_block_types: requiresExecutableCode ? ["code"] : ["paragraph"],
          ...(requiresExecutableCode ? { requires_executable_code: true } : {}),
        })]

  const requestedExamples = input.pedagogy_contract?.lesson.worked_example_count ?? 1
  const modeSlots: ConceptSectionSlot[] = Array.from({ length: requestedExamples }, (_, index) => {
    const base = primaryModeSlots[index === 0 ? 0 : primaryModeSlots.length - 1]!
    return {
      ...base,
      slot_id: stableId("CONCEPT-SLOT", {
        objective_id: input.objective_id,
        kind: base.kind,
        fact_ids: base.fact_ids,
        example_index: index,
      }),
      min_sentences: index === 0 ? base.min_sentences : Math.max(1, base.min_sentences - 1),
    }
  })
  const traceSlot = input.pedagogy_contract?.lesson.require_step_trace
    && mode !== "procedural"
    && (input.support.supported_behaviors.includes("trace") || executableExampleFactIds.length > 0)
    ? [slot("procedure_steps", {
        slot_id: stableId("CONCEPT-SLOT", { objective_id: input.objective_id, kind: "step_trace" }),
        fact_ids: executableExampleFactIds.length > 0 ? executableExampleFactIds : fact_ids,
        allowed_moves: ["procedure_trace"],
        min_sentences: 2,
        max_sentences: 6,
        allowed_block_types: ["paragraph"],
      })]
    : []
  const debuggingSlot = input.pedagogy_contract?.lesson.require_debugging_clinic
    && input.has_boundary_support
    ? [slot("boundary", {
        slot_id: stableId("CONCEPT-SLOT", { objective_id: input.objective_id, kind: "debugging_clinic" }),
        fact_ids,
        allowed_moves: ["boundary_explanation", "fact_negation"],
        min_sentences: 2,
        max_sentences: 5,
        allowed_block_types: ["callout", "paragraph"],
      })]
    : []

  const misconceptionSlot = slot("misconception", {
    fact_ids: fact_ids.slice(0, 1),
    allowed_moves: ["fact_negation"],
    min_sentences: 2,
    max_sentences: 4,
    allowed_block_types: ["callout"],
  })
  const recapSlot = slot("recap", {
    // Recap 压缩整个 objective，因此它的引用边界也必须覆盖
    // 整个 objective。只绑首组事实会让正常总结后半段变成“内容
    // 正确但引用错位”。
    fact_ids,
    allowed_moves: ["direct_paraphrase"],
    min_sentences: 1,
    max_sentences: 3,
    allowed_block_types: ["paragraph"],
  })

  const plannedMicroCheckFacts = input.micro_check_fact_ids?.length
    ? input.micro_check_fact_ids
    : primaryFactGroup
  const orderedSlots = input.pedagogy_contract?.lesson.opening === "example_then_rule"
    || input.pedagogy_contract?.lesson.opening === "task_then_explanation"
    ? [commonSlots[0]!, ...modeSlots, ...commonSlots.slice(1), ...traceSlot, ...debuggingSlot, misconceptionSlot, recapSlot]
    : [...commonSlots, ...modeSlots, ...traceSlot, ...debuggingSlot, misconceptionSlot, recapSlot]
  return {
    objective_id: input.objective_id,
    mode,
    slots: orderedSlots,
    micro_check: input.learner_level === "beginner"
      ? { mode: "recognition", fact_ids: primaryFactGroup, minimum_reasoning_steps: 1 }
      : input.observable_behavior === "create"
        ? { mode: "transfer", fact_ids: plannedMicroCheckFacts.slice(0, 4), minimum_reasoning_steps: 3 }
        : { mode: "guided_application", fact_ids: plannedMicroCheckFacts.slice(0, 4), minimum_reasoning_steps: 2 },
    ...(input.teaching_unit_contract
      ? { teaching_unit_contract: structuredClone(input.teaching_unit_contract) }
      : {}),
  }
}

// ── 物化：按 slot 生成多个 RenderBlock（内部 V2，公开 Schema 不动）──

export interface AuthoredSection {
  slot_id: string
  heading: string
  body: string
  steps: string[]
  code: string | null
}

/** 单个 slot → RenderBlock。 */
export function materializeSectionBlock(input: {
  objective_id: string
  slot: ConceptSectionSlot
  section: AuthoredSection
  claims: Claim[]
}): RenderBlock {
  const { slot, section, claims, objective_id } = input
  const baseId = stableId("CONCEPT-BLOCK", { objective_id, slot_id: slot.slot_id })
  if (slot.allowed_block_types.includes("comparison") && slot.kind === "comparison") {
    const match = section.body.match(/相同点\s*[：:]\s*([\s\S]+?)\s*(?:不同点|区别)\s*[：:]\s*([\s\S]+)/u)
    if (match?.[1]?.trim() && match[2]?.trim()) {
      return {
        block_id: baseId,
        block_type: "comparison",
        title: section.heading || slot.kind,
        columns: [
          { heading: "相同点", content: match[1].trim() },
          { heading: "不同点", content: match[2].trim() },
        ],
        claims,
      }
    }
    // 比较内容没有稳定分栏标记时保留为有证据的段落，避免程序臆造两栏含义。
    return {
      block_id: baseId,
      block_type: "paragraph",
      text: section.heading ? `${section.heading}：${section.body}` : section.body,
      claims,
    }
  }
  if (slot.allowed_block_types.includes("code") && section.code) {
    return {
      block_id: baseId,
      block_type: "code",
      code: section.code,
      language: "python",
      caption: section.heading || undefined,
      claims,
    } as RenderBlock
  }
  if (slot.allowed_block_types.includes("callout") && slot.kind === "misconception") {
    return {
      block_id: baseId,
      block_type: "callout",
      tone: "warning",
      title: section.heading || "常见误区",
      text: section.body,
      claims,
    }
  }
  return {
    block_id: baseId,
    block_type: "paragraph",
    text: section.heading ? `${section.heading}：${section.body}` : section.body,
    claims,
  }
}

/**
 * 按 Section Plan 物化一个 objective 的多个 RenderBlock。
 * required slot 缺失时抛错；非 required 缺失则跳过。模型不能自由添加 section。
 */
export function materializeConceptObjectiveV2(input: {
  objective_id: string
  source_id: string
  plan: ConceptSectionPlan
  authored: { sections: AuthoredSection[] }
  citations: CitationRef[]
  factTextByFactId: Map<string, string>
}): RenderBlock[] {
  const { objective_id, source_id, plan, authored, citations, factTextByFactId } = input
  const authoredBySlot = new Map(authored.sections.map((section) => [section.slot_id, section]))
  const blocks: RenderBlock[] = []
  for (const slot of plan.slots) {
    const section = authoredBySlot.get(slot.slot_id)
    if (!section) {
      if (slot.required) {
        throw new Error(`CONCEPT_REQUIRED_SLOT_MISSING:${slot.slot_id}`)
      }
      continue
    }
    const claims: Claim[] = slot.fact_ids.map((factId, index) => {
      const citation = citations.find((entry) =>
        entry.source_id === source_id && entry.fact_id === factId)
      return {
        claim_id: stableId("CONCEPT-CLAIM", { objective_id, slot_id: slot.slot_id, fact_id: factId, index }),
        text: citation
          ? factTextByFactId.get(factKey(citation)) ?? factTextByFactId.get(factId) ?? ""
          : factTextByFactId.get(factId) ?? "",
        citations: citation ? [structuredClone(citation)] : [],
      }
    })
    blocks.push(materializeSectionBlock({ objective_id, slot, section, claims }))
  }
  return blocks
}

/** 结构质量校验：required slot 是否全部物化、是否越界使用 content move。 */
export function validateConceptSectionStructure(input: {
  plan: ConceptSectionPlan
  authored: { sections: AuthoredSection[] }
}): string[] {
  const { plan, authored } = input
  const issues: string[] = []
  const sectionIds = authored.sections.map((section) => section.slot_id)
  const authoredIds = new Set(authored.sections.map((section) => section.slot_id))
  if (authoredIds.size !== sectionIds.length) {
    issues.push("sections 不得重复返回同一 slot_id")
  }
  for (const slot of plan.slots) {
    if (slot.required && !authoredIds.has(slot.slot_id)) {
      issues.push(`required slot ${slot.slot_id} 缺失`)
    }
  }
  for (const section of authored.sections) {
    const planned = plan.slots.find((slot) => slot.slot_id === section.slot_id)
    if (!planned) {
      issues.push(`计划外 section ${section.slot_id} 不得出现`)
      continue
    }
    if (section.code && !planned.allowed_block_types.includes("code")) {
      issues.push(`section ${section.slot_id} 不允许生成 code`)
    }
    if (planned.requires_executable_code && !isSubstantivePythonExample(section.code ?? "")) {
      issues.push(`section ${section.slot_id} 必须提供含可执行语句的 Python 示例，不能只写注释、pass 或省略号`)
    } else if (section.code && !isSubstantivePythonExample(section.code)) {
      issues.push(`section ${section.slot_id} 的 code 不能只包含注释、pass 或省略号`)
    }
    const sentences = splitTeachingSentences(section.body)
    if (sentences.length < planned.min_sentences) {
      issues.push(
        `section ${section.slot_id} 至少需要 ${planned.min_sentences} 个有效句子，实际 ${sentences.length}`,
      )
    }
    // max_sentences 是生成与质量评价的密度目标，不是事实正确性合同。
    // 模型多写一两个有效句子，或确定性事实锚定补入权威句后，不应让整份
    // 讲义失效。重复、空内容、事实覆盖和引用仍由下方独立规则严格检查。
    const distinctSentences = new Set(sentences.map(normalizeGroundedClaimText))
    if (distinctSentences.size < sentences.length) {
      issues.push(`section ${section.slot_id} 不得用重复句子填充篇幅`)
    }
    const normalizedHeading = normalizeGroundedClaimText(section.heading)
    const normalizedFirstSentence = normalizeGroundedClaimText(sentences[0] ?? "")
    if (
      normalizedHeading.length >= 6
      && normalizedHeading === normalizedFirstSentence
    ) {
      issues.push(`section ${section.slot_id} 标题不得与正文首句完全重复`)
    }
    if (/\b(?:fact|source)[-_ ]?id\b|证据事实|引用事实/iu.test(`${section.heading}\n${section.body}`)) {
      issues.push(`section ${section.slot_id} 不得向学习者暴露事实编号或证据标签`)
    }
  }
  return issues
}

function splitTeachingSentences(value: string): string[] {
  return value
    .split(/[。！？!?；;\n]+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
}

/**
 * 校验学习者实际可见的事实讲解，而不是自动附加的 claim/citation 元数据。
 * 每条 required fact 都必须在 fact_explanation 的学习者可见正文中原意可见。
 * 多条相关事实可在同一教学单元中自然组织；校验覆盖不强迫展示层“一事实一段”。
 */
export function validateConceptVisibleFactCoverage(
  request: ConceptTutorRequest,
  payload: ConceptSegmentAuthorPayloadV2,
  plans: ConceptSectionPlan[],
): string[] {
  const issues: string[] = []
  const factsByKey = new Map(request.evidence_pack.results.flatMap((source) =>
    source.facts.map((fact) => [`${source.source_id}:${fact.fact_id}`, fact.content] as const)))

  for (const target of request.generation_spec.targets) {
    const authored = payload.objectives.find((entry) => entry.objective_id === target.objective_id)
    const plan = plans.find((entry) => entry.objective_id === target.objective_id)
    if (!authored || !plan) continue
    const authoredBySlot = new Map(authored.sections.map((section) => [section.slot_id, section]))

    const normalizedFactTexts: string[] = []
    for (const factId of target.required_fact_ids) {
      const fact = factsByKey.get(`${target.source_id}:${factId}`)
      if (!fact?.trim()) {
        issues.push(`objective ${target.objective_id} 的 required fact ${factId} 在 evidence 中不存在`)
        continue
      }
      normalizedFactTexts.push(normalizeGroundedClaimText(fact))
      const factSlots = plan.slots.filter((slotPlan) =>
        slotPlan.kind === "fact_explanation" && slotPlan.fact_ids.includes(factId))
      const visibleBodies = factSlots
        .map((slotPlan) => authoredBySlot.get(slotPlan.slot_id)?.body ?? "")
        .filter(Boolean)
      const coveringBody = visibleBodies.find((body) =>
        visibleTeachingTextExpressesFact(body, fact))
      if (!coveringBody) {
        issues.push(
          `objective ${target.objective_id} 的 required fact ${factId} 未在可见 fact_explanation 正文中完整表达`,
        )
        continue
      }
    }

    const underExplainedSlot = plan.slots
      .filter((slotPlan) => slotPlan.kind === "fact_explanation")
      .find((slotPlan) => {
        const body = authoredBySlot.get(slotPlan.slot_id)?.body ?? ""
        const normalizedBody = normalizeGroundedClaimText(body)
        const boundFactLength = slotPlan.fact_ids.reduce((total, factId) => {
          const fact = factsByKey.get(`${target.source_id}:${factId}`)
          return total + normalizeGroundedClaimText(fact ?? "").length
        }, 0)
        const minimumExplanationLength = Math.max(12, slotPlan.fact_ids.length * 6)
        return normalizedBody.length - boundFactLength < minimumExplanationLength
      })
    if (normalizedFactTexts.length > 0 && underExplainedSlot) {
      issues.push(
        `objective ${target.objective_id} 只罗列或复述 required facts，缺少通俗解释或有意义的直接实例`,
      )
    }
  }
  return issues
}

// ── V2 author payload 与 segment 级物化器 ──

export interface ConceptSegmentAuthorPayloadV2 {
  title: string
  objectives: Array<{
    objective_id: string
    sections: AuthoredSection[]
    micro_check: {
      prompt: string
      options: string[]
      answer: string
      explanation: string
    }
    hints: string[]
  }>
}

/**
 * 将冻结证据的事实核心稳定地放入学习者可见讲义。
 *
 * 模型仍负责标题、解释、例子和教学组织；程序只在对应的
 * fact_explanation slot 中补入没有完整表达的权威事实句。这使
 * “事实真值”与“教学表达”分层，避免自由改写遗漏核心事实，也不会
 * 把 citation 或内部 ID 暴露到正文。
 */
export function anchorConceptFactsInVisibleText(input: {
  payload: ConceptSegmentAuthorPayloadV2
  request: ConceptTutorRequest
  plans: ConceptSectionPlan[]
}): ConceptSegmentAuthorPayloadV2 {
  const payload = structuredClone(input.payload)
  payload.title = normalizeLearnerVisibleAuditLanguage(payload.title)
  for (const objective of payload.objectives) {
    for (const section of objective.sections) {
      section.heading = normalizeLearnerVisibleAuditLanguage(section.heading)
      section.body = normalizeLearnerVisibleAuditLanguage(section.body)
      section.steps = section.steps.map(normalizeLearnerVisibleAuditLanguage)
      if (section.code) section.code = normalizeLearnerVisibleAuditLanguage(section.code)
    }
    objective.micro_check.prompt = normalizeLearnerVisibleAuditLanguage(objective.micro_check.prompt)
    objective.micro_check.options = objective.micro_check.options.map(normalizeLearnerVisibleAuditLanguage)
    objective.micro_check.answer = normalizeLearnerVisibleAuditLanguage(objective.micro_check.answer)
    objective.micro_check.explanation = normalizeLearnerVisibleAuditLanguage(objective.micro_check.explanation)
    objective.hints = objective.hints.map(normalizeLearnerVisibleAuditLanguage)
  }
  const factsByKey = new Map(input.request.evidence_pack.results.flatMap((source) =>
    source.facts.map((fact) => [`${source.source_id}:${fact.fact_id}`, fact.content] as const)))
  const targetByObjective = new Map(input.request.generation_spec.targets.map((target) =>
    [target.objective_id, target] as const))

  for (const objective of payload.objectives) {
    const target = targetByObjective.get(objective.objective_id)
    const plan = input.plans.find((entry) => entry.objective_id === objective.objective_id)
    if (!target || !plan) continue
    const sectionBySlot = new Map(objective.sections.map((section) => [section.slot_id, section]))
    for (const slot of plan.slots.filter((entry) => entry.kind === "fact_explanation")) {
      const section = sectionBySlot.get(slot.slot_id)
      if (!section) continue
      const anchors = slot.fact_ids.flatMap((factId) => {
        const fact = factsByKey.get(`${target.source_id}:${factId}`)?.trim()
        if (!fact || visibleTeachingTextExpressesFact(section.body, fact)) return []
        return [fact]
      })
      if (anchors.length > 0) section.body = `${anchors.join("。")}。${section.body}`
    }
  }
  return payload
}

function normalizeLearnerVisibleAuditLanguage(value: string): string {
  return value
    .replace(/\b(?:source|fact)[-_ ]?id\s*[:：]?\s*[KF]?\d*\b/giu, "")
    .replace(/(?:证据事实|引用事实|事实编号|知识库编号)\s*[:：]?\s*[KF]?\d*/gu, "")
    .replace(/\bRAG\b/gu, "当前学习材料")
    .replace(/\bevidence(?:_pack)?\b/giu, "当前学习材料")
    .replace(/内部审核/gu, "内容检查")
    .replace(/隐藏测试/gu, "额外检查")
    .replace(/正确答案/gu, "本题答案")
    .replace(/[ \t]{2,}/gu, " ")
    .trim()
}

/** V2 模型输出必须与冻结的 objective/slot 身份一一对应。 */
export function validateConceptSegmentV2AgainstPlans(
  payload: ConceptSegmentAuthorPayloadV2,
  plans: ConceptSectionPlan[],
): string[] {
  const issues: string[] = []
  const expectedIds = plans.map((plan) => plan.objective_id)
  const actualIds = payload.objectives.map((objective) => objective.objective_id)
  if (actualIds.length !== expectedIds.length) {
    issues.push(`objectives 数量应为 ${expectedIds.length}，实际 ${actualIds.length}`)
  }
  if (new Set(actualIds).size !== actualIds.length) {
    issues.push("objectives 不得重复 objective_id")
  }
  expectedIds.forEach((objectiveId, index) => {
    if (actualIds[index] !== objectiveId) {
      issues.push(`objectives[${index}].objective_id 应为 ${objectiveId}`)
    }
  })
  for (const plan of plans) {
    const authored = payload.objectives.find((objective) => objective.objective_id === plan.objective_id)
    if (!authored) {
      issues.push(`objectives 缺少 ${plan.objective_id}`)
      continue
    }
    issues.push(...validateConceptSectionStructure({ plan, authored }))
    const normalizedOptions = authored.micro_check.options.map((option) => option.trim().toLocaleLowerCase())
    if (new Set(normalizedOptions).size !== normalizedOptions.length) {
      issues.push(`objective ${plan.objective_id} 的 micro_check.options 不得重复`)
    }
    if (!normalizedOptions.includes(authored.micro_check.answer.trim().toLocaleLowerCase())) {
      issues.push(`objective ${plan.objective_id} 的 micro_check.answer 必须与某个选项完全一致`)
    }
  }
  return issues
}

/**
 * V2 segment 物化器：把 section plan + 分段作者草稿物化为公开 ConceptLessonPayload。
 * 每个 section 生成独立的 RenderBlock；misconception → misconceptions，
 * recap → summary，其余 → explanation_blocks；micro_check/hints 独立物化。
 */
export function materializeConceptSegmentAuthorPayloadV2(input: {
  objective_id: string
  plan: ConceptSectionPlan
  authored: ConceptSegmentAuthorPayloadV2["objectives"][number]
  spec_id: string
  source_id: string
  citations: Array<{ source_id: string; fact_id: string; relation: "supports" | "derived_from" }>
  factTextByFactId: Map<string, string>
}): {
  explanation_blocks: ConceptLessonPayload["explanation_blocks"]
  worked_examples: ConceptLessonPayload["worked_examples"]
  misconceptions: ConceptLessonPayload["misconceptions"]
  micro_check: QuizBlock
  hint_ladder: ConceptLessonPayload["hint_ladders"][number]
  summary: ConceptLessonPayload["summary"]
  coverage_block_ids: string[]
} {
  const { objective_id, plan, authored, spec_id, source_id, citations, factTextByFactId } = input
  const identity = { spec_id, objective_id, source_id }
  const authoredBySlot = new Map(authored.sections.map((section) => [section.slot_id, section]))

  const visibleFactIdsFor = (
    slot: ConceptSectionSlot,
    section: AuthoredSection,
  ): string[] => {
    const visible = [section.heading, section.body, ...section.steps, section.code ?? ""].join("\n")
    return [...new Set([
      ...slot.fact_ids,
      ...citations.flatMap((citation) => {
        const fact = factTextByFactId.get(factKey({ source_id, fact_id: citation.fact_id }))
          ?? factTextByFactId.get(citation.fact_id)
        return fact && visibleTeachingTextExpressesFact(visible, fact)
          ? [citation.fact_id]
          : []
      }),
    ])]
  }

  // Claims/citations follow the final learner-visible text.  A model may reuse
  // another authoritative fact from the same frozen objective in an example
  // or recap; attaching that fact here is more accurate than rejecting the
  // whole lesson merely because the prose crossed an internal slot boundary.
  const claimsFor = (slot: ConceptSectionSlot, section: AuthoredSection) =>
    visibleFactIdsFor(slot, section).map((factId, index) => ({
    claim_id: stableId("CONCEPT-CLAIM", { ...identity, slot_id: slot.slot_id, fact_id: factId, index }),
    text: factTextByFactId.get(factKey({ source_id, fact_id: factId }))
      ?? factTextByFactId.get(factId)
      ?? "",
    citations: citations
      .filter((citation) => citation.fact_id === factId)
      .map((citation) => structuredClone(citation)),
    }))

  const explanationBlocks: ConceptLessonPayload["explanation_blocks"] = []
  const workedExamples: ConceptLessonPayload["worked_examples"] = []
  const misconceptions: ConceptLessonPayload["misconceptions"] = []
  const summary: ConceptLessonPayload["summary"] = []
  const coverageBlockIds: string[] = []

  for (const slot of plan.slots) {
    const section = authoredBySlot.get(slot.slot_id)
    if (!section) {
      if (slot.required) throw new Error(`CONCEPT_REQUIRED_SLOT_MISSING:${slot.slot_id}`)
      continue
    }
    if (slot.kind === "misconception") {
      const visibleFactIds = visibleFactIdsFor(slot, section)
      misconceptions.push({
        misconception_tag: stableId("CONCEPT-MISCONCEPTION", { ...identity, slot_id: slot.slot_id }),
        explanation: section.body.trim() || "常见误解：请结合上文事实自查。",
        objective_id,
        citations: citations
          .filter((citation) => visibleFactIds.includes(citation.fact_id))
          .map((citation) => structuredClone(citation)),
      })
      continue
    }
    if (slot.kind === "recap") {
      summary.push({
        block_id: stableId("CONCEPT-SUMMARY", { ...identity, slot_id: slot.slot_id }),
        block_type: "paragraph",
        text: section.body.trim(),
        claims: claimsFor(slot, section),
      })
      coverageBlockIds.push(stableId("CONCEPT-SUMMARY", { ...identity, slot_id: slot.slot_id }))
      continue
    }
    const sectionWithSteps = section.steps.length > 0
      ? { ...section, body: [section.body, ...section.steps.map((step, index) => `${index + 1}. ${step}`)].join("\n") }
      : section
    const block = materializeSectionBlock({
      objective_id,
      slot,
      section: sectionWithSteps,
      claims: claimsFor(slot, section),
    })
    const practiceSlot = slot.kind === "guided_example"
      || slot.kind === "procedure_steps"
      || slot.kind === "comparison"
    ;(practiceSlot ? workedExamples : explanationBlocks).push(block)
    if ("block_id" in block) coverageBlockIds.push(block.block_id)
  }

  // micro_check
  const optionIndex = authored.micro_check.options.findIndex((option) =>
    option.trim().toLocaleLowerCase() === authored.micro_check.answer.trim().toLocaleLowerCase())
  const primaryFactIds = plan.micro_check.fact_ids
  const primaryCitations = citations.filter((citation) =>
    primaryFactIds.includes(citation.fact_id))
  const micro_check: QuizBlock = {
    block_id: stableId("CONCEPT-CHECK", identity),
    block_type: "quiz",
    item_id: stableId("CONCEPT-CHECK-ITEM", identity),
    prompt: authored.micro_check.prompt.trim(),
    options: authored.micro_check.options.map((text, optionIndex2) => ({
      option_id: stableId("CONCEPT-CHECK-OPTION", { ...identity, option_index: optionIndex2 }),
      label: String.fromCharCode(65 + optionIndex2),
      text: text.trim(),
    })),
    ...(optionIndex >= 0
      ? {
          answer_option_id: stableId("CONCEPT-CHECK-OPTION", { ...identity, option_index: optionIndex }),
          answer_explanation: authored.micro_check.explanation.trim(),
        }
      : {}),
    citations: primaryCitations.map((citation) => ({ ...citation, relation: "derived_from" as const })),
  }
  coverageBlockIds.push(micro_check.block_id)

  const hint_ladder: ConceptLessonPayload["hint_ladders"][number] = {
    objective_id,
    hints: authored.hints.slice(0, 3).map((text, hintIndex) => ({
      hint_level: (hintIndex + 1) as 1 | 2 | 3,
      text: text.trim(),
      citations: primaryCitations.map((citation) => ({ ...citation, relation: "derived_from" as const })),
    })),
  }

  return {
    explanation_blocks: explanationBlocks,
    worked_examples: workedExamples,
    misconceptions,
    micro_check,
    hint_ladder,
    summary,
    coverage_block_ids: coverageBlockIds,
  }
}

/** 为 segment 的每个 target 生成 Section Plan（复用 feasibility 的证据能力判断）。 */
export function buildConceptSectionPlansForSegment(
  request: ConceptTutorRequest,
): ConceptSectionPlan[] {
  const factsByKey = new Map<string, CapabilityFactLike>()
  for (const item of request.evidence_pack.results) {
    for (const fact of item.facts) {
      factsByKey.set(`${item.source_id}:${fact.fact_id}`, fact)
    }
  }
  return request.generation_spec.targets.map((target) => {
    const factRefs = target.required_fact_ids.map((factId) => ({ source_id: target.source_id, fact_id: factId }))
    const facts = factRefs.flatMap((ref) => {
      const fact = factsByKey.get(`${ref.source_id}:${ref.fact_id}`)
      return fact ? [fact] : []
    })
    const support = assessObjectiveSupport({
      objective_id: target.objective_id,
      observable_behavior: target.observable_behavior,
      fact_refs: factRefs,
      facts,
    })
    const selected = selectEvidenceBundle({
      behavior: target.observable_behavior,
      facts,
      max_facts: 4,
    }).fact_ids
    // 应用型单选不仅要有“怎么做”的规则，还要有能排除干扰项的边界/对比事实。
    // 否则作者容易写出合理但无法由局部引用唯一判定的选项。
    const discriminatingFact = facts.find((fact) => {
      const capabilities = fact.capabilities?.length
        ? fact.capabilities
        : inferFactCapabilities(fact.content)
      return capabilities.includes("boundary") || capabilities.includes("contrast")
    })
    const discriminatingFactId = discriminatingFact?.fact_id ?? discriminatingFact?.factId
    const microCheckFactIds = [...new Set([
      ...selected,
      ...(discriminatingFactId ? [discriminatingFactId] : []),
      ...target.required_fact_ids,
    ])]
    const targetFactSet = new Set(target.required_fact_ids)
    const evidenceItem = request.evidence_pack.results.find((entry) =>
      entry.source_id === target.source_id)
    const executableExample = evidenceItem?.examples?.find((example) =>
      isSubstantivePythonExample(example.code)
      && example.fact_refs.length > 0
      && example.fact_refs.every((ref) =>
        ref.source_id === target.source_id && targetFactSet.has(ref.fact_id)))
    const codeSupportFactIds = executableExample?.fact_refs.map((ref) => ref.fact_id)
      ?? executableExampleFactIds(facts)
    const pedagogy = request.generation_spec.learner_adaptation.pedagogy_contract
    const prerequisiteFactIds = request.evidence_pack.results
      .filter((entry) => request.generation_spec.path_node.prerequisite_source_ids.includes(entry.source_id))
      .flatMap((entry) => entry.facts.map((fact) => `${entry.source_id}:${fact.fact_id}`))
    const misconceptionFactIds = (evidenceItem?.misconceptions ?? [])
      .flatMap((entry) => entry.factRefs)
      .filter((ref) => ref.sourceId === target.source_id && targetFactSet.has(ref.factId))
      .map((ref) => ref.factId)
    const procedureFactIds = facts.flatMap((fact) => {
      const capabilities = fact.capabilities?.length
        ? fact.capabilities
        : inferFactCapabilities(fact.content)
      const factId = fact.fact_id ?? fact.factId
      return factId && (capabilities.includes("procedure") || capabilities.includes("state_transition"))
        ? [factId]
        : []
    })
    const hasBoundarySupport = facts.some((fact) => {
      const capabilities = fact.capabilities?.length
        ? fact.capabilities
        : inferFactCapabilities(fact.content)
      return capabilities.includes("boundary") || capabilities.includes("contrast")
    })
    const teachingUnit = pedagogy
      ? buildTeachingUnitContract({
          objective_id: target.objective_id,
          pedagogy,
          evidence: {
            fact_ids: [...target.required_fact_ids],
            prerequisite_fact_ids: prerequisiteFactIds,
            example_fact_ids: codeSupportFactIds,
            misconception_fact_ids: misconceptionFactIds,
            procedure_fact_ids: procedureFactIds,
            supports_executable_code: codeSupportFactIds.length > 0,
          },
        })
      : undefined
    const plan = buildConceptSectionPlan({
      objective_id: target.objective_id,
      observable_behavior: target.observable_behavior,
      fact_ids: target.required_fact_ids,
      support,
      learner_level: request.generation_spec.learner_adaptation.level,
      micro_check_fact_ids: microCheckFactIds,
      executable_example_fact_ids: codeSupportFactIds,
      ...(pedagogy ? { pedagogy_contract: pedagogy } : {}),
      ...(teachingUnit ? { teaching_unit_contract: teachingUnit } : {}),
      has_boundary_support: hasBoundarySupport,
    })
    if (teachingUnit) {
      const issues = validateTeachingUnitPlan(teachingUnit, {
        section_kinds: plan.slots.map((entry) => entry.kind),
        worked_example_count: plan.slots.filter((entry) =>
          entry.kind === "guided_example" || entry.kind === "procedure_steps").length,
        has_micro_check: true,
        hint_levels: pedagogy?.practice.hint_levels ?? 3,
        independent_practice_planned: true,
        transfer_assessment_planned: true,
      })
      if (issues.length > 0) throw new Error(`TEACHING_UNIT_PLAN_INVALID:${issues.join(";")}`)
    }
    return plan
  })
}

/** segment 级 V2 物化器：合并多个 objective 的 V2 分段结果成公开 ConceptLessonPayload。 */
export function materializeConceptSegmentV2(
  request: ConceptTutorRequest,
  payload: ConceptSegmentAuthorPayloadV2,
  plans: ConceptSectionPlan[],
): import("../contracts/artifacts").ConceptLessonPayload {
  const facts = new Map(request.evidence_pack.results.flatMap((entry) =>
    entry.facts.map((fact) => [`${fact.source_id}:${fact.fact_id}`, fact.content] as const)))

  const explanationBlocks: import("../contracts/artifacts").ConceptLessonPayload["explanation_blocks"] = []
  const workedExamples: import("../contracts/artifacts").ConceptLessonPayload["worked_examples"] = []
  const misconceptions: import("../contracts/artifacts").ConceptLessonPayload["misconceptions"] = []
  const microChecks: import("../contracts/artifacts").ConceptLessonPayload["micro_checks"] = []
  const hintLadders: import("../contracts/artifacts").ConceptLessonPayload["hint_ladders"] = []
  const summary: import("../contracts/artifacts").ConceptLessonPayload["summary"] = []
  const objectiveCoverage: import("../contracts/artifacts").ConceptLessonPayload["objective_coverage"] = []

  request.generation_spec.targets.forEach((target, index) => {
    const authored = payload.objectives.find((entry) => entry.objective_id === target.objective_id)
    if (!authored) throw new Error(`CONCEPT_V2_OBJECTIVE_MISSING:${target.objective_id}`)
    const plan = plans.find((entry) => entry.objective_id === target.objective_id)
    if (!plan) throw new Error(`CONCEPT_V2_PLAN_MISSING:${target.objective_id}`)
    const citations = target.required_fact_ids.map((factId) => ({
      source_id: target.source_id,
      fact_id: factId,
      relation: "supports" as const,
    }))
    const sourceTitle = request.evidence_pack.results.find((entry) =>
      entry.source_id === target.source_id)?.title?.trim()
    explanationBlocks.push({
      block_id: stableId("CONCEPT-OBJECTIVE-HEADING", {
        spec_id: request.generation_spec.spec_id,
        objective_id: target.objective_id,
      }),
      block_type: "heading",
      level: 2,
      text: sourceTitle
        ? `${sourceTitle}（${target.objective_id}）`
        : target.objective_id,
    })
    const result = materializeConceptSegmentAuthorPayloadV2({
      objective_id: target.objective_id,
      plan,
      authored,
      spec_id: request.generation_spec.spec_id,
      source_id: target.source_id,
      citations,
      factTextByFactId: facts,
    })
    explanationBlocks.push(...result.explanation_blocks)
    workedExamples.push(...result.worked_examples)
    misconceptions.push(...result.misconceptions)
    microChecks.push(result.micro_check)
    hintLadders.push(result.hint_ladder)
    summary.push(...result.summary)
    objectiveCoverage.push({
      objective_id: target.objective_id,
      block_ids: result.coverage_block_ids,
    })
  })

  return {
    title: payload.title.trim(),
    objective_ids: request.generation_spec.targets.map((target) => target.objective_id),
    prerequisite_bridge: [],
    explanation_blocks: explanationBlocks,
    worked_examples: workedExamples,
    misconceptions,
    micro_checks: microChecks,
    hint_ladders: hintLadders,
    summary,
    objective_coverage: objectiveCoverage,
    used_evidence: [],
  }
}
