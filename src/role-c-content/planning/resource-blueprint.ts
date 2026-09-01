import type { AssessmentItemPublic } from "../contracts/artifacts"
import { contentHash, stableId, type CitationRef } from "../contracts/common"
import type { RagEvidencePack } from "../contracts/evidence-pack"
import { adaptationDefaults, type GenerationSpec } from "../contracts/generation-spec"
import type { AssessmentBlueprint } from "../contracts/profile-adapter"
import type { AssessmentCapacityPlan } from "./assessment-capacity"
import { assessObjectiveSupport } from "./artifact-feasibility"
import { conceptModeForSupport } from "./concept-section-plan"
import {
  splitDifficultyVector,
  type ChallengeVector,
  type SupportProfile,
  type ResourceFitKind,
} from "../contracts/resource-fit"
import {
  buildAssessmentItemPlan,
  buildCodeLabObjectivePlan,
  buildCodeLabSecurePlan,
  buildLabIdentity,
  type AssessmentItemPlan,
  type CodeLabObjectivePlan,
  type CodeLabSecurePlan,
} from "../providers/staged-generation"
import {
  buildLearningDesignSpecV2,
  type LearningDesignSpecV2,
} from "./learning-design-spec-v2"
import {
  buildAssessmentTaxonomyPlan,
  type AssessmentTaxonomyPlan,
} from "./assessment-taxonomy"
import {
  buildPracticalGuidePlan,
  type PracticalGuidePlan,
} from "./practical-guide-plan"
import {
  buildProgrammingProblemBlueprint,
  selectProgrammingTaskKind,
} from "../programming/problem-blueprint"
import type { ProgrammingProblemBlueprint } from "../programming/contracts"

export interface ResourceBlueprintObjective {
  objective_id: string
  source_id: string
  observable_behavior: GenerationSpec["targets"][number]["observable_behavior"]
  importance: GenerationSpec["targets"][number]["importance"]
  required_fact_ids: string[]
  citations: CitationRef[]
  concept: {
    /** Stable objective order. Provider-specific batching is intentionally separate. */
    sequence_index: number
    /** 讲义创作模式（改进方案5 第六节）：由事实内容与数量决定，比 sparse_safe 更细。 */
    mode: "definition_only" | "guided_explanation" | "procedural" | "comparative"
    required_parts: Array<"explanation" | "worked_example" | "misconception" | "micro_check" | "hints" | "summary">
    prerequisite_source_ids: string[]
  }
  code_lab: {
    instruction_block_id: string
    public_test_id: string
    hidden_test_ids: string[]
    practice_behavior: "guided_implementation"
  }
  assessment: Array<{
    item_id: string
    tier: 1 | 2 | 3
    modality: AssessmentItemPublic["modality"]
    max_score: number
    cognitive_operation: string
  }>
}

/**
 * CodeLab 的外部执行契约由 planning 层决定，而不是生成阶段用 evidence 关键词猜。
 *
 * - task_kind 回答"这一道 code-lab 被设计成什么外部任务"：
 *   callable_function = 判题器调用入口函数（execution_mode=function）
 *   stdin_stdout_program = 判题器喂 stdin、比较 stdout（execution_mode=stdin_stdout）
 * - primary_objective_id 显式标记本轮主要教学目标（来自上游 is_primary，
 *   不依赖数组顺序）；其余 objectives 只是支撑证据。
 * - execution_mode 是 task_kind 的直接映射，绝不因学习者水平而变（能力影响难度，不影响 ABI）。
 * - 程序入口/输入形式/输出形式/判题调用方式/输出约束是任务设计的完整契约，
 *   约束模型生成题面与评测时保持一致（先设计题，再定判题接口）。
 */
export interface CodeLabTaskContract {
  task_kind: "callable_function" | "stdin_stdout_program"
  /** 学习者实际承担的工作；低证据能力目标不被迫完成证据外的编程任务。 */
  learner_action: "recall_fact" | "implement_program" | "implement_function"
  learner_owned_region: "fact_literal" | "program_logic" | "function_body"
  primary_objective_id: string
  execution_mode: "function" | "stdin_stdout"
  /** 程序入口：function = "入口函数（def 定义，函数名由 instruction 指定）"；stdin_stdout = "stdin→stdout"。 */
  program_entry: string
  /** 输入形式：判题器向学习者程序提供输入的方式。 */
  input_form: "function_arguments" | "stdin_lines" | "none"
  /** stdin 的确切布局由 planning 冻结，避免 public/secure 各自猜测行数。 */
  stdin_layout: "none" | "single_line_text"
  /** 输出形式：判题器比较学习者程序的哪种产物。 */
  output_form: "return_value" | "stdout_lines"
  /** 判题调用方式：判题器如何驱动学习者程序。 */
  grading_invocation: "call_entry_function" | "feed_stdin_compare_stdout"
  /** 返回值或标准输出约束（模型命制题面/评测时遵循，不得混用）。 */
  output_constraint: string
  /** Function tasks use one planning-owned entry point across authoring and judging. */
  entry_point?: string
}

