import type { ValidationIssue, ValidationReport } from "./citation-validator"
import type {
  AssessmentPublicPayload,
  AssessmentSecurePayload,
  CodeLabPublicPayload,
  CodeLabSecurePayload,
} from "../contracts/artifacts"

const FORBIDDEN_PUBLIC_KEYS = new Set([
  "answer",
  "answer_spec",
  "correct_answer",
  "correct_option_id",
  "hidden_test",
  "hidden_tests",
  "reference_solution",
  "solution",
  "scoring_groups",
  "misconception_by_option",
  "option_order_seed",
])

export function validatePublicArtifactNoSecrets(value: unknown): ValidationReport {
  const issues: ValidationIssue[] = []
  visit(value, "$", issues)
  return { ok: issues.length === 0, issues }
}

/** Checks value-level leaks that key-name scanning cannot detect. */
export function classifyPublicSecureLeak(input: {
  public_payload: CodeLabPublicPayload
  secure_payload: CodeLabSecurePayload
  execution_mode: CodeLabPublicPayload["execution_contract"]["execution_mode"]
}): ValidationIssue[] {
  const report = validateCodeLabPublicSecureSeparation(input.public_payload, input.secure_payload)
  return report.issues
}

export function validateCodeLabPublicSecureSeparation(
  publicPayload: CodeLabPublicPayload,
  securePayload: CodeLabSecurePayload,
): ValidationReport {
  const issues = [...validatePublicArtifactNoSecrets(publicPayload).issues]
  const publicText = JSON.stringify(publicPayload)
  const publicStrings = collectStrings(publicPayload)
  const publicLearnerStrings = codeLabLearnerStrings(publicPayload)
  const publicLearnerText = publicLearnerStrings.join("\n")
  const joinedPublicCode = normalizeCode(publicStrings.join("\n"))
  const normalizedStarter = normalizeCode(publicPayload.starter_code)
  const normalizedReference = normalizeCode(securePayload.reference_solution)

  if (normalizedReference && (
    publicStrings.some((value) =>
      normalizeCode(value).includes(normalizedReference))
    || joinedPublicCode.includes(normalizedReference)
    || containsReferenceDeltaLeak(
      publicStrings,
      securePayload.reference_solution,
      publicPayload.starter_code,
    )
  )) {
    issues.push(issue("reference_solution_leak", "$.public", "公开产物包含完整参考实现内容"))
  }
  if (normalizedStarter && normalizedStarter === normalizedReference) {
    issues.push(issue("starter_equals_reference", "$.starter_code", "starter code 与参考实现等价"))
  }
  if (publicText.includes(securePayload.test_suite_id)) {
    issues.push(issue("test_suite_id_leak", "$.public", "公开产物包含私有 test_suite_id"))
  }
  for (const test of securePayload.hidden_tests) {
    if (publicText.includes(test.test_id)) {
      issues.push(issue("hidden_test_id_leak", "$.public", `公开产物包含隐藏测试 ID ${test.test_id}`))
    }
    const hasPrivateCase = carriesPrivateTestCase(test.input)
    if (hasPrivateCase && publicPayload.public_tests.some(
      (publicTest) => sameJsonValue(publicTest.input, test.input),
    )) {
      issues.push(issue(
        "hidden_test_input_leak",
        "$.public",
        `公开产物包含隐藏测试 ${test.test_id} 的输入值`,
      ))
    }
    if (hasPrivateCase && containsExpectedSecret(
      publicLearnerStrings,
      publicLearnerText,
      test.expected,
    )) {
      const expectedStr = typeof test.expected === "string"
        ? test.expected.slice(0, 80)
        : JSON.stringify(test.expected).slice(0, 80)
      const leakedIn = findLeakLocation(publicLearnerStrings, publicLearnerText, test.expected)
      issues.push(issue(
        "hidden_test_expected_leak",
        "$.public",
        `隐藏测试 ${test.test_id} 的预期值 "…${expectedStr}" 泄漏${leakedIn ? "到：" + leakedIn : ""}。请修改公开文字中与此值重叠的部分，或更换隐藏测试的预期输出。`,
      ))
    }
  }
  for (const mutation of securePayload.mutation_variants) {
    const normalizedMutation = normalizeCode(mutation.code)
    if (normalizedMutation && publicStrings.some((value) => normalizeCode(value).includes(normalizedMutation))) {
      issues.push(issue("mutation_code_leak", "$.public", `公开产物包含错误变体 ${mutation.mutation_id}`))
    }
  }
  return { ok: issues.length === 0, issues }
}

