import {
  C_SCHEMA_VERSION,
  contentHash,
  stableId,
  type ArtifactVersions,
  type LearnerLevel,
  type SchemaVersion,
} from "./common"
import {
  type EvidenceGapRequest,
  type RagEvidencePack,
} from "./evidence-pack"
import type {
  AssessmentBlueprint,
  LearnerProfileSnapshot,
  LearningObjective,
  LearningPathNode,
} from "./profile-adapter"
import { assessmentBlueprintCanMeasureCoreObjectives } from "./assessment-measurement"

export type { AssessmentBlueprint } from "./profile-adapter"

export interface DifficultyVector {
  domain_complexity: number
  cognitive_demand: number
  reasoning_steps: number
  code_complexity: number
  prerequisite_load: number
  scaffold_strength: number
}

export interface GenerationSpec {
  schema_version: SchemaVersion
  spec_id: string
  run_id: string
  evidence_ref: string
  evidence_content_hash: string
  versions: ArtifactVersions
  profile_ref: {
    profile_id: string
    profile_version: string
    /** Binds the complete trusted snapshot without exposing learner fields to agents. */
    profile_content_hash: string
  }
  path_node: Omit<LearningPathNode, "schema_version" | "objectives" | "assessment_blueprint">
  targets: LearningObjective[]
  learner_adaptation: {
    level: LearnerLevel
    known_concepts: string[]
    weak_concepts: string[]
    preferred_contexts: string[]
    scaffold_level: 0 | 1 | 2 | 3
    reading_density: "low" | "medium" | "high"
    accommodations: string[]
  }
  difficulty: DifficultyVector
  assessment_blueprint: AssessmentBlueprint
  policies: {
    external_knowledge_allowed: false
    citation_required: true
    max_semantic_revision: 1
    max_tool_retry: 2
    seed: number
  }
}

export interface BuildGenerationSpecInput {
  run_id: string
  profile_snapshot: LearnerProfileSnapshot
  path_node: LearningPathNode
  evidence_pack: RagEvidencePack
  versions: Omit<ArtifactVersions, "profile_version" | "kb_version" | "rag_version" | "schema_version">
  seed?: number
  difficulty?: Partial<DifficultyVector>
  /** Narrow C-owned presentation override; profile facts remain read-only. */
  adaptive_shell?: {
    scaffold_level?: 0 | 1 | 2 | 3
    reading_density?: "low" | "medium" | "high"
  }
}

export type BuildGenerationSpecResult =
  | { ok: true; spec: GenerationSpec }
  | { ok: false; code: "INVALID_INPUT"; errors: string[] }
  | { ok: false; code: "MISSING_EVIDENCE" | "WEAK_EVIDENCE"; errors: string[]; gap_request: EvidenceGapRequest }

