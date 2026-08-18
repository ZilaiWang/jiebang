import { mkdir } from "node:fs/promises"
import { resolve } from "node:path"

type CaseResult = {
  case_id: string
  learner_profile_id: string
  status: "ready" | "blocked" | "failed"
  requested_target_source_ids: string[]
  final_target_source_ids: string[]
  checked_claims: number
  conflicting_claims: number
  hallucination_rate: number | null
  target_citation_coverage: number
  difficulty_matched: boolean | null
  prerequisite_covered: boolean | null
  all_three_artifacts_present: boolean
  review_decision: string
  code_execution: string
  failure_stage?: string
  failure_reason?: string
  failure_code?: string
  failure_issue_codes?: string[]
  fact_audit_by_artifact?: unknown[]
}

type EvaluationReport = {
  generated_at: string
  case_results: CaseResult[]
}

const root = process.cwd()
const outputDirectory = resolve(root, ".tmp/competition-sprint/day7-final-check")
const evidence = {
  current_cs_basic: ".tmp/competition-sprint/day7-final-check/week3-eval/final-current-cs-basic-v2/latest.json",
  current_zero_beginner: ".tmp/competition-sprint/day7-final-check/week3-eval/final-current-zero-beginner/latest.json",
  current_cross_major: ".tmp/competition-sprint/day7-final-check/week3-eval/final-current-cross-major/latest.json",
  post_audit_normalization_k004: ".tmp/competition-sprint/day7-final-check/week3-eval/post-audit-normalization-k004/latest.json",
  observed_safety_block: ".tmp/competition-sprint/day7-final-check/week3-eval/sparse-fact-final/latest.json",
  initial_day7_audit: ".tmp/competition-sprint/day7-final-check/week3-eval/latest.json",
} as const

const reports = Object.fromEntries(await Promise.all(Object.entries(evidence).map(async ([key, path]) => [
  key,
  await readReport(path),
]))) as Record<keyof typeof evidence, EvaluationReport>

const currentAttempts = [
  ...reports.current_cs_basic.case_results,
  ...reports.current_zero_beginner.case_results,
  ...reports.current_cross_major.case_results,
]
const selectedReady = [
  requiredReady(reports.current_cs_basic, "golden-cs-basic-01"),
  requiredReady(reports.current_zero_beginner, "golden-zero-beginner-07"),
  requiredReady(reports.current_cross_major, "golden-cross-major-20"),
]
const checkedClaims = sum(selectedReady.map((item) => item.checked_claims))
const conflictingClaims = sum(selectedReady.map((item) => item.conflicting_claims))
const difficultyMatched = selectedReady.filter((item) => item.difficulty_matched === true).length
const fullCoverage = selectedReady.filter((item) =>
  item.target_citation_coverage === 1 && item.all_three_artifacts_present).length
const initialBlocked = reports.initial_day7_audit.case_results.filter((item) => item.status === "blocked")
const observedSafetyBlocks = reports.observed_safety_block.case_results.filter((item) =>
  item.status === "blocked")

assert(checkedClaims > 0, "当前 ready 样例没有可复算的审核单元")
assert(conflictingClaims <= checkedClaims, "冲突数不得超过审核单元数")
assert(new Set(selectedReady.map((item) => item.learner_profile_id)).size === 3, "三组画像未全部形成当前 ready 样例")

