import type {
  AnswerSpec,
  AssessmentCodeTestSuite,
  AssessmentItemSecure,
  AssessmentPublicArtifact,
  AssessmentSecureArtifact,
  GradeItemResult,
  HiddenTest,
  RubricCriterion,
  RubricCriterionResult,
  SessionState,
  SubmissionAnswer,
  SubmissionEnvelope,
} from "../contracts/artifacts"
import { executeWithRunnerRetry, type CodeRunner } from "../security/code-runner"
import { validateRoleCSchema } from "../validators/runtime-schema-validator"

export interface SubmissionGrade {
  status: "graded" | "needs_review" | "blocked"
  submission_id: string
  form_id: string
  raw_score: number
  max_score: number
  evidence_score: number
  item_results: GradeItemResult[]
  unresolved_item_ids: string[]
  blocked_reason?: string
  validation_issues?: string[]
  /** True only when public policy and trusted session identity/hint state were both checked. */
  boundary_verified: boolean
}

/** The judge sees only the response and rubric, never profile, path, expected total, or prior grade. */
export interface BlindRubricJudgeRequest {
  response: string
  criteria: RubricCriterion[]
  contradictions: string[]
}

export interface BlindRubricJudgeResult {
  criteria: Array<{
    criterion_id: string
    status: "met" | "unmet" | "uncertain"
    confidence: number
    evidence_excerpt?: string
  }>
}

export interface BlindRubricJudge {
  readonly grader_version: string
  judge(request: BlindRubricJudgeRequest): Promise<BlindRubricJudgeResult>
}

export interface GradingOptions {
  code_runner?: CodeRunner
  rubric_judge?: BlindRubricJudge
  public_artifact?: AssessmentPublicArtifact
  session_state?: SessionState
  /** Number of earlier exposures to the same family or item, supplied by the trusted session service. */
  repeat_exposure_by_item?: Record<string, number>
  minimum_rubric_confidence?: number
  max_tool_retries?: number
  expected_path_node_id?: string
  assessment_secure_ref?: string
  /**
   * Trusted pre-session routing may grade exactly the public anchor set before
   * a scored route has been frozen into a formal learning session.
   */
  allow_anchor_only?: boolean
}

/**
 * Offline, deterministic rubric baseline. Production may replace it with a model-backed
 * blind judge, while score aggregation remains in this trusted program.
 */
export class EvidencePhraseRubricJudge implements BlindRubricJudge {
  readonly grader_version = "evidence-phrase-rubric-1.0.0"

  async judge(request: BlindRubricJudgeRequest): Promise<BlindRubricJudgeResult> {
    const response = normalizeComparable(request.response)
    const hasContradiction = request.contradictions.some((phrase) => response.includes(normalizeComparable(phrase)))
    return {
      criteria: request.criteria.map((criterion) => {
        const matched = criterion.required_evidence.filter((phrase) => response.includes(normalizeComparable(phrase)))
        const ratio = criterion.required_evidence.length === 0 ? 0 : matched.length / criterion.required_evidence.length
        // 确定性短语判定：部分匹配按"未满足"评分（0 分 + 教学反馈），
        // 而不是 needs_review——主链路没有人工复核通道，uncertain 只留给模型 judge。
        const status = hasContradiction || ratio < 1 ? "unmet" : "met"
        return {
          criterion_id: criterion.criterion_id,
          status,
          confidence: hasContradiction ? 0.9 : ratio === 0 || ratio === 1 ? 0.85 : 0.7,
          evidence_excerpt: matched.length > 0 ? request.response.slice(0, 160) : undefined,
        }
      }),
    }
  }
}