export function buildGenerationSpec(input: BuildGenerationSpecInput): BuildGenerationSpecResult {
  const errors = validateInputShape(input)
  if (errors.length > 0) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      errors,
    }
  }
  const sourceIds = new Set(input.evidence_pack.results.map((item) => item.source_id))
  const factKeys = new Set(
    input.evidence_pack.results.flatMap((item) =>
      item.facts.map((fact) => `${fact.source_id}:${fact.fact_id}`),
    ),
  )

  const missingSources = input.path_node.target_source_ids.filter((sourceId) => !sourceIds.has(sourceId))
  const missingPrerequisiteSources = input.path_node.prerequisite_source_ids
    .filter((sourceId) => !sourceIds.has(sourceId))
  const missingFacts = input.path_node.objectives.flatMap((objective) =>
    objective.required_fact_ids
      .filter((factId) => !factKeys.has(`${objective.source_id}:${factId}`))
      .map((factId) => `${objective.source_id}:${factId}`),
  )

  if (
    input.evidence_pack.match_status === "no_match" ||
    missingSources.length > 0 ||
    missingPrerequisiteSources.length > 0 ||
    missingFacts.length > 0
  ) {
    const details = [
      ...errors,
      ...(missingSources.length > 0 ? [`缺少知识点：${missingSources.join("、")}`] : []),
      ...(missingPrerequisiteSources.length > 0
        ? [`缺少先修知识点：${missingPrerequisiteSources.join("、")}`]
        : []),
      ...(missingFacts.length > 0 ? [`缺少事实：${missingFacts.join("、")}`] : []),
    ]
    return {
      ok: false,
      code: "MISSING_EVIDENCE",
      errors: details,
      gap_request: createGapRequest(input, "fact", details.join("；") || "RAG 未命中"),
    }
  }

  if (input.evidence_pack.match_status === "weak") {
    const weakDetail = "RAG 仅弱匹配"
    return {
      ok: false,
      code: "WEAK_EVIDENCE",
      errors: [`${weakDetail}，当前证据不足以发布事实性教学内容`],
      gap_request: createGapRequest(input, "strong_match", `${weakDetail}，需要重写 query 或补充证据`),
    }
  }

  const defaults = adaptationDefaults(input.profile_snapshot.level)
  const seed = input.seed ?? 0
  const versions: ArtifactVersions = {
    ...input.versions,
    profile_version: input.profile_snapshot.profile_version,
    kb_version: input.evidence_pack.kb_version,
    rag_version: input.evidence_pack.rag_version,
    schema_version: C_SCHEMA_VERSION,
  }
  const learnerAdaptation: GenerationSpec["learner_adaptation"] = {
    level: input.profile_snapshot.level,
    known_concepts: [...input.profile_snapshot.known_concepts],
    weak_concepts: [...input.profile_snapshot.weak_concepts],
    preferred_contexts: [...input.profile_snapshot.preferred_contexts],
    scaffold_level: input.adaptive_shell?.scaffold_level ?? defaults.scaffold_level,
    reading_density: input.adaptive_shell?.reading_density ?? defaults.reading_density,
    accommodations: [...input.profile_snapshot.accommodations],
  }
  const difficulty: DifficultyVector = { ...defaults.difficulty, ...input.difficulty }
  const pathNode = {
    node_id: input.path_node.node_id,
    target_source_ids: [...input.path_node.target_source_ids],
    prerequisite_source_ids: [...input.path_node.prerequisite_source_ids],
    goal: input.path_node.goal,
  }
  const targets = input.path_node.objectives.map((objective) => ({
    ...objective,
    required_fact_ids: [...objective.required_fact_ids],
  }))
  const assessmentBlueprint = {
    tier_1_count: input.path_node.assessment_blueprint.tier_1_count,
    tier_2_count: input.path_node.assessment_blueprint.tier_2_count,
    tier_3_count: input.path_node.assessment_blueprint.tier_3_count,
    required_modalities: [...input.path_node.assessment_blueprint.required_modalities],
  }
  const policies: GenerationSpec["policies"] = {
    external_knowledge_allowed: false,
    citation_required: true,
    max_semantic_revision: 1,
    max_tool_retry: 2,
    seed,
  }
  const specIdentity = {
    run_id: input.run_id,
    evidence_ref: input.evidence_pack.retrieval_id,
    evidence_content_hash: contentHash(input.evidence_pack),
    versions,
    profile_ref: {
      profile_id: input.profile_snapshot.profile_id,
      profile_version: input.profile_snapshot.profile_version,
      profile_content_hash: contentHash(input.profile_snapshot),
    },
    path_node: pathNode,
    targets,
    learner_adaptation: learnerAdaptation,
    difficulty,
    assessment_blueprint: assessmentBlueprint,
    policies,
  }

  const spec: GenerationSpec = {
    schema_version: C_SCHEMA_VERSION,
    spec_id: stableId("SPEC", specIdentity),
    run_id: input.run_id,
    evidence_ref: input.evidence_pack.retrieval_id,
    evidence_content_hash: contentHash(input.evidence_pack),
    versions,
    profile_ref: {
      profile_id: input.profile_snapshot.profile_id,
      profile_version: input.profile_snapshot.profile_version,
      profile_content_hash: contentHash(input.profile_snapshot),
    },
    path_node: pathNode,
    targets,
    learner_adaptation: learnerAdaptation,
    difficulty,
    assessment_blueprint: assessmentBlueprint,
    policies,
  }
  return {
    ok: true,
    spec: deepFreeze(spec),
  }
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value
  Object.values(value as Record<string, unknown>).forEach(deepFreeze)
  return Object.freeze(value)
}

