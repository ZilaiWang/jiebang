import { stableId } from "../contracts/common"
import type { ExecutionContract } from "../contracts/artifacts"
import type {
  ProgrammingGoalProfile,
  ProgrammingLearnerLevel,
  ProgrammingProblemBlueprint,
  ProgrammingProgressBand,
  ProgrammingTaskKind,
  TestPartitionPlan,
} from "./contracts"

export interface BuildProgrammingProblemBlueprintInput {
  objective_ids: string[]
  source_ids: string[]
  fact_refs: Array<{ source_id: string; fact_id: string }>
  goal_profile: ProgrammingGoalProfile
  learner_level: ProgrammingLearnerLevel
  progress_band: ProgrammingProgressBand
  title_brief: string
  scenario_brief: string
  learner_owned_behavior: string
  preferred_task_kind?: ProgrammingTaskKind
  execution_contract: ExecutionContract
}

export function buildProgrammingProblemBlueprint(
  input: BuildProgrammingProblemBlueprintInput,
): ProgrammingProblemBlueprint {
  if (input.objective_ids.length === 0) throw new Error("objective_ids 不能为空")
  if (input.source_ids.length === 0) throw new Error("source_ids 不能为空")
  if (input.fact_refs.length === 0) throw new Error("至少需要一个 fact_ref")
  const taskKind = input.preferred_task_kind
    ?? selectProgrammingTaskKind(input.goal_profile, input.learner_level, input.progress_band)
  const objectiveIds = unique(input.objective_ids)
  const complexity = taskComplexity(input.goal_profile, input.progress_band)
  const pureOutput = input.execution_contract.input_contract.type === "none"
  const partitions = pureOutput
    ? [{ partition_id: "nominal", label: "目标输出", kind: "nominal" as const, minimum_cases: 1, generation_instruction: "使用空输入核对冻结输出合同。" }]
    : testPartitionsFor(taskKind, input.progress_band)
  const partitionMinimum = partitions.reduce((total, partition) => total + partition.minimum_cases, 0)
  const body = {
    schema_version: "programming-problem-blueprint.v1" as const,
    objective_ids: objectiveIds,
    source_ids: unique(input.source_ids),
    task_kind: taskKind,
    submission_mode: taskKind === "code_completion" ? "gap_answers" as const : "full_code" as const,
    goal_profile: input.goal_profile,
    learner_level: input.learner_level,
    progress_band: input.progress_band,
    title_brief: normalizedBrief(input.title_brief, "编程实操"),
    scenario_brief: normalizedBrief(input.scenario_brief, "通用学习任务"),
    learner_owned_behavior: normalizedBrief(input.learner_owned_behavior, "完成并验证程序"),
    execution_contract: structuredClone(input.execution_contract),
    test_partitions: partitions,
    public_case_count: pureOutput ? 1 : complexity.publicCases,
    hidden_case_count: pureOutput ? 1 : Math.max(complexity.hiddenCases, partitionMinimum),
    // In a fault-localization task every frozen objective must be exercised by
    // an observable defect. Otherwise a multi-objective contract can demand
    // three learner-owned debugging steps while the problem blueprint asks the
    // author for only two mutations, making a valid task impossible.
    required_mutation_count: pureOutput
      ? 1
      : taskKind === "debugging_repair"
        ? Math.max(complexity.mutations, objectiveIds.length)
        : complexity.mutations,
    require_secondary_oracle: pureOutput ? false : complexity.secondaryOracle,
    fact_refs: deduplicateFacts(input.fact_refs),
  }
  return { ...body, blueprint_id: stableId("PROGRAMMING-PROBLEM", body) }
}

export function selectProgrammingTaskKind(
  goal: ProgrammingGoalProfile,
  level: ProgrammingLearnerLevel,
  progress: ProgrammingProgressBand,
): ProgrammingTaskKind {
  if (goal === "algorithm_competition") return "stdin_stdout_program"
  if (goal === "job_interview") return progress === "needs_reteach"
    ? "code_completion"
    : "debugging_repair"
  if (goal === "project") return progress === "mastered"
    ? "stdin_stdout_program"
    : "function_implementation"
  if (goal === "coursework") {
    if (level === "beginner" || progress === "needs_reteach") return "code_completion"
    return "function_implementation"
  }
  if (level === "beginner" || progress === "needs_reteach") return "code_completion"
  return progress === "ready_for_transfer" || progress === "mastered"
    ? "debugging_repair"
    : "function_implementation"
}

function testPartitionsFor(kind: ProgrammingTaskKind, progress: ProgrammingProgressBand): TestPartitionPlan[] {
  return [
    { partition_id: "nominal", label: "典型输入", kind: "nominal", minimum_cases: 2, generation_instruction: "覆盖题面主流程，数据规模小且便于人工复核。" },
    { partition_id: "boundary", label: "边界输入", kind: "boundary", minimum_cases: progress === "needs_reteach" ? 1 : 2, generation_instruction: "覆盖最小规模、空值、单元素或阈值边界，且符合输入合同。" },
    { partition_id: "anti_hardcode", label: "防硬编码输入", kind: "anti_hardcode", minimum_cases: 1, generation_instruction: "更换公开样例的关键常量，保持相同输入形状。" },
    ...(kind === "debugging_repair" ? [{ partition_id: "error_path", label: "缺陷触发输入", kind: "error_path" as const, minimum_cases: 1, generation_instruction: "稳定触发题目声明的缺陷，正确实现必须通过。" }] : []),
  ]
}

function taskComplexity(goal: ProgrammingGoalProfile, progress: ProgrammingProgressBand) {
  if (goal === "algorithm_competition") return { publicCases: 2, hiddenCases: 8, mutations: 3, secondaryOracle: true }
  if (progress === "mastered") return { publicCases: 2, hiddenCases: 6, mutations: 2, secondaryOracle: true }
  if (progress === "needs_reteach") return { publicCases: 2, hiddenCases: 4, mutations: 1, secondaryOracle: false }
  return { publicCases: 2, hiddenCases: 5, mutations: 2, secondaryOracle: false }
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function normalizedBrief(value: string | undefined, fallback: string): string {
  const normalized = value?.trim()
  return normalized ? normalized : fallback
}

function deduplicateFacts(values: Array<{ source_id: string; fact_id: string }>) {
  const seen = new Set<string>()
  return values.filter((entry) => {
    const key = `${entry.source_id}:${entry.fact_id}`
    if (!entry.source_id.trim() || !entry.fact_id.trim() || seen.has(key)) return false
    seen.add(key)
    return true
  })
}
