import { contentHash } from "../contracts/common"
import type { ProgrammingProblemBlueprint, TestInputCandidate } from "./contracts"
import type { PythonFunctionInterface } from "./python-function-interface"
import { validateFunctionInvocationAgainstInterface } from "./python-function-interface"

export interface TestPackQualityReport {
  ok: boolean
  issues: string[]
  partition_coverage: number
  unique_input_ratio: number
  public_hidden_overlap_count: number
}

export function validateInputCandidates(
  blueprint: ProgrammingProblemBlueprint,
  publicInputs: Array<{ input: unknown }>,
  hiddenInputs: TestInputCandidate[],
  functionInterface?: PythonFunctionInterface,
): TestPackQualityReport {
  const issues: string[] = []
  if (publicInputs.length < blueprint.public_case_count) {
    issues.push(`公开测试不足：需要 ${blueprint.public_case_count}，实际 ${publicInputs.length}`)
  }
  if (hiddenInputs.length < blueprint.hidden_case_count) {
    issues.push(`隐藏测试不足：需要 ${blueprint.hidden_case_count}，实际 ${hiddenInputs.length}`)
  }
  const hasPerCaseInput = blueprint.execution_contract.input_contract.type !== "none"
  const publicHashes = new Set(publicInputs.map((entry) => contentHash(entry.input)))
  const hiddenHashes = hiddenInputs.map((entry) => contentHash(entry.input))
  // 纯输出任务没有测试向量，公开与隐藏执行都只能使用同一个空输入。
  // 此时可信性的区分来自服务端 expected，而不是人为伪造不同的空输入。
  const overlap = hasPerCaseInput
    ? hiddenHashes.filter((hash) => publicHashes.has(hash)).length
    : 0
  if (overlap > 0) issues.push(`公开/隐藏测试输入重叠 ${overlap} 个`)
  const allHashes = hasPerCaseInput ? [...publicHashes, ...hiddenHashes] : hiddenHashes
  const uniqueCount = new Set(allHashes).size
  if (hasPerCaseInput && uniqueCount !== allHashes.length) issues.push("测试输入存在重复")
  let satisfied = 0
  for (const partition of blueprint.test_partitions) {
    const count = hiddenInputs.filter((entry) => entry.partition_id === partition.partition_id).length
    if (count < partition.minimum_cases) {
      issues.push(`${partition.label}隐藏测试不足：需要 ${partition.minimum_cases}，实际 ${count}`)
    } else satisfied += 1
  }
  if (functionInterface) {
    publicInputs.forEach((entry, index) => {
      validateFunctionInvocationAgainstInterface(entry.input, functionInterface)
        .forEach((message) => issues.push(`公开测试 ${index + 1}：${message}`))
    })
    hiddenInputs.forEach((entry, index) => {
      validateFunctionInvocationAgainstInterface(entry.input, functionInterface)
        .forEach((message) => issues.push(`隐藏测试 ${index + 1}：${message}`))
    })
  }
  return {
    ok: issues.length === 0,
    issues,
    partition_coverage: blueprint.test_partitions.length === 0 ? 1 : satisfied / blueprint.test_partitions.length,
    unique_input_ratio: allHashes.length === 0 ? 1 : uniqueCount / allHashes.length,
    public_hidden_overlap_count: overlap,
  }
}
