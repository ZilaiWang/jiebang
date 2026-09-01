import type { PracticalGuideContractRef, PracticalGuidePublicPayload } from "../planning/practical-guide-plan"
import { validateAssessmentTaxonomyPlan, type AssessmentTaxonomyInputItem, type AssessmentTaxonomyPlan } from "../planning/assessment-taxonomy"

export interface SectionSixValidationIssue { code: string; path: string; message: string }

// Code-completion guides legitimately refer to a visible TODO marker. Treat
// only standalone placeholders (or genuinely generic filler wording) as
// unfinished content; matching the token anywhere rejected valid actions such
// as “把 TODO 替换为循环语句”.
const PLACEHOLDER_ONLY = /^(?:待补充|待完善|稍后填写|占位(?:内容)?|TODO|TBD|示例内容|某知识点|x{2,})[。.!！]?$/iu
const GENERIC_FILLER = /(?:请自行补充|根据实际情况(?:处理)?即可|视情况而定|按需处理即可)/iu
const INTERNAL_GUIDE_TOKEN = /(?:\bstarter_code\b|\bexpected_behavior\b|\bpublic_test(?:_ids?)?\b|\bTODO(?:_[A-Z0-9]+)*\b)/giu
const GUIDE_ASSIGNMENT_IDENTIFIER = /\b([A-Za-z_][A-Za-z0-9_]*)\b\s*(?:=|等号右边|赋值行|的值)/gu
const GUIDE_ASSERTION_CUE = /(?:例如|比如|认为|声称|误以为)[：:]?\s*([^。！？；\n）)]{4,160})/gu
const GUIDE_ABSOLUTE_SCOPE = /(?:仅仅|只能|仅能|仅限|唯一|完全|一律|必然|绝不|从不|总是|只用于|仅用于|只会|仅会)/gu
const CONTRACT_REFS = new Set<PracticalGuideContractRef>([
  "execution.entry_point", "execution.input_contract", "execution.output_contract",
  "execution.allowed_imports", "public_tests",
])

export function validatePracticalGuideForRelease(guide: PracticalGuidePublicPayload): SectionSixValidationIssue[] {
  const issues: SectionSixValidationIssue[] = []
  text(guide.practice_goal, "$.practice_goal", issues)
  text(guide.deliverable, "$.deliverable", issues)
  if (!Number.isInteger(guide.estimated_minutes) || guide.estimated_minutes < 10) add(issues, "invalid_estimated_minutes", "$.estimated_minutes", "预计时长必须是至少 10 分钟的整数")
  if (guide.readiness_checks.length === 0) add(issues, "missing_readiness", "$.readiness_checks", "必须包含就绪检查")
  if (guide.steps.length < 3) add(issues, "insufficient_steps", "$.steps", "至少包含三个可执行步骤")
  guide.readiness_checks.forEach((entry, index) => {
    const path = `$.readiness_checks[${index}]`
    text(entry.title, `${path}.title`, issues); text(entry.check, `${path}.check`, issues); text(entry.ready_when, `${path}.ready_when`, issues)
    binding(entry, path, issues)
  })
  guide.steps.forEach((entry, index) => {
    const path = `$.steps[${index}]`
    if (entry.sequence !== index + 1) add(issues, "invalid_step_sequence", `${path}.sequence`, "步骤编号必须连续")
    text(entry.title, `${path}.title`, issues); text(entry.action, `${path}.action`, issues); text(entry.input, `${path}.input`, issues)
    text(entry.expected_result, `${path}.expected_result`, issues); text(entry.verification, `${path}.verification`, issues)
    binding(entry, path, issues)
  })
  if (guide.acceptance_criteria.length === 0) add(issues, "missing_acceptance_criteria", "$.acceptance_criteria", "必须包含公开测试验收标准")
  const tests = new Set<string>()
  guide.acceptance_criteria.forEach((entry, index) => {
    const path = `$.acceptance_criteria[${index}]`
    text(entry.description, `${path}.description`, issues); text(entry.expected_behavior, `${path}.expected_behavior`, issues)
    if (tests.has(entry.public_test_id)) add(issues, "duplicate_acceptance_test", `${path}.public_test_id`, "公开测试不得重复绑定")
    tests.add(entry.public_test_id)
  })
  if (guide.troubleshooting.length === 0) add(issues, "missing_troubleshooting", "$.troubleshooting", "必须包含排错条目")
  guide.troubleshooting.forEach((entry, index) => {
    const path = `$.troubleshooting[${index}]`
    text(entry.symptom, `${path}.symptom`, issues); text(entry.likely_cause, `${path}.likely_cause`, issues); text(entry.verification, `${path}.verification`, issues)
    if (!entry.recovery_steps.length) add(issues, "missing_recovery_steps", `${path}.recovery_steps`, "排错必须包含恢复步骤")
    entry.recovery_steps.forEach((step, stepIndex) => text(step, `${path}.recovery_steps[${stepIndex}]`, issues))
    binding(entry, path, issues)
  })
  text(guide.extension_task.task, "$.extension_task.task", issues)
  text(guide.extension_task.changed_dimension, "$.extension_task.changed_dimension", issues)
  text(guide.extension_task.verification, "$.extension_task.verification", issues)
  binding(guide.extension_task, "$.extension_task", issues)
  const used = new Set(guide.used_evidence.map((entry) => `${entry.source_id}:${entry.fact_id}`))
  for (const citation of [...guide.readiness_checks, ...guide.steps, ...guide.troubleshooting, guide.extension_task].flatMap((entry) => entry.citations)) {
    if (!used.has(`${citation.source_id}:${citation.fact_id}`)) add(issues, "used_evidence_incomplete", "$.used_evidence", `可见引用 ${citation.source_id}/${citation.fact_id} 未登记`)
  }
  return dedupe(issues)
}

