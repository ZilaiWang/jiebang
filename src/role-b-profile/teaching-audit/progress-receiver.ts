// 输入: ReceiveProgressInput（C 的动态反馈 + 当前画像 + 版本号）
// 输出: ReceiveProgressResult（更新后的画像 + 快照 + 变更摘要）
// 作用: B 角色学习进展接收器——接收 C 的测评证据后更新学习者画像
// 规则:
//   1. 从 C 的 DynamicFeedbackResult 中提取 mastery 信息
//   2. 达到 mastery 阈值的薄弱点 → 升级为 known_concepts
//   3. 持续不达标的已知概念 → 降级为 weak_concepts
//   4. 根据测评表现调整 learner level
//   5. 递增 profile_version
import type { KnowledgeDifficulty } from "../../knowledge/types"
import type { LearnerProfile } from "../types"
import type {
  ApplyProgressObservationInput,
  ProgressObservation,
  ReceiveProgressInput,
  ReceiveProgressResult,
} from "./types"
import type { LearnerProfileSnapshot } from "../../role-c-content/contracts/profile-adapter"

const LEVEL_ORDER: KnowledgeDifficulty[] = ["beginner", "basic", "intermediate", "integrated"]
const MASTERY_THRESHOLD = 0.7     // mastery ≥ 0.7 → 认为已掌握
const WEAK_THRESHOLD = 0.3        // mastery ≤ 0.3 → 持续薄弱
const LEVEL_UP_MASTERY = 0.8      // 全部 mastery ≥ 0.8 → 升级

export function receiveLearningProgress(input: ReceiveProgressInput): ReceiveProgressResult {
  const { feedback, currentProfile, profileVersion } = input
  return applyProgressObservation({
    currentProfile,
    profileVersion,
    observation: {
      observationId: feedback.feedback_id,
      action: feedback.final_decision.action,
      overallAccuracy: feedback.round_score.accuracy,
      mastery: feedback.mastery_snapshot.map((snapshot) => ({
        objectiveId: snapshot.objective_id,
        mastery: snapshot.mastery,
        evidenceBatches: snapshot.evidence_batches,
      })),
      // DynamicFeedbackResult 没有 objective_id 到 source_id 的映射，不能据此改写概念列表。
      conceptEvidence: [],
    },
  })
}

