import { stableId } from "../contracts/common"
import type { RagEvidencePack } from "../contracts/evidence-pack"
import type { GenerationSpec } from "../contracts/generation-spec"
import type { AssessmentItemPlan } from "../providers/staged-generation"
import type { RoleCPedagogyContract } from "../../role-b-profile/pedagogy-contract"

export interface LearningDesignSpecV2 {
  schema_version: "learning-design.v2"
  design_id: string
  spec_id: string
  pedagogy_contract?: RoleCPedagogyContract
  learner: {
    level: GenerationSpec["learner_adaptation"]["level"]
    skills: Array<{
      objective_id: string
      mean: number
      lower: number
      upper: number
      evidence_basis: "known" | "weak" | "unobserved"
    }>
    misconceptions: Array<{
      misconception_id: string
      objective_id: string
      probability: number
      diagnostic_signals: string[]
    }>
  }
  objectives: Array<{
    objective_id: string
    observable_behavior: GenerationSpec["targets"][number]["observable_behavior"]
    required_fact_ids: string[]
    cognitive_target: "understand" | "apply" | "analyze" | "transfer"
    adaptation_decisions: Array<{
      action: "omit_review" | "brief_activate" | "reteach" | "contrast" | "guided_practice" | "transfer_challenge"
      reason: string
      learner_evidence_refs: string[]
    }>
  }>
  lesson_sequence: Array<{
    block_id: string
    objective_id: string
    kind: "activation" | "explanation" | "worked_example" | "contrast" | "micro_check" | "guided_practice" | "debugging_clinic" | "transfer"
    purpose: string
    required_fact_ids: string[]
    target_misconception_ids: string[]
  }>
  assessment_plan: AssessmentItemPlan[]
  candidate_policy: {
    public_candidate_count: 3
    secure_candidate_count: 1
    max_targeted_revisions: 2
    minimum_quality_score: number
  }
}

/**
 * One deterministic instructional decision shared by all Role C authors.
 * It translates profile/evidence into observable teaching actions; authors no
 * longer infer the lesson strategy independently from prose fields.
 */
export function buildLearningDesignSpecV2(input: {
  spec: GenerationSpec
  evidence: RagEvidencePack
  assessment_plan: AssessmentItemPlan[]
}): LearningDesignSpecV2 {
  const skills = input.spec.targets.map((target) => {
    const basis = targetMatches(input.spec.learner_adaptation?.known_concepts ?? [], target, input.evidence)
      ? "known" as const
      : targetMatches(input.spec.learner_adaptation?.weak_concepts ?? [], target, input.evidence)
        ? "weak" as const
        : "unobserved" as const
    return {
      objective_id: target.objective_id,
      ...(basis === "known"
        ? { mean: 0.82, lower: 0.64, upper: 0.94 }
        : basis === "weak"
          ? { mean: 0.34, lower: 0.16, upper: 0.56 }
          : { mean: 0.5, lower: 0.22, upper: 0.78 }),
      evidence_basis: basis,
    }
  })
  const misconceptions = input.spec.targets.flatMap((target) => {
    const source = input.evidence.results.find((entry) => entry.source_id === target.source_id)
    const requiredFacts = new Set(target.required_fact_ids)
    return (source?.misconceptions ?? [])
      .filter((entry) => entry.factRefs.length === 0 || entry.factRefs.some((reference) =>
        reference.sourceId === target.source_id && requiredFacts.has(reference.factId)))
      .slice(0, 3)
      .map((entry) => ({
        misconception_id: entry.misconceptionId,
        objective_id: target.objective_id,
        probability: skills.find((skill) => skill.objective_id === target.objective_id)?.evidence_basis === "weak"
          ? 0.65
          : 0.35,
        diagnostic_signals: [...entry.diagnosticSignals],
      }))
  })
  const objectives = input.spec.targets.map((target) => {
    const skill = skills.find((entry) => entry.objective_id === target.objective_id)!
    const targetMisconceptions = misconceptions.filter((entry) => entry.objective_id === target.objective_id)
    return {
      objective_id: target.objective_id,
      observable_behavior: target.observable_behavior,
      required_fact_ids: [...target.required_fact_ids],
      cognitive_target: cognitiveTarget(target.observable_behavior),
      adaptation_decisions: adaptationDecisions(input.spec, skill, targetMisconceptions.length > 0),
    }
  })
  const lessonSequence = objectives.flatMap((objective) => {
    const targetMisconceptionIds = misconceptions
      .filter((entry) => entry.objective_id === objective.objective_id)
      .map((entry) => entry.misconception_id)
    const sequence: LearningDesignSpecV2["lesson_sequence"] = [
      sequenceBlock(objective, "activation", "激活与当前目标直接相关的已有认知", targetMisconceptionIds),
      sequenceBlock(objective, "explanation", "用证据支持的原子主张建立概念模型", targetMisconceptionIds),
      sequenceBlock(objective, "worked_example", "展示动作、理由与证据之间的对应关系", targetMisconceptionIds),
      ...(targetMisconceptionIds.length > 0
        ? [sequenceBlock(objective, "contrast", "用正误对比显式处理高概率误区", targetMisconceptionIds)]
        : []),
      sequenceBlock(objective, "micro_check", "立即检查学习者是否形成目标判断", targetMisconceptionIds),
      sequenceBlock(objective, "guided_practice", "在保留脚手架的任务中应用目标行为", targetMisconceptionIds),
      ...(input.spec.learner_adaptation.pedagogy_contract?.lesson.require_debugging_clinic
        ? [sequenceBlock(objective, "debugging_clinic", "识别错误信号、定位原因并说明修复步骤", targetMisconceptionIds)]
        : []),
      ...(input.spec.learner_adaptation.pedagogy_contract?.practice.transfer_distance !== "near"
        || objective.cognitive_target === "transfer"
        ? [sequenceBlock(objective, "transfer", "在改变任务结构后迁移目标行为", targetMisconceptionIds)]
        : []),
    ]
    return sequence
  })
  const identity = {
    spec_id: input.spec.spec_id,
    pedagogy_contract: input.spec.learner_adaptation.pedagogy_contract
      ? structuredClone(input.spec.learner_adaptation.pedagogy_contract)
      : undefined,
    learner: { level: input.spec.learner_adaptation?.level ?? "basic", skills, misconceptions },
    objectives,
    lesson_sequence: lessonSequence,
    assessment_plan: input.assessment_plan,
  }
  return {
    schema_version: "learning-design.v2",
    design_id: stableId("LEARNING-DESIGN", identity),
    ...identity,
    candidate_policy: {
      public_candidate_count: 3,
      secure_candidate_count: 1,
      max_targeted_revisions: 2,
      minimum_quality_score: 0.62,
    },
  }
}

