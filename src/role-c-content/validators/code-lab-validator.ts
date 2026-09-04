import type { CodeLabDraft, CodeLabDraftVerifier, CodeLabRequest } from "../agents/types"
import type { CitationRef } from "../contracts/common"
import { claimTextMatchesFact } from "./claim-grounding"
import type { CodeLabPublicPayload, CodeLabSecurePayload } from "../contracts/artifacts"
import {
  executeTrustedReferenceWithRetry,
  executeWithRunnerRetry,
  type CodeRunner,
  type RunnerTestSuite,
} from "../security/code-runner"
import { analyzePythonSource } from "../security/python-static-analyzer"
import { validateCitations, type ValidationIssue } from "./citation-validator"
import { validateCodeLabPublicSecureSeparation, validatePublicArtifactNoSecrets } from "./public-secure-leak-validator"
import { validateRoleCSchema, validateRoleCSchemaFragment } from "./runtime-schema-validator"
import {
  validatePracticalGuideAgainstLearnerSurface,
  validatePracticalGuideForRelease,
} from "./section-six-resource-validator"
import { classifyExpectedValue, classifyOutputContract } from "../contracts/output-contract"
import { failClosedStarterCode, validateGapLearnerContract, validateGapTemplate } from "../programming/gap-template"
import { validateInputCandidates } from "../programming/test-plan"
import { describePythonEntryPoint } from "../programming/python-function-interface"
import { validateCodeLabReflectionQuestions } from "../programming/reflection-grounding"
import {
  executePublicLabInputs,
  materializeTrustedPublicExpectations,
  publicLabInputCases,
} from "../security/public-lab-inputs"

export interface CodeLabDraftValidationReport {
  ok: boolean
  issues: ValidationIssue[]
  citations: CitationRef[]
  objective_coverage: number
}

/** Public-stage gate so public defects are repaired before secure material is authored. */
export function validateCodeLabPublicStage(
  request: CodeLabRequest,
  publicPayload: CodeLabPublicPayload,
): CodeLabDraftValidationReport {
  const schema = validateRoleCSchemaFragment(
    "code_lab_draft.schema.json",
    "/$defs/public_payload",
    publicPayload,
  )
  if (!schema.ok) return { ok: false, issues: schema.issues, citations: [], objective_coverage: 0 }

  const issues: ValidationIssue[] = [...validatePublicArtifactNoSecrets(publicPayload).issues]
  const guidePlan = request.resource_blueprint?.code_lab.practical_guide_plan
  const programmingPlan = request.resource_blueprint?.code_lab.programming_problem
  const programmingTask = publicPayload.programming_task
  if (programmingPlan && !programmingTask) {
    issues.push(issue("missing_programming_task", "$.programming_task", "生产代码实验必须包含编程题任务"))
  } else if (programmingPlan && programmingTask) {
    if (programmingTask.blueprint_id !== programmingPlan.blueprint_id
      || programmingTask.task_kind !== programmingPlan.task_kind
      || programmingTask.submission_mode !== programmingPlan.submission_mode) {
      issues.push(issue("programming_blueprint_mismatch", "$.programming_task", "编程题未遵守冻结蓝图"))
    }
    if (programmingPlan.submission_mode === "gap_answers") {
      if (!programmingTask.gap_template) {
        issues.push(issue("missing_gap_template", "$.programming_task.gap_template", "程序填空必须提供 gap_template"))
      } else {
        validateGapTemplate(programmingTask.gap_template).forEach((message) =>
          issues.push(issue("invalid_gap_template", "$.programming_task.gap_template", message)))
        analyzePythonSource(failClosedStarterCode(programmingTask.gap_template), publicPayload.execution_contract).forEach((entry) =>
          issues.push(issue(entry.code, "$.programming_task.gap_template.template_code", entry.message)))
        validateGapLearnerContract({ ...programmingTask, gap_template: programmingTask.gap_template }).forEach((message) =>
          issues.push(issue("unclear_gap_task", "$.programming_task", message)))
      }
      if (programmingTask.starter_code) {
        issues.push(issue("unsafe_gap_submission_surface", "$.programming_task.starter_code", "程序填空不得向浏览器开放完整代码提交"))
      }
    } else {
      if (programmingTask.gap_template) issues.push(issue("unexpected_gap_template", "$.programming_task.gap_template", "当前题型不得提供 gap_template"))
      if (!programmingTask.starter_code?.trim()) issues.push(issue("missing_programming_starter", "$.programming_task.starter_code", "当前题型必须提供可编辑 starter_code"))
    }
  }
  const publicGuide = publicPayload.practical_guide
  if (guidePlan && !publicGuide) {
    issues.push(issue("missing_practical_guide", "$.practical_guide", "生产代码实验必须包含实操指南"))
  }
  if (guidePlan && publicGuide) {
    for (const guideIssue of validatePracticalGuideForRelease(publicGuide)) {
      issues.push(issue(guideIssue.code, `$.practical_guide${guideIssue.path.slice(1)}`, guideIssue.message))
    }
    for (const guideIssue of validatePracticalGuideAgainstLearnerSurface({
      guide: publicGuide,
      starter_code: publicPayload.starter_code,
      gap_template_code: publicPayload.programming_task?.gap_template?.template_code,
      evidence_facts: request.evidence_pack.results.flatMap((entry) => entry.facts.map((fact) => fact.content)),
    })) {
      issues.push(issue(guideIssue.code, `$.practical_guide${guideIssue.path.slice(1)}`, guideIssue.message))
    }
  }
  for (const message of validateExecutionContractResultSemantics(publicPayload.execution_contract)) {
    issues.push(issue("invalid_execution_result_contract", "$.execution_contract.output_contract", message))
  }
  validateCodeLabReflectionQuestions(publicPayload.reflection_questions).forEach((message) =>
    issues.push(issue("unsupported_reflection_question", "$.reflection_questions", message)))
  const targetIds = new Set(request.generation_spec.targets.map((target) => target.objective_id))
  const coreTargets = request.generation_spec.targets.filter((target) => target.importance === "core")
  const blocks = uniqueMap(publicPayload.instructions, "block_id", "$.instructions", issues)
  const tests = uniqueMap(publicPayload.public_tests, "test_id", "$.public_tests", issues)
  const ladders = uniqueMap(publicPayload.hint_ladders, "objective_id", "$.hint_ladders", issues)
  const coverage = uniqueMap(publicPayload.objective_coverage, "objective_id", "$.objective_coverage", issues)
  const claims = publicPayload.instructions.flatMap((block) => "claims" in block ? block.claims : [])
  const contentCitations = deduplicate([
    ...claims.flatMap((claim) => claim.citations),
    ...publicPayload.public_tests.flatMap((test) => test.citations),
    ...publicPayload.hint_ladders.flatMap((ladder) => ladder.hints.flatMap((hint) => hint.citations)),
    ...(publicGuide?.used_evidence ?? []),
  ])
  issues.push(...validateCitations(deduplicate([...contentCitations, ...publicPayload.used_evidence]), request.evidence_pack).issues)
  issues.push(...validateClaimGrounding(claims, request))
  for (const objectiveId of publicPayload.objective_ids) {
    if (!targetIds.has(objectiveId)) issues.push(issue("unknown_objective", "$.objective_ids", `实验包含 Spec 外目标 ${objectiveId}`))
  }
  for (const test of publicPayload.public_tests) {
    if (!targetIds.has(test.objective_id)) issues.push(issue("unknown_public_test_objective", `$.public_tests.${test.test_id}`, `公开测试包含 Spec 外 objective ${test.objective_id}`))
  }
  issues.push(...validateFrozenStdinLayout(
    request,
    publicPayload.starter_code,
    publicPayload.public_tests.map((test) => ({ id: test.test_id, input: test.input })),
    "$.public_tests",
  ))

  let coveredCore = 0
  for (const target of coreTargets) {
    const entry = coverage.get(target.objective_id)
    const citedFactIds = new Set(claims.flatMap((claim) =>
      claim.citations
        .filter((citation) => citation.source_id === target.source_id)
        .map((citation) => citation.fact_id)))
    const plannedFactIds = codeLabPlannedFactIds(request, target)
    const missingRequiredFacts = plannedFactIds.filter(
      (factId) => !citedFactIds.has(factId),
    )
    const hasRequiredFacts = missingRequiredFacts.length === 0
    const validCoverage = Boolean(entry
      && entry.instruction_block_ids.every((id) => blocks.has(id))
      && entry.public_test_ids.every((id) => tests.get(id)?.objective_id === target.objective_id))
    const ladder = ladders.get(target.objective_id)
    const levels = new Set(ladder?.hints.map((hint) => hint.hint_level) ?? [])
    if (!hasRequiredFacts) issues.push(issue("missing_required_fact", `$.objective.${target.objective_id}`, `实验计划事实未用于 Claim：${missingRequiredFacts.join("、")}`))
    if (!validCoverage) issues.push(issue("missing_public_objective_coverage", `$.objective.${target.objective_id}`, "核心目标缺少 instruction/public test 对齐"))
    if ([1, 2, 3].some((level) => !levels.has(level as 1 | 2 | 3))) {
      issues.push(issue("invalid_hint_ladder", `$.objective.${target.objective_id}`, "核心目标必须包含 level 1/2/3 三级提示"))
    }
    if (hasRequiredFacts && validCoverage && levels.size === 3) coveredCore += 1
  }
  for (const entry of analyzePythonSource(publicPayload.starter_code, publicPayload.execution_contract)) {
    issues.push(issue(`static_${entry.code}`, "$.starter_code", entry.message))
  }
  return {
    ok: issues.length === 0,
    issues,
    citations: contentCitations,
    objective_coverage: coreTargets.length === 0 ? 1 : coveredCore / coreTargets.length,
  }
}

