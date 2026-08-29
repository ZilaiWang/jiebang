import { MODERN_AI_KNOWLEDGE_BASE } from "../src/knowledge/modern-ai"
import { PYTHON_BASIC_KNOWLEDGE_BASE } from "../src/knowledge/python-basic"
import { PYTHON_PROGRAMMING_KNOWLEDGE_BASE } from "../src/knowledge/python-programming"
import type { KnowledgeItem } from "../src/knowledge/types"

/**
 * Final-round authored teaching-evidence audit.
 *
 * Runtime V2 hydration is useful for compatibility, but a competition release
 * should not mistake derived placeholders for authored pedagogy.  This script
 * inspects the canonical source records before hydration and reports items that
 * still rely on generic questions, unbound examples, or derived-only teaching
 * metadata.
 *
 * Usage:
 *   bun scripts/audit-teaching-evidence.ts
 *   bun scripts/audit-teaching-evidence.ts --strict
 *   bun scripts/audit-teaching-evidence.ts --json
 */

type Severity = "error" | "warning" | "info"

interface Finding {
  severity: Severity
  source_id: string
  module: string
  field: string
  code: string
  message: string
  sample?: string
}

const args = new Set(process.argv.slice(2))
const strict = args.has("--strict")
const json = args.has("--json")

const items = [
  ...PYTHON_BASIC_KNOWLEDGE_BASE.items,
  ...PYTHON_PROGRAMMING_KNOWLEDGE_BASE.items,
  ...MODERN_AI_KNOWLEDGE_BASE.items,
]

// The frozen 60-case competition manifest currently concentrates on K001-K018.
// Findings in those sources are release-blocking; the rest remain backlog warnings.
const FORMAL_COMPETITION_TARGETS = new Set(
  Array.from({ length: 18 }, (_, index) => `K${String(index + 1).padStart(3, "0")}`),
)

const GENERIC_PATTERNS: Array<{ code: string; pattern: RegExp; description: string }> = [
  {
    code: "GENERIC_REFER_TO_FACT",
    pattern: /参考(?:该|本)?知识点的\s*F\d+\s*事实/u,
    description: "答案只是让学习者去看 fact_id，没有给出可学习、可核验的答案",
  },
  {
    code: "GENERIC_COMPLETE_RELATED_EXERCISE",
    pattern: /请完成一个与[“"].+?[”"]相关的小练习/u,
    description: "练习没有明确输入、动作、输出和验收标准",
  },
  {
    code: "GENERIC_APPLY_AND_EXPLAIN",
    pattern: /能正确运用该知识点并解释关键步骤/u,
    description: "答案/评分标准无法判定学习者究竟是否完成目标",
  },
  {
    code: "ENGINEERING_METADATA_IN_LEARNER_CODE",
    pattern: /(?:source|source_id|fact_id)\s*[:=]/iu,
    description: "学习者示例代码混入证据工程元信息",
  },
]

const findings: Finding[] = []
for (const item of items) auditItem(item, findings)

const counts = findings.reduce<Record<Severity, number>>(
  (acc, finding) => {
    acc[finding.severity] += 1
    return acc
  },
  { error: 0, warning: 0, info: 0 },
)

const authoredCoverage = items.map((item) => ({
  source_id: item.sourceId,
  formal_target: FORMAL_COMPETITION_TARGETS.has(item.sourceId),
  explicit_example_binding_rate: ratio(
    item.examples.filter((entry) => (entry.factIds?.length ?? 0) > 0).length,
    item.examples.length,
  ),
  authored_worked_examples: item.workedExamples?.length ?? 0,
  authored_misconceptions: item.misconceptions?.length ?? 0,
  authored_practice_templates: item.practiceTemplates?.length ?? 0,
  authored_objectives: item.observableObjectives?.length ?? 0,
}))

if (json) {
  console.log(JSON.stringify({
    audit_version: "teaching-evidence-audit-v1",
    item_count: items.length,
    counts,
    passed: counts.error === 0,
    authored_coverage: authoredCoverage,
    findings,
  }, null, 2))
} else {
  console.log("# Teaching evidence audit")
  console.log(`items=${items.length} errors=${counts.error} warnings=${counts.warning} info=${counts.info}`)
  console.log("")
  for (const finding of findings) {
    const sample = finding.sample ? ` sample=${JSON.stringify(finding.sample)}` : ""
    console.log(`[${finding.severity.toUpperCase()}] ${finding.source_id} ${finding.field} ${finding.code}: ${finding.message}${sample}`)
  }
  console.log("")
  console.log("Release rule: K001-K018 must have no ERROR findings before the formal 60×2 evaluation is frozen.")
}