/** Assessment option IDs are public by design; only answer relationships and test material are secret. */
export function validateAssessmentPublicSecureSeparation(
  publicPayload: AssessmentPublicPayload,
  securePayload: AssessmentSecurePayload,
): ValidationReport {
  const issues = [...validatePublicArtifactNoSecrets(publicPayload).issues]
  const publicText = JSON.stringify(publicPayload)
  const publicStrings = collectStrings(publicPayload)
  const publicLearnerText = publicStrings.join("\n")
  const joinedPublicCode = normalizeCode(publicStrings.join("\n"))
  const publicItems = new Map(
    publicPayload.items.map((item) => [item.item_id, item]),
  )
  for (const secureItem of securePayload.items) {
    const publicItem = publicItems.get(secureItem.item_id)
    if (!publicItem) continue
    const answerTokens: string[] = []
    if (secureItem.correct_option_id) {
      answerTokens.push(secureItem.correct_option_id)
      const correctOption = publicItem.options?.find(
        (option) => option.option_id === secureItem.correct_option_id,
      )
      if (correctOption) {
        answerTokens.push(correctOption.label, correctOption.text)
      }
    } else if (secureItem.answer_spec.kind === "numeric") {
      answerTokens.push(String(secureItem.answer_spec.target))
    } else if (secureItem.answer_spec.kind === "exact_set") {
      answerTokens.push(...secureItem.answer_spec.accepted)
    }
    if (
      secureItem.correct_option_id
        && containsLiteralToken(
          publicItem.prompt,
          secureItem.correct_option_id,
        )
      || containsExplicitAnswerRelation(publicItem.prompt, answerTokens)
    ) {
      issues.push(issue(
        "explicit_answer_leak",
        `$.items.${secureItem.item_id}.prompt`,
        "公开题干直接说明了正确答案",
      ))
    }
  }
  for (const suite of securePayload.code_test_suites) {
    const linkedItemIds = new Set(securePayload.items.flatMap((item) =>
      item.answer_spec.kind === "code"
        && item.answer_spec.test_suite_id === suite.test_suite_id
        ? [item.item_id]
        : []))
    const linkedPublicItems = publicPayload.items.filter((item) =>
      linkedItemIds.has(item.item_id))
    const suitePublicValue = linkedPublicItems.length > 0
      ? linkedPublicItems
      : publicPayload.items
    const suitePublicText = JSON.stringify(suitePublicValue)
    const suitePublicStrings = assessmentLearnerStrings(suitePublicValue)
    const suiteLearnerText = suitePublicStrings.join("\n")
    if (publicText.includes(suite.test_suite_id)) {
      issues.push(issue("test_suite_id_leak", "$.public", `公开测评包含私有测试套件 ${suite.test_suite_id}`))
    }
    const reference = normalizeCode(suite.reference_solution)
    if (reference && (
      publicStrings.some((value) => normalizeCode(value).includes(reference))
      || joinedPublicCode.includes(reference)
      || containsReferenceDeltaLeak(
        publicStrings,
        suite.reference_solution,
        publicPayload.items
          .map((item) => item.starter_code ?? "")
          .join("\n"),
      )
    )) {
      issues.push(issue("reference_solution_leak", "$.public", `公开测评包含测试套件 ${suite.test_suite_id} 的参考实现`))
    }
    for (const test of suite.hidden_tests) {
      if (publicText.includes(test.test_id)) {
        issues.push(issue("hidden_test_id_leak", "$.public", `公开测评包含隐藏测试 ID ${test.test_id}`))
      }
      const hasPrivateCase = carriesPrivateTestCase(test.input)
      if (hasPrivateCase && containsValueSecret(
        suitePublicStrings,
        suiteLearnerText,
        test.input,
      )) {
        issues.push(issue(
          "hidden_test_input_leak",
          "$.public",
          `公开测评包含隐藏测试 ${test.test_id} 的输入值`,
        ))
      }
      if (hasPrivateCase && containsExpectedSecret(
        suitePublicStrings,
        suitePublicText,
        test.expected,
      )) {
        issues.push(issue(
          "hidden_test_expected_leak",
          "$.public",
          `公开测评包含隐藏测试 ${test.test_id} 的预期值`,
        ))
      }
    }
  }
  return { ok: issues.length === 0, issues }
}

