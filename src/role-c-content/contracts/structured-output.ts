export interface StructuredOutputRecovery<T = unknown> {
  ok: boolean
  value?: T
  strategy?: "direct" | "fenced" | "substring" | "trailing_comma"
  error?: string
}

export function recoverStructuredJson<T = unknown>(raw: string): StructuredOutputRecovery<T> {
  const input = raw.trim()
  if (!input) return { ok: false, error: "EMPTY_OUTPUT" }

  const attempts: Array<{ strategy: StructuredOutputRecovery["strategy"]; value: string }> = [
    { strategy: "direct", value: input },
  ]

  const fenced = input.match(/```(?:json)?\s*([\s\S]*?)```/iu)?.[1]?.trim()
  if (fenced) attempts.push({ strategy: "fenced", value: fenced })

  const firstObject = firstBalancedJson(input)
  if (firstObject && firstObject !== input) {
    attempts.push({ strategy: "substring", value: firstObject })
  }

  for (const attempt of attempts) {
    const direct = parse<T>(attempt.value)
    if (direct.ok) return { ...direct, strategy: attempt.strategy }
    const repaired = removeTrailingCommas(attempt.value)
    if (repaired !== attempt.value) {
      const second = parse<T>(repaired)
      if (second.ok) return { ...second, strategy: "trailing_comma" }
    }
  }
  return { ok: false, error: "JSON_RECOVERY_FAILED" }
}

function parse<T>(value: string): { ok: true; value: T } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(value) as T }
  } catch {
    return { ok: false }
  }
}

function removeTrailingCommas(value: string): string {
  let output = ""
  let inString = false
  let escaped = false
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!
    if (inString) {
      output += character
      if (escaped) escaped = false
      else if (character === "\\") escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') {
      inString = true
      output += character
      continue
    }
    if (character === ",") {
      let cursor = index + 1
      while (/\s/u.test(value[cursor] ?? "")) cursor += 1
      if (value[cursor] === "}" || value[cursor] === "]") continue
    }
    output += character
  }
  return output
}

function firstBalancedJson(value: string): string | undefined {
  const start = value.search(/[\[{]/u)
  if (start < 0) return undefined
  const opening = value[start]!
  const closing = opening === "{" ? "}" : "]"
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < value.length; index += 1) {
    const character = value[index]!
    if (inString) {
      if (escaped) escaped = false
      else if (character === "\\") escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') {
      inString = true
      continue
    }
    if (character === opening) depth += 1
    else if (character === closing) {
      depth -= 1
      if (depth === 0) return value.slice(start, index + 1)
    }
  }
  return undefined
}