/**
 * One deterministic teaching decision shared by all three Role C agents.
 * The model authors explanations and tasks; this blueprint owns identities,
 * evidence bindings, coverage, assessment modality and score allocation.
 */
export interface ResourceBlueprint {
  schema_version: "1.0"
  blueprint_id: string
  spec_id: string
  evidence_ref: string
  evidence_content_hash: string
  objectives: ResourceBlueprintObjective[]
  /** Shared instructional decision consumed by all three authoring agents. */
  learning_design: LearningDesignSpecV2
  /**
   * 三类资源各自的目标难度（Target Resource Difficulty）：讲义/代码实验/测评
   * 分别冻结 challenge（越大越难）与 support（越大支持越强）目标。
   * 不再由三类资源共用同一份 DifficultyVector——测评应低支架、讲义应高支架。
   */
  difficulty_plan: ResourceDifficultyPlan
  code_lab: {
    lab_id: string
    test_suite_id: string
    objective_plan: CodeLabObjectivePlan[]
    secure_plan: CodeLabSecurePlan
    task_contract: CodeLabTaskContract
    practical_guide_plan: PracticalGuidePlan
    programming_problem: ProgrammingProblemBlueprint
  }
  assessment: {
    item_plan: AssessmentItemPlan[]
    taxonomy: AssessmentTaxonomyPlan
    total_items: number
    total_score: number
    /** 生成前容量规划的显式结果；REDUCE 时说明为何实际题量少于上游请求。 */
    capacity: Pick<
      AssessmentCapacityPlan,
      "decision" | "requested_items" | "feasible_items" | "limiting_factors"
    >
  }
  /** Deterministic division of labor prepared before any artifact is authored. */
  cross_artifact_contract: {
    concept_responsibilities: string[]
    code_lab_responsibilities: string[]
    assessment_responsibilities: string[]
    forbidden_duplicate_behaviors: string[]
  }
  /** Whether one compact High reasoning plan is justified before FAST rendering. */
  quality_requirement: {
    profile: "fast" | "quality"
    reason_codes: string[]
    policy_version: "glm52-policy-v1"
    decision_hash: string
  }
}

export interface ResourceDifficultyPlanEntry {
  challenge_target: ChallengeVector
  support_target: SupportProfile
}

export type ResourceDifficultyPlan = Record<ResourceFitKind, ResourceDifficultyPlanEntry>

export interface ResourceBlueprintOptions {
  assessment_blueprint?: AssessmentBlueprint
  assessment_capacity?: AssessmentCapacityPlan
}

/**
 * ResourceBlueprint 是容量规划后的测评执行合同。存在 blueprint 时，题量必须以
 * item_plan 为准；required modalities 仍来自上游教学意图，并已由 item planner 安置。
 */
export function effectiveAssessmentBlueprint(
  spec: GenerationSpec,
  blueprint?: ResourceBlueprint,
): AssessmentBlueprint {
  if (!blueprint) return structuredClone(spec.assessment_blueprint)
  return {
    tier_1_count: blueprint.assessment.item_plan.filter((item) => item.tier === 1).length,
    tier_2_count: blueprint.assessment.item_plan.filter((item) => item.tier === 2).length,
    tier_3_count: blueprint.assessment.item_plan.filter((item) => item.tier === 3).length,
    required_modalities: [...spec.assessment_blueprint.required_modalities],
  }
}