export function validateCodeLabDraftStructure(
  request: CodeLabRequest,
  draft: CodeLabDraft,
): CodeLabDraftValidationReport {
  const schema = validateRoleCSchema("code_lab_draft.schema.json", draft)
  if (!schema.ok) return { ok: false, issues: schema.issues, citations: [], objective_coverage: 0 }

  const publicPayload = draft.public_draft.payload
  const securePayload = draft.secure_draft.payload
  const issues: ValidationIssue[] = []
  const guidePlan = request.resource_blueprint?.code_lab.practical_guide_plan
  const practicalGuide = publicPayload.practical_guide
  if (guidePlan && !practicalGuide) {
    issues.push(issue("missing_practical_guide", "$.public_draft.payload.practical_guide", "生产代码实验必须包含实操指南"))
  }
  if (guidePlan && practicalGuide) {
    for (const guideIssue of validatePracticalGuideForRelease(practicalGuide)) {
      issues.push(issue(guideIssue.code, `$.public_draft.payload.practical_guide${guideIssue.path.slice(1)}`, guideIssue.message))
    }
    for (const guideIssue of validatePracticalGuideAgainstLearnerSurface({
      guide: practicalGuide,
      starter_code: publicPayload.starter_code,
      gap_template_code: publicPayload.programming_task?.gap_template?.template_code,
      evidence_facts: request.evidence_pack.results.flatMap((entry) => entry.facts.map((fact) => fact.content)),
    })) {
      issues.push(issue(guideIssue.code, `$.public_draft.payload.practical_guide${guideIssue.path.slice(1)}`, guideIssue.message))
    }
    if (practicalGuide.plan_id !== guidePlan.plan_id) issues.push(issue("practical_guide_plan_mismatch", "$.public_draft.payload.practical_guide.plan_id", "实操指南未绑定当前冻结计划"))
    if (practicalGuide.lab_id !== publicPayload.lab_id) issues.push(issue("practical_guide_lab_mismatch", "$.public_draft.payload.practical_guide.lab_id", "实操指南与代码实验 lab_id 不一致"))
    if (practicalGuide.environment.execution_mode !== publicPayload.execution_contract.execution_mode
      || practicalGuide.environment.entry_point !== (publicPayload.execution_contract.entry_point ?? null)
      || practicalGuide.environment.input_type !== publicPayload.execution_contract.input_contract.type
      || practicalGuide.environment.output_type !== publicPayload.execution_contract.output_contract.type) {
      issues.push(issue("practical_guide_execution_mismatch", "$.public_draft.payload.practical_guide.environment", "实操指南执行环境与代码实验执行合同不一致"))
    }
    const publicTestIds = new Set(publicPayload.public_tests.map((test) => test.test_id))
    const guideTestIds = new Set(practicalGuide.acceptance_criteria.map((entry) => entry.public_test_id))
    if (publicTestIds.size !== guideTestIds.size || [...publicTestIds].some((id) => !guideTestIds.has(id))) issues.push(issue("practical_guide_acceptance_mismatch", "$.public_draft.payload.practical_guide.acceptance_criteria", "实操指南验收标准必须完整对应公开测试"))
  }
  if (request.concept_artifact.status !== "ready" || !request.concept_artifact.payload) {
    issues.push(issue("concept_not_ready", "$.concept_artifact", "code-lab 只能消费 ready 的 concept artifact"))
  }
  if (publicPayload.lab_id !== securePayload.lab_id) {
    issues.push(issue("lab_id_mismatch", "$.secure_draft.payload.lab_id", "public/secure lab_id 不一致"))
  }
  if (JSON.stringify(publicPayload.execution_contract) !== JSON.stringify(securePayload.execution_contract)) {
    issues.push(issue("execution_contract_mismatch", "$.secure_draft.payload.execution_contract", "public/secure execution_contract 不一致"))
  }

  const targetIds = new Set(request.generation_spec.targets.map((target) => target.objective_id))
  const coreTargets = request.generation_spec.targets.filter((target) => target.importance === "core")
  const publicObjectiveIds = new Set(publicPayload.objective_ids)
  for (const objectiveId of publicPayload.objective_ids) {
    if (!targetIds.has(objectiveId)) issues.push(issue("unknown_objective", "$.public_draft.payload.objective_ids", `实验包含 Spec 外目标 ${objectiveId}`))
  }

  const blocks = new Map<string, CodeLabPublicPayload["instructions"][number]>()
  for (const [index, block] of publicPayload.instructions.entries()) {
    if (blocks.has(block.block_id)) issues.push(issue("duplicate_block_id", `$.public_draft.payload.instructions[${index}]`, `block_id 重复：${block.block_id}`))
    blocks.set(block.block_id, block)
  }
  const publicTests = uniqueMap(publicPayload.public_tests, "test_id", "$.public_draft.payload.public_tests", issues)
  const hiddenTests = uniqueMap(securePayload.hidden_tests, "test_id", "$.secure_draft.payload.hidden_tests", issues)
  const scoringGroups = uniqueMap(securePayload.scoring_groups, "group_id", "$.secure_draft.payload.scoring_groups", issues)
  const hintLadders = uniqueMap(publicPayload.hint_ladders, "objective_id", "$.public_draft.payload.hint_ladders", issues)
  const programmingProblem = request.resource_blueprint?.code_lab.programming_problem
  if (programmingProblem) {
    const functionInterface = publicPayload.execution_contract.execution_mode === "function"
      ? describePythonEntryPoint(
          securePayload.reference_solution,
          publicPayload.execution_contract.entry_point,
        )
      : undefined
    const quality = validateInputCandidates(
      programmingProblem,
      publicPayload.programming_task?.public_examples ?? publicPayload.public_tests,
      securePayload.hidden_tests.map((test) => ({
        case_id: test.test_id,
        partition_id: test.partition_id ?? "nominal",
        input: test.input,
        note: test.note ?? "",
      })),
      functionInterface,
    )
    quality.issues.forEach((message) => issues.push(issue(
      message.includes("重叠") ? "public_hidden_input_overlap"
        : message.includes("重复") ? "duplicate_test_input"
          : message.includes("分区") || message.includes("测试不足") ? "insufficient_partition_cases"
            : "invalid_test_partition",
      "$.secure_draft.payload.hidden_tests",
      message,
    )))
  }

  for (const test of publicPayload.public_tests) {
    if (!targetIds.has(test.objective_id)) issues.push(issue("unknown_public_test_objective", `$.public_tests.${test.test_id}`, `公开测试包含 Spec 外 objective ${test.objective_id}`))
  }
  for (const [authorIndex, test] of securePayload.hidden_tests.entries()) {
    if (!targetIds.has(test.objective_id)) issues.push(issue("unknown_hidden_test_objective", `$.hidden_tests.${test.test_id}`, `隐藏测试包含 Spec 外 objective ${test.objective_id}`))
    for (const message of validateHiddenTestComparisonCompatibility(
      test.comparison,
      test.expected,
      publicPayload.execution_contract.output_contract,
    )) {
      issues.push(issue("invalid_test_comparison", `$.hidden_tests.${test.test_id}.comparison`, message))
    }
    for (const message of validateHiddenTestExpectedAgainstOutputContract(publicPayload.execution_contract.output_contract, test.expected)) {
      issues.push(buildInvalidExpectedTypeIssue(
        publicPayload.execution_contract.output_contract,
        test.expected,
        authorIndex,
        test.objective_id,
        message,
      ))
    }
  }
  issues.push(...validateFrozenStdinLayout(
    request,
    securePayload.reference_solution,
    securePayload.hidden_tests.map((test) => ({ id: test.test_id, input: test.input })),
    "$.secure_draft.payload.hidden_tests",
  ))
  issues.push(...validateFrozenStdinTokenShapes(
    request,
    publicPayload.public_tests.map((test) => ({ id: test.test_id, input: test.input })),
    securePayload.hidden_tests.map((test) => ({ id: test.test_id, input: test.input })),
  ))

  const claims = publicPayload.instructions.flatMap((block) => "claims" in block ? block.claims : [])
  const contentCitations = deduplicate([
    ...claims.flatMap((claim) => claim.citations),
    ...publicPayload.public_tests.flatMap((test) => test.citations),
    ...publicPayload.hint_ladders.flatMap((ladder) => ladder.hints.flatMap((hint) => hint.citations)),
  ])
  issues.push(...validateCitations(deduplicate([...contentCitations, ...publicPayload.used_evidence]), request.evidence_pack).issues)
  issues.push(...validateClaimGrounding(claims, request))

  const publicCoverage = uniqueMap(publicPayload.objective_coverage, "objective_id", "$.public_draft.payload.objective_coverage", issues)
  const secureCoverage = uniqueMap(securePayload.objective_coverage, "objective_id", "$.secure_draft.payload.objective_coverage", issues)
  let coveredCore = 0
  for (const target of coreTargets) {
    const publicEntry = publicCoverage.get(target.objective_id)
    const secureEntry = secureCoverage.get(target.objective_id)
    const citedFactIds = new Set(claims.flatMap((claim) =>
      claim.citations
        .filter((citation) => citation.source_id === target.source_id)
        .map((citation) => citation.fact_id)))
    const plannedFactIds = codeLabPlannedFactIds(request, target)
    const missingRequiredFacts = plannedFactIds.filter(
      (factId) => !citedFactIds.has(factId),
    )
    const hasRequiredFacts = missingRequiredFacts.length === 0
    const publicOk = Boolean(publicObjectiveIds.has(target.objective_id) && publicEntry &&
      publicEntry.instruction_block_ids.length > 0 &&
      publicEntry.instruction_block_ids.every((id) => blocks.has(id)) &&
      publicEntry.public_test_ids.length > 0 &&
      publicEntry.public_test_ids.every((id) => publicTests.get(id)?.objective_id === target.objective_id))
    const secureOk = Boolean(secureEntry &&
      secureEntry.hidden_test_ids.length > 0 &&
      secureEntry.hidden_test_ids.every((id) => hiddenTests.get(id)?.objective_id === target.objective_id) &&
      secureEntry.scoring_group_ids.length > 0 &&
      secureEntry.scoring_group_ids.every((id) => scoringGroups.get(id)?.objective_id === target.objective_id))
    if (!hasRequiredFacts) issues.push(issue("missing_required_fact", `$.objective.${target.objective_id}`, `实验计划事实未用于 Claim：${missingRequiredFacts.join("、")}`))
    if (!publicOk) issues.push(issue("missing_public_objective_coverage", `$.objective.${target.objective_id}`, "核心目标缺少 instruction/public test 对齐"))
    if (!secureOk) issues.push(issue("missing_secure_objective_coverage", `$.objective.${target.objective_id}`, "核心目标缺少 hidden test/scoring 对齐"))
    const ladder = hintLadders.get(target.objective_id)
    if (!ladder || new Set(ladder.hints.map((hint) => hint.hint_level)).size !== 3) {
      issues.push(issue("invalid_hint_ladder", `$.objective.${target.objective_id}`, "核心目标必须包含 level 1/2/3 三级提示"))
    }
    if (publicOk && secureOk && hasRequiredFacts && ladder) coveredCore += 1
  }

  const assignedTests = new Map<string, string>()
  for (const group of securePayload.scoring_groups) {
    if (!targetIds.has(group.objective_id)) {
      issues.push(issue("unknown_group_objective", `$.scoring_groups.${group.group_id}`, `评分组包含 Spec 外 objective ${group.objective_id}`))
    }
    let expectedWeight = 0
    for (const testId of group.test_ids) {
      const test = hiddenTests.get(testId)
      if (!test) {
        issues.push(issue("unknown_group_test", `$.scoring_groups.${group.group_id}`, `评分组引用未知测试 ${testId}`))
        continue
      }
      if (test.objective_id !== group.objective_id) {
        issues.push(issue("group_objective_mismatch", `$.scoring_groups.${group.group_id}`, `评分组 ${group.group_id} 与测试 ${testId} 的 objective 不一致`))
      }
      if (assignedTests.has(testId)) {
        issues.push(issue("test_in_multiple_groups", `$.scoring_groups.${group.group_id}`, `隐藏测试 ${testId} 同时属于多个评分组`))
      }
      assignedTests.set(testId, group.group_id)
      expectedWeight += test.weight
    }
    if (Math.abs(group.weight - expectedWeight) > 1e-9) {
      issues.push(issue("group_weight_mismatch", `$.scoring_groups.${group.group_id}.weight`, "评分组权重必须等于组内隐藏测试权重之和"))
    }
  }
  for (const testId of hiddenTests.keys()) {
    if (!assignedTests.has(testId)) issues.push(issue("ungrouped_hidden_test", "$.secure_draft.payload.scoring_groups", `隐藏测试未进入任何评分组：${testId}`))
  }
  const mappedTests = new Set<string>()
  for (const mapping of securePayload.misconception_map) {
    if (!hiddenTests.has(mapping.failed_test_id)) issues.push(issue("unknown_misconception_test", "$.misconception_map", `误区映射引用未知测试 ${mapping.failed_test_id}`))
    if (mappedTests.has(mapping.failed_test_id)) issues.push(issue("duplicate_misconception_test", "$.misconception_map", `隐藏测试重复映射误区：${mapping.failed_test_id}`))
    mappedTests.add(mapping.failed_test_id)
  }
  for (const testId of hiddenTests.keys()) {
    if (!mappedTests.has(testId)) issues.push(issue("missing_misconception_test", "$.misconception_map", `隐藏测试缺少误区映射：${testId}`))
  }
  const hiddenWeight = securePayload.hidden_tests.reduce((sum, test) => sum + test.weight, 0)
  const groupWeight = securePayload.scoring_groups.reduce((sum, group) => sum + group.weight, 0)
  if (!approximatelyOne(hiddenWeight)) issues.push(issue("invalid_hidden_weight", "$.hidden_tests", "hidden test 权重之和必须为 1"))
  if (!approximatelyOne(groupWeight)) issues.push(issue("invalid_group_weight", "$.scoring_groups", "scoring group 权重之和必须为 1"))

  issues.push(...staticIssues(publicPayload, securePayload))
  issues.push(...validateCodeLabPublicSecureSeparation(publicPayload, securePayload).issues)
  const objectiveCoverage = coreTargets.length === 0 ? 1 : coveredCore / coreTargets.length
  return { ok: issues.length === 0, issues, citations: contentCitations, objective_coverage: objectiveCoverage }
}

