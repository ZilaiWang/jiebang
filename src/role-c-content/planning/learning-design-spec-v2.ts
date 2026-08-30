import { stableId } from "../contracts/common"
import type { RagEvidencePack } from "../contracts/evidence-pack"
import type { GenerationSpec } from "../contracts/generation-spec"
import type { AssessmentItemPlan } from "../providers/staged-generation"
import type { RoleCPedagogyContract } from "../../role-b-profile/pedagogy-contract"
import {
  progressAdaptationActions,
  resolveObjectiveSkillEstimate,
  type ObjectiveProgressBand,
  type SkillEvidenceBasis,
} from "./objective-skill-estimate"

export interface LearningDesignSpecV2 {
  schema_version: "learning-design.v2"
  design_id: string
  spec_id: string
  pedagogy_contract?: RoleCPedagogyContract
  learner: {
    level: GenerationSpec["learner_adaptation"]["level"]
    skills: Array<{
      objective_id: string
      source_id: string
      mean: number
      lower: number
      upper: number
      evidence_basis: SkillEvidenceBasis
      progress_band: ObjectiveProgressBand
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
  const pedagogy = input.spec.learner_adaptation.pedagogy_contract
  const mastery = pedagogy?.learner_state.mastery_by_source_id ?? {}
  const known = pedagogy?.learner_state.known_concepts ?? input.spec.learner_adaptation.known_concepts ?? []
  const weak = pedagogy?.learner_state.weak_concepts ?? input.spec.learner_adaptation.weak_concepts ?? []
  const skills = input.spec.targets.map((target) => {
    const source = input.evidence.results.find((entry) => entry.source_id === target.source_id)
    const estimate = resolveObjectiveSkillEstimate({
      source_id: target.source_id,
      objective_id: target.objective_id,
      title: source?.title,
      mastery_by_source_id: mastery,
      known_concepts: known,
      weak_concepts: weak,
    })
    return {
      objective_id: target.objective_id,
      ...estimate,
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
        probability: misconceptionProbability(skills.find((skill) => skill.objective_id === target.objective_id)!),
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
    const skill = skills.find((entry) => entry.objective_id === objective.objective_id)!
    const targetMisconceptionIds = misconceptions
      .filter((entry) => entry.objective_id === objective.objective_id)
      .map((entry) => entry.misconception_id)
    const sequence: LearningDesignSpecV2["lesson_sequence"] = [
      sequenceBlock(objective, "activation", skill.progress_band === "mastered" ? "用短检查激活已掌握能力" : "激活与当前目标直接相关的已有认知", targetMisconceptionIds),
      ...(["needs_reteach", "developing"].includes(skill.progress_band)
        ? [sequenceBlock(objective, "explanation", "用证据支持的原子主张建立概念模型", targetMisconceptionIds)]
        : []),
      ...(skill.progress_band !== "mastered"
        ? [sequenceBlock(objective, "worked_example", "展示动作、理由与证据之间的对应关系", targetMisconceptionIds)]
        : []),
      ...(targetMisconceptionIds.length > 0 && skill.progress_band === "needs_reteach"
        ? [sequenceBlock(objective, "contrast", "用正误对比显式处理高概率误区", targetMisconceptionIds)]
        : []),
      sequenceBlock(objective, "micro_check", "立即检查学习者是否形成目标判断", targetMisconceptionIds),
      ...(skill.progress_band !== "mastered"
        ? [sequenceBlock(objective, "guided_practice", "在与当前进度匹配的脚手架中应用目标行为", targetMisconceptionIds)]
        : []),
      ...(input.spec.learner_adaptation.pedagogy_contract?.lesson.require_debugging_clinic
        ? [sequenceBlock(objective, "debugging_clinic", "识别错误信号、定位原因并说明修复步骤", targetMisconceptionIds)]
        : []),
      ...(skill.progress_band === "mastered"
        || skill.progress_band === "ready_for_transfer"
        || input.spec.learner_adaptation.pedagogy_contract?.practice.transfer_distance !== "near"
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
  return progressAdaptationActions(skill.progress_band, hasMisconception).map((action) => ({
    action,
    reason: action === "brief_activate"
      ? `目标熟练度 ${skill.mean.toFixed(2)}，用短检查激活已有能力`
      : action === "transfer_challenge"
        ? `目标熟练度 ${skill.mean.toFixed(2)}，可改变任务结构检验迁移`
        : action === "contrast"
          ? "当前证据包含可诊断误区，使用正误对比处理"
          : action === "guided_practice"
            ? `目标熟练度 ${skill.mean.toFixed(2)}，按 scaffold_level=${spec.learner_adaptation?.scaffold_level ?? 1} 进行渐退练习`
            : `目标熟练度 ${skill.mean.toFixed(2)}，需要重新建立概念与操作链`,
    learner_evidence_refs: refs,
  }))
}

function misconceptionProbability(skill: LearningDesignSpecV2["learner"]["skills"][number]): number {
  if (skill.progress_band === "needs_reteach") return 0.72
  if (skill.progress_band === "developing") return 0.55
  if (skill.progress_band === "ready_for_transfer") return 0.3
  return 0.18
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