export function buildResourceBlueprint(
  spec: GenerationSpec,
  evidence: RagEvidencePack,
  options: ResourceBlueprintOptions = {},
): ResourceBlueprint {
  const evidenceHash = contentHash(evidence)
  if (evidence.retrieval_id !== spec.evidence_ref
    || evidenceHash !== spec.evidence_content_hash) {
    throw new Error("RESOURCE_BLUEPRINT_EVIDENCE_IDENTITY_MISMATCH")
  }
  const identity = buildLabIdentity(spec)
  const taskContract = decideCodeLabTaskContract(spec, evidence)
  const codeObjectivePlan = buildCodeLabObjectivePlan(spec, evidence, taskContract)
  const misconceptionIdsByObjective = Object.fromEntries(spec.targets.map((target) => {
    const evidenceItem = evidence.results.find((item) => item.source_id === target.source_id)
    const misconception = evidenceItem?.misconceptions?.find((entry) =>
      entry.factRefs.some((ref) => ref.sourceId === target.source_id
        && target.required_fact_ids.includes(ref.factId)))
    return [target.objective_id, misconception?.misconceptionId
      ?? `MIS-${target.objective_id}-COMMON-ERROR`]
  }))
  const assessmentSpec = options.assessment_blueprint
    ? { ...spec, assessment_blueprint: options.assessment_blueprint }
    : spec
  const baseAssessmentPlan = buildAssessmentItemPlan(assessmentSpec, evidence)
  const assessmentCapacity = options.assessment_capacity
    ? {
        decision: options.assessment_capacity.decision,
        requested_items: options.assessment_capacity.requested_items,
        feasible_items: options.assessment_capacity.feasible_items,
        limiting_factors: [...options.assessment_capacity.limiting_factors],
      }
    : {
        decision: "FULL" as const,
        requested_items: baseAssessmentPlan.length,
        feasible_items: baseAssessmentPlan.length,
        limiting_factors: [],
      }
  const crossArtifactContract = buildCrossArtifactContract()
  const qualityRequirement = decideQualityRequirement(assessmentSpec, codeObjectivePlan.length)
  // 容量缩减后，目标难度必须来自实际执行的 assessment blueprint。
  const difficultyPlan = buildDifficultyPlan(assessmentSpec, {
    assessment_plan: baseAssessmentPlan,
  })
  const initialLearningDesign = buildLearningDesignSpecV2({
    spec: assessmentSpec,
    evidence,
    assessment_plan: baseAssessmentPlan,
  })
  const primarySkill = initialLearningDesign.learner.skills.find((skill) =>
    skill.objective_id === taskContract.primary_objective_id)!
  const primaryTarget = spec.targets.find((target) =>
    target.objective_id === taskContract.primary_objective_id)!
  const primaryEvidence = evidence.results.find((entry) =>
    entry.source_id === primaryTarget.source_id)
  const goalProfile = spec.personalization_policy?.goal_profile ?? "general_learning"
  const learnerLevel = spec.learner_adaptation.level ?? evidence.learner_level ?? "basic"
  const preferredProgrammingKind = taskContract.learner_action === "recall_fact"
    ? "code_completion" as const
    : selectProgrammingTaskKind(goalProfile, learnerLevel, primarySkill.progress_band)
  const programmingProblem = buildProgrammingProblemBlueprint({
    objective_ids: codeObjectivePlan.map((entry) => entry.objective_id),
    source_ids: [...new Set(spec.targets.map((target) => target.source_id))],
    fact_refs: codeObjectivePlan.flatMap((entry) => entry.citations.map((citation) => ({
      source_id: citation.source_id,
      fact_id: citation.fact_id,
    }))),
    goal_profile: goalProfile,
    learner_level: learnerLevel,
    progress_band: primarySkill.progress_band,
    preferred_task_kind: preferredProgrammingKind,
    title_brief: primaryEvidence?.title ?? spec.path_node.goal ?? primaryTarget.source_id,
    scenario_brief: spec.learner_adaptation.preferred_contexts?.[0]
      ?? spec.path_node.goal
      ?? "通用学习任务",
    learner_owned_behavior: primaryTarget.observable_behavior,
    execution_contract: plannedProgrammingExecutionContract(taskContract),
  })
  const codeSecurePlan = buildCodeLabSecurePlan(
    spec,
    identity.test_suite_id,
    misconceptionIdsByObjective,
    programmingProblem,
  )
  const taxonomy = buildAssessmentTaxonomyPlan({
    items: baseAssessmentPlan,
    emphasis: assessmentSpec.learner_adaptation.pedagogy_contract?.assessment.emphasis
      ?? { recall: 0.2, understanding: 0.25, application: 0.3, analysis: 0.2, creation: 0.05 },
    progress_by_objective: Object.fromEntries(initialLearningDesign.learner.skills.map((skill) => [
      skill.objective_id,
      skill.progress_band,
    ])),
  })
  const taxonomyByItem = new Map(taxonomy.entries.map((entry) => [entry.item_id, entry]))
  const assessmentPlan = baseAssessmentPlan.map((item) => ({
    ...item,
    difficulty_band: taxonomyByItem.get(item.item_id)!.difficulty_band,
    cognitive_level: taxonomyByItem.get(item.item_id)!.cognitive_level,
  }))
  const practicalGuidePlan = buildPracticalGuidePlan({
    lab_id: identity.lab_id,
    objective_ids: spec.targets.map((target) => target.objective_id),
    primary_objective_id: taskContract.primary_objective_id,
    goal_context: spec.path_node.goal?.trim()
      || evidence.results.find((entry) => entry.source_id === spec.targets.find((target) => target.objective_id === taskContract.primary_objective_id)?.source_id)?.title
      || taskContract.primary_objective_id,
    scaffold_strength: practicalGuideScaffoldStrength(
      initialLearningDesign.learner.skills.find((skill) => skill.objective_id === taskContract.primary_objective_id)!.progress_band,
      spec.learner_adaptation.pedagogy_contract?.lesson.scaffold_strength
        ?? Math.max(1, Math.min(4, Math.round(spec.difficulty?.scaffold_strength ?? 2))),
    ),
    session_minutes: spec.learner_adaptation.pedagogy_contract?.pacing.session_minutes ?? 30,
    require_troubleshooting: spec.learner_adaptation.pedagogy_contract?.practice.require_troubleshooting ?? true,
    tool_constraints: spec.learner_adaptation.pedagogy_contract?.constraints.tool_constraints ?? [],
    objective_fact_refs: Object.fromEntries(codeObjectivePlan.map((entry) => [entry.objective_id, entry.citations])),
    prerequisite_fact_refs: evidence.results
      .filter((entry) => spec.path_node.prerequisite_source_ids.includes(entry.source_id))
      .flatMap((entry) => entry.facts.slice(0, 1).map((fact) => ({
        source_id: entry.source_id,
        fact_id: fact.fact_id,
        relation: "prerequisite" as const,
      }))),
    public_tests: codeObjectivePlan.map((entry) => ({ test_id: entry.public_test_id, objective_id: entry.objective_id })),
  })
  const objectives = spec.targets.map((target, index) => {
    const code = codeObjectivePlan.find((entry) =>
      entry.objective_id === target.objective_id)!
    const targetFactTexts = (evidence.results.find((item) =>
      item.source_id === target.source_id)?.facts ?? [])
      .filter((fact) => target.required_fact_ids.includes(fact.fact_id))
      .map((fact) => fact.content.trim())
      .filter(Boolean)
    const conceptMode: ResourceBlueprintObjective["concept"]["mode"] =
      conceptModeForObjective(
        target.observable_behavior,
        targetFactTexts,
        target.required_fact_ids.map((factId) => ({ source_id: target.source_id, fact_id: factId })),
        target.objective_id,
      )
    return {
      objective_id: target.objective_id,
      source_id: target.source_id,
      observable_behavior: target.observable_behavior,
      importance: target.importance,
      required_fact_ids: [...target.required_fact_ids],
      citations: target.required_fact_ids.map((factId) => ({
        source_id: target.source_id,
        fact_id: factId,
        relation: "derived_from" as const,
      })),
      concept: {
        sequence_index: index,
        mode: conceptMode,
        required_parts: [
          "explanation" as const,
          "worked_example" as const,
          "misconception" as const,
          "micro_check" as const,
          "hints" as const,
          "summary" as const,
        ],
        prerequisite_source_ids: index === 0
          ? [...spec.path_node.prerequisite_source_ids]
          : [],
      },
      code_lab: {
        instruction_block_id: code.instruction_block_id,
        public_test_id: code.public_test_id,
        hidden_test_ids: codeSecurePlan.hidden_tests
          .filter((test) => test.objective_id === target.objective_id)
          .map((test) => test.test_id),
        practice_behavior: "guided_implementation" as const,
      },
      assessment: assessmentPlan
        .filter((item) => item.objective_id === target.objective_id)
        .map((item) => ({
          item_id: item.item_id,
          tier: item.tier,
          modality: item.modality,
          max_score: item.max_score,
          cognitive_operation: item.cognitive_operation,
        })),
    }
  })
  const learningDesign: LearningDesignSpecV2 = {
    ...initialLearningDesign,
    assessment_plan: assessmentPlan,
  }
  const blueprintIdentity = {
    spec_id: spec.spec_id,
    evidence_ref: evidence.retrieval_id,
    evidence_content_hash: evidenceHash,
    objectives,
    learning_design: learningDesign,
    difficulty_plan: difficultyPlan,
    code_lab: {
      lab_id: identity.lab_id,
      test_suite_id: identity.test_suite_id,
      objective_plan: codeObjectivePlan,
      secure_plan: codeSecurePlan,
      task_contract: taskContract,
      practical_guide_plan: practicalGuidePlan,
      programming_problem: programmingProblem,
    },
    assessment: { item_plan: assessmentPlan, taxonomy, capacity: assessmentCapacity },
    cross_artifact_contract: crossArtifactContract,
    quality_requirement: qualityRequirement,
  }
  return deepFreeze({
    schema_version: "1.0",
    blueprint_id: stableId("RESOURCE-BLUEPRINT", blueprintIdentity),
    spec_id: spec.spec_id,
    evidence_ref: evidence.retrieval_id,
    evidence_content_hash: evidenceHash,
    objectives,
    learning_design: learningDesign,
    difficulty_plan: difficultyPlan,
    code_lab: {
      lab_id: identity.lab_id,
      test_suite_id: identity.test_suite_id,
      objective_plan: codeObjectivePlan,
      secure_plan: codeSecurePlan,
      task_contract: taskContract,
      practical_guide_plan: practicalGuidePlan,
      programming_problem: programmingProblem,
    },
    assessment: {
      item_plan: assessmentPlan,
      taxonomy,
      total_items: assessmentPlan.length,
      total_score: assessmentPlan.reduce((sum, item) => sum + item.max_score, 0),
      capacity: assessmentCapacity,
    },
    cross_artifact_contract: crossArtifactContract,
    quality_requirement: qualityRequirement,
  })
}