export async function gradeSubmission(
  submission: SubmissionEnvelope,
  secureArtifact: AssessmentSecureArtifact,
  optionsOrRunner: GradingOptions | CodeRunner = {},
): Promise<SubmissionGrade> {
  const options = isCodeRunner(optionsOrRunner) ? { code_runner: optionsOrRunner } : optionsOrRunner
  const boundaryIssues = validateSubmissionBoundary(submission, secureArtifact, options)
  if (boundaryIssues.length > 0) return blockedGrade(submission, "提交未通过可信边界校验", boundaryIssues)

  const securePayload = secureArtifact.payload!
  const answers = new Map(submission.answers.map((answer) => [answer.item_id, answer]))
  const requiredItemIdSet = new Set(options.session_state?.required_item_ids
    ?? securePayload.items.map((item) => item.item_id))
  const requiredItems = securePayload.items.filter((item) => requiredItemIdSet.has(item.item_id))
  const codeSuites = new Map(securePayload.code_test_suites.map((suite) => [suite.test_suite_id, suite]))
  const results: GradeItemResult[] = []
  const unresolved: string[] = []
  const blocked: string[] = []

  for (const item of requiredItems) {
    const answer = answers.get(item.item_id)
    const decision = await gradeOne(answer, item, options, codeSuites)
    if (decision.status !== "graded") unresolved.push(item.item_id)
    if (decision.status === "blocked") blocked.push(item.item_id)
    const hintFactor = hintEvidenceFactor(answer?.hint_level_used ?? 0)
    const repeatFactor = repeatEvidenceFactor(options.repeat_exposure_by_item?.[item.item_id] ?? 0)
    const rawRatio = item.max_score === 0 ? 0 : decision.score / item.max_score
    results.push({
      item_id: item.item_id,
      objective_id: item.objective_id,
      raw_score: roundScore(decision.score),
      max_score: item.max_score,
      evidence_score: roundScore(clamp01(rawRatio * item.evidence_weight * decision.confidence * hintFactor * repeatFactor)),
      grader_confidence: decision.confidence,
      hint_factor: hintFactor,
      repeat_factor: repeatFactor,
      misconception_tags: deriveMisconceptions(answer, item, decision),
      feedback_code: decision.feedback_code,
      rubric_results: decision.rubric_results,
    })
  }

  const maxScore = requiredItems.reduce((sum, item) => sum + item.max_score, 0)
  return {
    status: blocked.length > 0 ? "blocked" : unresolved.length === 0 ? "graded" : "needs_review",
    submission_id: submission.submission_id,
    form_id: submission.form_id,
    raw_score: roundScore(results.reduce((sum, result) => sum + result.raw_score, 0)),
    max_score: maxScore,
    evidence_score: roundScore(results.length === 0 ? 0 : results.reduce((sum, result) => sum + result.evidence_score, 0) / results.length),
    item_results: results,
    unresolved_item_ids: unresolved,
    blocked_reason: blocked.length > 0 ? `以下题目缺少可信评分能力：${blocked.join("、")}` : undefined,
    boundary_verified: Boolean(
      options.public_artifact && options.session_state
      && options.expected_path_node_id && options.assessment_secure_ref,
    ),
  }
}

interface GradeDecision {
  status: "graded" | "needs_review" | "blocked"
  score: number
  confidence: number
  feedback_code: string
  failure_codes?: string[]
  rubric_results?: RubricCriterionResult[]
}