/** 将不同来源的进展统一应用到 B 持有的画像。 */
export function applyProgressObservation(
  input: ApplyProgressObservationInput,
): ReceiveProgressResult {
  const { observation, currentProfile, profileVersion } = input
  assertObservation(observation, profileVersion)
  const newProfile: LearnerProfile = {
    ...currentProfile,
    learner_id: currentProfile.learner_id,
    known_concepts: [...currentProfile.known_concepts],
    weak_concepts: [...currentProfile.weak_concepts],
  }

  const knownAdded: string[] = []
  const knownPromotedFromWeak: string[] = []
  const weakAdded: string[] = []
  const weakCleared: string[] = []

  for (const evidence of observation.conceptEvidence) {
    const matches = (profileConcept: string) =>
      input.conceptMatches?.(profileConcept, evidence)
        ?? profileConcept.trim().toLowerCase() === evidence.concept.trim().toLowerCase()

    if (evidence.evidenceScore >= MASTERY_THRESHOLD) {
      const wasKnown = newProfile.known_concepts.some(matches)
      const clearedWeak = newProfile.weak_concepts.filter(matches)
      newProfile.weak_concepts = newProfile.weak_concepts.filter((concept) => !matches(concept))
      weakCleared.push(...clearedWeak)
      if (!wasKnown) {
        newProfile.known_concepts.push(evidence.concept)
        if (clearedWeak.length > 0) {
          knownPromotedFromWeak.push(evidence.concept)
        } else {
          knownAdded.push(evidence.concept)
        }
      }
      continue
    }

    if (evidence.evidenceScore <= WEAK_THRESHOLD && evidence.evidenceBatches >= 1) {
      newProfile.known_concepts = newProfile.known_concepts.filter((concept) => !matches(concept))
      if (!newProfile.weak_concepts.some(matches)) {
        newProfile.weak_concepts.push(evidence.concept)
        weakAdded.push(evidence.concept)
      }
    }
  }

  const overallAccuracy = observation.overallAccuracy
  const oldLevel = currentProfile.level
  let newLevel = oldLevel

  // 事件批次没有轮次总分分母，不据此调整 level；完整动态反馈仍按原规则处理。
  const allMastered = observation.mastery.length > 0
    && observation.mastery.every((snapshot) => snapshot.mastery >= MASTERY_THRESHOLD)
  if (
    observation.action === "advance"
    && allMastered
    && overallAccuracy !== null
    && overallAccuracy >= LEVEL_UP_MASTERY
  ) {
    const currentIdx = LEVEL_ORDER.indexOf(oldLevel)
    if (currentIdx < LEVEL_ORDER.length - 1) {
      newLevel = LEVEL_ORDER[currentIdx + 1]
    }
  }

  // 如果 decision 是 remediate 且 accuracy 很低，考虑降级
  if (
    observation.action === "remediate"
    && overallAccuracy !== null
    && overallAccuracy < WEAK_THRESHOLD
  ) {
    const currentIdx = LEVEL_ORDER.indexOf(oldLevel)
    if (currentIdx > 0) {
      newLevel = LEVEL_ORDER[currentIdx - 1]
    }
  }

  newProfile.level = newLevel

  const snapshot: LearnerProfileSnapshot = {
    schema_version: "1.0",
    profile_id: `PROFILE-${currentProfile.learner_id}-${profileVersion}`,
    profile_version: profileVersion,
    learner_id: currentProfile.learner_id,
    level: newProfile.level,
    known_concepts: [...newProfile.known_concepts],
    weak_concepts: [...newProfile.weak_concepts],
    goal: newProfile.goal,
    preferred_contexts: [],
    accommodations: [],
    provenance_ref: `role-b:receive-progress:${observation.observationId}`,
  }

  return {
    profile: newProfile,
    snapshot,
    changes: {
      levelChanged: oldLevel !== newLevel,
      oldLevel,
      newLevel,
      knownAdded,
      knownPromotedFromWeak,
      weakAdded,
      weakCleared,
    },
  }
}

function assertObservation(observation: ProgressObservation, profileVersion: string): void {
  if (observation.observationId.trim() === "" || profileVersion.trim() === "") {
    throw new Error("ROLE_B_PROGRESS_OBSERVATION_IDENTITY_EMPTY")
  }
  if (
    observation.overallAccuracy !== null
    && (
      !Number.isFinite(observation.overallAccuracy)
      || observation.overallAccuracy < 0
      || observation.overallAccuracy > 1
    )
  ) {
    throw new Error("ROLE_B_PROGRESS_OBSERVATION_ACCURACY_INVALID")
  }
  if (observation.mastery.some((entry) =>
    !Number.isFinite(entry.mastery)
      || entry.mastery < 0
      || entry.mastery > 1
      || !Number.isInteger(entry.evidenceBatches)
      || entry.evidenceBatches < 0
  )) {
    throw new Error("ROLE_B_PROGRESS_OBSERVATION_MASTERY_INVALID")
  }
  if (observation.conceptEvidence.some((entry) =>
    entry.sourceId.trim() === ""
      || entry.concept.trim() === ""
      || !Number.isFinite(entry.evidenceScore)
      || entry.evidenceScore < 0
      || entry.evidenceScore > 1
      || !Number.isInteger(entry.evidenceBatches)
      || entry.evidenceBatches < 1
  )) {
    throw new Error("ROLE_B_PROGRESS_OBSERVATION_CONCEPT_INVALID")
  }
}