function targetMatches(
  concepts: string[],
  target: GenerationSpec["targets"][number],
  evidence: RagEvidencePack,
): boolean {
  const title = evidence.results.find((entry) => entry.source_id === target.source_id)?.title ?? ""
  const identities = new Set([target.source_id, target.objective_id, title].map(normalize).filter(Boolean))
  return concepts.some((concept) => {
    const normalized = normalize(concept)
    return [...identities].some((identity) => normalized === identity || normalized.includes(identity) || identity.includes(normalized))
  })
}

function cognitiveTarget(
  behavior: GenerationSpec["targets"][number]["observable_behavior"],
): LearningDesignSpecV2["objectives"][number]["cognitive_target"] {
  if (behavior === "recognize" || behavior === "explain") return "understand"
  if (behavior === "trace" || behavior === "apply") return "apply"
  if (behavior === "debug") return "analyze"
  return "transfer"
}

function adaptationDecisions(
  spec: GenerationSpec,
  skill: LearningDesignSpecV2["learner"]["skills"][number],
  hasMisconception: boolean,
): LearningDesignSpecV2["objectives"][number]["adaptation_decisions"] {
  const refs = [
    `profile:${spec.profile_ref?.profile_id ?? "legacy"}:${spec.profile_ref?.profile_version ?? "legacy"}`,
    `skill-basis:${skill.evidence_basis}`,
  ]
  if (skill.evidence_basis === "known") {
    return [
      { action: "brief_activate", reason: "画像显示已有基础，仅用短检查激活，不重复大段讲解", learner_evidence_refs: refs },
      { action: "transfer_challenge", reason: "已有基础后改变任务结构检验迁移", learner_evidence_refs: refs },
    ]
  }
  return [
    { action: "reteach", reason: skill.evidence_basis === "weak" ? "画像标记为薄弱，需要重新建立概念链" : "缺少稳定学习证据，需要从可观察基础开始", learner_evidence_refs: refs },
    ...(hasMisconception
      ? [{ action: "contrast" as const, reason: "证据包包含可诊断误区，使用正误对比处理", learner_evidence_refs: refs }]
      : []),
    { action: "guided_practice", reason: `按 scaffold_level=${spec.learner_adaptation?.scaffold_level ?? 1} 提供渐退式练习`, learner_evidence_refs: refs },
  ]
}

function sequenceBlock(
  objective: LearningDesignSpecV2["objectives"][number],
  kind: LearningDesignSpecV2["lesson_sequence"][number]["kind"],
  purpose: string,
  targetMisconceptionIds: string[],
): LearningDesignSpecV2["lesson_sequence"][number] {
  return {
    block_id: stableId("LESSON-BLOCK", { objective_id: objective.objective_id, kind }),
    objective_id: objective.objective_id,
    kind,
    purpose,
    required_fact_ids: [...objective.required_fact_ids],
    target_misconception_ids: [...targetMisconceptionIds],
  }
}

function normalize(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase()
}