async function gradeOne(
  answer: SubmissionAnswer | undefined,
  item: AssessmentItemSecure,
  options: GradingOptions,
  codeSuites: Map<string, AssessmentCodeTestSuite>,
): Promise<GradeDecision> {
  const spec = item.answer_spec
  if (!answer) return { status: "graded", score: 0, confidence: 1, feedback_code: "unanswered" }

  if (spec.kind === "exact_set") {
    const raw = answer.selected_option_id ?? answer.text_response ?? ""
    const normalized = normalizeText(raw, spec.normalization)
    const accepted = spec.accepted.map((value) => normalizeText(value, spec.normalization))
    const correct = accepted.includes(normalized)
    return { status: "graded", score: correct ? item.max_score : 0, confidence: 1, feedback_code: correct ? "correct" : "incorrect" }
  }

  if (spec.kind === "numeric") {
    const parsed = parseNumericResponse(answer.text_response ?? "", spec.unit)
    if (!parsed.ok) return { status: "graded", score: 0, confidence: 1, feedback_code: parsed.feedback_code }
    const tolerance = Math.max(spec.abs_tolerance, Math.abs(spec.target) * spec.rel_tolerance)
    const correct = Math.abs(parsed.value - spec.target) <= tolerance
    return { status: "graded", score: correct ? item.max_score : 0, confidence: 1, feedback_code: correct ? "correct" : "outside_tolerance" }
  }

  if (spec.kind === "code") {
    if (!options.code_runner) return { status: "blocked", score: 0, confidence: 0, feedback_code: "code_runner_unavailable" }
    if (!answer.code_response?.trim()) return { status: "graded", score: 0, confidence: 1, feedback_code: "unanswered" }
    const suite = codeSuites.get(spec.test_suite_id)
    if (!suite) return { status: "blocked", score: 0, confidence: 0, feedback_code: "code_test_suite_unavailable" }
    const result = await executeWithRunnerRetry(options.code_runner, {
      language: "python",
      code: answer.code_response,
      test_suite_id: spec.test_suite_id,
      test_suite: {
        test_suite_id: suite.test_suite_id,
        execution_contract: suite.execution_contract,
        tests: suite.hidden_tests,
      },
      timeout_ms: suite.execution_contract.resource_limits.timeout_ms,
      memory_mb: suite.execution_contract.resource_limits.memory_mb,
      max_output_bytes: suite.execution_contract.resource_limits.max_output_bytes,
      network_allowed: false,
    }, options.max_tool_retries ?? 2)
    if (!validCodeExecutionResult(result, suite.hidden_tests) || result.runner_image_digest !== options.code_runner.runner_image_digest) {
      return { status: "blocked", score: 0, confidence: 0, feedback_code: "invalid_code_runner_result" }
    }
    return {
      status: result.status === "runner_error" ? "blocked" : "graded",
      score: item.max_score * result.score_ratio,
      confidence: result.status === "runner_error" ? 0 : 1,
      feedback_code: result.status,
      failure_codes: result.failure_codes,
    }
  }

  return gradeRubric(answer.text_response ?? "", spec, item.max_score, options)
}

async function gradeRubric(
  response: string,
  spec: Extract<AnswerSpec, { kind: "concept_rubric" }>,
  maxScore: number,
  options: GradingOptions,
): Promise<GradeDecision> {
  if (!response.trim()) return { status: "graded", score: 0, confidence: 1, feedback_code: "unanswered" }
  if (!options.rubric_judge) {
    return { status: "needs_review", score: 0, confidence: 0, feedback_code: "rubric_judge_unavailable" }
  }
  let judged: BlindRubricJudgeResult
  try {
    judged = await options.rubric_judge.judge({ response, criteria: structuredClone(spec.criteria), contradictions: [...spec.contradictions] })
  } catch {
    return { status: "blocked", score: 0, confidence: 0, feedback_code: "rubric_judge_error" }
  }
  const expected = new Map(spec.criteria.map((criterion) => [criterion.criterion_id, criterion]))
  const publicCriterionIds = new Map(
    spec.criteria.map((criterion, index) => [
      criterion.criterion_id,
      `criterion_${index + 1}`,
    ]),
  )
  const seen = new Set<string>()
  const rubricResults: RubricCriterionResult[] = []
  let weightedConfidence = 0
  for (const result of judged.criteria) {
    const criterion = expected.get(result.criterion_id)
    if (!criterion || seen.has(result.criterion_id) || !validJudgeResult(result)
      || (result.status === "met" && (!result.evidence_excerpt || !response.includes(result.evidence_excerpt)))) {
      return { status: "blocked", score: 0, confidence: 0, feedback_code: "invalid_rubric_judgment" }
    }
    seen.add(result.criterion_id)
    weightedConfidence += result.confidence * criterion.weight
    rubricResults.push({
      criterion_id: publicCriterionIds.get(result.criterion_id)!,
      status: result.status,
      awarded_score: result.status === "met" ? roundScore(maxScore * criterion.weight) : 0,
      confidence: result.confidence,
      evidence_excerpt: result.evidence_excerpt?.slice(0, 160),
    })
  }
  if (seen.size !== expected.size) return { status: "blocked", score: 0, confidence: 0, feedback_code: "incomplete_rubric_judgment" }
  const confidence = roundScore(weightedConfidence)
  const uncertain = rubricResults.some((result) => result.status === "uncertain")
  const lowConfidence = confidence < (options.minimum_rubric_confidence ?? 0.65)
  return {
    status: uncertain || lowConfidence ? "needs_review" : "graded",
    score: roundScore(rubricResults.reduce((sum, result) => sum + result.awarded_score, 0)),
    confidence,
    feedback_code: uncertain ? "rubric_uncertain" : lowConfidence ? "rubric_low_confidence" : "rubric_graded",
    rubric_results: rubricResults,
  }
}