function collectStrings(value: unknown): string[] {
  const strings: string[] = []
  visitValue(value)
  return strings

  function visitValue(current: unknown): void {
    if (typeof current === "string") {
      strings.push(current)
      return
    }
    if (Array.isArray(current)) {
      current.forEach(visitValue)
      return
    }
    if (!current || typeof current !== "object") return
    Object.values(current as Record<string, unknown>).forEach(visitValue)
  }
}

function visit(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
  inspectKeys = true,
): void {
  if (typeof value === "string") {
    if (value.toLowerCase().includes("secure://role-c/")) {
      issues.push(issue("secure_ref_leak", path, "公开产物包含私有引用"))
    }
    return
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      visit(entry, `${path}[${index}]`, issues, inspectKeys))
    return
  }
  if (!value || typeof value !== "object") return

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = key.toLowerCase()
    const childPath = `${path}.${key}`
    if (inspectKeys && FORBIDDEN_PUBLIC_KEYS.has(normalizedKey)) {
      issues.push({
        code: "public_secure_leak",
        path: childPath,
        message: `公开产物包含私有字段 ${key}`,
        severity: "critical",
      })
    }
    // The key named `input` is legitimate public protocol data, but its nested
    // object must still be scanned for private answer/test material.
    visit(child, childPath, issues, inspectKeys)
  }
}

