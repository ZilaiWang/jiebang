import type { RoleCPedagogyContract } from "../../role-b-profile/pedagogy-contract"

export type TeachingUnitSlotKind =
  | "learning_outcome"
  | "prerequisite_checkpoint"
  | "mental_model"
  | "worked_example"
  | "step_trace"
  | "guided_practice"
  | "independent_practice"
  | "debugging_clinic"
  | "transfer_task"
  | "recap_check"

export interface TeachingEvidenceCapabilities {
  fact_ids: string[]
  prerequisite_fact_ids: string[]
  example_fact_ids: string[]
  misconception_fact_ids: string[]
  procedure_fact_ids: string[]
  supports_executable_code: boolean
}

export interface TeachingUnitSlot {
  kind: TeachingUnitSlotKind
  required: boolean
  fact_ids: string[]
  minimum_count: number
  learner_visible_acceptance: string
}

export interface TeachingUnitContract {
  schema_version: "1.0"
  objective_id: string
  slots: TeachingUnitSlot[]
  required_visible_fact_ids: string[]
  forbidden_shortcuts: string[]
}

export interface TeachingUnitPlanSurface {
  section_kinds: string[]
  worked_example_count: number
  has_micro_check: boolean
  hint_levels: number
  independent_practice_planned: boolean
  transfer_assessment_planned: boolean
}

/** Only the lecture-owned part enters lecture authoring/critique. */
export function conceptOwnedTeachingContract(contract: TeachingUnitContract): TeachingUnitContract {
  return { ...structuredClone(contract), slots: contract.slots.filter(slot =>
    !["independent_practice", "transfer_task", "prerequisite_checkpoint"].includes(slot.kind)).map(slot => structuredClone(slot)) }
}

/**
 * Deterministic pre-generation check that every required teaching function has
 * an owning artifact. It checks structure only; factual correctness remains in
 * the existing claim/evidence audits.
 */
export function validateTeachingUnitPlan(
  contract: TeachingUnitContract,
  surface: TeachingUnitPlanSurface,
): string[] {
  const kinds = new Set(surface.section_kinds)
  const issues: string[] = []
  for (const required of contract.slots.filter((entry) => entry.required)) {
    const satisfied = required.kind === "learning_outcome"
      ? kinds.has("overview")
      : required.kind === "mental_model"
        ? kinds.has("fact_explanation")
        : required.kind === "worked_example"
          ? surface.worked_example_count >= required.minimum_count
          : required.kind === "step_trace"
            ? kinds.has("procedure_steps")
            : required.kind === "guided_practice"
              ? surface.has_micro_check && surface.hint_levels >= 2
              : required.kind === "independent_practice"
                ? surface.independent_practice_planned
                : required.kind === "debugging_clinic"
                  ? kinds.has("boundary") || kinds.has("misconception")
                  : required.kind === "transfer_task"
                    ? surface.transfer_assessment_planned
                    : required.kind === "recap_check"
                      ? kinds.has("recap") && surface.has_micro_check
                      : required.kind === "prerequisite_checkpoint"
                        // prerequisite_bridge is materialized outside objective sections.
                        ? true
                        : false
    if (!satisfied) issues.push(`required teaching slot is not owned by a planned artifact: ${required.kind}`)
  }
  return issues
}

/**
 * Converts profile-driven pedagogy into a deterministic lesson skeleton.
 * The model fills only slots supported by the frozen evidence capabilities.
 */
export function buildTeachingUnitContract(input: {
  objective_id: string
  pedagogy: RoleCPedagogyContract
  evidence: TeachingEvidenceCapabilities
}): TeachingUnitContract {
  const { pedagogy, evidence } = input
  if (evidence.fact_ids.length === 0) throw new Error("TEACHING_UNIT_FACTS_MISSING")

  const slots: TeachingUnitSlot[] = [
    slot("learning_outcome", evidence.fact_ids.slice(0, 1), true,
      "学习者能用可观察动词复述本单元结束时要完成的行为"),
    slot("prerequisite_checkpoint", evidence.prerequisite_fact_ids,
      pedagogy.lesson.require_prerequisite_checkpoint && evidence.prerequisite_fact_ids.length > 0,
      "学习者能在进入正文前判断自己是否具备前置知识"),
    slot("mental_model", evidence.fact_ids, true,
      "学习者能说明概念、规则、边界及其相互关系"),
    slot("worked_example", evidence.example_fact_ids,
      evidence.example_fact_ids.length > 0,
      "例题包含输入、逐步过程、输出和每一步理由",
      evidence.example_fact_ids.length > 0 ? pedagogy.lesson.worked_example_count : 0),
    slot("step_trace", unique([...evidence.procedure_fact_ids, ...evidence.example_fact_ids]),
      pedagogy.lesson.require_step_trace && (evidence.procedure_fact_ids.length > 0 || evidence.example_fact_ids.length > 0),
      "学习者能逐步追踪状态变化，而不是只看到最终答案"),
    slot("guided_practice", evidence.fact_ids, true,
      "任务提供逐级提示，但不直接泄露最终答案"),
    slot("independent_practice", evidence.fact_ids, true,
      "任务给出明确输入、产物、预期结果与验收标准"),
    slot("debugging_clinic", evidence.misconception_fact_ids,
      pedagogy.lesson.require_debugging_clinic && evidence.misconception_fact_ids.length > 0,
      "学习者能识别错误信号、定位原因并执行修复"),
    slot("transfer_task", evidence.fact_ids,
      pedagogy.practice.transfer_distance !== "near",
      "学习者在新表述或新场景中应用同一核心规则"),
    slot("recap_check", evidence.fact_ids, true,
      "学习者完成一次不依赖原文照抄的即时检查"),
  ]

  return {
    schema_version: "1.0",
    objective_id: input.objective_id,
    slots,
    required_visible_fact_ids: unique([
      ...evidence.fact_ids,
      ...evidence.prerequisite_fact_ids,
    ]),
    forbidden_shortcuts: [
      "不得用“请完成一个相关练习”代替具体任务",
      "不得用 fact_id 本身代替答案或解释",
      "不得把无 fact_refs 的示例自动绑定到数组前几条事实",
      "不得仅给最终代码而省略输入、过程、输出与验证",
      "不得因为画像不同而改变事实、答案或评分标准",
    ],
  }
}

function slot(
  kind: TeachingUnitSlotKind,
  factIds: string[],
  required: boolean,
  learnerVisibleAcceptance: string,
  minimumCount?: number,
): TeachingUnitSlot {
  return {
    kind,
    required,
    fact_ids: unique(factIds),
    minimum_count: required ? Math.max(1, minimumCount ?? 1) : 0,
    learner_visible_acceptance: learnerVisibleAcceptance,
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}