function validateSubmissionBoundary(
  submission: SubmissionEnvelope,
  secureArtifact: AssessmentSecureArtifact,
  options: GradingOptions,
): string[] {
  const issues = validateRoleCSchema("submission.schema.json", submission).issues.map((entry) => `${entry.path}: ${entry.message}`)
  issues.push(...validateRoleCSchema("assessment_secure.schema.json", secureArtifact).issues.map((entry) => `${entry.path}: ${entry.message}`))
  if (secureArtifact.status !== "ready" || !secureArtifact.payload) issues.push("assessment_secure 未就绪")
  if (!secureArtifact.quality.answer_key_verified) issues.push("assessment_secure 未标记 answer_key_verified")
  if (submission.run_id !== secureArtifact.run_id) issues.push("submission.run_id 与 assessment_secure.run_id 不一致")
  if (submission.form_id !== secureArtifact.payload?.form_id) issues.push("submission.form_id 与 assessment_secure.form_id 不一致")
  const ids = submission.answers.map((answer) => answer.item_id)
  if (new Set(ids).size !== ids.length) issues.push("submission.answers 存在重复 item_id")
  const items = new Map(secureArtifact.payload?.items.map((item) => [item.item_id, item]) ?? [])
  const requiredItemIds = options.session_state?.required_item_ids ?? [...items.keys()]
  const requiredItemSet = new Set(requiredItemIds)
  const answerIdSet = new Set(ids)
  for (const itemId of requiredItemIds) {
    if (!items.has(itemId)) issues.push(`session_state.required_item_ids 包含未知 item_id：${itemId}`)
    if (!answerIdSet.has(itemId)) issues.push(`submission.answers 缺少本次路由要求的 item_id：${itemId}`)
  }
  for (const itemId of answerIdSet) {
    if (!requiredItemSet.has(itemId)) issues.push(`submission.answers 包含本次路由未要求的 item_id：${itemId}`)
  }
  for (const answer of submission.answers) {
    const item = items.get(answer.item_id)
    if (!item) {
      issues.push(`submission.answers 包含未知 item_id：${answer.item_id}`)
      continue
    }
    const responseFields = [answer.selected_option_id, answer.text_response, answer.code_response].filter((value) => value !== undefined)
    if (responseFields.length !== 1) issues.push(`${answer.item_id} 必须且只能提交一种 response 字段`)
    if ((item.modality === "mcq" || item.modality === "true_false") && answer.selected_option_id === undefined) {
      issues.push(`${answer.item_id} 必须提交 selected_option_id`)
    }
    if ((item.modality === "trace" || item.modality === "short_answer") && answer.text_response === undefined) {
      issues.push(`${answer.item_id} 必须提交 text_response`)
    }
    if (item.modality === "code" && answer.code_response === undefined) issues.push(`${answer.item_id} 必须提交 code_response`)
  }
  const publicPayload = options.public_artifact?.payload
  if (options.public_artifact) {
    issues.push(...validateRoleCSchema("assessment_public.schema.json", options.public_artifact).issues.map((entry) => `${entry.path}: ${entry.message}`))
    if (options.public_artifact.status !== "ready" || !publicPayload) issues.push("assessment_public 未就绪")
    if (options.public_artifact.run_id !== submission.run_id) issues.push("assessment_public.run_id 与 submission.run_id 不一致")
    if (publicPayload?.form_id !== submission.form_id) issues.push("assessment_public.form_id 与 submission.form_id 不一致")
    if (options.public_artifact.seed !== secureArtifact.seed) issues.push("assessment public/secure seed 不一致")
    if (options.public_artifact.versions.prompt_version !== secureArtifact.versions.prompt_version
      || options.public_artifact.versions.model_config_hash !== secureArtifact.versions.model_config_hash
      || options.public_artifact.versions.schema_version !== secureArtifact.versions.schema_version) {
      issues.push("assessment public/secure 关键版本不一致")
    }
    if (options.public_artifact.quality.answer_key_verified !== true) issues.push("assessment_public 未标记 answer_key_verified")
    const publicItems = new Map(publicPayload?.items.map((item) => [item.item_id, item]) ?? [])
    if (publicItems.size !== items.size) issues.push("assessment public/secure 题目数量不一致")
    for (const secureItem of items.values()) {
      const publicItem = publicItems.get(secureItem.item_id)
      if (!publicItem || publicItem.objective_id !== secureItem.objective_id
        || publicItem.modality !== secureItem.modality || publicItem.max_score !== secureItem.max_score) {
        issues.push(`${secureItem.item_id} 的 assessment public/secure 合同不一致`)
      }
      if (secureItem.correct_option_id && !publicItem?.options?.some((option) => option.option_id === secureItem.correct_option_id)) {
        issues.push(`${secureItem.item_id} 的正确稳定 option_id 不存在于公开选项`)
      }
      if (secureItem.correct_option_id && secureItem.answer_spec.kind === "exact_set") {
        const exactSpec = secureItem.answer_spec
        const accepted = exactSpec.accepted.map((value) => normalizeText(value, exactSpec.normalization))
        if (!accepted.includes(normalizeText(secureItem.correct_option_id, exactSpec.normalization))) {
          issues.push(`${secureItem.item_id} 的 correct_option_id 与 exact_set.accepted 不一致`)
        }
      }
    }
    for (const answer of submission.answers) {
      if (!answer.selected_option_id) continue
      const optionIds = publicItems.get(answer.item_id)?.options?.map((option) => option.option_id) ?? []
      if (!optionIds.includes(answer.selected_option_id)) issues.push(`${answer.item_id} 提交了不存在的 option_id`)
    }
    if (submission.attempt_no > (publicPayload?.submission_policy.max_attempts ?? Number.MAX_SAFE_INTEGER)) {
      issues.push("submission.attempt_no 超过 submission_policy.max_attempts")
    }
  }
  if (options.session_state) {
    const session = options.session_state
    issues.push(...validateRoleCSchema("session_state.schema.json", session).issues.map((entry) => `${entry.path}: ${entry.message}`))
    if (session.run_id !== submission.run_id) issues.push("session_state.run_id 与 submission.run_id 不一致")
    if (session.learner_id_hash !== submission.learner_id_hash) issues.push("session_state.learner_id_hash 与 submission 不一致")
    if (session.current_form_id !== submission.form_id) issues.push("session_state.current_form_id 与 submission.form_id 不一致")
    if (session.attempt_no !== submission.attempt_no) issues.push("session_state.attempt_no 与 submission.attempt_no 不一致")
    if (new Set(session.required_item_ids).size !== session.required_item_ids.length) {
      issues.push("session_state.required_item_ids 不得重复")
    }
    if (options.expected_path_node_id && session.current_path_node_id !== options.expected_path_node_id) {
      issues.push("session_state.current_path_node_id 与预期路径节点不一致")
    }
    if (options.public_artifact && !session.public_artifact_refs.includes(options.public_artifact.artifact_id)) {
      issues.push("session_state 未引用当前 assessment_public")
    }
    if (publicPayload && !isAllowedRoutedItemSet(
      publicPayload,
      session.required_item_ids,
      options.allow_anchor_only ?? false,
    )) {
      issues.push("session_state.required_item_ids 不是 assessment 路由策略允许的题集")
    }
    if (options.assessment_secure_ref && !session.secure_artifact_refs.includes(options.assessment_secure_ref)) {
      issues.push("session_state 未持有当前 assessment_secure 的 opaque ref")
    }
    for (const answer of submission.answers) {
      const trustedHint = session.revealed_hint_levels[answer.item_id] ?? 0
      if (answer.hint_level_used !== trustedHint) issues.push(`${answer.item_id} 的 hint_level_used 与可信 session_state 不一致`)
    }
  }
  const expectedDigest = secureArtifact.versions.runner_image_digest
  if (options.code_runner && expectedDigest && options.code_runner.runner_image_digest !== expectedDigest) {
    issues.push("CodeRunner digest 与 assessment_secure 版本不一致")
  }
  return [...new Set(issues)]
}