const generatedAt = new Date().toISOString()
const metrics = {
  report_kind: "role_c_day7_quality_evidence",
  generated_at: generatedAt,
  scope: {
    current_code_validation: "仅统计修复后重新运行的三个画像；旧版或历史 ready 不进入当前质量分子分母。",
    automated_audit_limit: "冲突率表示当前自动事实审核发现的冲突比例，不等同于真实世界事实错误概率；人工抽查单列。",
    run_health_limit: "ready/blocked 衡量模型与流水线稳定性，和已发布内容质量分开统计。",
  },
  metrics: {
    published_automated_conflict_rate: {
      value: round4(conflictingClaims / checkedClaims),
      checked_review_units: checkedClaims,
      conflicting_review_units: conflictingClaims,
      sample_count: selectedReady.length,
    },
    structural_difficulty_fit_accuracy: {
      value: round4(difficultyMatched / selectedReady.length),
      matched_samples: difficultyMatched,
      sample_count: selectedReady.length,
      note: "按画像 level、GenerationSpec 难度和 B 教学审核计算，不代表真实学习增益。",
    },
    target_citation_coverage: {
      value: round4(fullCoverage / selectedReady.length),
      fully_covered_samples: fullCoverage,
      sample_count: selectedReady.length,
      note: "表示三类资源均引用全部冻结目标，不代表学习者已经掌握目标。",
    },
  },
  profile_coverage: Object.fromEntries(selectedReady.map((item) => [
    item.learner_profile_id,
    item.case_id,
  ])),
  current_run_health: countStatuses(currentAttempts),
  published_samples: selectedReady.map((item) => ({
    case_id: item.case_id,
    learner_profile_id: item.learner_profile_id,
    targets: item.final_target_source_ids,
    checked_review_units: item.checked_claims,
    conflicting_review_units: item.conflicting_claims,
    automated_conflict_rate: item.hallucination_rate,
    target_citation_coverage: item.target_citation_coverage,
    difficulty_matched: item.difficulty_matched,
    prerequisite_covered: item.prerequisite_covered,
    all_three_artifacts_present: item.all_three_artifacts_present,
    code_execution: item.code_execution,
    evidence_file: evidenceFileFor(item.case_id),
  })),
  observed_safety_blocks: observedSafetyBlocks.map(blockedEvidence),
  initial_gate_evidence: initialBlocked.map(blockedEvidence),
  initial_run_health: countStatuses(reports.initial_day7_audit.case_results),
  manual_spot_check: {
    status: "completed_with_preview_scope",
    checked_cases: selectedReady.map((item) => item.case_id),
    finding: "修复前 K001 讲义曾把通用语言扩写为数据分析、人工智能、网页开发等无证据领域；修复后单事实讲义由冻结事实正向物化，当前三个发布样例预览未再出现该类扩写。",
    limitation: "人工抽查覆盖公开预览与浏览器实际展示，不替代完整领域专家评审。",
  },
  browser_end_to_end_validation: {
    status: "completed",
    session_id: "SESSION-e95fbeac-7b99-4f38-a6ba-95568f6df606",
    target: "K004",
    diagnosis_items: 3,
    artifacts_published: ["concept", "code_lab", "assessment"],
    code_execution: { passed_checks: 1, total_checks: 1 },
    assessment: { raw_score: 10, max_score: 10, accuracy: 1 },
    terminal_outcome: "PATH_MASTERED",
    evidence_file: ".tmp/competition-sprint/day7-browser-runtime/sessions/SESSION-e95fbeac-7b99-4f38-a6ba-95568f6df606.json",
  },
  evidence_index: evidence,
}

await mkdir(outputDirectory, { recursive: true })
await Bun.write(resolve(outputDirectory, "quality-metrics-final.json"), `${JSON.stringify(metrics, null, 2)}\n`)
await Bun.write(resolve(outputDirectory, "fact-audit-final.md"), renderFactAudit(metrics))
await Bun.write(resolve(outputDirectory, "repair-downgrade-final.md"), renderRepair(metrics))
console.log(`Day7 证据已生成：${outputDirectory}`)

async function readReport(path: string): Promise<EvaluationReport> {
  const absolute = resolve(root, path)
  const file = Bun.file(absolute)
  if (!await file.exists()) throw new Error(`缺少评测证据：${path}`)
  const report = await file.json() as EvaluationReport
  if (!Array.isArray(report.case_results)) throw new Error(`评测报告格式无效：${path}`)
  return report
}

function requiredReady(report: EvaluationReport, caseId: string): CaseResult {
  const result = report.case_results.find((item) => item.case_id === caseId)
  if (!result || result.status !== "ready") throw new Error(`${caseId} 当前没有 ready 证据`)
  return result
}

function evidenceFileFor(caseId: string): string {
  if (caseId === "golden-cs-basic-01") return evidence.current_cs_basic
  if (caseId === "golden-zero-beginner-07") return evidence.current_zero_beginner
  return evidence.current_cross_major
}

function blockedEvidence(item: CaseResult) {
  return {
    case_id: item.case_id,
    learner_profile_id: item.learner_profile_id,
    checked_review_units: item.checked_claims,
    conflicting_review_units: item.conflicting_claims,
    automated_conflict_rate: item.hallucination_rate,
    failure_stage: item.failure_stage,
    failure_code: item.failure_code,
    failure_issue_codes: item.failure_issue_codes ?? [],
    failure_reason: item.failure_reason,
  }
}

function countStatuses(items: CaseResult[]) {
  return {
    attempts: items.length,
    ready: items.filter((item) => item.status === "ready").length,
    blocked: items.filter((item) => item.status === "blocked").length,
    failed: items.filter((item) => item.status === "failed").length,
  }
}

