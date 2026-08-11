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
import { classifyExpectedValue, classifyOutputContract } from "../contracts/output-contract"

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
  for (const message of validateExecutionContractResultSemantics(publicPayload.execution_contract)) {
    issues.push(issue("invalid_execution_result_contract", "$.execution_contract.output_contract", message))
  }
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
  ])
  issues.push(...validateCitations(deduplicate([...contentCitations, ...publicPayload.used_evidence]), request.evidence_pack).issues)
  issues.push(...validateClaimGrounding(claims, request))
  for (const objectiveId of publicPayload.objective_ids) {
    if (!targetIds.has(objectiveId)) issues.push(issue("unknown_objective", "$.objective_ids", `实验包含 Spec 外目标 ${objectiveId}`))
  }
  for (const test of publicPayload.public_tests) {
    if (!targetIds.has(test.objective_id)) issues.push(issue("unknown_public_test_objective", `$.public_tests.${test.test_id}`, `公开测试包含 Spec 外 objective ${test.objective_id}`))
  }

  let coveredCore = 0
  for (const target of coreTargets) {
    const entry = coverage.get(target.objective_id)
    const citedFactIds = new Set(claims.flatMap((claim) =>
      claim.citations
        .filter((citation) => citation.source_id === target.source_id)
        .map((citation) => citation.fact_id)))
    const missingRequiredFacts = target.required_fact_ids.filter(
      (factId) => !citedFactIds.has(factId),
    )
    const hasRequiredFacts = missingRequiredFacts.length === 0
    const validCoverage = Boolean(entry
      && entry.instruction_block_ids.every((id) => blocks.has(id))
      && entry.public_test_ids.every((id) => tests.get(id)?.objective_id === target.objective_id))
    const ladder = ladders.get(target.objective_id)
    const levels = new Set(ladder?.hints.map((hint) => hint.hint_level) ?? [])
    if (!hasRequiredFacts) issues.push(issue("missing_required_fact", `$.objective.${target.objective_id}`, `核心目标必要事实未全部用于实验 Claim：${missingRequiredFacts.join("、")}`))
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
    const missingRequiredFacts = target.required_fact_ids.filter(
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
    if (!hasRequiredFacts) issues.push(issue("missing_required_fact", `$.objective.${target.objective_id}`, `核心目标必要事实未全部用于实验 Claim：${missingRequiredFacts.join("、")}`))
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
    const report = validateCodeLabDraftStructure(request, draft)
    const issues = report.issues.map((entry) => `${entry.path}: ${entry.message}`)
    const expectedDigest = request.generation_spec.versions.runner_image_digest
    if (!expectedDigest) issues.push("GenerationSpec 缺少 runner_image_digest")
    if (expectedDigest && expectedDigest !== this.runner.runner_image_digest) {
      issues.push("GenerationSpec.runner_image_digest 与 CodeRunner 不一致")
    }
    if (!report.ok || issues.length > 0) return result(false, issues, this.runner.runner_image_digest, 0, 0, report.objective_coverage)

    const publicPayload = draft.public_draft.payload
    const securePayload = draft.secure_draft.payload
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
    return result(
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
  }
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
