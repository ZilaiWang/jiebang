import type { AssessmentPublicPayload, AssessmentSecurePayload } from "../contracts/artifacts"
import type {
  AssessmentItemPlan,
  AssessmentPublicAuthorPayload,
} from "../providers/staged-generation"

const INTERNAL_META = /(?:source[_ ]?id|fact[_ ]?id|\bRAG\b|evidence(?:_pack)?|知识库编号|隐藏测试|正确答案)/iu
const GENERIC_MISCONCEPTION = /^(?:其他错误|理解错误|概念不清|答案错误|未知|none|other|wrong)$/iu
const VACUOUS_OPTION = /(?:不需要任何.{0,8}(?:依据|规则)|随机生成|只适用于界面|与题目无关|以上都[对错])/u
const ABSOLUTE_SCOPE = /(?:仅仅|只能|仅能|唯一|完全|一律|必然|绝不|从不|总是|只用于|仅用于|只会|仅会)/gu

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
    const authorizedScopes = new Set(citedFacts.flatMap(scopeTokens))
    const unauthorizedPromptScopes = scopeTokens(item.prompt)
      .filter((token) => !authorizedScopes.has(token))
    if (unauthorizedPromptScopes.length > 0) issues.push(issue(
      "ASSESSMENT_UNSUPPORTED_ABSOLUTE_PROMPT",
      `$.items[${index}].prompt`,
      `题干引入了当前引用事实未授权的绝对限定：${[...new Set(unauthorizedPromptScopes)].join("、")}；请直接询问事实本身或使用证据已写明的条件`,
    ))
    for (const [optionIndex, option] of (item.options ?? []).entries()) {
      const unauthorized = scopeTokens(option).filter((token) => !authorizedScopes.has(token))
      if (unauthorized.length === 0) continue
      issues.push(issue(
        "ASSESSMENT_UNSUPPORTED_ABSOLUTE_DISTRACTOR",
        `$.items[${index}].options[${optionIndex}]`,
        `选项引入了当前引用事实未授权的绝对限定：${[...new Set(unauthorized)].join("、")}；请改为对引用事实条件、方向或边界的直接反转`,
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