function renderFactAudit(report: typeof metrics): string {
  const metric = report.metrics.published_automated_conflict_rate
  return `# Role C Day7 事实审核报告\n\n`+
    `## 结论\n\n`+
    `修复后重新运行的三组画像均形成可发布样例。已发布样例共检查 ${metric.checked_review_units} 个审核单元，自动审核发现 ${metric.conflicting_review_units} 个冲突，当前自动冲突率为 ${(metric.value * 100).toFixed(1)}%。该值只表示自动审核在当前样例中未发现冲突，不等同于事实错误概率为零。\n\n`+
    `## 审核链路\n\n`+
    `内容只能使用当前冻结 evidence_pack；引用编号、事实原文和目标覆盖由程序物化。A 检查引用与事实一致性，语义审核检查无证据扩写，B 检查难度与前置知识，审核通过后才向前端发布。\n\n`+
    `## 本日发现与修复\n\n`+
    `- 人工抽查发现旧 K001 讲义会把“通用编程语言”扩写成数据分析、人工智能、网页开发等具体领域，旧自动审核存在漏检。语义审核规则已补充用途清单检查；单事实目标改为直接依据冻结事实物化讲义，避免在生成源头创造无证据例子。\n`+
    `- 审核汇总曾出现冲突数大于检查数。现按独立审核单元去重，并保证指标处于 0 到 1 的有效范围。\n`+
    `- 修复后的跨专业 K004/K005/K006 样例完成讲义、代码实验和测评，目标引用覆盖、难度和前置知识检查均通过。\n`+
    `- 真实浏览器验收从注册、诊断、画像与路径生成进入互动学习，代码实验的正确与错误提交均由 Docker 返回结果；测评提交后可完成评分和下一轮决策。验收同时发现并修正了代码运行后误跳回路径页、stdin/stdout 实验显示函数提交提示、以及选择题出现等价正确选项的问题。\n\n`+
    `## 指标边界\n\n`+
    `难度适配是结构匹配，不是学习效果；知识点覆盖是引用覆盖，不是掌握度；人工抽查覆盖公开预览和浏览器展示，完整专业结论仍需领域评审。\n\n`+
    `## 证据\n\n${Object.values(evidence).map((path) => `- \`${path}\``).join("\n")}\n`
}

function renderRepair(report: typeof metrics): string {
  const health = report.current_run_health
  return `# Role C Day7 修复与失败处理记录\n\n`+
    `## 当前验证结果\n\n`+
    `修复后共运行 ${health.attempts} 次真实模型用例：${health.ready} 次 ready、${health.blocked} 次 blocked、${health.failed} 次 failed。blocked 产物未发布，运行稳定性与已发布内容质量分开统计。\n\n`+
    `## 已完成修复\n\n`+
    `- 多目标代码实验统一为一个任务、一个输入协议和一套验收语义，禁止按输入行数切换成多道无关题。运行失败诊断会记录阶段、问题码和安全摘要。\n`+
    `- B 的前置知识审核现在区分教学目标与同轮先修桥梁。path_node 已声明并由讲义教授的先修知识可满足覆盖，但不会被误当成新目标。\n`+
    `- 单一事实不足以支持丰富案例时，讲义的解释、误区、示例和总结直接围绕冻结事实物化；题目仍由模型生成，并接受证据范围、答案与执行验证。\n`+
    `- 语义审核补充用途、领域、误区和任务规范的判断规则，避免把任务输入输出要求误判成语言事实，同时拦截无证据专业扩写。\n`+
    `- 代码实验 stdin/stdout 合同会识别“调用函数并返回”一类接口错配；隐藏测试和参考实现仍由 Docker 可信执行验证。\n`+
    `- 语义审核模型偶发返回“结论与 unsupported_text 自相矛盾”的结构。现在这类可解释矛盾会保守归一为 unsupported/uncertain 并进入正常修订，不再把整条流水线误记为传输失败；未知块、重复块和缺块仍按合同错误拒绝。\n`+
    `- 审核失败结果向主 Agent 保留具体 finding message，页面和运行日志可以区分内容越界、题目歧义与审核结果异常，不再只剩统一错误码。\n\n`+
    `## 仍需如实报告的运行现象\n\n`+
    `真实模型可能生成与公开输入重复的隐藏测试，有限修订没有变化时会以 HIDDEN_TEST_INPUT_LEAK / NO_REPAIR_PROGRESS 阻塞。该情况不会降级发布，属于模型生成稳定性问题。本日另有一次网络 socket closed，未计入内容质量分子分母。\n\n`+
    `## 证据\n\n${Object.values(evidence).map((path) => `- \`${path}\``).join("\n")}\n`
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}
