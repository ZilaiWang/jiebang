export interface PythonFunctionInterface {
  entry_point: string
  positional_parameters: string[]
  required_positional_count: number
  maximum_positional_count: number | null
  required_keyword_only: string[]
  accepted_keyword_parameters: string[]
  accepts_arbitrary_keywords: boolean
}

/**
 * Extract the callable surface only; test authors do not need the reference
 * implementation body. Generated Role C functions deliberately use a single,
 * ordinary `def` signature, but the parser also handles defaults, annotations,
 * keyword-only parameters, *args and **kwargs.
 */
export function describePythonEntryPoint(
  source: string,
  entryPoint: string | undefined,
): PythonFunctionInterface | undefined {
  if (!entryPoint) return undefined
  const escaped = entryPoint.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
  const match = source.match(new RegExp(
    `^\\s*def\\s+${escaped}\\s*\\(([\\s\\S]*?)\\)\\s*(?:->[^:\\n]+)?\\s*:`,
    "mu",
  ))
  if (!match) return undefined
  const parameters = splitTopLevel(match[1] ?? "")
  const positional: Array<{ name: string; required: boolean }> = []
  const keywordOnly: Array<{ name: string; required: boolean }> = []
  let keywordOnlyMode = false
  let variadicPositional = false
  let variadicKeywords = false

  for (const raw of parameters) {
    const parameter = raw.trim()
    if (!parameter || parameter === "/") continue
    if (parameter === "*") {
      keywordOnlyMode = true
      continue
    }
    if (parameter.startsWith("**")) {
      variadicKeywords = true
      continue
    }
    if (parameter.startsWith("*")) {
      variadicPositional = true
      keywordOnlyMode = true
      continue
    }
    const assignment = topLevelIndex(parameter, "=")
    const declaration = assignment >= 0 ? parameter.slice(0, assignment) : parameter
    const annotation = topLevelIndex(declaration, ":")
    const name = (annotation >= 0 ? declaration.slice(0, annotation) : declaration).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) return undefined
    const descriptor = { name, required: assignment < 0 }
    if (keywordOnlyMode) keywordOnly.push(descriptor)
    else positional.push(descriptor)
  }

  return {
    entry_point: entryPoint,
    positional_parameters: positional.map((entry) => entry.name),
    required_positional_count: positional.filter((entry) => entry.required).length,
    maximum_positional_count: variadicPositional ? null : positional.length,
    required_keyword_only: keywordOnly.filter((entry) => entry.required).map((entry) => entry.name),
    accepted_keyword_parameters: [...positional, ...keywordOnly].map((entry) => entry.name),
    accepts_arbitrary_keywords: variadicKeywords,
  }
}

export function validateFunctionInvocationAgainstInterface(
  invocation: unknown,
  contract: PythonFunctionInterface,
): string[] {
  if (!invocation || typeof invocation !== "object" || Array.isArray(invocation)) {
    return [`${contract.entry_point} 输入必须使用 args/kwargs 调用封装`]
  }
  const record = invocation as Record<string, unknown>
  if (!Array.isArray(record.args)) return [`${contract.entry_point} 调用缺少 args 数组`]
  const args = record.args
  const kwargs = record.kwargs ?? {}
  if (!kwargs || typeof kwargs !== "object" || Array.isArray(kwargs)) {
    return [`${contract.entry_point} 调用的 kwargs 必须是对象`]
  }
  const keywordNames = Object.keys(kwargs as Record<string, unknown>)
  const accepted = new Set(contract.accepted_keyword_parameters)
  const issues: string[] = []
  if (contract.maximum_positional_count !== null
    && args.length > contract.maximum_positional_count) {
    issues.push(`${contract.entry_point} 最多接收 ${contract.maximum_positional_count} 个位置参数，当前为 ${args.length} 个`)
  }
  const suppliedPositionally = new Set(contract.positional_parameters.slice(0, args.length))
  for (const name of keywordNames) {
    if (!contract.accepts_arbitrary_keywords && !accepted.has(name)) {
      issues.push(`${contract.entry_point} 不接收关键字参数 ${name}`)
    }
    if (suppliedPositionally.has(name)) {
      issues.push(`${contract.entry_point} 的参数 ${name} 被位置参数和 kwargs 重复赋值`)
    }
  }
  const suppliedByName = new Set(keywordNames)
  const suppliedRequired = contract.positional_parameters
    .slice(0, contract.required_positional_count)
    .filter((name, index) => index < args.length || suppliedByName.has(name))
  if (suppliedRequired.length < contract.required_positional_count) {
    issues.push(`${contract.entry_point} 至少需要 ${contract.required_positional_count} 个必填参数，当前调用未完整提供`)
  }
  for (const name of contract.required_keyword_only) {
    if (!suppliedByName.has(name)) issues.push(`${contract.entry_point} 缺少必填关键字参数 ${name}`)
  }
  return issues
}

function splitTopLevel(value: string): string[] {
  const result: string[] = []
  let start = 0
  let depth = 0
  let quote: "'" | '"' | undefined
  let escaped = false
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!
    if (quote) {
      if (escaped) escaped = false
      else if (character === "\\") escaped = true
      else if (character === quote) quote = undefined
      continue
    }
    if (character === "'" || character === '"') quote = character
    else if ("([{<".includes(character)) depth += 1
    else if (")]}>".includes(character)) depth = Math.max(0, depth - 1)
    else if (character === "," && depth === 0) {
      result.push(value.slice(start, index))
      start = index + 1
    }
  }
  result.push(value.slice(start))
  return result
}

function topLevelIndex(value: string, target: string): number {
  let depth = 0
  let quote: "'" | '"' | undefined
  let escaped = false
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!
    if (quote) {
      if (escaped) escaped = false
      else if (character === "\\") escaped = true
      else if (character === quote) quote = undefined
      continue
    }
    if (character === "'" || character === '"') quote = character
    else if ("([{<".includes(character)) depth += 1
    else if (")]}>".includes(character)) depth = Math.max(0, depth - 1)
    else if (character === target && depth === 0) return index
  }
  return -1
}
