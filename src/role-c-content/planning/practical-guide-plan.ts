import type { CitationRef } from "../contracts/common"
import { stableId } from "../contracts/common"
import type { ExecutionContract, PublicTest } from "../contracts/artifacts"

export type PracticalGuideContractRef =
  | "execution.entry_point"
  | "execution.input_contract"
  | "execution.output_contract"
  | "execution.allowed_imports"
  | "public_tests"

export interface PracticalGuideBinding {
  slot_id: string
  objective_id: string
  citations: CitationRef[]
  contract_refs: PracticalGuideContractRef[]
  public_test_ids: string[]
}

export interface PracticalGuidePlan {
  schema_version: "practical-guide-plan.v1"
  plan_id: string
  lab_id: string
  primary_objective_id: string
  objective_ids: string[]
  goal_context: string
  estimated_minutes: number
  tool_constraints: string[]
  readiness_slots: PracticalGuideBinding[]
  step_slots: Array<PracticalGuideBinding & { sequence: number }>
  troubleshooting_slots: PracticalGuideBinding[]
  extension_slot: PracticalGuideBinding
  acceptance_test_ids: string[]
}

export interface PracticalGuideAuthorPayload {
  practice_goal: string
  deliverable: string
  readiness_checks: Array<{ title: string; check: string; ready_when: string }>
  steps: Array<{ title: string; action: string; input: string; expected_result: string; verification: string }>
  troubleshooting: Array<{ symptom: string; likely_cause: string; recovery_steps: string[]; verification: string }>
  extension_task: { task: string; changed_dimension: string; verification: string }
}

export interface PracticalGuidePublicPayload {
  schema_version: "practical-guide.v1"
  guide_id: string
  plan_id: string
  lab_id: string
  practice_goal: string
  deliverable: string
  estimated_minutes: number
  environment: {
    language: "python"
    execution_mode: "function" | "stdin_stdout"
    entry_point: string | null
    input_type: string
    output_type: string
    allowed_imports: string[]
    tool_constraints: string[]
  }
  readiness_checks: Array<PracticalGuideBinding & { title: string; check: string; ready_when: string }>
  steps: Array<PracticalGuideBinding & { sequence: number; title: string; action: string; input: string; expected_result: string; verification: string }>
  acceptance_criteria: Array<{ criterion_id: string; public_test_id: string; objective_id: string; description: string; expected_behavior: string }>
  troubleshooting: Array<PracticalGuideBinding & { symptom: string; likely_cause: string; recovery_steps: string[]; verification: string }>
  extension_task: PracticalGuideBinding & { task: string; changed_dimension: string; verification: string }
  used_evidence: CitationRef[]
}

