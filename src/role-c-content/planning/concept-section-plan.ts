import { stableId } from "../contracts/common"
import type { CitationRef } from "../contracts/common"
import type { ConceptLessonPayload, QuizBlock, RenderBlock, Claim } from "../contracts/artifacts"
import type { ConceptTutorRequest } from "../agents/types"
import type { ObjectiveSupportPlan } from "./artifact-feasibility"
import { assessObjectiveSupport } from "./artifact-feasibility"
import type { ObservableBehavior } from "../contracts/profile-adapter"

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
}

export interface ConceptSectionPlan {
  objective_id: string
  mode: ConceptAuthoringMode
  slots: ConceptSectionSlot[]
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
}): ConceptSectionPlan {
  const { fact_ids } = input
  const mode = conceptModeForSupport(input.support, fact_ids.length)

  const commonSlots: ConceptSectionSlot[] = [
    slot("overview", {
      fact_ids,
      allowed_moves: ["direct_paraphrase", "plain_language_explanation"],
      min_sentences: 1,
      max_sentences: 2,
      allowed_block_types: ["paragraph"],
    }),
    slot("fact_explanation", {
      fact_ids,
      allowed_moves: ["direct_paraphrase", "plain_language_explanation", "direct_instance"],
      min_sentences: 2,
      max_sentences: 5,
      allowed_block_types: ["paragraph", "callout"],
    }),
  ]

  const modeSlots: ConceptSectionSlot[] = mode === "procedural"
    ? [slot("procedure_steps", {
        fact_ids,
        allowed_moves: ["procedure_trace", "direct_instance"],
        min_sentences: 1,
        max_sentences: 6,
        allowed_block_types: ["paragraph", "code"],
      })]
    : mode === "comparative"
      ? [slot("comparison", {
          fact_ids,
          allowed_moves: ["explicit_comparison", "direct_instance"],
          min_sentences: 2,
          max_sentences: 6,
          allowed_block_types: ["comparison", "paragraph"],
        })]
      : [slot("guided_example", {
          fact_ids,
          allowed_moves: ["direct_instance", "recognition_check"],
          min_sentences: 1,
          max_sentences: 4,
          allowed_block_types: ["paragraph", "code"],
        })]

  const misconceptionSlot = slot("misconception", {
    fact_ids,
    allowed_moves: ["fact_negation"],
    min_sentences: 2,
    max_sentences: 4,
    allowed_block_types: ["callout"],
  })
  const recapSlot = slot("recap", {
    fact_ids,
    allowed_moves: ["direct_paraphrase"],
    min_sentences: 1,
    max_sentences: 3,
    allowed_block_types: ["paragraph"],
  })

  return {
    objective_id: input.objective_id,
    mode,
    slots: [...commonSlots, ...modeSlots, misconceptionSlot, recapSlot],
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
  plan: ConceptSectionPlan
  authored: { sections: AuthoredSection[] }
  citations: CitationRef[]
  factTextByFactId: Map<string, string>
}): RenderBlock[] {
  const { objective_id, plan, authored, citations, factTextByFactId } = input
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
    const claims: Claim[] = slot.fact_ids.map((factId, index) => ({
      claim_id: stableId("CONCEPT-CLAIM", { objective_id, slot_id: slot.slot_id, fact_id: factId, index }),
      text: factTextByFactId.get(factId) ?? "",
      citations: structuredClone(citations),
    }))
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
    if (section.steps.length > 0 && planned.kind !== "procedure_steps") {
      issues.push(`section ${section.slot_id} 仅 procedure_steps 可返回 steps`)
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

  const claimsFor = (slot: ConceptSectionSlot) => slot.fact_ids.map((factId, index) => ({
    claim_id: stableId("CONCEPT-CLAIM", { ...identity, slot_id: slot.slot_id, fact_id: factId, index }),
    text: factTextByFactId.get(factId) ?? "",
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
      misconceptions.push({
        misconception_tag: stableId("CONCEPT-MISCONCEPTION", { ...identity, slot_id: slot.slot_id }),
        explanation: section.body.trim() || "常见误解：请结合上文事实自查。",
        objective_id,
        citations: structuredClone(citations),
      })
      continue
    }
    if (slot.kind === "recap") {
      summary.push({
        block_id: stableId("CONCEPT-SUMMARY", { ...identity, slot_id: slot.slot_id }),
        block_type: "paragraph",
        text: section.body.trim(),
        claims: claimsFor(slot),
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
      claims: claimsFor(slot),
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
    citations: citations.map((citation) => ({ ...citation, relation: "derived_from" as const })),
  }
  coverageBlockIds.push(micro_check.block_id)

  const hint_ladder: ConceptLessonPayload["hint_ladders"][number] = {
    objective_id,
    hints: authored.hints.slice(0, 3).map((text, hintIndex) => ({
      hint_level: (hintIndex + 1) as 1 | 2 | 3,
      text: text.trim(),
      citations: citations.map((citation) => ({ ...citation, relation: "derived_from" as const })),
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
  const factsByKey = new Map<string, { content: string }>()
  for (const item of request.evidence_pack.results) {
    for (const fact of item.facts) {
      factsByKey.set(`${item.source_id}:${fact.fact_id}`, { content: fact.content })
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
    return buildConceptSectionPlan({
      objective_id: target.objective_id,
      observable_behavior: target.observable_behavior,
      fact_ids: target.required_fact_ids,
      support,
    })
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
