import type { AssessmentPublicPayload, AssessmentSecurePayload } from "../contracts/artifacts"
import type {
  AssessmentItemPlan,
  AssessmentPublicAuthorPayload,
} from "../providers/staged-generation"
import { normalizeGroundedClaimText } from "../validators/claim-grounding"

const INTERNAL_META = /(?:source[_ ]?id|fact[_ ]?id|\bRAG\b|evidence(?:_pack)?|知识库编号|隐藏测试|正确答案)/iu
const GENERIC_MISCONCEPTION = /^(?:其他错误|理解错误|概念不清|答案错误|未知|none|other|wrong)$/iu
const VACUOUS_OPTION = /(?:不需要任何.{0,8}(?:依据|规则)|随机生成|只适用于界面|与题目无关|以上都[对错])/u
const ABSOLUTE_SCOPE = /(?:仅仅|只能|仅能|仅限|唯一|完全|一律|必然|绝不|从不|总是|只用于|仅用于|只会|仅会)/gu
const NEGATIVE_CHOICE_STEM = /(?:直接否定|错误的是|不正确的是|不符合的是|不属于|以下哪项不是|哪一项不是)/u
const TECHNICAL_MECHANISM_TERMS = [
  "重新赋值", "赋值", "覆盖", "旧绑定", "绑定", "引用", "解释器", "编译器",
  "缩进", "代码块", "参数", "返回值", "遍历", "迭代", "索引", "输入", "输出",
] as const

export interface AssessmentEvidenceFactView {
  source_id: string
  fact_id: string
  content: string
}

export interface AssessmentValidityIssue {
  code: string
  path: string
  message: string
}

export function validateAssessmentPublicValidity(
  payload: AssessmentPublicPayload,
  plan: AssessmentItemPlan[],
): AssessmentValidityIssue[] {
  const issues: AssessmentValidityIssue[] = []
  payload.items.forEach((item, index) => {
    const expected = plan[index]
    if (!expected) return
    const publicText = [item.prompt, ...(item.options?.map((option) => option.text) ?? [])].join("\n")
    if (INTERNAL_META.test(publicText)) issues.push(issue(
      "ASSESSMENT_INTERNAL_META_CLUE",
      `$.items[${index}]`,
      "题面不得出现检索、证据或内部答案元信息",
    ))
    const vacuous = item.options?.filter((option) => VACUOUS_OPTION.test(option.text)) ?? []
    if (vacuous.length > 0) issues.push(issue(
      "ASSESSMENT_VACUOUS_DISTRACTOR",
      `$.items[${index}].options`,
      "错误选项必须来自真实误区，不能使用明显荒谬或工程话术",
    ))
    const forbidden = expected.forbidden_clues ?? []
    const normalized = normalize(publicText)
    const hits = forbidden.filter((clue) => normalized.includes(normalize(clue)))
    if (hits.length > 0) issues.push(issue(
      "ASSESSMENT_FORBIDDEN_CLUE",
      `$.items[${index}]`,
      `题面包含规划层禁止线索：${hits.join("、")}`,
    ))
    if (expected.cognitive_demand === "transfer"
      && expected.presentation_mode !== "scenario_transfer"
      && item.structure_meta?.operation === "recognize") {
      issues.push(issue(
        "ASSESSMENT_FALSE_TRANSFER",
        `$.items[${index}].structure_meta.operation`,
        "迁移题必须改变认知操作或任务结构，不能仍是直接识别",
      ))
    }
  })
  return issues
}

/**
 * Checks the model-authored surface before candidate selection.  A Tier-1
 * choice item is intentionally backed by a very small evidence surface; an
 * choice item cannot manufacture an absolute qualifier in either its stem or
 * options merely to look like a plausible misconception. Such claims are not
 * direct reversals of cited facts and cannot be proven wrong from the item's
 * evidence. This applies to every choice tier: tier changes reasoning demand,
 * not the authority boundary.
 */
