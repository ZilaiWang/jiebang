import type { DifficultyVector, GenerationSpec } from "./generation-spec"
import type { AssessmentBlueprint, ObservableBehavior } from "./profile-adapter"

export type GenerationArtifactKind =
  | "concept_lesson"
  | "code_lab"
  | "assessment"
/** Concrete authoring requirements. Evaluation labels deliberately do not belong here. */
export interface ArtifactTaskContractV2 {
  contract_version: "artifact-task.v2"
  artifact_kind: GenerationArtifactKind
  task_shape: string
  behavior: ObservableBehavior
  target_count: number
  difficulty_vector: DifficultyVector
  common: {
    preserve_locked_facts: true
    preserve_objectives: true
    require_direct_core_measurement: true
    forbid_expected_difficulty_label: true
  }
  lesson?: {
    worked_example_count: 1 | 2 | 3
    max_new_terms_before_gloss: number
    require_step_trace: boolean
    require_debugging_clinic: boolean
    require_design_tradeoff: boolean
  }
  lab?: {
    learner_owned_dependent_steps: number
    starter_completion_ratio_ceiling: number
    public_test_minimum: number
    hidden_test_minimum: number
    boundary_case_minimum: number
    require_faulty_starter: boolean
    require_open_acceptance_criteria: boolean
  }
  assessment?: AssessmentBlueprint & {
    require_independent_code_item: boolean
    require_boundary_or_counterexample_item: boolean
  }
}
export type ArtifactTaskContractsV2 = Record<
  GenerationArtifactKind,
  ArtifactTaskContractV2
>
export const GENERATION_ARTIFACT_KINDS = [
  "concept_lesson",
  "code_lab",
  "assessment",
] as const

/** Authoring a single item must not also request the parent five-item form. */
export function projectAssessmentTask(
  task: ArtifactTaskContractV2 | undefined,
  item: {
    tier: 1 | 2 | 3
    modality: AssessmentBlueprint["required_modalities"][number]
    task_requirements?: { boundary_or_counterexample: boolean }
  },
): ArtifactTaskContractV2 | undefined {
  if (!task) return undefined
  return {
    ...structuredClone(task),
    target_count: 1,
    assessment: {
      ...task.assessment!,
      tier_1_count: item.tier === 1 ? 1 : 0,
      tier_2_count: item.tier === 2 ? 1 : 0,
      tier_3_count: item.tier === 3 ? 1 : 0,
      required_modalities: [item.modality],
      require_independent_code_item: item.modality === "code",
      require_boundary_or_counterexample_item:
        item.task_requirements?.boundary_or_counterexample ?? false,
    },
  }
}

export function artifactDifficulty(
  spec: Pick<GenerationSpec, "difficulty" | "artifact_tasks">,
  kind: GenerationArtifactKind,
): DifficultyVector {
  return structuredClone(
    spec.artifact_tasks?.[kind].difficulty_vector ?? spec.difficulty,
  )
}

/** Compatibility summary only: no individual author uses this maximum when tasks are supplied. */
export function aggregateArtifactDifficulty(
  tasks: ArtifactTaskContractsV2,
): DifficultyVector {
  const keys = new Set(
    GENERATION_ARTIFACT_KINDS.flatMap((k) =>
      Object.keys(tasks[k].difficulty_vector),
    ),
  )
  return Object.fromEntries(
    [...keys].map((key) => [
      key,
      Math.max(
        ...GENERATION_ARTIFACT_KINDS.map(
          (k) => tasks[k].difficulty_vector[key as keyof DifficultyVector] ?? 0,
        ),
      ),
    ]),
  ) as unknown as DifficultyVector
}

