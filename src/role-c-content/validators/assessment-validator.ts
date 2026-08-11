import type {
  AssessmentDraft,
  AssessmentDraftVerifier,
  TieredEvaluatorRequest,
} from "../agents/types"
import type {
  AssessmentItemPublic,
  AssessmentItemSecure,
  AssessmentPublicPayload,
} from "../contracts/artifacts"
import type { CitationRef } from "../contracts/common"
import {
  executeTrustedReferenceWithRetry,
  type CodeRunner,
  type RunnerTestSuite,
} from "../security/code-runner"
import { analyzePythonSource } from "../security/python-static-analyzer"
import { validateCitations, type ValidationIssue } from "./citation-validator"
import { validateAssessmentPublicSecureSeparation, validatePublicArtifactNoSecrets } from "./public-secure-leak-validator"
import { validateRoleCSchema, validateRoleCSchemaFragment } from "./runtime-schema-validator"

export interface AssessmentDraftValidationReport {
  ok: boolean
  issues: ValidationIssue[]
  citations: CitationRef[]
  objective_coverage: number
}

export function validateAssessmentPublicSecureCodeContract(
  publicItem: Pick<AssessmentItemPublic, "objective_id" | "modality" | "prompt" | "starter_code">,
  suite: { execution_contract: { execution_mode: string }; reference_solution: string; hidden_tests: unknown[] },
): ValidationIssue[] {
  if (publicItem.modality !== "code" || suite.execution_contract.execution_mode !== "stdin_stdout") return []
  const publicText = `${publicItem.prompt}\n${publicItem.starter_code ?? ""}`.normalize("NFKC").toLocaleLowerCase()
  const publicOwnsInput = /input\s*\(/u.test(publicItem.starter_code ?? "")
    || /(?:读取|获取|输入).{0,16}(?:用户|标准输入|stdin|数值|温度|分数)/u.test(publicText)
  const secureRequiresInput = /input\s*\(|sys\.stdin/u.test(suite.reference_solution)
    || suite.hidden_tests.length > 0
  return secureRequiresInput && !publicOwnsInput
    ? [issue("public_secure_code_contract_mismatch", "$.secure.code_test_suite", "私有评分合同引入了公开题目未声明或未提供的 stdin/input 必做能力")]
    : []
}

export function validateAssessmentObjectiveScope(
  request: Pick<TieredEvaluatorRequest, "generation_spec" | "evidence_pack">,
  item: Pick<AssessmentItemPublic, "objective_id" | "modality" | "prompt" | "starter_code">,
): ValidationIssue[] {
  const target = request.generation_spec.targets.find((entry) => entry.objective_id === item.objective_id)
  if (!target || item.modality !== "code") return []
  const facts = request.evidence_pack.results
    .filter((entry) => entry.source_id === target.source_id)
    .flatMap((entry) => entry.facts)
    .filter((fact) => target.required_fact_ids.includes(fact.fact_id))
    .map((fact) => fact.content)
    .join(" ")
    .normalize("NFKC")
    .toLocaleLowerCase()
  const visible = `${item.prompt}\n${item.starter_code ?? ""}`.normalize("NFKC").toLocaleLowerCase()
  const inputIsTarget = /(?:input|输入|读取)/u.test(facts)
  const requiresInput = /(?:读取|获取|输入).{0,12}(?:input|用户|数值|温度)|input\s*\(/u.test(item.prompt.normalize("NFKC").toLocaleLowerCase())
  const inputProvided = /input\s*\(/u.test(item.starter_code ?? "")
  return !inputIsTarget && requiresInput && !inputProvided
    ? [issue("off_objective_required_skill", "$.item.prompt", "代码题把当前目标外的输入解析设为必做步骤；应在 starter 中提供旁支输入，仅评分当前目标行为")]
    : []
}

/** Public-stage gate so question/citation defects are repaired before answers are authored. */
export function validateAssessmentPublicStage(
  request: TieredEvaluatorRequest,
  publicPayload: AssessmentPublicPayload,
): AssessmentDraftValidationReport {
  const schema = validateRoleCSchemaFragment(
    "assessment_draft.schema.json",
    "/$defs/public_payload",
    publicPayload,
  )
  if (!schema.ok) return { ok: false, issues: schema.issues, citations: [], objective_coverage: 0 }
  const issues: ValidationIssue[] = [...validatePublicArtifactNoSecrets(publicPayload).issues]
  const targets = new Map(request.generation_spec.targets.map((target) => [target.objective_id, target]))
  const coreTargets = request.generation_spec.targets.filter((target) => target.importance === "core")
  const items = uniqueMap(publicPayload.items, "item_id", "$.items", issues)
  const coverage = uniqueMap(publicPayload.objective_coverage, "objective_id", "$.objective_coverage", issues)
  const familyVariants = new Set<string>()
  publicPayload.items.forEach((item, index) => {
    const familyVariant = `${item.family_id}\u0000${item.variant_id}`
    if (familyVariants.has(familyVariant)) issues.push(issue("duplicate_family_variant", `$.items[${index}]`, "同一 family_id 下的 variant_id 必须唯一"))
    familyVariants.add(familyVariant)
    if (item.display_no !== index + 1) issues.push(issue("invalid_display_no", `$.items[${index}].display_no`, "display_no 必须连续编号"))
    const target = targets.get(item.objective_id)
    if (!target) issues.push(issue("unknown_objective", `$.items[${index}].objective_id`, `未知目标 ${item.objective_id}`))
    else if (!item.citations.some((citation) =>
      citation.source_id === target.source_id && target.required_fact_ids.includes(citation.fact_id),
    )) issues.push(issue("missing_required_fact", `$.items[${index}].citations`, "题目未引用所属目标的必要事实"))
    issues.push(...validateAssessmentObjectiveScope(request, item))
  })
  for (const target of coreTargets) {
    const citedFactIds = new Set(publicPayload.items
      .filter((item) => item.objective_id === target.objective_id)
      .flatMap((item) => item.citations)
      .filter((citation) => citation.source_id === target.source_id)
      .map((citation) => citation.fact_id))
    const missing = target.required_fact_ids.filter((factId) =>
      !citedFactIds.has(factId))
    if (missing.length > 0) {
      issues.push(issue("missing_required_fact", `$.objective.${target.objective_id}`, `核心目标必要事实未被测评完整覆盖：${missing.join("、")}`))
    }
  }
  const expected = request.generation_spec.assessment_blueprint
  for (const tier of [1, 2, 3] as const) {
    const count = publicPayload.items.filter((item) => item.tier === tier).length
    const wanted = tier === 1 ? expected.tier_1_count : tier === 2 ? expected.tier_2_count : expected.tier_3_count
    if (count !== wanted) issues.push(issue("blueprint_tier_count", "$.items", `Tier ${tier} 题量应为 ${wanted}，实际 ${count}`))
  }
  const modalities = new Set(publicPayload.items.map((item) => item.modality))
  for (const modality of expected.required_modalities) {
    if (!modalities.has(modality)) issues.push(issue("missing_required_modality", "$.items", `缺少 blueprint 必需题型 ${modality}`))
  }
  const citations = deduplicate(publicPayload.items.flatMap((item) => item.citations))
  issues.push(...validateCitations(deduplicate([...citations, ...publicPayload.used_evidence]), request.evidence_pack).issues)
  let coveredCore = 0
  for (const target of coreTargets) {
    const entry = coverage.get(target.objective_id)
    const valid = Boolean(entry && entry.item_ids.length > 0
      && entry.item_ids.every((id) => items.get(id)?.objective_id === target.objective_id)
      && sameStringSet(entry.modalities, unique(entry.item_ids.map((id) => items.get(id)!.modality))))
    if (!valid) issues.push(issue("missing_public_objective_coverage", `$.objective.${target.objective_id}`, "核心目标缺少有效公开测评映射"))
    else coveredCore += 1
  }
  validateRouting(publicPayload, items, issues)
  return {
    ok: issues.length === 0,
    issues,
    citations,
    objective_coverage: coreTargets.length === 0 ? 1 : coveredCore / coreTargets.length,
  }
}

export function validateAssessmentDraftStructure(
  request: TieredEvaluatorRequest,
  draft: AssessmentDraft,
): AssessmentDraftValidationReport {
  const schema = validateRoleCSchema("assessment_draft.schema.json", draft)
  if (!schema.ok) return { ok: false, issues: schema.issues, citations: [], objective_coverage: 0 }

  const publicPayload = draft.public_draft.payload
  const securePayload = draft.secure_draft.payload
  const issues: ValidationIssue[] = []
  if (request.concept_artifact.status !== "ready" || !request.concept_artifact.payload) {
    issues.push(issue("concept_not_ready", "$.concept_artifact", "tiered-evaluator 只能消费 ready concept artifact"))
  }
  if (publicPayload.form_id !== securePayload.form_id) {
    issues.push(issue("form_id_mismatch", "$.secure_draft.payload.form_id", "public/secure form_id 不一致"))
  }
  if (securePayload.option_order_seed !== request.generation_spec.policies.seed) {
    issues.push(issue("option_seed_mismatch", "$.secure_draft.payload.option_order_seed", "选项顺序 seed 必须来自 GenerationSpec"))
  }

  const targets = new Map(request.generation_spec.targets.map((target) => [target.objective_id, target]))
  const coreTargets = request.generation_spec.targets.filter((target) => target.importance === "core")
  const publicItems = uniqueMap(publicPayload.items, "item_id", "$.public_draft.payload.items", issues)
  const secureItems = uniqueMap(securePayload.items, "item_id", "$.secure_draft.payload.items", issues)
  const suites = uniqueMap(securePayload.code_test_suites, "test_suite_id", "$.secure_draft.payload.code_test_suites", issues)
  const familyVariants = new Set<string>()
  for (const [index, item] of publicPayload.items.entries()) {
    const key = `${item.family_id}\u0000${item.variant_id}`
    if (familyVariants.has(key)) {
      issues.push(issue("duplicate_family_variant", `$.public_draft.payload.items[${index}]`, "同一 family_id 下的 variant_id 必须唯一"))
    }
    familyVariants.add(key)
  }

  const expectedTierCounts = [
    request.generation_spec.assessment_blueprint.tier_1_count,
    request.generation_spec.assessment_blueprint.tier_2_count,
    request.generation_spec.assessment_blueprint.tier_3_count,
  ]
  expectedTierCounts.forEach((expected, index) => {
    const tier = (index + 1) as 1 | 2 | 3
    const actual = publicPayload.items.filter((item) => item.tier === tier).length
    if (actual !== expected) {
      issues.push(issue("blueprint_tier_count", "$.public_draft.payload.items", `Tier ${tier} 题量应为 ${expected}，实际 ${actual}`))
    }
  })
  const modalities = new Set(publicPayload.items.map((item) => item.modality))
  for (const modality of request.generation_spec.assessment_blueprint.required_modalities) {
    if (!modalities.has(modality)) {
      issues.push(issue("missing_required_modality", "$.public_draft.payload.items", `缺少 blueprint 必需题型 ${modality}`))
    }
  }

  publicPayload.items.forEach((publicItem, index) => {
    if (publicItem.display_no !== index + 1) {
      issues.push(issue("invalid_display_no", `$.public_draft.payload.items[${index}].display_no`, "display_no 必须按最终题序从 1 连续编号"))
    }
    const target = targets.get(publicItem.objective_id)
    if (!target) {
      issues.push(issue("unknown_objective", `$.public_draft.payload.items[${index}].objective_id`, `未知目标 ${publicItem.objective_id}`))
    }
    const privateItem = secureItems.get(publicItem.item_id)
    if (!privateItem) {
      issues.push(issue("missing_secure_item", `$.public_draft.payload.items[${index}]`, `缺少同 ID secure item ${publicItem.item_id}`))
      return
    }
    compareItemContract(publicItem, privateItem, index, issues)
    validateChoiceContract(publicItem, privateItem, index, issues)
    validateAnswerModality(publicItem, privateItem, index, issues)
    if (target && !publicItem.citations.some((citation) =>
      citation.source_id === target.source_id && target.required_fact_ids.includes(citation.fact_id)
    )) {
      issues.push(issue("missing_required_fact", `$.public_draft.payload.items[${index}].citations`, "题目未引用所属目标的必要事实"))
    }
    issues.push(...validateAssessmentObjectiveScope(request, publicItem))
    if (privateItem.answer_spec.kind === "concept_rubric") validateRubric(privateItem, index, issues)
    if (privateItem.answer_spec.kind === "numeric" &&
      (!Number.isFinite(privateItem.answer_spec.target) ||
        privateItem.answer_spec.abs_tolerance < 0 || privateItem.answer_spec.rel_tolerance < 0)) {
      issues.push(issue("invalid_numeric_spec", `$.secure_draft.payload.items[${index}].answer_spec`, "数值答案规范无效"))
    }
    if (privateItem.answer_spec.kind === "code" && !suites.has(privateItem.answer_spec.test_suite_id)) {
      issues.push(issue("missing_code_suite", `$.secure_draft.payload.items[${index}].answer_spec`, "代码答案引用未知测试套件"))
    }
    if (privateItem.answer_spec.kind === "code") {
      const suite = suites.get(privateItem.answer_spec.test_suite_id)
      if (suite) {
        issues.push(...validateAssessmentPublicSecureCodeContract(publicItem, suite))
        if (suite.execution_contract.execution_mode !== "function") {
          issues.push(issue("public_secure_code_contract_mismatch", `$.secure_draft.payload.code_test_suites`, "正式代码题必须使用 function 模式"))
        }
      }
    }
  })
  for (const privateItem of securePayload.items) {
    if (!publicItems.has(privateItem.item_id)) {
      issues.push(issue("orphan_secure_item", "$.secure_draft.payload.items", `secure item 无公开题目 ${privateItem.item_id}`))
    }
  }
  const referencedSuiteIds = new Set(securePayload.items.flatMap((item) =>
    item.answer_spec.kind === "code" ? [item.answer_spec.test_suite_id] : [],
  ))
  for (const suite of securePayload.code_test_suites) {
    if (!referencedSuiteIds.has(suite.test_suite_id)) {
      issues.push(issue("orphan_code_suite", "$.secure_draft.payload.code_test_suites", `测试套件未被任何代码题引用：${suite.test_suite_id}`))
    }
  }

  const contentCitations = deduplicate(publicPayload.items.flatMap((item) => item.citations))
  issues.push(...validateCitations(deduplicate([...contentCitations, ...publicPayload.used_evidence]), request.evidence_pack).issues)
  const publicCoverage = uniqueMap(publicPayload.objective_coverage, "objective_id", "$.public_draft.payload.objective_coverage", issues)
  const secureCoverage = uniqueMap(securePayload.objective_coverage, "objective_id", "$.secure_draft.payload.objective_coverage", issues)
  let coveredCore = 0
  for (const target of coreTargets) {
    const publicEntry = publicCoverage.get(target.objective_id)
    const secureEntry = secureCoverage.get(target.objective_id)
    const publicOk = Boolean(publicEntry && publicEntry.item_ids.length > 0 &&
      publicEntry.item_ids.every((id) => publicItems.get(id)?.objective_id === target.objective_id) &&
      sameStringSet(publicEntry.modalities, unique(publicEntry.item_ids.map((id) => publicItems.get(id)!.modality))))
    const secureOk = Boolean(secureEntry && secureEntry.item_ids.length > 0 &&
      secureEntry.item_ids.every((id) => secureItems.get(id)?.objective_id === target.objective_id) &&
      sameStringSet(secureEntry.answer_kinds, unique(secureEntry.item_ids.map((id) => secureItems.get(id)!.answer_spec.kind))))
    const citedFactIds = new Set(publicPayload.items
      .filter((item) => item.objective_id === target.objective_id)
      .flatMap((item) => item.citations)
      .filter((citation) => citation.source_id === target.source_id)
      .map((citation) => citation.fact_id))
    const missingRequiredFacts = target.required_fact_ids.filter((factId) =>
      !citedFactIds.has(factId))
    if (!publicOk) issues.push(issue("missing_public_objective_coverage", `$.objective.${target.objective_id}`, "核心目标缺少有效公开测评映射"))
    if (!secureOk) issues.push(issue("missing_secure_objective_coverage", `$.objective.${target.objective_id}`, "核心目标缺少有效答案规范映射"))
    if (missingRequiredFacts.length > 0) {
      issues.push(issue("missing_required_fact", `$.objective.${target.objective_id}`, `核心目标必要事实未被测评完整覆盖：${missingRequiredFacts.join("、")}`))
    }
    if (publicOk && secureOk && missingRequiredFacts.length === 0) coveredCore += 1
  }

  validateRouting(publicPayload, publicItems, issues)
  for (const [index, suite] of securePayload.code_test_suites.entries()) {
    const staticReport = analyzePythonSource(suite.reference_solution, suite.execution_contract)
    for (const entry of staticReport) issues.push(issue(`static_${entry.code}`, `$.secure_draft.payload.code_test_suites[${index}]`, entry.message))
    if (suite.hidden_tests.some((test) => !targets.has(test.objective_id))) {
      issues.push(issue("unknown_test_objective", `$.secure_draft.payload.code_test_suites[${index}]`, "代码测试包含 Spec 外 objective"))
    }
    const weight = suite.hidden_tests.reduce((sum, test) => sum + test.weight, 0)
    if (!approximatelyOne(weight)) issues.push(issue("invalid_test_weight", `$.secure_draft.payload.code_test_suites[${index}]`, "代码测试权重之和必须为 1"))
  }
  issues.push(...validateAssessmentPublicSecureSeparation(publicPayload, securePayload).issues)
  const objectiveCoverage = coreTargets.length === 0 ? 1 : coveredCore / coreTargets.length
  return { ok: issues.length === 0, issues, citations: contentCitations, objective_coverage: objectiveCoverage }
}

/** Independent trust-plane verifier for answer keys and code reference suites. */
export class TrustedAssessmentVerifier implements AssessmentDraftVerifier {
  constructor(private readonly runner?: CodeRunner) {}

  async verifyAssessment(request: TieredEvaluatorRequest, draft: AssessmentDraft) {
    const report = validateAssessmentDraftStructure(request, draft)
    const issues = report.issues.map((entry) => `${entry.path}: ${entry.message}`)
    const suites = draft.secure_draft.payload.code_test_suites
    if (suites.length > 0 && !this.runner) issues.push("测评包含代码题，但未配置可信 CodeRunner")
    const expectedDigest = request.generation_spec.versions.runner_image_digest
    if (suites.length > 0 && !expectedDigest) issues.push("GenerationSpec 缺少 runner_image_digest")
    if (suites.length > 0 && expectedDigest && this.runner && expectedDigest !== this.runner.runner_image_digest) {
      issues.push("GenerationSpec.runner_image_digest 与 assessment CodeRunner 不一致")
    }
    let verifiedTests = 0
    if (report.ok && this.runner) {
      for (const suite of suites) {
        const runnerSuite: RunnerTestSuite = {
          test_suite_id: suite.test_suite_id,
          execution_contract: suite.execution_contract,
          tests: suite.hidden_tests,
        }
        const execution = await executeTrustedReferenceWithRetry(this.runner, {
          language: "python",
          code: suite.reference_solution,
          test_suite_id: suite.test_suite_id,
          test_suite: runnerSuite,
          timeout_ms: suite.execution_contract.resource_limits.timeout_ms,
          memory_mb: suite.execution_contract.resource_limits.memory_mb,
          max_output_bytes: suite.execution_contract.resource_limits.max_output_bytes,
          network_allowed: false,
        }, request.generation_spec.policies.max_tool_retry)
        if (execution.status !== "passed" || execution.passed_tests !== execution.total_tests) {
          issues.push(`代码题 reference ${suite.test_suite_id} 未通过全部隐藏测试：${execution.failure_codes.join("、")}`)
        } else {
          verifiedTests += execution.total_tests
        }
      }
    }
    return {
      answer_key_verified: report.ok && issues.length === 0,
      issues,
      runner_image_digest: suites.length > 0 ? this.runner?.runner_image_digest : undefined,
      verified_item_count: report.ok && issues.length === 0 ? draft.secure_draft.payload.items.length : 0,
      objective_coverage: report.objective_coverage,
      verified_test_count: verifiedTests,
    }
  }
}

function compareItemContract(
  publicItem: AssessmentItemPublic,
  secureItem: AssessmentItemSecure,
  index: number,
  issues: ValidationIssue[],
): void {
  for (const key of ["objective_id", "tier", "modality", "max_score"] as const) {
    if (publicItem[key] !== secureItem[key]) {
      issues.push(issue("item_contract_mismatch", `$.secure_draft.payload.items[${index}].${key}`, `public/secure ${key} 不一致`))
    }
  }
}

function validateChoiceContract(
  publicItem: AssessmentItemPublic,
  secureItem: AssessmentItemSecure,
  index: number,
  issues: ValidationIssue[],
): void {
  const choice = publicItem.modality === "mcq" || publicItem.modality === "true_false"
  if (!choice) {
    if (secureItem.correct_option_id || Object.keys(secureItem.misconception_by_option).length > 0) {
      issues.push(issue("unexpected_option_key", `$.secure_draft.payload.items[${index}]`, "非选择题不得包含选项答案或选项误区映射"))
    }
    return
  }
  const options = publicItem.options ?? []
  const optionIds = options.map((option) => option.option_id)
  if (new Set(optionIds).size !== optionIds.length) issues.push(issue("duplicate_option_id", `$.public_draft.payload.items[${index}].options`, "option_id 必须唯一"))
  options.forEach((option, optionIndex) => {
    if (option.label !== "ABCD"[optionIndex]) issues.push(issue("invalid_option_label", `$.public_draft.payload.items[${index}].options[${optionIndex}]`, "选项标签必须与最终显示位置一致"))
  })
  if (!secureItem.correct_option_id || !optionIds.includes(secureItem.correct_option_id)) {
    issues.push(issue("invalid_correct_option", `$.secure_draft.payload.items[${index}].correct_option_id`, "正确 option_id 不在公开选项中"))
  }
  if (secureItem.answer_spec.kind !== "exact_set" || !secureItem.correct_option_id ||
    !isOnlyAcceptedChoice(secureItem.answer_spec, secureItem.correct_option_id)) {
    issues.push(issue("choice_answer_spec_mismatch", `$.secure_draft.payload.items[${index}].answer_spec`, "选择题 AnswerSpec 只能接受规范化后的正确 option_id"))
  }
  const wrongIds = optionIds.filter((id) => id !== secureItem.correct_option_id)
  if (!sameStringSet(Object.keys(secureItem.misconception_by_option), wrongIds)) {
    issues.push(issue("incomplete_misconception_map", `$.secure_draft.payload.items[${index}].misconception_by_option`, "每个错误选项必须且只能映射一个误区"))
  }
}

function validateAnswerModality(
  publicItem: AssessmentItemPublic,
  secureItem: AssessmentItemSecure,
  index: number,
  issues: ValidationIssue[],
): void {
  const kind = secureItem.answer_spec.kind
  const compatible = publicItem.modality === "code"
    ? kind === "code"
    : publicItem.modality === "mcq" || publicItem.modality === "true_false"
      ? kind === "exact_set"
      : kind !== "code"
  if (!compatible) {
    issues.push(issue("answer_modality_mismatch", `$.secure_draft.payload.items[${index}].answer_spec`, `${publicItem.modality} 题型不能使用 ${kind} AnswerSpec`))
  }
}

function isOnlyAcceptedChoice(
  spec: Extract<AssessmentItemSecure["answer_spec"], { kind: "exact_set" }>,
  correctOptionId: string,
): boolean {
  const accepted = new Set(spec.accepted.map((value) => normalizeExact(value, spec.normalization)))
  return accepted.size === 1 && accepted.has(normalizeExact(correctOptionId, spec.normalization))
}

function validateRubric(item: AssessmentItemSecure, index: number, issues: ValidationIssue[]): void {
  if (item.answer_spec.kind !== "concept_rubric") return
  const weight = item.answer_spec.criteria.reduce((sum, criterion) => sum + criterion.weight, 0)
  if (!approximatelyOne(weight)) issues.push(issue("invalid_rubric_weight", `$.secure_draft.payload.items[${index}].answer_spec.criteria`, "rubric criterion 权重之和必须为 1"))
  const ids = item.answer_spec.criteria.map((criterion) => criterion.criterion_id)
  if (new Set(ids).size !== ids.length) issues.push(issue("duplicate_criterion_id", `$.secure_draft.payload.items[${index}].answer_spec.criteria`, "criterion_id 必须唯一"))
  for (const [criterionIndex, criterion] of item.answer_spec.criteria.entries()) {
    if (new Set(criterion.required_evidence.map(normalize)).size !== criterion.required_evidence.length) {
      issues.push(issue("duplicate_required_evidence", `$.secure_draft.payload.items[${index}].answer_spec.criteria[${criterionIndex}]`, "required_evidence 规范化后不得重复"))
    }
  }
  if (new Set(item.answer_spec.contradictions.map(normalize)).size !== item.answer_spec.contradictions.length) {
    issues.push(issue("duplicate_contradiction", `$.secure_draft.payload.items[${index}].answer_spec.contradictions`, "contradictions 规范化后不得重复"))
  }
}

function validateRouting(
  payload: AssessmentPublicPayload,
  items: Map<string, AssessmentItemPublic>,
  issues: ValidationIssue[],
): void {
  if (new Set(payload.routing.anchor_item_ids).size !== payload.routing.anchor_item_ids.length) {
    issues.push(issue("duplicate_anchor", "$.public_draft.payload.routing.anchor_item_ids", "锚点题 ID 不得重复"))
  }
  for (const itemId of payload.routing.anchor_item_ids) {
    const item = items.get(itemId)
    if (!item) issues.push(issue("unknown_anchor", "$.public_draft.payload.routing.anchor_item_ids", `锚点题不存在：${itemId}`))
    else if (item.tier === 3) issues.push(issue("invalid_anchor_tier", "$.public_draft.payload.routing.anchor_item_ids", "Tier 3 不应作为初始锚点题"))
  }
  const rules = [...payload.routing.rules].sort((a, b) => a.min_anchor_score_ratio - b.min_anchor_score_ratio)
  if (rules.length !== 3) {
    issues.push(issue("routing_rule_count", "$.public_draft.payload.routing.rules", "路由必须且只能包含三个区间"))
  }
  if (new Set(rules.map((rule) => rule.route_id)).size !== rules.length) {
    issues.push(issue("duplicate_route_id", "$.public_draft.payload.routing.rules", "route_id 不得重复"))
  }
  if (rules[0]?.min_anchor_score_ratio !== 0 || rules.at(-1)?.max_anchor_score_ratio !== 1) {
    issues.push(issue("routing_not_total", "$.public_draft.payload.routing.rules", "路由区间必须覆盖 [0,1]"))
  }
  rules.forEach((rule, index) => {
    if (rule.min_anchor_score_ratio >= rule.max_anchor_score_ratio) issues.push(issue("invalid_routing_range", `$.routing.rules[${index}]`, "路由下界必须小于上界"))
    if (new Set(rule.reveal_tiers).size !== rule.reveal_tiers.length) {
      issues.push(issue("duplicate_reveal_tier", `$.routing.rules[${index}].reveal_tiers`, "reveal_tiers 不得重复"))
    }
    if (index > 0 && Math.abs(rule.min_anchor_score_ratio - rules[index - 1].max_anchor_score_ratio) > 1e-9) {
      issues.push(issue("routing_gap", `$.routing.rules[${index}]`, "路由区间必须连续"))
    }
  })
  if (!sameStringSet(rules.map((rule) => rule.action), ["remediate", "reinforce", "advance"])) {
    issues.push(issue("routing_actions", "$.public_draft.payload.routing.rules", "路由必须包含 remediate/reinforce/advance"))
  }
  const expectedActionOrder = ["remediate", "reinforce", "advance"]
  if (rules.some((rule, index) => rule.action !== expectedActionOrder[index])) {
    issues.push(issue("routing_action_order", "$.public_draft.payload.routing.rules", "路由动作必须随分数依次为 remediate、reinforce、advance"))
  }
}

function uniqueMap<T extends Record<K, string>, K extends keyof T>(
  entries: T[],
  key: K,
  path: string,
  issues: ValidationIssue[],
  requireUnique = true,
): Map<string, T> {
  const map = new Map<string, T>()
  entries.forEach((entry, index) => {
    const id = entry[key]
    if (requireUnique && map.has(id)) issues.push(issue("duplicate_id", `${path}[${index}]`, `ID 重复：${id}`))
    map.set(id, entry)
  })
  return map
}

function approximatelyOne(value: number): boolean {
  return Math.abs(value - 1) <= 1e-9
}

function normalize(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase()
}

function normalizeExact(
  value: string,
  operations: Extract<AssessmentItemSecure["answer_spec"], { kind: "exact_set" }>["normalization"],
): string {
  let output = value
  for (const operation of operations) {
    if (operation === "trim") output = output.trim()
    if (operation === "casefold") output = output.toLocaleLowerCase()
    if (operation === "unicode") output = output.normalize("NFKC")
    if (operation === "collapse_whitespace") output = output.replace(/\s+/g, " ")
  }
  return output
}

function citationKey(entry: CitationRef): string {
  return `${entry.source_id}:${entry.fact_id}:${entry.relation}`
}

function deduplicate(citations: CitationRef[]): CitationRef[] {
  return [...new Map(citations.map((entry) => [citationKey(entry), entry])).values()]
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  const leftSet = new Set(left)
  const rightSet = new Set(right)
  return leftSet.size === left.length && rightSet.size === right.length
    && leftSet.size === rightSet.size && [...leftSet].every((entry) => rightSet.has(entry))
}

function issue(code: string, path: string, message: string): ValidationIssue {
  return { code, path, message, severity: "critical" }
}
