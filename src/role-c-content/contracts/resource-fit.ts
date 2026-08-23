import { C_SCHEMA_VERSION, contentHash } from "./common"
import type { SchemaVersion } from "./common"
import type { DifficultyVector } from "./generation-spec"

/**
 * 资源适配（Resource Fit）领域契约。
 *
 * 背景：历史上 `GenerationSpec.difficulty`（DifficultyVector）是**生成前的目标教学负荷**，
 * 却一度被当作"生成后资源实际难度"直接暴露，造成自证循环。本模块把教学控制面拆成四层：
 *
 *   Knowledge Difficulty（知识库知识点难度，A 属性）
 *   Learner Capability（B 画像能力）
 *   Target Resource Difficulty（本轮希望三类资源分别达到的难度 = 本文件的 target）
 *   Observed Resource Difficulty（生成后按真实产物估计的难度 = observed）
 *
 * 并据此产出 fit verdict，形成可公开、可持久化、可审核的 ResourceFitReport。
 */

/** 挑战维度：方向统一为"越大越难"。与 DifficultyVector 的挑战侧一一对应。 */
export interface ChallengeVector {
  domain_complexity: number
  cognitive_demand: number
  reasoning_steps: number
  code_complexity: number
  prerequisite_load: number
  transfer_distance?: number
  boundary_condition_density?: number
  task_composition?: number
}

/** 支持维度：方向统一为"越大支持越强、学习体验越容易"。 */
export interface SupportProfile {
  scaffold_strength: number
  reading_density: "low" | "medium" | "high"
  hint_strength: number
  starter_support: number
}

export type ResourceFitVerdict = "fit" | "too_easy" | "too_hard" | "uncertain"

export type ResourceFitKind = "concept_lesson" | "code_lab" | "assessment"

/** 单个适配维度的 raw 调试输出（target/observed/gap），便于排查分数来源。 */
export interface ResourceFitDimension {
  name: string
  family: "challenge" | "support"
  applicable: boolean
  target: number
  observed: number
  /** observed - target；正值偏难、负值偏易。 */
  signed_gap: number
  weight: number
  tolerance: number
  basis: Array<{ feature: string; value: number | string; source_ref?: string }>
}

export interface ArtifactResourceFit {
  artifact_id: string
  kind: ResourceFitKind
  target: {
    challenge: ChallengeVector
    support: SupportProfile
  }
  observed: {
    challenge: ChallengeVector
    support: SupportProfile
    /** 0..1。observed 估计的可信度：确定性结构特征高、纯模型语义低。 */
    confidence: number
  }
  fit: {
    verdict: ResourceFitVerdict
    /** 0..1，1 = 与目标完全匹配。 */
    score: number
    mismatched_dimensions: string[]
    reason_codes: string[]
    /** 每个维度的 target/observed/gap 调试输出（改进方案6 第一节：让分数可解释）。 */
    dimensions: ResourceFitDimension[]
  }
}

/** 总分聚合口径（改进方案6 第一节：公开 66 的来源，而不是让用户猜）。 */
export interface ResourceFitAggregation {
  policy: "arithmetic_mean" | "weighted_mean" | "bottleneck_cap"
  /** 三类资源加权平均（讲义 0.30 / 实验 0.35 / 测评 0.35）。 */
  weighted_mean: number
  weakest_kind: ResourceFitKind
  weakest_score: number
  /** bottleneck_cap 时给最弱资源留的裕量。 */
  bottleneck_margin?: number
  final_score: number
}

export interface ResourceFitReport {
  schema_version: SchemaVersion
  run_id: string
  spec_id: string
  profile_ref: {
    profile_id: string
    profile_version: string
    profile_content_hash: string
  }
  policy_version: string
  resources: ArtifactResourceFit[]
  overall: {
    verdict: ResourceFitVerdict
    score: number
    aggregation: ResourceFitAggregation
  }
}

export const RESOURCE_FIT_POLICY_VERSION = "resource-fit-v2"

/**
 * 把历史 DifficultyVector（挑战+支持混在一个向量里）拆成方向统一的两个向量。
 * scaffold_strength 属于支持侧；其余属于挑战侧。这是过渡期兼容函数：
 * 新代码应直接用 ChallengeVector / SupportProfile，而不是依赖 DifficultyVector。
 */
export function splitDifficultyVector(difficulty: DifficultyVector): {
  challenge: ChallengeVector
  support: SupportProfile
} {
  const {
    domain_complexity,
    cognitive_demand,
    reasoning_steps,
    code_complexity,
    prerequisite_load,
    scaffold_strength,
    transfer_distance,
    boundary_condition_density,
    task_composition,
  } = difficulty
  return {
    challenge: {
      domain_complexity,
      cognitive_demand,
      reasoning_steps,
      code_complexity,
      prerequisite_load,
      ...(transfer_distance !== undefined ? { transfer_distance } : {}),
      ...(boundary_condition_density !== undefined ? { boundary_condition_density } : {}),
      ...(task_composition !== undefined ? { task_composition } : {}),
    },
    support: {
      scaffold_strength,
      reading_density: readingDensityForScaffold(scaffold_strength),
      hint_strength: clamp01(scaffold_strength),
      starter_support: clamp01(scaffold_strength - 1),
    },
  }
}

function readingDensityForScaffold(scaffold: number): SupportProfile["reading_density"] {
  if (scaffold >= 3) return "low"
  if (scaffold >= 2) return "medium"
  return "high"
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(5, value))
}

/** 挑战向量聚合难度（不含支持侧），用于与画像 level 对比。 */
export function challengeLevel(challenge: ChallengeVector): number {
  return Math.max(
    challenge.domain_complexity,
    challenge.cognitive_demand,
    challenge.reasoning_steps,
    challenge.code_complexity,
    challenge.prerequisite_load,
    challenge.transfer_distance ?? 0,
    challenge.boundary_condition_density ?? 0,
    challenge.task_composition ?? 0,
  )
}

/** 支持向量聚合强度（0..5）。 */
export function supportLevel(support: SupportProfile): number {
  return Math.max(support.scaffold_strength, support.hint_strength, support.starter_support)
}

/** 生成 ResourceFitReport 的稳定 content hash（用于审计与幂等）。 */
export function resourceFitReportHash(report: Omit<ResourceFitReport, "schema_version">): string {
  return contentHash({
    run_id: report.run_id,
    spec_id: report.spec_id,
    profile_ref: report.profile_ref,
    policy_version: report.policy_version,
    resources: report.resources,
    overall: report.overall,
  })
}

export function emptyResourceFitReport(input: {
  run_id: string
  spec_id: string
  profile_ref: ResourceFitReport["profile_ref"]
}): ResourceFitReport {
  return {
    schema_version: C_SCHEMA_VERSION,
    run_id: input.run_id,
    spec_id: input.spec_id,
    profile_ref: input.profile_ref,
    policy_version: RESOURCE_FIT_POLICY_VERSION,
    resources: [],
    overall: {
      verdict: "uncertain",
      score: 0,
      aggregation: {
        policy: "bottleneck_cap",
        weighted_mean: 0,
        weakest_kind: "assessment",
        weakest_score: 0,
        bottleneck_margin: 0.08,
        final_score: 0,
      },
    },
  }
}