function practicalGuideScaffoldStrength(
  band: LearningDesignSpecV2["learner"]["skills"][number]["progress_band"],
  profileStrength: number,
): number {
  const base = Math.max(1, Math.min(4, Math.round(profileStrength)))
  if (band === "needs_reteach") return 4
  if (band === "developing") return Math.max(3, base)
  if (band === "ready_for_transfer") return Math.min(3, base)
  return Math.min(2, base)
}

/**
 * 为三类资源分别规划目标难度（Target Resource Difficulty）。
 *
 * 从 GenerationSpec.difficulty（目标教学负荷）拆分 challenge/support 后，
 * 按资源形态做差异化：
 *   - 讲义：认知/推理坡度更缓，支架最强，低阅读密度；
 *   - 代码实验：过程推理稍高，支架中等，starter/hint 充分；
 *   - 测评：支架最低（不提示，真正测"独立完成能力"），挑战与目标一致。
 *
 * 这是"三种资源不再共用同一份 DifficultyVector"的落地。
 */
export function buildDifficultyPlan(
  spec: GenerationSpec,
  options: { assessment_plan?: AssessmentItemPlan[] } = {},
): ResourceDifficultyPlan {
  const difficulty = spec.difficulty
    ?? adaptationDefaults(spec.learner_adaptation?.level ?? "basic").difficulty
  const { challenge, support } = splitDifficultyVector(difficulty)
  const learnerLevel = spec.learner_adaptation?.level ?? "basic"
  const assessmentBlueprint = spec.assessment_blueprint
  const plannedPrerequisiteLoad = spec.path_node?.prerequisite_source_ids?.length ?? 0
  const assessmentChallenge = plannedAssessmentChallenge(
    options.assessment_plan,
    assessmentBlueprint,
    spec.learner_adaptation?.preferred_contexts ?? [],
  )

  const concept: ResourceDifficultyPlanEntry = {
    challenge_target: {
      ...challenge,
      // 讲义降低阅读密度与表达坡度，但不能把学习目标本身降一档。
      // basic 学习者仍需在讲义中完成简单应用，而不是被重新测成纯识记。
      cognitive_demand: clamp5(Math.max(1, challenge.cognitive_demand)),
      reasoning_steps: clamp5(Math.max(1, challenge.reasoning_steps)),
      code_complexity: clamp5(challenge.code_complexity - 1),
      prerequisite_load: clamp5(Math.max(
        challenge.prerequisite_load,
        plannedPrerequisiteLoad,
      )),
      ...(challenge.transfer_distance !== undefined
        ? { transfer_distance: clamp5(challenge.transfer_distance - 1) }
        : {}),
    },
    support_target: {
      scaffold_strength: clamp5(support.scaffold_strength + 1),
      reading_density: "low",
      hint_strength: clamp5(support.hint_strength + 1),
      starter_support: 0,
    },
  }

  const codeLab: ResourceDifficultyPlanEntry = {
    challenge_target: {
      ...challenge,
      reasoning_steps: clamp5(challenge.reasoning_steps + 0.5),
      code_complexity: clamp5(Math.max(challenge.code_complexity, 1)),
    },
    support_target: {
      scaffold_strength: clamp5(support.scaffold_strength),
      reading_density: support.reading_density,
      hint_strength: clamp5(Math.max(
        support.hint_strength,
        learnerLevel === "beginner" ? 3 : learnerLevel === "basic" ? 2 : 1,
      )),
      starter_support: clamp5(Math.max(
        support.starter_support,
        learnerLevel === "beginner" ? 3 : learnerLevel === "basic" ? 2 : 1,
      )),
    },
  }

  const assessment: ResourceDifficultyPlanEntry = {
    challenge_target: {
      ...challenge,
      cognitive_demand: clamp5(Math.max(
        challenge.cognitive_demand,
        assessmentChallenge.cognitive_demand,
      )),
      reasoning_steps: clamp5(Math.max(
        challenge.reasoning_steps,
        assessmentChallenge.reasoning_steps,
      )),
      transfer_distance: clamp5(Math.max(
        challenge.transfer_distance ?? 0,
        assessmentChallenge.transfer_distance,
      )),
    },
    support_target: {
      scaffold_strength: 0,
      reading_density: "high",
      hint_strength: 0,
      starter_support: 0,
    },
  }

  return { concept_lesson: concept, code_lab: codeLab, assessment }
}