function validateInputShape(input: BuildGenerationSpecInput): string[] {
  const errors: string[] = []
  if (!input.run_id.trim()) errors.push("run_id 不能为空")
  if (!input.profile_snapshot.profile_id.trim()) errors.push("profile_id 不能为空")
  if (!input.profile_snapshot.profile_version.trim()) errors.push("profile_version 不能为空")
  if (!input.profile_snapshot.goal.trim()) errors.push("profile goal 不能为空")
  if (!input.evidence_pack.retrieval_id.trim()) errors.push("retrieval_id 不能为空")
  if (!input.evidence_pack.kb_version.trim()) errors.push("kb_version 不能为空")
  if (!input.evidence_pack.rag_version.trim()) errors.push("rag_version 不能为空")
  if (!input.versions.prompt_version.trim()) errors.push("prompt_version 不能为空")
  if (!input.versions.model_config_hash.trim()) errors.push("model_config_hash 不能为空")
  if (input.versions.runner_image_digest !== undefined
    && !/^sha256:[a-f0-9]{64}$/.test(input.versions.runner_image_digest)) {
    errors.push("runner_image_digest 必须为 sha256:<64 hex>")
  }
  if (input.seed !== undefined && !Number.isSafeInteger(input.seed)) errors.push("seed 必须为安全整数")
  if (!input.path_node.node_id.trim()) errors.push("path_node.node_id 不能为空")
  if (!input.path_node.goal.trim()) errors.push("path_node.goal 不能为空")
  if (input.path_node.target_source_ids.length === 0) errors.push("target_source_ids 不能为空")
  if (input.path_node.target_source_ids.length > 30) errors.push("target_source_ids 单轮最多包含 30 个目标")
  if (input.path_node.objectives.length === 0) errors.push("objectives 不能为空")
  if (input.path_node.objectives.length > 30) errors.push("objectives 单轮最多包含 30 个目标")
  if (input.path_node.objectives.length > 0 && !input.path_node.objectives.some((objective) => objective.importance === "core")) {
    errors.push("objectives 至少包含一个 core 目标")
  }
  if (new Set(input.path_node.target_source_ids).size !== input.path_node.target_source_ids.length) errors.push("target_source_ids 不得重复")
  if (new Set(input.path_node.prerequisite_source_ids).size !== input.path_node.prerequisite_source_ids.length) errors.push("prerequisite_source_ids 不得重复")
  const overlap = input.path_node.target_source_ids.filter((source) => input.path_node.prerequisite_source_ids.includes(source))
  if (overlap.length > 0) errors.push(`目标与先修知识不得重复：${overlap.join("、")}`)
  const objectiveIds = input.path_node.objectives.map((objective) => objective.objective_id)
  if (new Set(objectiveIds).size !== objectiveIds.length) errors.push("objective_id 不得重复")
  const profileOverlap = input.profile_snapshot.known_concepts.filter((concept) => input.profile_snapshot.weak_concepts.includes(concept))
  if (profileOverlap.length > 0) errors.push(`画像的 known_concepts 与 weak_concepts 冲突：${profileOverlap.join("、")}`)
  for (const [name, values] of Object.entries({
    known_concepts: input.profile_snapshot.known_concepts,
    weak_concepts: input.profile_snapshot.weak_concepts,
    preferred_contexts: input.profile_snapshot.preferred_contexts,
    accommodations: input.profile_snapshot.accommodations,
  })) {
    if (values.some((value) => !value.trim())) errors.push(`画像的 ${name} 不得包含空字符串`)
    if (new Set(values).size !== values.length) errors.push(`画像的 ${name} 不得重复`)
  }
  for (const objective of input.path_node.objectives) {
    if (!input.path_node.target_source_ids.includes(objective.source_id)) {
      errors.push(`目标 ${objective.objective_id} 的 source_id 不在 target_source_ids 中`)
    }
    if (objective.required_fact_ids.length === 0) {
      errors.push(`目标 ${objective.objective_id} 缺少 required_fact_ids`)
    }
    if (new Set(objective.required_fact_ids).size !== objective.required_fact_ids.length) errors.push(`目标 ${objective.objective_id} 的 required_fact_ids 不得重复`)
  }
  const objectiveSourceIds = new Set(
    input.path_node.objectives.map((objective) => objective.source_id),
  )
  const targetsWithoutObjective = input.path_node.target_source_ids.filter(
    (sourceId) => !objectiveSourceIds.has(sourceId),
  )
  if (targetsWithoutObjective.length > 0) {
    errors.push(`target_source_ids 中的每个知识点都必须有 objective：${targetsWithoutObjective.join("、")}`)
  }
  validateDifficulty(input.difficulty, errors)
  if (input.adaptive_shell?.scaffold_level !== undefined
    && (!Number.isSafeInteger(input.adaptive_shell.scaffold_level)
      || input.adaptive_shell.scaffold_level < 0
      || input.adaptive_shell.scaffold_level > 3)) {
    errors.push("adaptive_shell.scaffold_level 必须是 0..3 的整数")
  }
  if (input.adaptive_shell?.reading_density !== undefined
    && !["low", "medium", "high"].includes(input.adaptive_shell.reading_density)) {
    errors.push("adaptive_shell.reading_density 必须是 low、medium 或 high")
  }
  const blueprint = input.path_node.assessment_blueprint as AssessmentBlueprint | undefined
  if (!blueprint) {
    errors.push("path_node.assessment_blueprint 必须由上游下发")
    return errors
  }
  for (const [key, value] of Object.entries({
    tier_1_count: blueprint.tier_1_count,
    tier_2_count: blueprint.tier_2_count,
    tier_3_count: blueprint.tier_3_count,
  })) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 20) errors.push(`${key} 必须是 0..20 的整数`)
  }
  if (new Set(blueprint.required_modalities).size !== blueprint.required_modalities.length) {
    errors.push("required_modalities 不得重复")
  }
  const allowedModalities = new Set(["mcq", "true_false", "trace", "short_answer", "code"])
  for (const modality of blueprint.required_modalities as string[]) {
    if (!allowedModalities.has(modality)) errors.push(`不支持的 assessment modality：${modality}`)
  }
  const total = blueprint.tier_1_count + blueprint.tier_2_count + blueprint.tier_3_count
  if (total < 1 || total > 30) errors.push("assessment blueprint 总题量必须在 1..30")
  if (blueprint.tier_1_count + blueprint.tier_2_count < 1) {
    errors.push("assessment blueprint 至少需要一道 Tier 1 或 Tier 2 锚点题")
  }
  if (blueprint.required_modalities.length > total) errors.push("required_modalities 数量不能超过总题量")
  if (total < input.path_node.objectives.filter((objective) => objective.importance === "core").length) {
    errors.push("assessment blueprint 总题量不能少于 core objective 数量")
  }
  if (!assessmentBlueprintCanMeasureCoreObjectives(
    input.path_node.objectives,
    blueprint,
  )) {
    errors.push("assessment blueprint 的必选题型和剩余题量无法直接测量全部 core objective")
  }
  return errors
}