function normalizeCode(value: string | null | undefined): string {
  return (value ?? "").replace(/#[^\n]*/g, "").replace(/\s+/g, "").trim()
}

function containsStructuredSecret(
  publicText: string,
  value: unknown,
): boolean {
  if (!Array.isArray(value)
    && (!value || typeof value !== "object")) return false
  const serialized = JSON.stringify(value).replace(/\s+/g, "")
  return serialized.length >= 16
    && publicText.replace(/\s+/g, "").includes(serialized)
}

function containsValueSecret(
  publicStrings: string[],
  publicText: string,
  value: unknown,
): boolean {
  if (containsStructuredSecret(publicText, value)) return true
  const rawTokens = flattenScalarTokens(value)
  const tokens = rawTokens.map(normalizeSemanticText).filter(Boolean)
  if (tokens.length === 0) return false
  if (tokens.length === 1) {
    return publicStrings.some((text) =>
      containsExplicitInputRelation(text, rawTokens[0]!))
  }
  const scalarSequence = tokens.join("")
  if (scalarSequence.length < 3) return false
  return publicStrings.some((text) =>
    normalizeSemanticText(text).includes(scalarSequence))
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

/**
 * `null`, an empty stdin payload, and an empty call envelope describe protocols
 * without a per-case input. Their expected output is the public task contract,
 * not a private test vector.
 */
function isEmptyFunctionInvocationEnvelope(input: unknown): boolean {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false
  const record = input as Record<string, unknown>
  const keys = Object.keys(record)
  if (!keys.every((key) => key === "args" || key === "kwargs")) return false
  const args = record.args
  const kwargs = record.kwargs
  return (args === undefined || Array.isArray(args) && args.length === 0)
    && (kwargs === undefined || Boolean(kwargs && typeof kwargs === "object" && !Array.isArray(kwargs) && Object.keys(kwargs as Record<string, unknown>).length === 0))
}

function carriesPrivateTestCase(input: unknown): boolean {
  if (isEmptyFunctionInvocationEnvelope(input)) return false
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const record = input as Record<string, unknown>
    if (Object.keys(record).every((key) => key === "args" || key === "kwargs")) return true
  }
  return input !== null && input !== undefined && JSON.stringify(input) !== "{}"
}

/** 定位预期值泄漏到哪段公开文字中，给模型修复提示具体位置。 */
function findLeakLocation(publicStrings: string[], publicText: string, value: unknown): string {
  const candidates: string[] = []
  if (typeof value === "string" && value.trim().length >= 4) {
    const escaped = value.trim().toLowerCase()
    for (const s of publicStrings) {
      if (s.toLowerCase().includes(escaped)) candidates.push(s.slice(0, 100))
    }
  }
  if (Array.isArray(value) || (value && typeof value === "object")) {
    const compact = JSON.stringify(value).replace(/\s/g, "")
    if (compact.length >= 4 && publicText.replace(/\s/g, "").includes(compact)) {
      for (const s of publicStrings) {
        if (s.replace(/\s/g, "").includes(compact)) candidates.push(s.slice(0, 100))
      }
    }
  }
  return candidates.length ? `"${candidates[0]}"` : ""
}

function containsExpectedSecret(
  publicStrings: string[],
  publicText: string,
  value: unknown,
): boolean {
  if (containsStructuredSecret(publicText, value)) return true
  if (typeof value === "string" && value.trim().length >= 8
    && publicText.toLocaleLowerCase().includes(
      JSON.stringify(value).slice(1, -1).toLocaleLowerCase(),
    )) {
    return true
  }
  const tokens = flattenScalarTokens(value)
    .map(normalizeSemanticText)
    .filter(Boolean)
  if (tokens.length === 0) return false
  const secret = tokens.join("")
  if (secret.length === 0) return false
  // 纯数字等低熵标量是教学文本的高频词汇（"预期输出为 20"），语义关系判定会
  // 大面积误报；仅保留代码字面量检测（public 示例代码中出现 return 20 才是真泄漏）。
  const lowEntropyScalar = tokens.every((token) =>
    /^\d+(?:\.\d+)?$/u.test(token))
  return publicStrings.some((text) => {
    const literalLeak = flattenScalarTokens(value).some((token) => containsCodeReturnLiteral(text, token))
    if (lowEntropyScalar) return literalLeak
    const compact = normalizeSemanticText(text)
    const escaped = escapeRegExp(secret)
    const explicitRelations = [
      `预期(?:输出|结果|值)?(?:是|为|等于)?${escaped}`,
      `(?:输出|结果|返回值)(?:是|为|应为|等于)${escaped}`,
      `(?:应为|等于)${escaped}`,
      `expected(?:output|result|value)?(?:is|equals)?${escaped}`,
      `(?:output|result|returnvalue)(?:is|equals)${escaped}`,
      `returns?${escaped}`,
    ]
    return explicitRelations.some((pattern) =>
      new RegExp(pattern, "u").test(compact))
      || literalLeak
  })
}

function containsCodeReturnLiteral(text: string, value: unknown): boolean {
  if (typeof value !== "string" && typeof value !== "number"
    && typeof value !== "boolean" && value !== null) return false
  const literal = value === null ? "None" : String(value)
  const escaped = escapeRegExp(literal)
  return new RegExp(`\\breturn\\s+${escaped}(?![A-Za-z0-9_.])`, "iu").test(text)
}

function containsExplicitAnswerRelation(
  text: string,
  tokens: string[],
): boolean {
  const compact = text.normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/\s+/g, "")
  return tokens
    .map((token) => token.normalize("NFKC").toLocaleLowerCase().trim())
    .filter(Boolean)
    .some((token) => {
      const escaped = escapeRegExp(token)
      const boundary = `(?![a-z0-9_])`
      return [
        `正确答案(?:是|为|选)?(?:选项)?${escaped}${boundary}`,
        `正确选项(?:id)?(?:是|为|选)?${escaped}${boundary}`,
        `答案(?:是|为|选)?(?:选项)?${escaped}${boundary}`,
        `应选(?:择)?(?:选项)?${escaped}${boundary}`,
        `correct(?:answer|option)(?:is|:|=)?${escaped}${boundary}`,
        `answer(?:is|:|=)${escaped}${boundary}`,
        `(?:评分器|判分器|系统|grader).*?(?:接受|认可|匹配|accepts?).*?${escaped}${boundary}`,
        `(?:选择|提交|填写|select|submit).*?${escaped}${boundary}.*?(?:满分|得分|通过|正确|fullscore|pass|correct)`,
        `${escaped}${boundary}.*?(?:会|可|将)?(?:获得|得到|判为|算作|gets?).*?(?:满分|得分|通过|正确|fullscore|pass|correct)`,
      ].some((pattern) => new RegExp(pattern, "u").test(compact))
    })
}

function containsExplicitInputRelation(text: string, token: string): boolean {
  const compact = text.normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/\s+/g, "")
  const normalized = token.normalize("NFKC").toLocaleLowerCase().trim()
  if (!normalized) return false
  const escaped = escapeRegExp(normalized)
  const boundary = `(?![a-z0-9_])`
  return [
    `(?:隐藏|私有)?(?:测试|用例)?输入(?:值)?(?:是|为|等于|:|=)?${escaped}${boundary}`,
    `(?:使用|采用|传入|输入|testwith|input)(?:值)?${escaped}${boundary}(?:测试|作为用例|astest)?`,
  ].some((pattern) => new RegExp(pattern, "u").test(compact))
}