/**
 * 整卷难度必须由每道题的测量计划按分值加权汇总。Tier 表示题目层级，
 * 但 Tier 3 不必然是迁移题；没有 scenario_transfer 时，不能把整卷目标强行
 * 抬成迁移距离 2。这样 target 与真正交给 author 的 item plan 使用同一语义。
 */
function plannedAssessmentChallenge(
  plan: AssessmentItemPlan[] | undefined,
  blueprint: GenerationSpec["assessment_blueprint"] | undefined,
  preferredContexts: string[],
): {
  cognitive_demand: number
  reasoning_steps: number
  transfer_distance: number
} {
  const entries = plan?.length
    ? plan.map((item) => ({
        weight: Math.max(1, item.max_score),
        demand: item.cognitive_demand
          ?? (item.tier === 1 ? "understand" : item.tier === 2 ? "apply" : "analyze"),
        transfer: item.presentation_mode === "scenario_transfer" ? 2 : 0,
      }))
    : inferredAssessmentChallengeEntries(blueprint, preferredContexts)
  const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0)
  if (totalWeight === 0) {
    return { cognitive_demand: 1, reasoning_steps: 1, transfer_distance: 0 }
  }
  const demandValue = (value: AssessmentItemPlan["cognitive_demand"]): number =>
    value === "understand" ? 1 : value === "apply" ? 2 : value === "analyze" ? 3 : 4
  const reasoningValue = (value: AssessmentItemPlan["cognitive_demand"]): number =>
    value === "understand" ? 1 : value === "apply" ? 2 : 3
  return {
    cognitive_demand: CLAMP_WEIGHTED(entries, totalWeight, (entry) => demandValue(entry.demand)),
    reasoning_steps: CLAMP_WEIGHTED(entries, totalWeight, (entry) => reasoningValue(entry.demand)),
    transfer_distance: CLAMP_WEIGHTED(entries, totalWeight, (entry) => entry.transfer),
  }
}