function deriveMisconceptions(answer: SubmissionAnswer | undefined, item: AssessmentItemSecure, decision: GradeDecision): string[] {
  const tags = new Set<string>()
  if (answer?.selected_option_id) {
    const tag = item.misconception_by_option[answer.selected_option_id]
    if (tag) {
      tags.add("option_misconception")
    }
  }
  for (const code of publicCodeFailureCategories(decision.failure_codes ?? [])) {
    tags.add(`code:${code}`)
  }
  return [...tags]
}

/**
 * Runner failure strings may contain hidden test identifiers. Only stable,
 * learner-safe categories cross the grading boundary.
 */
function publicCodeFailureCategories(codes: string[]): string[] {
  const known = [
    "assertion_failed",
    "syntax_error",
    "execution_timeout",
    "resource_limit_exceeded",
    "output_limit",
    "forbidden_import",
    "unsupported_contract_import",
    "forbidden_builtin",
  ] as const
  const categories = codes.map((code) => {
    const normalized = code.normalize("NFKC").toLocaleLowerCase()
    return known.find((category) =>
      normalized === category
        || normalized.endsWith(`:${category}`)
        || normalized.includes(category))
      ?? "execution_failed"
  })
  return [...new Set(categories)]
}

function validJudgeResult(result: BlindRubricJudgeResult["criteria"][number]): boolean {
  return ["met", "unmet", "uncertain"].includes(result.status)
    && Number.isFinite(result.confidence) && result.confidence >= 0 && result.confidence <= 1
    && (result.evidence_excerpt === undefined || typeof result.evidence_excerpt === "string")
}