export function validateArtifactTaskAlignment(
  tasks: ArtifactTaskContractsV2,
  targets: GenerationSpec["targets"],
  blueprint: AssessmentBlueprint,
): string[] {
  const issues: string[] = []
  for (const kind of GENERATION_ARTIFACT_KINDS) {
    const task = tasks[kind]
    if (
      !task ||
      task.artifact_kind !== kind ||
      task.contract_version !== "artifact-task.v2"
    ) {
      issues.push(`artifact_tasks.${kind}: invalid identity`)
      continue
    }
    const vector = task.difficulty_vector
    const required = [
      "domain_complexity",
      "cognitive_demand",
      "reasoning_steps",
      "code_complexity",
      "prerequisite_load",
      "scaffold_strength",
    ] as const
    if (
      !vector ||
      required.some((key) => !Number.isFinite(vector[key])) ||
      Object.values(vector).some(
        (value) =>
          typeof value !== "number" ||
          !Number.isFinite(value) ||
          value < 0 ||
          value > 5,
      )
    )
      issues.push(
        `artifact_tasks.${kind}: difficulty values must be finite numbers in 0..5`,
      )
    if (task.target_count !== new Set(targets.map((t) => t.source_id)).size)
      issues.push(`artifact_tasks.${kind}: target_count mismatch`)
    if (!targets.some((t) => t.observable_behavior === task.behavior))
      issues.push(`artifact_tasks.${kind}: behavior not in objectives`)
    if (
      (kind === "concept_lesson" && !task.lesson) ||
      (kind === "code_lab" && !task.lab) ||
      (kind === "assessment" && !task.assessment)
    )
      issues.push(`artifact_tasks.${kind}: missing constraints`)
  }
  const assessment = tasks.assessment?.assessment
  if (
    assessment &&
    (["tier_1_count", "tier_2_count", "tier_3_count"] as const).some(
      (k) => assessment[k] !== blueprint[k],
    )
  )
    issues.push("artifact_tasks.assessment: tier counts differ from blueprint")
  if (
    assessment &&
    (!Array.isArray(assessment.required_modalities) ||
      JSON.stringify([...assessment.required_modalities].sort()) !==
        JSON.stringify([...blueprint.required_modalities].sort()))
  )
    issues.push("artifact_tasks.assessment: modalities differ from blueprint")
  return issues
}

/** Same-node learning adjustments retain task identity and fact/answer boundaries. */
export function adaptArtifactTasks(
  tasks: ArtifactTaskContractsV2 | undefined,
  action: string | undefined,
): ArtifactTaskContractsV2 | undefined {
  if (!tasks) return undefined
  const result = structuredClone(tasks)
  if (action !== "remediate" && action !== "reinforce") return result
  for (const task of Object.values(result)) {
    const v = task.difficulty_vector
    v.scaffold_strength = Math.max(
      0,
      Math.min(5, v.scaffold_strength + (action === "remediate" ? 1 : -1)),
    )
    if (action === "remediate") {
      v.reasoning_steps = Math.max(1, v.reasoning_steps - 1)
      v.transfer_distance = Math.max(0, (v.transfer_distance ?? 0) - 1)
      if (task.lab)
        task.lab.learner_owned_dependent_steps = Math.max(
          1,
          task.lab.learner_owned_dependent_steps - 1,
        )
    }
  }
  return result
}