function inferredAssessmentChallengeEntries(
  blueprint: GenerationSpec["assessment_blueprint"] | undefined,
  preferredContexts: string[],
): Array<{
  weight: number
  demand: NonNullable<AssessmentItemPlan["cognitive_demand"]>
  transfer: number
}> {
  const tier1 = blueprint?.tier_1_count ?? 0
  const tier2 = blueprint?.tier_2_count ?? 0
  const tier3 = blueprint?.tier_3_count ?? 0
  const itemCount = tier1 + tier2 + tier3
  const scenarioBudget = preferredContexts.length > 0
    ? Math.min(tier3, Math.floor(itemCount * 0.35))
    : 0
  return [
    ...Array.from({ length: tier1 }, () => ({ weight: 1, demand: "understand" as const, transfer: 0 })),
    ...Array.from({ length: tier2 }, () => ({ weight: 2, demand: "apply" as const, transfer: 0 })),
    ...Array.from({ length: tier3 }, (_, index) => ({
      weight: 4,
      demand: index < scenarioBudget ? "transfer" as const : "analyze" as const,
      transfer: index < scenarioBudget ? 2 : 0,
    })),
  ]
}

function CLAMP_WEIGHTED<T>(
  entries: T[],
  totalWeight: number,
  value: (entry: T) => number,
): number {
  return clamp5(entries.reduce((sum, entry) =>
    sum + value(entry) * (entry as T & { weight: number }).weight, 0) / totalWeight)
}

function clamp5(value: number): number {
  return Math.max(0, Math.min(5, Math.round(value * 10) / 10))
}

/**
 * 由事实内容与数量决定讲义创作模式（改进方案5 第六节）。
 * 不再用单一的 facts.length <= 3 判断 sparse_safe：
 *  - comparative：证据明确描述对比/区别 → 允许比较
 *  - procedural：证据含步骤/顺序/执行 → 允许过程拆解
 *  - definition_only：事实极少且无过程/对比 → 只讲定义与识别
 *  - guided_explanation：事实充足 → 分层解释 + 直接实例 + 误区
 */
function conceptModeForObjective(
  behavior: string,
  factTexts: string[],
  factRefs: Array<{ source_id: string; fact_id: string }>,
  objectiveId: string,
): "definition_only" | "guided_explanation" | "procedural" | "comparative" {
  // 复用 feasibility 的证据能力判断（单一权威），不再用关键词判断，避免
  // "可行性说只有定义能力，Blueprint 却认为能讲过程"的冲突。
  const support = assessObjectiveSupport({
    objective_id: objectiveId,
    observable_behavior: behavior as never,
    fact_refs: factRefs,
    facts: factTexts.map((content) => ({ content })),
  })
  return conceptModeForSupport(support, factTexts.length)
}

function buildCrossArtifactContract(): ResourceBlueprint["cross_artifact_contract"] {
  return {
    concept_responsibilities: [
      "解释必要事实、先修衔接、例题、误区、自查与提示",
    ],
    code_lab_responsibilities: [
      "把目标转换为可执行练习，严格遵守 task_contract 与公开/私有边界",
    ],
    assessment_responsibilities: [
      "用冻结的题量、题型和认知操作独立检验学习目标",
    ],
    forbidden_duplicate_behaviors: [
      "测评不得复制代码实验的完整题面或公开测试",
      "代码实验不得复制讲义的完整 worked example 作为答案",
      "三类产物不得重复公开私有答案、隐藏测试或评分细节",
    ],
  }
}