function validCodeExecutionResult(result: {
  status: string
  passed_tests: number
  total_tests: number
  score_ratio: number
  failure_codes: string[]
}, expectedTests: number | HiddenTest[]): boolean {
  const tests = Array.isArray(expectedTests) ? expectedTests : undefined
  const expectedCount = tests?.length ?? expectedTests
  const shapeOk = ["passed", "failed", "timeout", "runner_error"].includes(result.status)
    && Number.isSafeInteger(result.passed_tests) && Number.isSafeInteger(result.total_tests)
    && result.passed_tests >= 0 && result.total_tests === expectedCount && result.passed_tests <= result.total_tests
    && Number.isFinite(result.score_ratio) && result.score_ratio >= 0 && result.score_ratio <= 1
    && Array.isArray(result.failure_codes) && result.failure_codes.every((code) => typeof code === "string")
  if (!shapeOk) return false
  if (tests && !scoreRatioMatchesSomePassedSubset(result.score_ratio, result.passed_tests, tests)) return false
  if (result.passed_tests === 0 && result.score_ratio !== 0) return false
  if (result.passed_tests === result.total_tests && result.score_ratio !== 1) return false
  if (result.status === "passed") return result.passed_tests === expectedCount && result.score_ratio === 1 && result.failure_codes.length === 0
  if (result.status === "failed") return result.passed_tests < expectedCount && result.score_ratio < 1 && result.failure_codes.length > 0
  if (result.status === "timeout") return result.score_ratio === 0 && result.failure_codes.length > 0
  return false
}