function validateFrozenStdinLayout(
  request: CodeLabRequest,
  source: string,
  tests: Array<{ id: string; input: unknown }>,
  path: string,
): ValidationIssue[] {
  const contract = request.resource_blueprint?.code_lab.task_contract
  if (contract?.stdin_layout !== "single_line_text") return []
  const issues: ValidationIssue[] = []
  const inputCalls = source.match(/\binput\s*\(/gu)?.length ?? 0
  if (inputCalls > 1) {
    issues.push(issue(
      "stdin_layout_mismatch",
      path,
      "single_line_text 只允许一次 input() 读取整行，不得用多次 input() 猜测多行协议",
    ))
  }
  for (const test of tests) {
    if (typeof test.input !== "string" || !isSingleInputLine(test.input)) {
      issues.push(issue(
        "stdin_layout_mismatch",
        `${path}.${test.id}.input`,
        "single_line_text 测试输入必须把全部字段放在同一行",
      ))
    }
  }
  return issues
}

function isSingleInputLine(value: string): boolean {
  return value.replace(/\r?\n$/u, "").split(/\r?\n/u).length === 1
}

type StdinTokenKind = "integer" | "decimal" | "boolean" | "text"

/**
 * Public and hidden tests are different data for one task, not different input
 * languages.  Free-form model generation previously kept both inputs on one
 * line but changed integers into words (or vice versa), so a valid reference
 * parser failed only in Docker.  Freeze the lexical token shape before trusted
 * execution while still allowing variable-length homogeneous lists.
 */
export function validateFrozenStdinTokenShapes(
  request: CodeLabRequest,
  publicTests: Array<{ id: string; input: unknown }>,
  hiddenTests: Array<{ id: string; input: unknown }>,
): ValidationIssue[] {
  if (request.resource_blueprint?.code_lab.task_contract.stdin_layout !== "single_line_text") return []
  const publicShapes = publicTests.flatMap((test) =>
    typeof test.input === "string" ? [stdinTokenShape(test.input)] : [])
  if (publicShapes.length === 0) return []
  const homogeneousKind = publicShapes.every((shape) =>
    shape.length > 0 && shape.every((kind) => kind === publicShapes[0]?.[0]))
    ? publicShapes[0]?.[0]
    : undefined
  const issues: ValidationIssue[] = []
  for (const test of hiddenTests) {
    if (typeof test.input !== "string") continue
    const hiddenShape = stdinTokenShape(test.input)
    const compatible = homogeneousKind
      ? hiddenShape.length > 0 && hiddenShape.every((kind) => kind === homogeneousKind)
      : publicShapes.some((shape) => sameTokenShape(shape, hiddenShape))
    if (!compatible) {
      issues.push(issue(
        "stdin_token_shape_mismatch",
        `$.secure_draft.payload.hidden_tests.${test.id}.input`,
        `隐藏输入的 token 类型序列 ${hiddenShape.join("/") || "empty"} 与公开输入合同不一致`,
      ))
    }
  }
  return issues
}

function stdinTokenShape(value: string): StdinTokenKind[] {
  const text = value.replace(/\r?\n$/u, "").trim()
  if (!text) return []
  return text.split(/\s+/u).map((token) => {
    if (/^[+-]?\d+$/u.test(token)) return "integer"
    if (/^[+-]?(?:\d+\.\d*|\d*\.\d+)$/u.test(token)) return "decimal"
    if (/^(?:true|false)$/iu.test(token)) return "boolean"
    return "text"
  })
}

function sameTokenShape(left: StdinTokenKind[], right: StdinTokenKind[]): boolean {
  return left.length === right.length && left.every((kind, index) => kind === right[index])
}

function codeLabPlannedFactIds(
  request: CodeLabRequest,
  target: CodeLabRequest["generation_spec"]["targets"][number],
): string[] {
  const planned = request.resource_blueprint?.code_lab.objective_plan.find((entry) =>
    entry.objective_id === target.objective_id)
  return planned?.citations
    .filter((citation) => citation.source_id === target.source_id)
    .map((citation) => citation.fact_id)
    ?? target.required_fact_ids
}

export interface CodeLabVerificationDiagnosticInput {
  issues: string[]
  reference_failed?: boolean
  reference_failure_codes?: string[]
  starter_status?: "passed" | "failed" | "timeout" | "runner_error"
  failed_mutations?: Array<{ mutation_id: string; status: string; failure_codes: string[] }>
  public_payload?: { public_tests?: Array<{ input?: unknown }> }
  secure_payload?: { hidden_tests?: Array<{ input?: unknown }> }
}

export interface CodeLabVerificationFailureDiagnostic {
  code: "RUNNER_IDENTITY_MISMATCH" | "REFERENCE_SOLUTION_FAILED" | "STARTER_ALREADY_SOLVES_LAB" | "STARTER_EXECUTION_UNSTABLE" | "MUTATION_NOT_DETECTED" | "CODE_LAB_EXECUTION_UNVERIFIED"
  stage: "code_lab_secure_execution"
  safe_message: string
  private_details: string[]
}

export function classifyCodeLabVerificationFailure(input: CodeLabVerificationDiagnosticInput): CodeLabVerificationFailureDiagnostic {
  const issues = input.issues.filter((entry) => {
    if (!entry.includes("hidden_test_input_leak")) return true
    const empty = (value: unknown) => Boolean(value && typeof value === "object" && !Array.isArray(value)
      && Array.isArray((value as { args?: unknown }).args)
      && (value as { args: unknown[] }).args.length === 0
      && Object.keys(((value as { files?: unknown }).files ?? {}) as object).length === 0
      && Object.keys(((value as { kwargs?: unknown }).kwargs ?? {}) as object).length === 0)
    return !((input.public_payload?.public_tests ?? []).every((test) => empty(test.input))
      && (input.secure_payload?.hidden_tests ?? []).every((test) => empty(test.input)))
  })
  if (issues.some((entry) => entry.includes("runner_image_digest"))) {
    return { code: "RUNNER_IDENTITY_MISMATCH", stage: "code_lab_secure_execution", safe_message: "可信执行镜像身份不一致", private_details: [...issues] }
  }
  if (input.reference_failed) {
    const details = input.reference_failure_codes ?? input.issues
    const infrastructure = details.some((code) => /runner|timeout|docker|identity|unverified/u.test(code))
    if (!infrastructure) return { code: "REFERENCE_SOLUTION_FAILED", stage: "code_lab_secure_execution", safe_message: "参考实现未通过可信隐藏测试", private_details: [...details] }
  }
  if (input.starter_status === "passed") {
    return { code: "STARTER_ALREADY_SOLVES_LAB", stage: "code_lab_secure_execution", safe_message: "起始代码意外完成了实验任务", private_details: [...issues] }
  }
  if (input.starter_status === "timeout" || input.starter_status === "runner_error") {
    return { code: "STARTER_EXECUTION_UNSTABLE", stage: "code_lab_secure_execution", safe_message: "起始代码无法稳定进入可信执行", private_details: [...issues] }
  }
  const mutationDetails = (input.failed_mutations ?? []).flatMap((entry) => entry.failure_codes)
  if (mutationDetails.length > 0) {
    return { code: "MUTATION_NOT_DETECTED", stage: "code_lab_secure_execution", safe_message: "错误实现未被隐藏测试稳定检出", private_details: mutationDetails }
  }
  return { code: "CODE_LAB_EXECUTION_UNVERIFIED", stage: "code_lab_secure_execution", safe_message: "代码实验未通过可信执行验证", private_details: [...issues] }
}

export interface TrustedCodeLabVerifierOptions {
  /** Limits concurrent isolated mutation executions; reference and starter stay sequential. */
  mutation_concurrency?: number
}

/** Independent trust-plane verifier; it never accepts execution claims from the Provider. */
export class TrustedCodeLabVerifier implements CodeLabDraftVerifier {
  private readonly mutationConcurrency: number

  constructor(
    private readonly runner: CodeRunner,
    private readonly options: TrustedCodeLabVerifierOptions = {},
  ) {
    this.mutationConcurrency = boundedMutationConcurrency(
      options.mutation_concurrency,
    )
  }

  async verifyCodeLab(request: CodeLabRequest, draft: CodeLabDraft) {
    let report = validateCodeLabDraftStructure(request, draft)
    let deferredExpectedIssues = report.issues.filter((entry) =>
      isTrustedExpectedDerivationIssue(entry.code))
    let blockingStructureIssues = report.issues.filter((entry) =>
      !isTrustedExpectedDerivationIssue(entry.code))
    const issues = blockingStructureIssues.map((entry) => `${entry.path}: ${entry.message}`)
    const expectedDigest = request.generation_spec.versions.runner_image_digest
    if (!expectedDigest) issues.push("GenerationSpec 缺少 runner_image_digest")
    if (expectedDigest && expectedDigest !== this.runner.runner_image_digest) {
      issues.push("GenerationSpec.runner_image_digest 与 CodeRunner 不一致")
    }
    if (blockingStructureIssues.length > 0 || issues.length > 0) return result(false, issues, this.runner.runner_image_digest, 0, 0, report.objective_coverage)

    let materializedDraft: CodeLabDraft | undefined
    if (draft.secure_draft.payload.hidden_tests.some((test) => isPendingTrustedExpected(test.expected))) {
      const pendingSuite: RunnerTestSuite = {
        test_suite_id: draft.secure_draft.payload.test_suite_id,
        execution_contract: draft.public_draft.payload.execution_contract,
        tests: draft.secure_draft.payload.hidden_tests,
      }
      const oracle = await executeTrustedReferenceWithRetry(this.runner, {
        language: "python",
        code: draft.secure_draft.payload.reference_solution,
        test_suite_id: pendingSuite.test_suite_id,
        test_suite: pendingSuite,
        timeout_ms: draft.public_draft.payload.execution_contract.resource_limits.timeout_ms,
        memory_mb: draft.public_draft.payload.execution_contract.resource_limits.memory_mb,
        max_output_bytes: draft.public_draft.payload.execution_contract.resource_limits.max_output_bytes,
        network_allowed: false,
        derive_expected: true,
      }, request.generation_spec.policies.max_tool_retry)
      if (oracle.status !== "passed" || oracle.derived_outputs?.length !== pendingSuite.tests.length) {
        return {
          ...result(false, [
            `可信参考解无法物化 expected：${oracle.failure_codes.join("、") || oracle.status}`,
          ], this.runner.runner_image_digest, 0, 0, report.objective_coverage),
          reference_failed: true,
          reference_failure_codes: [...oracle.failure_codes],
        }
      }
      if (draft.secure_draft.payload.secondary_reference_solution) {
        const secondary = await executeTrustedReferenceWithRetry(this.runner, {
          language: "python",
          code: draft.secure_draft.payload.secondary_reference_solution,
          test_suite_id: pendingSuite.test_suite_id,
          test_suite: pendingSuite,
          timeout_ms: draft.public_draft.payload.execution_contract.resource_limits.timeout_ms,
          memory_mb: draft.public_draft.payload.execution_contract.resource_limits.memory_mb,
          max_output_bytes: draft.public_draft.payload.execution_contract.resource_limits.max_output_bytes,
          network_allowed: false,
          derive_expected: true,
        }, request.generation_spec.policies.max_tool_retry)
        if (secondary.status !== "passed"
          || !outputsEquivalent(
            oracle.derived_outputs,
            secondary.derived_outputs,
            classifyOutputContract(draft.public_draft.payload.execution_contract.output_contract),
          )) {
          return result(false, ["secondary oracle 与主参考解输出不一致"], this.runner.runner_image_digest, 0, 0, report.objective_coverage)
        }
      }
      materializedDraft = structuredClone(draft)
      materializedDraft.secure_draft.payload.hidden_tests.forEach((test, index) => {
        test.expected = structuredClone(oracle.derived_outputs![index])
      })
      draft = materializedDraft
      report = validateCodeLabDraftStructure(request, draft)
      deferredExpectedIssues = report.issues.filter((entry) => isTrustedExpectedDerivationIssue(entry.code))
      blockingStructureIssues = report.issues.filter((entry) => !isTrustedExpectedDerivationIssue(entry.code))
      if (report.issues.length > 0) {
        return result(false, report.issues.map((entry) => `${entry.path}: ${entry.message}`), this.runner.runner_image_digest, 0, 0, report.objective_coverage)
      }
    }

    let publicPayload = draft.public_draft.payload
    let securePayload = draft.secure_draft.payload
    if (publicPayload.programming_task) {
      const publicProbe = await executePublicLabInputs(
        this.runner,
        publicPayload,
        securePayload.reference_solution,
        request.generation_spec.policies.max_tool_retry,
      )
      if (publicProbe.status !== "passed") return {
        ...result(false, [`PUBLIC_REFERENCE_INPUT_FAILED:${publicProbe.failure_codes.join("、") || publicProbe.status}`], this.runner.runner_image_digest, 0, 0, report.objective_coverage),
        ...(materializedDraft ? { materialized_draft: materializedDraft } : {}),
      }
      if (publicProbe.derived_outputs?.length !== publicLabInputCases(publicPayload).length) return {
        ...result(false, ["PUBLIC_REFERENCE_OUTPUT_DERIVATION_FAILED"], this.runner.runner_image_digest, 0, 0, report.objective_coverage),
        ...(materializedDraft ? { materialized_draft: materializedDraft } : {}),
      }
      const trustedPublic = materializeTrustedPublicExpectations(
        publicPayload,
        publicProbe.derived_outputs,
      )
      if (JSON.stringify(trustedPublic) !== JSON.stringify(publicPayload)) {
        materializedDraft = structuredClone(draft)
        materializedDraft.public_draft.payload = trustedPublic
        draft = materializedDraft
        report = validateCodeLabDraftStructure(request, draft)
        if (!report.ok) return {
          ...result(false, report.issues.map((entry) => `${entry.path}: ${entry.message}`), this.runner.runner_image_digest, 0, 0, report.objective_coverage),
          materialized_draft: materializedDraft,
        }
        publicPayload = draft.public_draft.payload
        securePayload = draft.secure_draft.payload
      }
    }
    const suite: RunnerTestSuite = {
      test_suite_id: securePayload.test_suite_id,
      execution_contract: publicPayload.execution_contract,
      tests: securePayload.hidden_tests,
    }
    const execute = (
      code: string,
      targetSuite: RunnerTestSuite = suite,
    ) => executeWithRunnerRetry(this.runner, {
      language: "python",
      code,
      test_suite_id: targetSuite.test_suite_id,
      test_suite: targetSuite,
      timeout_ms: publicPayload.execution_contract.resource_limits.timeout_ms,
      memory_mb: publicPayload.execution_contract.resource_limits.memory_mb,
      max_output_bytes: publicPayload.execution_contract.resource_limits.max_output_bytes,
      network_allowed: false,
    }, request.generation_spec.policies.max_tool_retry)

    const reference = await executeTrustedReferenceWithRetry(this.runner, {
      language: "python",
      code: securePayload.reference_solution,
      test_suite_id: suite.test_suite_id,
      test_suite: suite,
      timeout_ms: publicPayload.execution_contract.resource_limits.timeout_ms,
      memory_mb: publicPayload.execution_contract.resource_limits.memory_mb,
      max_output_bytes: publicPayload.execution_contract.resource_limits.max_output_bytes,
      network_allowed: false,
    }, request.generation_spec.policies.max_tool_retry)
    const referenceFailed = reference.status !== "passed"
      || reference.passed_tests !== reference.total_tests
    if (referenceFailed) {
      issues.push(`reference_solution 未通过全部隐藏测试：${reference.failure_codes.join("、")}`)
    }
    issues.push(...deferredExpectedIssues.map((entry) => `${entry.path}: ${entry.message}`))
    if (reference.runner_image_digest !== this.runner.runner_image_digest) {
      issues.push("执行结果 runner_image_digest 不一致")
    }
    const starter = await execute(publicPayload.starter_code)
    if (starter.status === "runner_error" || starter.status === "timeout") {
      issues.push(`starter code 未能稳定执行：${starter.status}`)
    } else if (starter.status === "passed") {
      issues.push("starter code 已直接通过全部隐藏测试")
    }

    let killed = 0
    const failedMutations: Array<{
      mutation_id: string
      status: "passed" | "failed" | "timeout" | "runner_error"
      failure_codes: string[]
      must_fail_test_ids: string[]
    }> = []
    const hiddenTestsById = new Map(
      securePayload.hidden_tests.map((test) => [test.test_id, test]),
    )
    const targetIds = new Set(
      request.generation_spec.targets.map((target) => target.objective_id),
    )
    const runnableMutations = securePayload.mutation_variants.filter((mutation) => {
      const validObjectives = mutation.objective_ids.length > 0
        && mutation.objective_ids.every((objectiveId) => targetIds.has(objectiveId))
      const validTests = mutation.must_fail_test_ids.length > 0
        && mutation.must_fail_test_ids.every((testId) => {
          const test = hiddenTestsById.get(testId)
          return Boolean(test && mutation.objective_ids.includes(test.objective_id))
        })
      if (validObjectives && validTests) return true
      failedMutations.push({
        mutation_id: mutation.mutation_id,
        status: "runner_error",
        failure_codes: ["invalid_optional_mutation_diagnostic"],
        must_fail_test_ids: [...mutation.must_fail_test_ids],
      })
      return false
    })
    const mutationExecutions = await mapInOrderWithConcurrency(
      runnableMutations,
      this.mutationConcurrency,
      async (mutation) => {
        const mutationSuite: RunnerTestSuite = {
          test_suite_id: suite.test_suite_id,
          execution_contract: suite.execution_contract,
          // Structural validation above guarantees every declared ID exists.
          tests: mutation.must_fail_test_ids.map((testId) =>
            hiddenTestsById.get(testId)!),
        }
        return {
          mutation,
          execution: await execute(mutation.code, mutationSuite),
        }
      },
    )
    for (const { mutation, execution } of mutationExecutions) {
      if (execution.status === "runner_error") {
        failedMutations.push({
          mutation_id: mutation.mutation_id,
          status: execution.status,
          failure_codes: [...execution.failure_codes],
          must_fail_test_ids: [...mutation.must_fail_test_ids],
        })
        continue
      }
      const killedRequired = mutation.must_fail_test_ids.every((testId) =>
        execution.failure_codes.some((code) => code === "execution_timeout" || code.startsWith(`${testId}:`)),
      )
      if (execution.status !== "passed" && killedRequired) killed += 1
      else {
        failedMutations.push({
          mutation_id: mutation.mutation_id,
          status: execution.status,
          failure_codes: [...execution.failure_codes],
          must_fail_test_ids: [...mutation.must_fail_test_ids],
        })
      }
    }
    const mutationKillRate = securePayload.mutation_variants.length === 0
      ? undefined
      : killed / securePayload.mutation_variants.length
    const verified = result(
      issues.length === 0,
      issues,
      this.runner.runner_image_digest,
      mutationKillRate,
      reference.total_tests,
      report.objective_coverage,
      {
        reference_failed: referenceFailed,
        reference_failure_codes: [...reference.failure_codes],
        starter_status: starter.status,
        failed_mutations: failedMutations,
      },
    )
    return materializedDraft ? { ...verified, materialized_draft: materializedDraft } : verified
  }
}

function isPendingTrustedExpected(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && (value as Record<string, unknown>).__trusted_expected_pending__ === true)
}