function decideQualityRequirement(
  spec: GenerationSpec,
  codeObjectiveCount: number,
): ResourceBlueprint["quality_requirement"] {
  // Runtime input validation requires difficulty, while this planner also remains
  // compatible with older trusted callers that predate DifficultyVector.
  const difficulty = spec.difficulty ?? {
    cognitive_level: 0,
    prerequisite_load: 0,
    reasoning_steps: 0,
    code_complexity: 0,
    scaffold_strength: 0,
  }
  const tier3Count = spec.assessment_blueprint?.tier_3_count ?? 0
  const hardHigh = difficulty.reasoning_steps >= 5
    || difficulty.code_complexity >= 5
    || (difficulty.task_composition ?? 0) >= 5
  const signals = [
    spec.targets.length >= 3,
    difficulty.reasoning_steps >= 3,
    difficulty.code_complexity >= 3,
    difficulty.prerequisite_load >= 3,
    (difficulty.transfer_distance ?? 0) >= 3,
    (difficulty.boundary_condition_density ?? 0) >= 3,
    (difficulty.task_composition ?? 0) >= 3,
    tier3Count >= 2,
    codeObjectiveCount >= 3,
  ]
  const profile = hardHigh || signals.filter(Boolean).length >= 2
    ? "quality" as const
    : "fast" as const
  const reasonCodes = profile === "quality"
    ? ["COMPLEX_COMPOSITE_TASK"]
    : ["STANDARD_SINGLE_ROUND"]
  return {
    profile,
    reason_codes: reasonCodes,
    policy_version: "glm52-policy-v1",
    decision_hash: contentHash({
      profile,
      reason_codes: reasonCodes,
      difficulty,
      objective_count: spec.targets.length,
      tier_3_count: tier3Count,
      code_objective_count: codeObjectiveCount,
    }),
  }
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value
  Object.values(value as Record<string, unknown>).forEach(deepFreeze)
  return Object.freeze(value)
}

/**
 * Planning 层决定 CodeLab 外部执行契约（"先设计题，再确定判题接口"）。
 *
 * 判定基于 primary objective 的教学语义与其冻结事实能力：
 * - 参数/返回值专题 → callable_function：判题器调用入口函数，execution_mode=function
 * - 只有函数定义/调用、尚无返回值事实 → stdin_stdout_program；允许在完整程序中定义并调用辅助函数
 * - 其余知识点 → stdin_stdout_program：判题器喂 stdin、比较 stdout，产出可运行程序
 *
 * primary objective 决定契约；supporting objectives（如综合项目里的函数先修）只提供证据，
 * 它们的 def/return 不能改变 primary 决定的执行接口。execution_mode 也绝不因学习者水平而变。
 *
 * task_kind 由"本轮教学意图"决定（先设计题，再定判题接口）：
 * - 教学意图 = primary 目标的知识描述（primaryItem.title）+ 节点 goal。
 *   primary 是本轮主修知识的权威描述（显式 is_primary 标记），信号以它为锚；
 *   goal 是整轮意图的补充。输出型语义（综合项目/完整程序/读取输入输出/统计）
 *   → 设计"产出可运行程序"任务 → stdin_stdout；
 *   具备参数/返回值语义 → 设计"实现可调用函数"任务 → callable_function。
 * - primary 的 title/goal 均无信号时，看 primary 证据的 facts 兜底。
 * 不再用知识库标题关键词猜执行方式；相同 primary 标记下改变目标顺序不改变契约。
 */
