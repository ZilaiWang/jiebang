export interface PythonProgramEntryIssue {
  code: "duplicate_program_entry"
  message: string
}

/** Detect duplicate execution of a user-defined stdin/stdout entry before Docker. */
export function validatePythonProgramEntry(source: string): PythonProgramEntryIssue[] {
  const lines = source.replace(/\r\n?/gu, "\n").split("\n")
  const defined = new Set(lines.flatMap((line) => {
    const match = line.match(/^\s*def\s+([A-Za-z_]\w*)\s*\(/u)
    return match ? [match[1]!] : []
  }))
  const topLevelCalls = new Map<string, number>()
  const guardedCalls = new Set<string>()
  let mainGuardIndent: number | undefined

  for (const line of lines) {
    if (!line.trim() || /^\s*#/u.test(line)) continue
    const indent = line.match(/^\s*/u)?.[0].replace(/\t/gu, "    ").length ?? 0
    if (/^\s*if\s+__name__\s*==\s*["']__main__["']\s*:\s*(?:#.*)?$/u.test(line)) {
      mainGuardIndent = indent
      continue
    }
    if (mainGuardIndent !== undefined && indent <= mainGuardIndent) mainGuardIndent = undefined
    const call = line.trim().match(/^([A-Za-z_]\w*)\s*\(\s*\)\s*(?:#.*)?$/u)?.[1]
    if (!call || !defined.has(call)) continue
    if (mainGuardIndent !== undefined && indent > mainGuardIndent) guardedCalls.add(call)
    else if (indent === 0) topLevelCalls.set(call, (topLevelCalls.get(call) ?? 0) + 1)
  }

  return [...defined]
    .filter((name) => (topLevelCalls.get(name) ?? 0) > 1
      || (guardedCalls.has(name) && (topLevelCalls.get(name) ?? 0) > 0))
    .map((name) => ({
      code: "duplicate_program_entry" as const,
      message: `stdin_stdout 程序入口 ${name}() 被重复调用；只能保留 __main__ guard 或顶层调用中的一种`,
    }))
}