function scoreRatioMatchesSomePassedSubset(
  ratio: number,
  passedCount: number,
  tests: HiddenTest[],
): boolean {
  const totalWeight = tests.reduce((sum, test) => sum + test.weight, 0)
  if (!(totalWeight > 0)) return ratio === 0
  let sums: number[][] = [[]]
  for (let selected = 0; selected < passedCount; selected += 1) {
    sums = sums.flatMap((indices) => tests.flatMap((test, index) =>
      indices.includes(index) ? [] : [[...indices, index]]))
  }
  return sums.some((indices) => {
    const passedWeight = indices.reduce((sum, index) => sum + tests[index]!.weight, 0)
    return Math.abs(passedWeight / totalWeight - ratio) <= 1e-9
  })
}

function parseNumericResponse(
  raw: string,
  expectedUnit: string | undefined,
): { ok: true; value: number } | { ok: false; feedback_code: "invalid_numeric" | "invalid_unit" } {
  const normalized = raw.normalize("NFKC").trim()
  let numericText = normalized
  if (expectedUnit !== undefined) {
    const unit = expectedUnit.normalize("NFKC").trim()
    if (!unit || !normalized.endsWith(unit)) return { ok: false, feedback_code: "invalid_unit" }
    numericText = normalized.slice(0, -unit.length).trim()
  }
  const value = Number(numericText)
  return Number.isFinite(value)
    ? { ok: true, value }
    : { ok: false, feedback_code: "invalid_numeric" }
}

function isAllowedRoutedItemSet(
  payload: AssessmentPublicArtifact["payload"] & {},
  requiredItemIds: string[],
  allowAnchorOnly: boolean,
): boolean {
  if (!payload) return false
  if (allowAnchorOnly
    && sameStringSet(payload.routing.anchor_item_ids, requiredItemIds)) {
    return true
  }
  const candidates = payload.routing.rules.map((rule) => payload.items
    .filter((item) => payload.routing.anchor_item_ids.includes(item.item_id) || rule.reveal_tiers.includes(item.tier))
    .map((item) => item.item_id))
  return candidates.some((candidate) => sameStringSet(candidate, requiredItemIds))
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  const leftSet = new Set(left)
  const rightSet = new Set(right)
  return leftSet.size === left.length && rightSet.size === right.length
    && leftSet.size === rightSet.size && [...leftSet].every((value) => rightSet.has(value))
}

function normalizeText(value: string, operations: Extract<AnswerSpec, { kind: "exact_set" }>["normalization"]): string {
  let output = value
  for (const operation of operations) {
    if (operation === "trim") output = output.trim()
    if (operation === "casefold") output = output.toLocaleLowerCase()
    if (operation === "unicode") output = output.normalize("NFKC")
    if (operation === "collapse_whitespace") output = output.replace(/\s+/g, " ")
  }
  return output
}

function normalizeComparable(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, "")
}

function hintEvidenceFactor(level: 0 | 1 | 2 | 3): number {
  return [1, 0.85, 0.65, 0.45][level]!
}

function repeatEvidenceFactor(previousExposures: number): number {
  if (!Number.isSafeInteger(previousExposures) || previousExposures <= 0) return 1
  return roundScore(Math.max(0.5, 1 / Math.sqrt(previousExposures + 1)))
}

function isCodeRunner(value: GradingOptions | CodeRunner): value is CodeRunner {
  return typeof (value as CodeRunner).execute === "function" && typeof (value as CodeRunner).runner_image_digest === "string"
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function roundScore(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

function blockedGrade(submission: SubmissionEnvelope, reason: string, issues?: string[]): SubmissionGrade {
  return {
    status: "blocked",
    submission_id: submission.submission_id,
    form_id: submission.form_id,
    raw_score: 0,
    max_score: 0,
    evidence_score: 0,
    item_results: [],
    unresolved_item_ids: [],
    blocked_reason: reason,
    validation_issues: issues,
    boundary_verified: false,
  }
}