/**
 * The guide and the editor are one learner-facing contract.  The model may
 * describe the task in prose, but it must not expose internal JSON field names
 * or refer to a variable/placeholder that is absent from the actual starter.
 */
export function validatePracticalGuideAgainstLearnerSurface(input: {
  guide: PracticalGuidePublicPayload
  starter_code: string
  gap_template_code?: string | null
  evidence_facts?: string[]
}): SectionSixValidationIssue[] {
  const issues: SectionSixValidationIssue[] = []
  const textEntries = practicalGuideTextEntries(input.guide)
  const knownIdentifiers = new Set(
    `${input.starter_code}\n${input.gap_template_code ?? ""}`
      .match(/\b[A-Za-z_][A-Za-z0-9_]*\b/gu) ?? [],
  )
  for (const [path, value] of textEntries) {
    const internal = [...value.matchAll(INTERNAL_GUIDE_TOKEN)].map((match) => match[0]!)
    if (internal.length > 0) add(
      issues,
      "internal_guide_vocabulary",
      path,
      `实操指南应使用“完整代码预览、待填写位置、公开样例”等学习者用语，不得暴露内部字段或占位标记：${[...new Set(internal)].join("、")}`,
    )
    for (const match of value.matchAll(GUIDE_ASSIGNMENT_IDENTIFIER)) {
      const identifier = match[1]!
      const explicitlyIntroducesExtensionVariable = path === "$.extension_task.task"
        && /(?:新增|增加|添加|定义|创建|再设置|尝试设置)/u.test(value)
      if (!knownIdentifiers.has(identifier) && !explicitlyIntroducesExtensionVariable) add(
        issues,
        "guide_identifier_mismatch",
        path,
        `实操指南引用了代码中不存在的变量 ${identifier}`,
      )
    }
    for (const assertion of guideExampleAssertions(value)) {
      const unauthorizedScopes = [...assertion.matchAll(GUIDE_ABSOLUTE_SCOPE)]
        .map((match) => match[0]!)
        .filter((token) => !(input.evidence_facts ?? []).some((fact) => fact.includes(token)))
      if (unauthorizedScopes.length > 0 && guideSharesFactSubject(assertion, input.evidence_facts ?? [])) add(
        issues,
        "unsupported_guide_example",
        path,
        `实操指南的事实反例只能直接否定已引用事实，不得用未授权绝对限定另造具体用途或机制：${[...new Set(unauthorizedScopes)].join("、")}`,
      )
    }
  }
  return dedupe(issues)
}

function guideExampleAssertions(value: string): string[] {
  return [...value.matchAll(GUIDE_ASSERTION_CUE)]
    .map((match) => match[1]?.trim() ?? "")
    .filter(Boolean)
}