function outputsEquivalent(
  left: unknown[] | undefined,
  right: unknown[] | undefined,
  outputKind: ReturnType<typeof classifyOutputContract>,
): boolean {
  if (!left || !right || left.length !== right.length) return false
  return left.every((entry, index) => {
    const candidate = right[index]
    if (outputKind === "number" && typeof entry === "number" && typeof candidate === "number") {
      const absolute = Math.abs(entry - candidate)
      const scale = Math.max(1, Math.abs(entry), Math.abs(candidate))
      return absolute <= 1e-9 || absolute / scale <= 1e-9
    }
    return JSON.stringify(entry) === JSON.stringify(candidate)
  })
}

export function isTrustedExpectedDerivationIssue(code: string): boolean {
  return code === "invalid_expected_type" || code === "invalid_test_comparison"
}

const DEFAULT_MUTATION_CONCURRENCY = 2
const MAX_MUTATION_CONCURRENCY = 4

function boundedMutationConcurrency(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MUTATION_CONCURRENCY
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_MUTATION_CONCURRENCY) {
    throw new RangeError(
      `mutation_concurrency 必须为 1..${MAX_MUTATION_CONCURRENCY} 的整数`,
    )
  }
  return value
}

/** Runs concurrently while retaining input order for all later diagnostics. */
async function mapInOrderWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const output = new Array<R>(values.length)
  let cursor = 0
  const workerCount = Math.min(concurrency, values.length)
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = cursor
      cursor += 1
      if (index >= values.length) return
      output[index] = await mapper(values[index]!, index)
    }
  }))
  return output
}

