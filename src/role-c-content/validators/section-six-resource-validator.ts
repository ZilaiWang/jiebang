import type { PracticalGuideContractRef, PracticalGuidePublicPayload } from "../planning/practical-guide-plan"
import { validateAssessmentTaxonomyPlan, type AssessmentTaxonomyInputItem, type AssessmentTaxonomyPlan } from "../planning/assessment-taxonomy"

export interface SectionSixValidationIssue { code: string; path: string; message: string }

const PLACEHOLDER = /(?:待补充|待完善|稍后填写|占位|TODO|TBD|示例内容|某知识点|xxx|请自行补充|根据实际情况(?:处理)?即可|视情况而定|按需处理即可)/iu
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
function text(value: string, path: string, issues: SectionSixValidationIssue[]): void { const normalized = value?.trim() ?? ""; if (!normalized) add(issues, "empty_visible_text", path, "学习者可见文本不能为空"); else if (PLACEHOLDER.test(normalized)) add(issues, "placeholder_visible_text", path, `禁止占位或泛化文本：${normalized}`) }
function add(issues: SectionSixValidationIssue[], code: string, path: string, message: string): void { issues.push({ code, path, message }) }
function dedupe(issues: SectionSixValidationIssue[]): SectionSixValidationIssue[] { return [...new Map(issues.map((entry) => [`${entry.code}:${entry.path}:${entry.message}`, entry])).values()] }