function guideSharesFactSubject(value: string, facts: string[]): boolean {
  const normalizedValue = value.normalize("NFKC").replace(/\s+/gu, "").toLocaleLowerCase()
  return facts.some((fact) => {
    const subject = fact.split(/(?:是|属于|通常|常用于|适合|可以|表示|用|负责)/u, 1)[0]?.trim() ?? ""
    const normalizedSubject = subject.normalize("NFKC").replace(/\s+/gu, "").toLocaleLowerCase()
    return normalizedSubject.length >= 2 && normalizedValue.includes(normalizedSubject)
  })
}

export function validateSectionSixAssessmentForRelease(input: {
  items: AssessmentTaxonomyInputItem[]
  taxonomy: AssessmentTaxonomyPlan
}): SectionSixValidationIssue[] {
  return validateAssessmentTaxonomyPlan(input.items, input.taxonomy).map((message, index) => ({ code: "invalid_assessment_taxonomy", path: `$.taxonomy[${index}]`, message }))
}

function binding(entry: { citations: unknown[]; contract_refs: PracticalGuideContractRef[]; public_test_ids: string[] }, path: string, issues: SectionSixValidationIssue[]): void {
  if (!entry.citations.length && !entry.contract_refs.length && !entry.public_test_ids.length) add(issues, "unbound_guide_content", path, "每段内容必须绑定事实、执行合同或公开测试")
  entry.contract_refs.forEach((ref) => { if (!CONTRACT_REFS.has(ref)) add(issues, "unknown_contract_ref", `${path}.contract_refs`, `未知合同引用 ${ref}`) })
  if (entry.contract_refs.includes("public_tests") && !entry.public_test_ids.length) add(issues, "public_test_ref_empty", `${path}.public_test_ids`, "引用 public_tests 时必须给出测试 ID")
}
function practicalGuideTextEntries(guide: PracticalGuidePublicPayload): Array<[string, string]> {
  return [
    ["$.practice_goal", guide.practice_goal],
    ["$.deliverable", guide.deliverable],
    ...guide.readiness_checks.flatMap((entry, index): Array<[string, string]> => [
      [`$.readiness_checks[${index}].title`, entry.title],
      [`$.readiness_checks[${index}].check`, entry.check],
      [`$.readiness_checks[${index}].ready_when`, entry.ready_when],
    ]),
    ...guide.steps.flatMap((entry, index): Array<[string, string]> => [
      [`$.steps[${index}].title`, entry.title],
      [`$.steps[${index}].action`, entry.action],
      [`$.steps[${index}].input`, entry.input],
      [`$.steps[${index}].expected_result`, entry.expected_result],
      [`$.steps[${index}].verification`, entry.verification],
    ]),
    ...guide.troubleshooting.flatMap((entry, index): Array<[string, string]> => [
      [`$.troubleshooting[${index}].symptom`, entry.symptom],
      [`$.troubleshooting[${index}].likely_cause`, entry.likely_cause],
      ...entry.recovery_steps.map((step, stepIndex): [string, string] => [`$.troubleshooting[${index}].recovery_steps[${stepIndex}]`, step]),
      [`$.troubleshooting[${index}].verification`, entry.verification],
    ]),
    ["$.extension_task.task", guide.extension_task.task],
    ["$.extension_task.changed_dimension", guide.extension_task.changed_dimension],
    ["$.extension_task.verification", guide.extension_task.verification],
  ]
}
function text(value: string, path: string, issues: SectionSixValidationIssue[]): void { const normalized = value?.trim() ?? ""; if (!normalized) add(issues, "empty_visible_text", path, "学习者可见文本不能为空"); else if (PLACEHOLDER_ONLY.test(normalized) || GENERIC_FILLER.test(normalized)) add(issues, "placeholder_visible_text", path, `禁止占位或泛化文本：${normalized}`) }
function add(issues: SectionSixValidationIssue[], code: string, path: string, message: string): void { issues.push({ code, path, message }) }
function dedupe(issues: SectionSixValidationIssue[]): SectionSixValidationIssue[] { return [...new Map(issues.map((entry) => [`${entry.code}:${entry.path}:${entry.message}`, entry])).values()] }