function staticIssues(publicPayload: CodeLabPublicPayload, securePayload: CodeLabSecurePayload): ValidationIssue[] {
  const sources = [
    ["$.public_draft.payload.starter_code", publicPayload.starter_code],
    ["$.secure_draft.payload.reference_solution", securePayload.reference_solution],
  ] as const
  return sources.flatMap(([path, source]) => analyzePythonSource(source, publicPayload.execution_contract)
    .map((entry) => issue(`static_${entry.code}`, path, entry.message)))
}

function validateClaimGrounding(
  claims: Array<{ claim_id: string; text: string; citations: CitationRef[] }>,
  request: CodeLabRequest,
): ValidationIssue[] {
  const facts = new Map(request.evidence_pack.results.flatMap((entry) =>
    entry.facts.map((fact) => [`${fact.source_id}:${fact.fact_id}`, fact.content] as const),
  ))
  return claims.flatMap((claim) => {
    const grounded = claim.citations.some((citation) =>
      claimTextMatchesFact(claim.text, facts.get(`${citation.source_id}:${citation.fact_id}`) ?? ""),
    )
    return grounded ? [] : [issue("ungrounded_claim", `$.claim.${claim.claim_id}`, "Claim.text 未通过有限规则归一化的事实对应校验")]
  })
}