export function validateAssessmentAuthorEvidenceDiscipline(
  payload: AssessmentPublicAuthorPayload,
  plan: AssessmentItemPlan[],
  evidence: AssessmentEvidenceFactView[],
): AssessmentValidityIssue[] {
  const issues: AssessmentValidityIssue[] = []
  const factsByKey = new Map(evidence.map((fact) => [
    `${fact.source_id}:${fact.fact_id}`,
    fact.content,
  ]))
  payload.items.forEach((item, index) => {
    const expected = plan[index]
    if (!expected
      || (expected.modality !== "mcq" && expected.modality !== "true_false")) return
    const citedFacts = expected.citations.flatMap((citation) => {
      const content = factsByKey.get(`${citation.source_id}:${citation.fact_id}`)
      return content ? [content] : []
    })
    const citedKeys = new Set(expected.citations.map((citation) =>
      `${citation.source_id}:${citation.fact_id}`))
    const citedSourceIds = new Set(expected.citations.map((citation) => citation.source_id))
    const citedSurface = normalize(citedFacts.join(" "))
    const uncitedTerms = [...new Set(evidence
      .filter((fact) => citedSourceIds.has(fact.source_id)
        && !citedKeys.has(`${fact.source_id}:${fact.fact_id}`))
      .flatMap((fact) => TECHNICAL_MECHANISM_TERMS.filter((term) =>
        normalize(fact.content).includes(normalize(term))
        && !citedSurface.includes(normalize(term)))))]
    const authoredSurface = normalize([item.prompt, ...(item.options ?? [])].join(" "))
    const leakedTerms = uncitedTerms.filter((term) => authoredSurface.includes(normalize(term)))
    if (leakedTerms.length > 0) issues.push(issue(
      "ASSESSMENT_UNCITED_MECHANISM",
      `$.items[${index}]`,
      `题面或选项使用了同一知识点中未被本题引用的机制：${leakedTerms.join("、")}；请只围绕本题 citations 中的事实命题`,
    ))
    const citedMechanisms = new Set(TECHNICAL_MECHANISM_TERMS.filter((term) =>
      citedSurface.includes(normalize(term))))
    const outOfEvidenceMechanisms = TECHNICAL_MECHANISM_TERMS.filter((term) =>
      authoredSurface.includes(normalize(term)) && !citedMechanisms.has(term))
    if (outOfEvidenceMechanisms.length > 0) issues.push(issue(
      "ASSESSMENT_OUT_OF_EVIDENCE_MECHANISM",
      `$.items[${index}]`,
      `题干或选项引入了本题引用事实未授权的技术机制：${[...new Set(outOfEvidenceMechanisms)].join("、")}`,
    ))
    const authorizedScopes = new Set(citedFacts.flatMap(scopeTokens))
    if (expected.modality === "mcq" && NEGATIVE_CHOICE_STEM.test(item.prompt)) {
      issues.push(issue(
        "ASSESSMENT_AMBIGUOUS_NEGATIVE_STEM",
        `$.items[${index}].prompt`,
        "选择题题干必须正向询问正确事实；不要让学习者在‘选错误/选否定’与服务端正确答案之间做双重反转",
      ))
    }
    const unauthorizedPromptScopes = scopeTokens(item.prompt)
      .filter((token) => !authorizedScopes.has(token))
    if (unauthorizedPromptScopes.length > 0) issues.push(issue(
      "ASSESSMENT_UNSUPPORTED_ABSOLUTE_PROMPT",
      `$.items[${index}].prompt`,
      `题干引入了当前引用事实未授权的绝对限定：${[...new Set(unauthorizedPromptScopes)].join("、")}；请直接询问事实本身或使用证据已写明的条件`,
    ))
    for (const [optionIndex, option] of (item.options ?? []).entries()) {
      const unauthorized = scopeTokens(option).filter((token) => !authorizedScopes.has(token))
      if (unauthorized.length > 0) {
        issues.push(issue(
          "ASSESSMENT_UNSUPPORTED_ABSOLUTE_DISTRACTOR",
          `$.items[${index}].options[${optionIndex}]`,
          `选项引入了当前引用事实未授权的绝对限定：${[...new Set(unauthorized)].join("、")}；请改为对引用事实条件、方向或边界的直接反转`,
        ))
      }
    }
    if (expected.modality === "mcq"
      && isVerbatimFactAndTrivialNegationPair(item.options ?? [], citedFacts)) {
      issues.push(issue(
        "ASSESSMENT_DEGENERATE_FACT_NEGATION_PAIR",
        `$.items[${index}].options`,
        "选择题不得用‘逐字复制事实 / 只加否定词’充当整组选项；请基于本题引用的关系设计简短、有区分度的匹配或追踪选项",
      ))
    }
  })
  return issues
}

