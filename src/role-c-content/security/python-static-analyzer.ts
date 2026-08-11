import type { ExecutionContract } from "../contracts/artifacts"

export interface PythonStaticIssue {
  code: string
  message: string
}

/** Platform-owned Python standard-library subset. Per-lab declarations can only narrow it. */
export const PLATFORM_PYTHON_IMPORT_ALLOWLIST = Object.freeze([
  "bisect",
  "collections",
  "datetime",
  "decimal",
  "enum",
  "fractions",
  "functools",
  "heapq",
  "itertools",
  "io",
  "json",
  "math",
  "operator",
  "random",
  "re",
  "statistics",
  "string",
] as const)

const PLATFORM_ALLOWED_MODULES = new Set<string>(PLATFORM_PYTHON_IMPORT_ALLOWLIST)

const NEVER_ALLOWED_MODULES = new Set([
  "builtins",
  "ctypes",
  "importlib",
  "inspect",
  "marshal",
  "multiprocessing",
  "os",
  "pathlib",
  "pickle",
  "resource",
  "shutil",
  "signal",
  "socket",
  "subprocess",
  "sys",
  "threading",
])

const DANGEROUS_PATTERNS: Array<[RegExp, string]> = [
  [/\b(?:eval|exec|compile|open|breakpoint|__import__)\s*\(/, "dangerous_builtin"],
  [/\b(?:globals|locals|vars)\s*\(/, "namespace_introspection"],
  [/\b(?:getattr|setattr|delattr)\s*\(/, "dynamic_attribute_access"],
  [/\bmemoryview\s*\(/, "raw_memory_access"],
  [/\b__builtins__\b/, "builtins_introspection"],
  [/\.(?:f_back|f_locals|f_globals|gi_frame|cr_frame|ag_frame)\b/, "frame_introspection"],
  [/\b(?:__class__|__bases__|__mro__|__subclasses__|__globals__|__code__|__closure__)\b/, "object_introspection"],
]

/** Conservative preflight. Isolation remains mandatory even when this report passes. */
export function analyzePythonSource(
  source: string,
  contract: ExecutionContract,
): PythonStaticIssue[] {
  const issues: PythonStaticIssue[] = []
  if (!source.trim()) issues.push(issue("empty_source", "Python 源码不能为空"))
  if (Buffer.byteLength(source, "utf8") > 20_000) {
    issues.push(issue("source_too_large", "Python 源码超过 20,000 bytes"))
  }
  if (source.includes("\0")) issues.push(issue("nul_byte", "Python 源码包含 NUL byte"))

  const declared = contract.allowed_imports.map((entry) => entry.split(".")[0])
  for (const module of declared) {
    if (NEVER_ALLOWED_MODULES.has(module)) {
      issues.push(issue("forbidden_contract_import", `allowed_imports 不得声明永久禁止模块 ${module}`))
    } else if (!PLATFORM_ALLOWED_MODULES.has(module)) {
      issues.push(issue("unsupported_contract_import", `模块 ${module} 不在平台 Python 白名单中`))
    }
  }
  const allowed = new Set(declared.filter((module) => PLATFORM_ALLOWED_MODULES.has(module)))
  for (const module of importedModules(source)) {
    if (NEVER_ALLOWED_MODULES.has(module)) {
      issues.push(issue("forbidden_import", `禁止导入模块 ${module}`))
    } else if (!allowed.has(module)) {
      issues.push(issue("unlisted_import", `模块 ${module} 不在 allowed_imports 中`))
    }
  }
  for (const [pattern, code] of DANGEROUS_PATTERNS) {
    // 逐行扫描并报告具体行号与命中的 token，让修复轮次能准确定位并移除该用法。
    const lines = source.split(/\r?\n/)
    for (let index = 0; index < lines.length; index += 1) {
      const match = pattern.exec(lines[index]!)
      if (match) {
        issues.push(issue(
          code,
          `源码第 ${index + 1} 行命中禁止能力：${match[0]}（请移除该用法）`,
        ))
        break
      }
    }
  }
  if (contract.execution_mode === "function") {
    const entryPoint = contract.entry_point
    if (!entryPoint) {
      issues.push(issue("entry_point_missing", "function 模式必须声明 entry_point"))
    } else {
      const escaped = entryPoint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      if (!new RegExp(`^\\s*def\\s+${escaped}\\s*\\(`, "m").test(source)) {
        issues.push(issue("entry_point_not_defined", `源码未定义入口函数 ${entryPoint}`))
      }
    }
  }
  return deduplicate(issues)
}

function importedModules(source: string): string[] {
  const modules: string[] = []
  for (const line of source.replace(/;/g, "\n").split(/\r?\n/)) {
    const importMatch = line.match(/^\s*import\s+(.+)$/)
    if (importMatch) {
      for (const part of importMatch[1].split(",")) {
        const name = part.trim().split(/\s+as\s+/)[0].split(".")[0]
        if (name) modules.push(name)
      }
    }
    const fromMatch = line.match(/^\s*from\s+([A-Za-z_][A-Za-z0-9_.]*)\s+import\s+/)
    if (fromMatch) modules.push(fromMatch[1].split(".")[0])
  }
  return modules
}

function issue(code: string, message: string): PythonStaticIssue {
  return { code, message }
}

function deduplicate(issues: PythonStaticIssue[]): PythonStaticIssue[] {
  return [...new Map(issues.map((entry) => [`${entry.code}:${entry.message}`, entry])).values()]
}