export function validateExecutionContractResultSemantics(
  contract: CodeLabPublicPayload["execution_contract"],
): string[] {
  if (contract.execution_mode !== "function") return []
  const text = [contract.output_contract.type, ...(contract.output_contract.constraints ?? [])]
    .join(" ").normalize("NFKC").toLocaleLowerCase()
  return /(?:标准输出|打印|输出到屏幕|stdout|\bprint\b)/u.test(text)
    ? ["function 模式只校验入口函数返回值；纯打印任务必须使用 stdin_stdout，或把 output_contract 改为真实返回值类型"]
    : []
}

export function validateHiddenTestExpectedAgainstOutputContract(
  outputContract: CodeLabPublicPayload["execution_contract"]["output_contract"],
  expected: unknown,
): string[] {
  const required = classifyOutputContract(outputContract)
  const actual = classifyExpectedValue(expected)
  if (required === "unknown") return ["未知 output_contract 类型，拒绝验证 expected"]
  if (required === actual) return []
  const messages = {
    string: "stdout text 只允许字符串 expected",
    number: "数值输出合同只允许有限数值 expected",
    array: "列表输出合同只允许数组 expected",
    object: "对象输出合同只允许对象 expected",
    boolean: "布尔输出合同只允许布尔 expected",
  } as const
  return [messages[required]]
}