export function validateAssessmentPairValidity(
  publicPayload: AssessmentPublicPayload,
  securePayload: AssessmentSecurePayload,
  plan: AssessmentItemPlan[],
): AssessmentValidityIssue[] {
  const issues: AssessmentValidityIssue[] = []
  securePayload.items.forEach((secureItem, index) => {
    const publicItem = publicPayload.items[index]
    const expected = plan[index]
    if (!publicItem || !expected) return
    if (publicItem.modality !== "mcq" && publicItem.modality !== "true_false") return
    const wrongOptions = (publicItem.options ?? []).filter((option) =>
      option.option_id !== secureItem.correct_option_id)
    for (const option of wrongOptions) {
      const misconception = secureItem.misconception_by_option[option.option_id]?.trim() ?? ""
      if (!misconception || GENERIC_MISCONCEPTION.test(misconception)) {
        issues.push(issue(
          "ASSESSMENT_DISTRACTOR_WITHOUT_MISCONCEPTION",
          `$.items[${index}].misconception_by_option.${option.option_id}`,
          "每个错误选项必须绑定具体误区或错误机制",
        ))
      }
    }
    if (expected.target_misconception_id
      && !Object.values(secureItem.misconception_by_option).includes(expected.target_misconception_id)) {
      issues.push(issue(
        "ASSESSMENT_TARGET_MISCONCEPTION_MISSING",
        `$.items[${index}].misconception_by_option`,
        `至少一个错误选项必须绑定规划指定误区 ${expected.target_misconception_id}`,
      ))
    }
  })
  return issues
}

function issue(code: string, path: string, message: string): AssessmentValidityIssue {
  return { code, path, message }
}

function normalize(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase()
}

function scopeTokens(value: string): string[] {
  return normalize(value).match(ABSOLUTE_SCOPE) ?? []
}

function isVerbatimFactAndTrivialNegationPair(options: string[], facts: string[]): boolean {
  if (options.length !== 2) return false
  const factSurfaces = facts.map(normalizeGroundedClaimText)
  const optionSurfaces = options.map(normalizeGroundedClaimText)
  const verbatimIndex = optionSurfaces.findIndex((surface) => factSurfaces.includes(surface))
  if (verbatimIndex < 0) return false
  const other = optionSurfaces[1 - verbatimIndex] ?? ""
  const affirmativeCandidates = [
    other.replace(/^(?:以下说法不成立|该说法不成立)[：:]?/u, ""),
    other.replace(/并非/gu, ""),
    other.replace(/不是/gu, "是"),
    other.replace(/不会/gu, "会"),
    other.replace(/不能/gu, "能"),
    other.replace(/不可以/gu, "可以"),
    other.replace(/不使用/gu, "使用"),
    other.replace(/不表示/gu, "表示"),
    other.replace(/不属于/gu, "属于"),
    other.replace(/不用于/gu, "用于"),
    other.replace(/未/gu, ""),
  ].map(normalizeGroundedClaimText)
  return affirmativeCandidates.some((surface) => factSurfaces.includes(surface))
}