export function planArtifactTasks(input: {
  behavior: ObservableBehavior
  target_count: number
  level: string
  blueprint: AssessmentBlueprint
  shapes?: Record<GenerationArtifactKind, string>
}): ArtifactTaskContractsV2 {
  const behavior = input.behavior,
    n = input.target_count,
    b = behavior === "recognize" ? "explain" : behavior
  const vectors: Record<string, number[]> = {
    explain: [1, 1, 1, 1, 0, 4, 0, 0, 0],
    apply: [2, 2, 2, 2, 1, 3, 1, 1, Math.min(2, n - 1)],
    trace: [3, 3, 3, 3, 2, 2, 2, 2, 2],
    debug: [3, 3, 4, 3, 2, 2, 2, 3, 2],
    create: [4, 4, 4, 4, 3, 1, 4, 3, 4],
  }
  const vector = (kind: GenerationArtifactKind): DifficultyVector => {
    const values = [...vectors[b]!]
    if (kind === "concept_lesson") {
      if (b === "trace")
        values.splice(0, 9, 2, 2, 2, 1, 1, 3, 1, 1, Math.min(2, n - 1))
      else if (b === "create") values.splice(0, 9, 3, 3, 3, 2, 2, 2, 2, 2, 2)
      else if (b === "explain" || b === "apply")
        values[3] = b === "explain" ? 0 : 1
    }
    return Object.fromEntries(
      [
        "domain_complexity",
        "cognitive_demand",
        "reasoning_steps",
        "code_complexity",
        "prerequisite_load",
        "scaffold_strength",
        "transfer_distance",
        "boundary_condition_density",
        "task_composition",
      ].map((key, index) => [key, values[index]]),
    ) as unknown as DifficultyVector
  }
  const common = {
    preserve_locked_facts: true,
    preserve_objectives: true,
    require_direct_core_measurement: true,
    forbid_expected_difficulty_label: true,
  } as const
  const base = (kind: GenerationArtifactKind) => ({
    contract_version: "artifact-task.v2" as const,
    artifact_kind: kind,
    behavior,
    target_count: n,
    task_shape: input.shapes?.[kind] ?? `${kind}:${behavior}`,
    common,
    difficulty_vector: vector(kind),
  })
  return {
    concept_lesson: {
      ...base("concept_lesson"),
      lesson: {
        worked_example_count:
          b === "explain" || input.level === "beginner"
            ? 3
            : b === "apply"
              ? 2
              : 1,
        max_new_terms_before_gloss:
          input.level === "beginner" ? 2 : input.level === "basic" ? 4 : 7,
        require_step_trace: ["trace", "debug", "create"].includes(b),
        require_debugging_clinic: b === "debug",
        require_design_tradeoff: b === "create",
      },
    },
    code_lab: {
      ...base("code_lab"),
      lab: {
        learner_owned_dependent_steps:
          b === "create"
            ? Math.max(4, n + 1)
            : b === "explain"
              ? 1
              : b === "apply"
                ? 2
                : 3,
        starter_completion_ratio_ceiling: {
          explain: 0.9,
          apply: 0.65,
          trace: 0.5,
          debug: 0.45,
          create: 0.2,
        }[b]!,
        public_test_minimum: b === "explain" ? 1 : b === "create" ? 3 : 2,
        hidden_test_minimum: b === "explain" ? 1 : b === "create" ? 4 : 2,
        boundary_case_minimum:
          b === "create" ? 3 : b === "debug" ? 2 : b === "trace" ? 1 : 0,
        require_faulty_starter: b === "debug",
        require_open_acceptance_criteria: b === "create",
      },
    },
    assessment: {
      ...base("assessment"),
      assessment: {
        ...structuredClone(input.blueprint),
        require_independent_code_item: ["apply", "debug", "create"].includes(b),
        require_boundary_or_counterexample_item: [
          "trace",
          "debug",
          "create",
        ].includes(b),
      },
    },
  }
}

export function tasksForNextPath(
  parent: GenerationSpec,
  targets: GenerationSpec["targets"],
  blueprint: AssessmentBlueprint,
  level: string,
  action?: string,
): ArtifactTaskContractsV2 | undefined {
  if (!parent.artifact_tasks) return undefined
  const same =
    JSON.stringify(
      parent.targets.map((t) => [t.source_id, t.observable_behavior]),
    ) ===
    JSON.stringify(targets.map((t) => [t.source_id, t.observable_behavior]))
  const tasks = same
    ? structuredClone(parent.artifact_tasks)
    : planArtifactTasks({
        behavior:
          targets.find((t) => t.is_primary)?.observable_behavior ??
          targets[0]!.observable_behavior,
        target_count: new Set(targets.map((t) => t.source_id)).size,
        level,
        blueprint,
      })
  Object.assign(tasks.assessment.assessment!, structuredClone(blueprint))
  return adaptArtifactTasks(tasks, action)
}