/** Frozen structure and evidence/test bindings.  The model owns prose only. */
export function buildPracticalGuidePlan(input: {
  lab_id: string
  objective_ids: string[]
  primary_objective_id: string
  goal_context: string
  scaffold_strength: number
  session_minutes: number
  require_troubleshooting: boolean
  tool_constraints: string[]
  objective_fact_refs: Record<string, CitationRef[]>
  prerequisite_fact_refs: CitationRef[]
  public_tests: Array<{ test_id: string; objective_id: string }>
}): PracticalGuidePlan {
  const objectiveIds = unique(input.objective_ids)
  if (!input.lab_id.trim() || objectiveIds.length === 0 || !objectiveIds.includes(input.primary_objective_id)) {
    throw new Error("PRACTICAL_GUIDE_PLAN_IDENTITY_INVALID")
  }
  if (input.public_tests.length === 0) throw new Error("PRACTICAL_GUIDE_PLAN_PUBLIC_TESTS_EMPTY")
  const count = input.scaffold_strength >= 4 ? 5 : input.scaffold_strength >= 3 ? 4 : 3
  const binding = (
    kind: string,
    index: number,
    objectiveId: string,
    contractRefs: PracticalGuideContractRef[],
    publicTestIds: string[] = [],
    citations: CitationRef[] = input.objective_fact_refs[objectiveId] ?? [],
  ): PracticalGuideBinding => {
    if (citations.length === 0 && contractRefs.length === 0 && publicTestIds.length === 0) {
      throw new Error(`PRACTICAL_GUIDE_SLOT_UNBOUND:${kind}:${index}`)
    }
    return {
      slot_id: stableId("GUIDE-SLOT", { lab_id: input.lab_id, kind, index, objective_id: objectiveId }),
      objective_id: objectiveId,
      citations: deduplicateCitations(citations),
      contract_refs: [...new Set(contractRefs)],
      public_test_ids: unique(publicTestIds),
    }
  }
  const readiness = input.prerequisite_fact_refs.length > 0
    ? [binding("readiness", 0, input.primary_objective_id, [], [], input.prerequisite_fact_refs)]
    : [binding("readiness", 0, input.primary_objective_id, ["execution.input_contract"])]
  const supporting = objectiveIds.filter((id) => id !== input.primary_objective_id)
  const allTestIds = input.public_tests.map((test) => test.test_id)
  const steps = Array.from({ length: count }, (_, index) => {
    const objectiveId = index === 0 || index === count - 1
      ? input.primary_objective_id
      : supporting[(index - 1) % Math.max(1, supporting.length)] ?? input.primary_objective_id
    const related = input.public_tests.filter((test) => test.objective_id === objectiveId).map((test) => test.test_id)
    return {
      ...binding(
        "step",
        index,
        objectiveId,
        [
          ...(index === 0 ? ["execution.input_contract" as const] : []),
          ...(index === count - 1 ? ["execution.output_contract" as const, "public_tests" as const] : []),
        ],
        index === count - 1 ? (related.length ? related : allTestIds) : [],
      ),
      sequence: index + 1,
    }
  })
  const troubleshooting = Array.from({ length: input.require_troubleshooting ? 2 : 1 }, (_, index) =>
    binding(
      "troubleshooting",
      index,
      input.primary_objective_id,
      index === 0 ? ["execution.output_contract", "public_tests"] : ["execution.input_contract"],
      index === 0 ? allTestIds : [],
    ))
  const extension = binding(
    "extension",
    0,
    input.primary_objective_id,
    ["execution.output_contract", "public_tests"],
    allTestIds,
  )
  const identity = {
    lab_id: input.lab_id,
    objectives: objectiveIds,
    primary: input.primary_objective_id,
    readiness,
    steps,
    troubleshooting,
    extension,
  }
  return deepFreeze({
    schema_version: "practical-guide-plan.v1",
    plan_id: stableId("PRACTICAL-GUIDE-PLAN", identity),
    lab_id: input.lab_id,
    primary_objective_id: input.primary_objective_id,
    objective_ids: objectiveIds,
    goal_context: input.goal_context.trim(),
    estimated_minutes: Math.max(10, Math.min(120, Math.round(input.session_minutes))),
    tool_constraints: unique(input.tool_constraints),
    readiness_slots: readiness,
    step_slots: steps,
    troubleshooting_slots: troubleshooting,
    extension_slot: extension,
    acceptance_test_ids: unique(allTestIds),
  })
}

