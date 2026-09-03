import type {
  ArtifactKind,
  ArtifactTaskContractLike,
  ArtifactValidationResult,
  ContractIssue,
} from "./types"

export function validateArtifactContract(input: {
  artifact_kind: ArtifactKind
  contract?: ArtifactTaskContractLike
  artifact: unknown
  required_objective_ids?: string[]
}): ArtifactValidationResult {
  const issues: ContractIssue[] = []
  if (!input.artifact || typeof input.artifact !== "object") {
    return finish(input.artifact_kind, [issue(input.artifact_kind, "ARTIFACT_MISSING", "hard", "缺少实际资源")])
  }
  if (!input.contract) {
    issues.push(issue(input.artifact_kind, "MISSING_ARTIFACT_CONTRACT", "hard", "资源没有独立 artifact task contract"))
    return finish(input.artifact_kind, issues)
  }
  if (input.artifact_kind === "lesson") validateLesson(input.contract, input.artifact, issues)
  else if (input.artifact_kind === "lab") validateLab(input.contract, input.artifact, issues)
  else validateAssessment(input.contract, input.artifact, issues, input.required_objective_ids)
  return finish(input.artifact_kind, issues)
}

function validateLesson(contract: ArtifactTaskContractLike, artifact: unknown, issues: ContractIssue[]) {
  const task = contract.lesson ?? {}
  const record = asRecord(artifact)
  const payload = asRecord(record.payload ?? artifact)
  const text = collectText(artifact)
  const examples = arrayAt(payload, ["worked_examples"]).length
    || occurrences(text, /(?:示例|例如|例题|worked example|```python)/giu)
  if ((task.worked_example_count ?? 0) > examples) {
    issues.push(issue("lesson", "LESSON_EXAMPLES_LOW", "soft", `期望至少 ${task.worked_example_count} 个示例，观测到约 ${examples} 个`))
  }
  if (task.require_step_trace && !/(?:步骤|第[一二三四五\d]+步|逐步|trace|状态变化)/iu.test(text)) {
    issues.push(issue("lesson", "LESSON_STEP_TRACE_MISSING", "soft", "讲义合同要求步骤/状态追踪，但公开内容未观察到"))
  }
  if (task.require_debugging_clinic && !/(?:排错|调试|错误|误区|debug|异常)/iu.test(text)) {
    issues.push(issue("lesson", "LESSON_DEBUGGING_CLINIC_MISSING", "soft", "讲义合同要求排错/误区教学单元"))
  }
  if (task.require_design_tradeoff && !/(?:取舍|比较|权衡|trade-?off|方案)/iu.test(text)) {
    issues.push(issue("lesson", "LESSON_DESIGN_TRADEOFF_MISSING", "soft", "讲义合同要求设计取舍"))
  }
}

function validateLab(contract: ArtifactTaskContractLike, artifact: unknown, issues: ContractIssue[]) {
  const task = contract.lab ?? {}
  const record = asRecord(artifact)
  const payload = asRecord(record.payload ?? artifact)
  const text = collectText(artifact)
  const publicTests = Math.max(
    arrayAt(payload, ["public_tests", "tests.public", "lab.public_tests"]).length,
    arrayAt(asRecord(payload.programming_task), ["public_examples"]).length,
  )
  const publicMinimum = task.public_test_minimum ?? task.minimum_public_tests ?? 0
  if (publicMinimum > publicTests) {
    issues.push(issue("lab", "LAB_PUBLIC_TESTS_LOW", "hard", `公开测试少于合同要求 ${publicMinimum}`))
  }
  const hiddenMinimum = task.hidden_test_minimum ?? task.minimum_hidden_tests ?? 0
  const quality = asRecord(record.quality)
  const verifiedTests = Number(quality.verified_test_count ?? 0)
  // C's verifier reports reference.total_tests from the private hidden suite.
  // Public examples are executed separately and must not be counted twice.
  if (hiddenMinimum > 0 && (quality.execution_verified !== true || !Number.isFinite(verifiedTests) || verifiedTests < hiddenMinimum)) {
    issues.push(issue("lab", "LAB_HIDDEN_TESTS_UNVERIFIED", "hard", "隐藏测试仅在私有执行证据中核验，当前验证数量不足"))
  }
  if (task.require_faulty_starter && !/(?:bug|错误|修复|TODO|pass|notimplemented)/iu.test(text)) {
    issues.push(issue("lab", "LAB_FAULTY_STARTER_MISSING", "soft", "故障实验没有明显的待修复 starter"))
  }
  if (task.require_open_acceptance_criteria && !/(?:验收|acceptance|完成标准|通过条件)/iu.test(text)) {
    issues.push(issue("lab", "LAB_ACCEPTANCE_CRITERIA_MISSING", "soft", "开放任务缺少可观察验收条件"))
  }
  if ((task.learner_owned_dependent_steps ?? 0) > 1 && !/(?:步骤|先.*再|然后|最后|TODO)/iu.test(text)) {
    issues.push(issue("lab", "LAB_DEPENDENT_STEPS_NOT_VISIBLE", "soft", "没有观察到合同要求的多个学习者独立依赖步骤"))
  }
}

function validateAssessment(contract: ArtifactTaskContractLike, artifact: unknown, issues: ContractIssue[], requiredObjectives?: string[]) {
  const task = contract.assessment ?? {}
  const record = asRecord(artifact)
  const payload = asRecord(record.payload ?? artifact)
  const items = arrayAt(payload, ["items", "assessment.items"])
  const expectedItems = task.item_count
    ?? (task.tier_1_count ?? 0) + (task.tier_2_count ?? 0) + (task.tier_3_count ?? 0)
  if (expectedItems > 0 && items.length !== expectedItems) {
    issues.push(issue("assessment", "ASSESSMENT_ITEM_COUNT_MISMATCH", "hard", `题量应为 ${expectedItems}，实际 ${items.length}`))
  }
  const tiers = items.map((item) => Number(asRecord(item).tier))
  const requiredTiers = [task.tier_1_count ?? 0, task.tier_2_count ?? 0, task.tier_3_count ?? 0]
  requiredTiers.forEach((count, index) => {
    if (count > 0 && tiers.filter((tier) => tier === index + 1).length < count) {
      issues.push(issue("assessment", `ASSESSMENT_TIER_${index + 1}_LOW`, "soft", `Tier ${index + 1} 少于合同目标 ${count}`))
    }
  })
  const modalities = items.map((item) => String(asRecord(item).modality ?? ""))
  for (const modality of task.required_modalities ?? []) {
    if (!modalities.includes(modality)) {
      issues.push(issue("assessment", "ASSESSMENT_REQUIRED_MODALITY_MISSING", "hard", `缺少必需题型 ${modality}`))
    }
  }
  if (task.require_independent_code_item && !modalities.some((value) => value === "code" || value === "coding")) {
    issues.push(issue("assessment", "ASSESSMENT_CODE_ITEM_MISSING", "hard", "合同要求独立代码题"))
  }
  if (task.require_boundary_or_counterexample_item && !/(?:边界|反例|异常|错误|counterexample|boundary)/iu.test(collectText(artifact))) {
    issues.push(issue("assessment", "ASSESSMENT_BOUNDARY_ITEM_MISSING", "soft", "合同要求边界/反例测量，但题面未观察到"))
  }
  const objectiveIds = new Set(requiredObjectives ?? arrayAt(payload, ["objective_ids"]).map(String))
  const measured = new Set(items.map((item) => String(asRecord(item).objective_id ?? "")))
  if ([...objectiveIds].some((objectiveId) => !measured.has(objectiveId))) {
    issues.push(issue("assessment", "ASSESSMENT_OBJECTIVE_NOT_MEASURED", "hard", "正式测评没有逐一测量所有核心目标"))
  }
}

function issue(artifact_kind: ArtifactKind, code: string, severity: "hard" | "soft", message: string): ContractIssue {
  return { artifact_kind, code, severity, message }
}

function finish(artifact_kind: ArtifactKind, issues: ContractIssue[]): ArtifactValidationResult {
  const hard = issues.filter((entry) => entry.severity === "hard")
  const soft = issues.filter((entry) => entry.severity === "soft")
  return {
    artifact_kind,
    hard_pass: hard.length === 0,
    soft_score: Math.max(0, 1 - soft.length * 0.15),
    issues,
  }
}

function occurrences(text: string, pattern: RegExp): number {
  return [...text.matchAll(pattern)].length
}

function collectText(value: unknown): string {
  if (typeof value === "string") return value
  if (Array.isArray(value)) return value.map(collectText).join("\n")
  if (!value || typeof value !== "object") return ""
  return Object.values(value as Record<string, unknown>).map(collectText).join("\n")
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function arrayAt(record: Record<string, unknown>, paths: string[]): unknown[] {
  for (const path of paths) {
    let value: unknown = record
    for (const key of path.split(".")) value = asRecord(value)[key]
    if (Array.isArray(value)) return value
  }
  return []
}