if (strict && counts.error > 0) process.exitCode = 1

function auditItem(item: KnowledgeItem, output: Finding[]): void {
  const formal = FORMAL_COMPETITION_TARGETS.has(item.sourceId)
  const releaseSeverity: Severity = formal ? "error" : "warning"

  if (!item.workedExamples?.length) {
    output.push(finding(item, releaseSeverity, "workedExamples", "DERIVED_ONLY_WORKED_EXAMPLE",
      "缺少人工编写的分步例题；运行时只能从 legacy example 派生单步结构，无法证明教学步骤质量"))
  }
  if (!item.misconceptions?.length) {
    output.push(finding(item, releaseSeverity, "misconceptions", "DERIVED_ONLY_MISCONCEPTION",
      "缺少人工编写的典型误解、诊断信号、反例与纠正策略"))
  }
  if (!item.practiceTemplates?.length) {
    output.push(finding(item, releaseSeverity, "practiceTemplates", "DERIVED_ONLY_PRACTICE_TEMPLATE",
      "缺少带认知要求和 fact 闭包的实践模板"))
  }
  if (!item.observableObjectives?.length) {
    output.push(finding(item, releaseSeverity, "observableObjectives", "DERIVED_ONLY_OBJECTIVE",
      "缺少人工冻结的可观察学习目标；运行时目标可能退化为通用描述"))
  }

  item.examples.forEach((example, index) => {
    if (!example.factIds?.length) {
      output.push(finding(item, releaseSeverity, `examples[${index}].factIds`, "EXAMPLE_WITHOUT_FACT_CLOSURE",
        "示例没有显式绑定支持它的完整事实集合；不得用数组前几条事实自动补 provenance", example.title))
    }
    scanGeneric(item, `examples[${index}].code`, example.code, output, releaseSeverity)
    scanGeneric(item, `examples[${index}].explanation`, example.explanation, output, releaseSeverity)
    if (!looksRunnable(example.code)) {
      output.push(finding(item, "warning", `examples[${index}].code`, "EXAMPLE_NOT_OBSERVABLE",
        "示例缺少可观察行为（输出、返回或断言），学习者难以确认运行结果", example.title))
    }
  })

  item.practiceTasks.forEach((task, index) => {
    scanGeneric(item, `practiceTasks[${index}]`, task, output, releaseSeverity)
    if (!hasConcreteAcceptance(task)) {
      output.push(finding(item, releaseSeverity, `practiceTasks[${index}]`, "PRACTICE_WITHOUT_ACCEPTANCE",
        "任务未同时说明具体动作与可验收产物/结果", task))
    }
  })

  item.quizItems.forEach((quiz, index) => {
    scanGeneric(item, `quizItems[${index}].question`, quiz.question, output, releaseSeverity)
    scanGeneric(item, `quizItems[${index}].answer`, quiz.answer, output, releaseSeverity)
    if (quiz.answer.trim().length < 2) {
      output.push(finding(item, "warning", `quizItems[${index}].answer`, "ANSWER_TOO_SHORT",
        "非符号型答案过短，难以作为解释型反馈", quiz.answer))
    }
  })
}

function scanGeneric(
  item: KnowledgeItem,
  field: string,
  value: string,
  output: Finding[],
  severity: Severity,
): void {
  for (const rule of GENERIC_PATTERNS) {
    if (!rule.pattern.test(value)) continue
    output.push(finding(item, severity, field, rule.code, rule.description, truncate(value)))
  }
}

function finding(
  item: KnowledgeItem,
  severity: Severity,
  field: string,
  code: string,
  message: string,
  sample?: string,
): Finding {
  return {
    severity,
    source_id: item.sourceId,
    module: item.module,
    field,
    code,
    message,
    ...(sample ? { sample: truncate(sample) } : {}),
  }
}

function looksRunnable(code: string): boolean {
  return /\b(?:print|return|assert)\s*(?:\(|\b)/u.test(code)
}

function hasConcreteAcceptance(task: string): boolean {
  const hasAction = /定义|实现|编写|输出|返回|计算|判断|修复|运行|读取|写入|生成|统计|找出|解释/u.test(task)
  const hasArtifact = /结果|输出|返回值|代码|程序|列表|字典|文件|字符串|数字|布尔|异常|测试|步骤/u.test(task)
  return hasAction && hasArtifact
}

function truncate(value: string, max = 120): string {
  const normalized = value.replace(/\s+/gu, " ").trim()
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : Math.round((numerator / denominator) * 10_000) / 10_000
}