export function materializePracticalGuide(input: {
  plan: PracticalGuidePlan
  author: PracticalGuideAuthorPayload
  execution_contract: ExecutionContract
  public_tests: PublicTest[]
}): PracticalGuidePublicPayload {
  const issues = validatePracticalGuideAuthorAgainstPlan(input.author, input.plan)
  if (issues.length > 0) throw new Error(`PRACTICAL_GUIDE_AUTHOR_INVALID:${issues.join("|")}`)
  const tests = new Map(input.public_tests.map((test) => [test.test_id, test]))
  const acceptance = input.plan.acceptance_test_ids.map((testId) => {
    const test = tests.get(testId)
    if (!test) throw new Error(`PRACTICAL_GUIDE_PUBLIC_TEST_MISSING:${testId}`)
    return {
      criterion_id: stableId("GUIDE-ACCEPTANCE", { plan_id: input.plan.plan_id, test_id: testId }),
      public_test_id: testId,
      objective_id: test.objective_id,
      description: required(test.description, `public_test.${testId}.description`),
      expected_behavior: required(test.expected_behavior, `public_test.${testId}.expected_behavior`),
    }
  })
  const usedEvidence = deduplicateCitations([
    ...input.plan.readiness_slots.flatMap((slot) => slot.citations),
    ...input.plan.step_slots.flatMap((slot) => slot.citations),
    ...input.plan.troubleshooting_slots.flatMap((slot) => slot.citations),
    ...input.plan.extension_slot.citations,
  ])
  return {
    schema_version: "practical-guide.v1",
    guide_id: stableId("PRACTICAL-GUIDE", { plan_id: input.plan.plan_id, author: input.author }),
    plan_id: input.plan.plan_id,
    lab_id: input.plan.lab_id,
    practice_goal: input.author.practice_goal.trim(),
    deliverable: input.author.deliverable.trim(),
    estimated_minutes: input.plan.estimated_minutes,
    environment: {
      language: "python",
      execution_mode: input.execution_contract.execution_mode,
      entry_point: input.execution_contract.entry_point?.trim() || null,
      input_type: required(input.execution_contract.input_contract.type, "execution.input_contract.type"),
      output_type: required(input.execution_contract.output_contract.type, "execution.output_contract.type"),
      allowed_imports: unique(input.execution_contract.allowed_imports),
      tool_constraints: [...input.plan.tool_constraints],
    },
    readiness_checks: input.author.readiness_checks.map((entry, index) => ({ ...clone(input.plan.readiness_slots[index]!), ...trim(entry) })),
    steps: input.author.steps.map((entry, index) => ({ ...clone(input.plan.step_slots[index]!), ...trim(entry) })),
    acceptance_criteria: acceptance,
    troubleshooting: input.author.troubleshooting.map((entry, index) => ({
      ...clone(input.plan.troubleshooting_slots[index]!),
      symptom: entry.symptom.trim(), likely_cause: entry.likely_cause.trim(),
      recovery_steps: entry.recovery_steps.map((step) => step.trim()).filter(Boolean),
      verification: entry.verification.trim(),
    })),
    extension_task: { ...clone(input.plan.extension_slot), ...trim(input.author.extension_task) },
    used_evidence: usedEvidence,
  }
}

export function validatePracticalGuideAuthorAgainstPlan(author: PracticalGuideAuthorPayload, plan: PracticalGuidePlan): string[] {
  const issues: string[] = []
  if (!author.practice_goal?.trim()) issues.push("practice_goal 不能为空")
  if (!author.deliverable?.trim()) issues.push("deliverable 不能为空")
  if (author.readiness_checks?.length !== plan.readiness_slots.length) issues.push(`readiness_checks 数量应为 ${plan.readiness_slots.length}`)
  if (author.steps?.length !== plan.step_slots.length) issues.push(`steps 数量应为 ${plan.step_slots.length}`)
  if (author.troubleshooting?.length !== plan.troubleshooting_slots.length) issues.push(`troubleshooting 数量应为 ${plan.troubleshooting_slots.length}`)
  const values: unknown[] = [author.readiness_checks, author.steps, author.troubleshooting, author.extension_task]
  if (values.some((value) => value == null)) return [...issues, "practical_guide 结构不完整"]
  author.readiness_checks.forEach((entry, index) => checkTexts(entry, `readiness_checks[${index}]`, issues))
  author.steps.forEach((entry, index) => checkTexts(entry, `steps[${index}]`, issues))
  author.troubleshooting.forEach((entry, index) => {
    checkTexts({ symptom: entry.symptom, likely_cause: entry.likely_cause, verification: entry.verification }, `troubleshooting[${index}]`, issues)
    if (!entry.recovery_steps?.length || entry.recovery_steps.some((step) => !step.trim())) issues.push(`troubleshooting[${index}].recovery_steps 无效`)
  })
  checkTexts(author.extension_task, "extension_task", issues)
  return issues
}

function checkTexts(value: Record<string, string>, path: string, issues: string[]): void {
  Object.entries(value).forEach(([key, text]) => { if (!text?.trim()) issues.push(`${path}.${key} 不能为空`) })
}
function trim<T extends Record<string, string>>(value: T): T { return Object.fromEntries(Object.entries(value).map(([key, text]) => [key, text.trim()])) as T }
function required(value: string, path: string): string { const result = value.trim(); if (!result) throw new Error(`${path}:EMPTY`); return result }
function unique(values: string[]): string[] { return [...new Set(values.map((value) => value.trim()).filter(Boolean))] }
function deduplicateCitations(values: CitationRef[]): CitationRef[] { return [...new Map(values.map((value) => [`${value.source_id}:${value.fact_id}:${value.relation}`, clone(value)])).values()] }
function clone<T>(value: T): T { return structuredClone(value) }
function deepFreeze<T>(value: T): T { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); Object.values(value as Record<string, unknown>).forEach(deepFreeze) }; return value }