export function buildInvalidExpectedTypeIssue(
  outputContract: CodeLabPublicPayload["execution_contract"]["output_contract"],
  expected: unknown,
  authorIndex: number,
  objectiveId: string,
  message: string,
): ValidationIssue {
  return issue(
    "invalid_expected_type",
    `$.hidden_tests[${authorIndex}].expected`,
    `author_index=${authorIndex}; objective_id=${objectiveId}; required_kind=${classifyOutputContract(outputContract)}; actual_kind=${classifyExpectedValue(expected)}; ${message}`,
  )
}

export function validateHiddenTestComparisonCompatibility(
  comparison: CodeLabSecurePayload["hidden_tests"][number]["comparison"],
  expected: unknown,
  outputContract?: CodeLabPublicPayload["execution_contract"]["output_contract"],
): string[] {
  const required = outputContract ? classifyOutputContract(outputContract) : classifyExpectedValue(expected)
  if (required === "unknown") return ["未知 output_contract 类型，无法选择 comparison"]
  if (required === "number") {
    return comparison.kind === "numeric" && classifyExpectedValue(expected) === "number"
      ? []
      : ["数值输出合同必须使用 numeric 且 expected 为有限数值"]
  }
  return comparison.kind === "exact"
    ? []
    : ["numeric 比较只允许有限数值 expected；对象、数组、字符串或布尔结果必须使用 exact"]
}