function containsLiteralToken(text: string, token: string): boolean {
  const normalizedText = text.normalize("NFKC").toLocaleLowerCase()
  const normalizedToken = token.normalize("NFKC")
    .toLocaleLowerCase()
    .trim()
  if (!normalizedToken) return false
  const escaped = escapeRegExp(normalizedToken)
  const needsBoundary = /^[a-z0-9_-]+$/u.test(normalizedToken)
  return new RegExp(
    `${needsBoundary ? "(?<![a-z0-9_-])" : ""}${escaped}${needsBoundary ? "(?![a-z0-9_-])" : ""}`,
    "u",
  ).test(normalizedText)
}

/** Detects disclosure of every implementation line that completes a public starter. */
function containsReferenceDeltaLeak(
  publicStrings: string[],
  referenceSolution: string,
  allowedStarter: string,
): boolean {
  const starterLines = new Set(codeLines(allowedStarter))
  const deltaLines = [...new Set(codeLines(referenceSolution)
    .filter((line) => !starterLines.has(line)))]
  if (deltaLines.length === 0) return false
  const publicCandidates = publicStrings
    .filter((value) => normalizeCode(value) !== normalizeCode(allowedStarter))
    .map(normalizeCode)
    .filter(Boolean)
  if (publicCandidates.length === 0) return false
  return deltaLines.every((line) =>
    publicCandidates.some((candidate) => candidate.includes(line)))
}

function codeLines(value: string): string[] {
  return value.split(/\r?\n/)
    .map(normalizeCode)
    .filter((line) => line.length >= 6)
}

function codeLabLearnerStrings(payload: CodeLabPublicPayload): string[] {
  return [
    payload.title,
    payload.starter_code,
    ...((payload.instructions ?? []).flatMap(renderBlockLearnerStrings)),
    // public_tests 的 description 和 expected_behavior 均描述公开测试行为，
    // 不应被 hidden_test_expected_leak 判定为泄漏。
    ...((payload.hint_ladders ?? []).flatMap((ladder) =>
      ladder.hints.map((hint) => hint.text))),
    ...(payload.reflection_questions ?? []),
  ]
}

function assessmentLearnerStrings(
  items: AssessmentPublicPayload["items"],
): string[] {
  return items.flatMap((item) => [
    item.prompt,
    item.starter_code ?? "",
    ...(item.options?.map((option) => `${option.label}. ${option.text}`) ?? []),
  ]).filter(Boolean)
}

function renderBlockLearnerStrings(
  block: CodeLabPublicPayload["instructions"][number],
): string[] {
  if (block.block_type === "heading") return [block.text]
  if (block.block_type === "paragraph") return [block.text, ...block.claims.map((claim) => claim.text)]
  if (block.block_type === "code") return [block.code, block.caption ?? "", ...block.claims.map((claim) => claim.text)].filter(Boolean)
  if (block.block_type === "callout") return [block.title, block.text, ...block.claims.map((claim) => claim.text)]
  if (block.block_type === "comparison") {
    return [block.title, ...block.columns.flatMap((column) => [column.heading, column.content]), ...block.claims.map((claim) => claim.text)]
  }
  if (block.block_type === "quiz") {
    return [block.prompt, ...(block.options?.map((option) => `${option.label}. ${option.text}`) ?? [])]
  }
  if (block.block_type === "hint") return [block.text]
  return []
}

function flattenScalarTokens(value: unknown): string[] {
  if (value === null) return ["null"]
  if (
    typeof value === "string"
      || typeof value === "number"
      || typeof value === "boolean"
  ) {
    return [String(value)]
  }
  if (Array.isArray(value)) {
    return value.flatMap(flattenScalarTokens)
  }
  if (!value || typeof value !== "object") return []
  return Object.values(value as Record<string, unknown>)
    .flatMap(flattenScalarTokens)
}

function normalizeSemanticText(value: unknown): string {
  return typeof value === "string"
    ? value.normalize("NFKC")
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "")
    : ""
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function issue(code: string, path: string, message: string): ValidationIssue {
  return { code, path, message, severity: "critical" }
}