function validateDifficulty(difficulty: Partial<DifficultyVector> | undefined, errors: string[]): void {
  if (!difficulty) return
  for (const [key, value] of Object.entries(difficulty)) {
    if (!Number.isFinite(value) || value < 0 || value > 5) errors.push(`difficulty.${key} 必须是 0..5 的有限数值`)
  }
}

function createGapRequest(
  input: BuildGenerationSpecInput,
  missingType: EvidenceGapRequest["missing_type"],
  reason: string,
): EvidenceGapRequest {
  const requiredFacts = input.path_node.objectives.flatMap((objective) =>
    objective.required_fact_ids.map((factId) => ({ source_id: objective.source_id, fact_id: factId })),
  )
  const uniqueRequiredFacts = [
    ...new Map(requiredFacts.map((fact) => [`${fact.source_id}:${fact.fact_id}`, fact])).values(),
  ]
  return {
    schema_version: C_SCHEMA_VERSION,
    request_id: stableId("EGR", { run_id: input.run_id, node_id: input.path_node.node_id, missingType, reason }),
    run_id: input.run_id,
    target_source_ids: [...new Set([
      ...input.path_node.target_source_ids,
      ...input.path_node.prerequisite_source_ids,
    ])],
    missing_type: missingType,
    reason,
    learner_level: input.profile_snapshot.level,
    required_facts: uniqueRequiredFacts,
  }
}

function adaptationDefaults(level: LearnerLevel): {
  scaffold_level: 0 | 1 | 2 | 3
  reading_density: "low" | "medium" | "high"
  difficulty: DifficultyVector
} {
  const byLevel = {
    beginner: { scaffold_level: 3 as const, reading_density: "low" as const, base: 1 },
    basic: { scaffold_level: 2 as const, reading_density: "medium" as const, base: 2 },
    intermediate: { scaffold_level: 1 as const, reading_density: "medium" as const, base: 3 },
    integrated: { scaffold_level: 0 as const, reading_density: "high" as const, base: 4 },
  }
  const selected = byLevel[level]
  return {
    scaffold_level: selected.scaffold_level,
    reading_density: selected.reading_density,
    difficulty: {
      domain_complexity: selected.base,
      cognitive_demand: selected.base,
      reasoning_steps: selected.base,
      code_complexity: Math.max(0, selected.base - 1),
      prerequisite_load: Math.max(0, selected.base - 1),
      scaffold_strength: selected.scaffold_level,
    },
  }
}
