/**
 * A teaching code example must contain learner-visible executable structure.
 * Comments, pass, ellipsis and NotImplemented placeholders are useful in a
 * starter skeleton, but they are not a worked example.
 */
export function isSubstantivePythonExample(code: string): boolean {
  const significant = code
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("#"))
    .filter((line) => !/^(?:pass|\.\.\.|raise\s+NotImplementedError(?:\(.*\))?)\s*(?:#.*)?$/u.test(line))
    .filter((line) => !/:\s*(?:pass|\.\.\.|raise\s+NotImplementedError(?:\(.*\))?)\s*(?:#.*)?$/u.test(line))
    .filter((line) => !/^(?:[rubf]{0,2})?(?:"""[\s\S]*"""|'''[\s\S]*''')$/iu.test(line))
  if (significant.length === 0) return false

  // Do not mistake a Chinese explanation or a bare control/declaration header
  // for code.  At least one line must carry a concrete Python operation that a
  // learner can trace: assignment, call, import, return/yield, mutation/control
  // statement or an operator expression.  A header whose only body is pass/...
  // was removed above and therefore cannot satisfy this condition.
  const operationLines = significant.filter((line) =>
    !/^(?:async\s+)?(?:def|class|for|while|if|elif|else|try|except|finally|with)\b[^\n]*:\s*$/u.test(line))
  return operationLines.some((line) =>
    /^(?:from\s+\S+\s+import\s+|import\s+\S+|return(?:\s+.+)?$|yield(?:\s+.+)?$|assert\s+|raise\s+(?!NotImplementedError)|break$|continue$|del\s+|global\s+|nonlocal\s+)/u.test(line)
    || /^(?:[A-Za-z_]\w*(?:\[[^\]]+\]|\.[A-Za-z_]\w*)*)\s*(?:=|\+=|-=|\*=|\/=|\/\/=|%=|\*\*=)/u.test(line)
    || /(?:^|\s)[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*\s*\([^\n]*\)/u.test(line)
    || /(?:\[[^\n\]]*\]|\{[^\n}]*\}|\([^\n)]*\))\s*(?:\+|-|\*|\/|\/\/|%|\*\*)/u.test(line)
  )
}

export function isCommentOnlyPythonExample(code: string): boolean {
  return Boolean(code.trim()) && !isSubstantivePythonExample(code)
}

const PYTHON_SURFACE_PATTERN = /(?:\b(?:def|for|while|if|elif|else|return|print|input|range|sorted|import|from|open|with|try|except|class|lambda|len|sum|max|min)\b|[A-Za-z_][A-Za-z0-9_.]*\([^\n)]*\)|\[[^\n\]]*\]|\{[^\n}]*\}|(?:^|\s)[A-Za-z_][A-Za-z0-9_]*\s*(?:=|\+=|-=|\*=|\/=))/iu

/**
 * Facts may support a fresh code-shaped direct instance even when an older
 * chapter example cannot be projected into the exact fact closure.  Require
 * both an operational capability and explicit Python surface syntax; generic
 * claims such as “Python is a programming language” never qualify.
 */
export function executableExampleFactIds(facts: Array<{
  factId?: string
  fact_id?: string
  content: string
  capabilities?: string[]
}>): string[] {
  const operational = new Set([
    "rule", "procedure", "state_transition", "io_contract", "example",
  ])
  const eligible = facts.flatMap((fact) => {
    const factId = fact.fact_id ?? fact.factId
    if (!factId) return []
    if (!(fact.capabilities ?? []).some((capability) => operational.has(capability))) return []
    return [{ factId, explicitSyntax: PYTHON_SURFACE_PATTERN.test(fact.content) }]
  })
  if (!eligible.some((entry) => entry.explicitSyntax)) return []
  return eligible
    .sort((left, right) => Number(right.explicitSyntax) - Number(left.explicitSyntax))
    .map((entry) => entry.factId)
    .slice(0, 4)
}