function decideCodeLabTaskContract(
  spec: GenerationSpec,
  evidence: RagEvidencePack,
): CodeLabTaskContract {
  // primary 由上游显式 is_primary 标记决定，绝不依赖数组顺序
  const explicitPrimaries = spec.targets.filter((target) => target.is_primary)
  if (explicitPrimaries.length > 1) {
    throw new Error("MULTIPLE_CODE_LAB_PRIMARY_OBJECTIVES: 一个代码实验只能声明一个 primary objective")
  }
  const primary = explicitPrimaries[0]
    ?? spec.targets.find((t) => t.importance === "core")
    ?? spec.targets[0]
  if (!primary) {
    throw new Error("MISSING_CODE_LAB_PRIMARY_OBJECTIVE: 无法确定代码实验的 primary objective")
  }
  const primaryItem = evidence.results.find((r) => r.source_id === primary.source_id)
  const primaryTitle = (primaryItem?.title ?? "").normalize("NFKC").toLocaleLowerCase()
  const goal = (spec.path_node.goal ?? "").normalize("NFKC").toLocaleLowerCase()
  const facts = (primaryItem?.facts ?? [])
    .map((fact) => typeof fact === "string" ? fact : (fact as { content?: string }).content ?? "")
    .join(" ")
    .normalize("NFKC")
    .toLocaleLowerCase()
  // 教学意图信号。primary 的 title 是"本轮主修知识"的权威描述（显式标记，
  // 与目标顺序无关）；节点级 goal 是整轮意图，可能含其他目标（如综合项目里
  // 的先修函数），因此 goal 只在 primary title 无信号时兜底，绝不让 goal 覆盖
  // primary 决定的任务形态。
  const primaryOutputSignal = /(?:综合项目|完整程序|读取用户输入|读取输入|标准输出|输出结果|统计|计算.*输出|输入.*输出)/u.test(primaryTitle)
  const primaryFunctionSignal = /(?:参数与返回值|函数参数|函数返回值|返回值)/u.test(primaryTitle)
  const goalOutputSignal = /(?:综合项目|完整程序|读取用户输入|读取输入|标准输出|输出结果|统计|计算.*输出|输入.*输出)/u.test(goal)
  const goalFunctionSignal = /(?:参数与返回值|函数参数|函数返回值|返回值)/u.test(goal)
  const functionFactSignal = /(?:参数|返回值|\breturn\b)/u.test(facts)
  const outputFactSignal = /(?:输入输出|stdin|stdout|读取|print|输出)/u.test(facts)
  const taskKind: CodeLabTaskContract["task_kind"] = primaryOutputSignal
    ? "stdin_stdout_program"
    : primaryFunctionSignal
      ? "callable_function"
      : goalOutputSignal
        ? "stdin_stdout_program"
        : goalFunctionSignal
          ? "callable_function"
          : (functionFactSignal && !outputFactSignal)
            ? "callable_function"
            : "stdin_stdout_program"
  const callable = taskKind === "callable_function"
  const implementationFactSignal = /(?:输入|输出|返回值|\b(?:def|return)\b|定义函数|函数体|调用函数|循环|遍历|条件|赋值|计算|索引|读写|调用.*参数|文件|[A-Za-z_][\w.]*\([^)]*\))/u.test(facts)
  const learnerAction: CodeLabTaskContract["learner_action"] = callable
    ? "implement_function"
    : implementationFactSignal
        ? "implement_program"
        : primary.observable_behavior === "recognize"
            || primary.observable_behavior === "explain"
          ? "recall_fact"
          : "recall_fact"
  const learnerOwnedRegion: CodeLabTaskContract["learner_owned_region"] =
    learnerAction === "recall_fact"
      ? "fact_literal"
      : learnerAction === "implement_function"
        ? "function_body"
        : "program_logic"
  const externalInputSignal = primaryOutputSignal
    || goalOutputSignal
    || /(?:标准输入|stdin|读取(?:用户)?输入|输入数据)/u.test(facts)
  const inputForm: CodeLabTaskContract["input_form"] = callable
    ? "function_arguments"
    : learnerAction === "recall_fact" || !externalInputSignal
      ? "none"
      : "stdin_lines"
  return {
    task_kind: taskKind,
    learner_action: learnerAction,
    learner_owned_region: learnerOwnedRegion,
    primary_objective_id: primary.objective_id,
    execution_mode: callable ? "function" : "stdin_stdout",
    program_entry: callable
      ? "入口函数（def 定义，函数名由 instruction 指定）"
      : learnerAction === "recall_fact"
        ? "stdout（程序胶水已给出，学习者只填写事实文本）"
        : inputForm === "none"
          ? "stdout（程序直接运行冻结任务数据并打印结果）"
          : "stdin→stdout（整个程序读取 stdin 并打印结果）",
    input_form: inputForm,
    stdin_layout: inputForm === "stdin_lines" ? "single_line_text" : "none",
    output_form: callable ? "return_value" : "stdout_lines",
    grading_invocation: callable
      ? "call_entry_function"
      : "feed_stdin_compare_stdout",
    output_constraint: callable
      ? "判题器调用入口函数并比较返回值；不得要求 print 输出作为评分结果"
      : learnerAction === "recall_fact"
        ? "判题器使用空 stdin 并比较 stdout；学习者只替换一个事实文本占位，输出调用由 starter_code 完整提供"
        : inputForm === "none"
          ? "判题器使用空 stdin 并比较 stdout；任务数据由程序骨架给出，学习者完成目标逻辑，不得改造为另一套输入协议"
          : "判题器喂 stdin、比较 stdout；不得以函数 return 值作为判题产物。完整程序内可以定义和调用辅助函数，starter_code 与 hidden_test 均围绕标准输入输出",
    ...(callable ? { entry_point: "solve" } : {}),
  }
}

function plannedProgrammingExecutionContract(task: CodeLabTaskContract) {
  return {
    language: "python" as const,
    execution_mode: task.execution_mode,
    ...(task.entry_point ? { entry_point: task.entry_point } : {}),
    allowed_imports: [],
    input_contract: {
      type: task.input_form,
      constraints: [task.program_entry],
    },
    output_contract: {
      kind: task.execution_mode === "stdin_stdout" ? "string" as const : "object" as const,
      type: task.output_form,
      constraints: [task.output_constraint],
    },
    resource_limits: {
      timeout_ms: 2_000,
      memory_mb: 128,
      max_output_bytes: 32_768,
    },
  }
}