function uniqueMap<T extends Record<K, string>, K extends keyof T>(
  entries: T[],
  key: K,
  path: string,
  issues: ValidationIssue[],
): Map<string, T> {
  const map = new Map<string, T>()
  entries.forEach((entry, index) => {
    const id = entry[key]
    if (map.has(id)) issues.push(issue("duplicate_id", `${path}[${index}]`, `ID 重复：${id}`))
    map.set(id, entry)
  })
  return map
}

function result(
  executionVerified: boolean,
  issues: string[],
  runnerImageDigest: string,
  mutationKillRate: number | undefined,
  verifiedTestCount: number,
  objectiveCoverage: number,
  diagnostics?: {
    reference_failed: boolean
    reference_failure_codes: string[]
    starter_status: "passed" | "failed" | "timeout" | "runner_error"
    failed_mutations: Array<{
      mutation_id: string
      status: "passed" | "failed" | "timeout" | "runner_error"
      failure_codes: string[]
      must_fail_test_ids: string[]
    }>
  },
) {
  return {
    execution_verified: executionVerified,
    issues,
    runner_image_digest: runnerImageDigest,
    mutation_kill_rate: mutationKillRate,
    verified_test_count: verifiedTestCount,
    objective_coverage: objectiveCoverage,
    ...(diagnostics ?? {}),
  }
}

function approximatelyOne(value: number): boolean {
  return Math.abs(value - 1) <= 1e-9
}

function citationKey(entry: CitationRef): string {
  return `${entry.source_id}:${entry.fact_id}:${entry.relation}`
}

function deduplicate(citations: CitationRef[]): CitationRef[] {
  return [...new Map(citations.map((entry) => [citationKey(entry), entry])).values()]
}

function issue(code: string, path: string, message: string): ValidationIssue {
  return { code, path, message, severity: "critical" }
}
