import type { KnowledgeBase } from "../../knowledge/types"
import {
  C_SCHEMA_VERSION,
  contentHash,
} from "../../role-c-content/contracts/common"
import type {
  RoleBLearningProgressPort,
  RoleCDeliveryAck,
  RoleCLearningProgressDelivery,
} from "../../role-c-content/contracts/external-api"
import {
  adaptLearnerProfile,
  type LearnerProfileSnapshot,
} from "../../role-c-content/contracts/profile-adapter"
import { validateRoleCSchema } from "../../role-c-content/validators/runtime-schema-validator"
import { canonicalizeConcept } from "../concept-canonicalizer"
import type { LearnerProfile } from "../types"
import { applyProgressObservation } from "./progress-receiver"
import type {
  ProgressObservation,
  ReceiveProgressResult,
} from "./types"

export interface RoleBLearnerProgressRegistration {
  learnerIdHash: string
  currentProfile: LearnerProfile
  profileVersion: string
  /** B 持有的单调递增修订号。 */
  profileRevision: number
}

export interface RoleBLearnerProgressState {
  learnerIdHash: string
  currentProfile: LearnerProfile
  currentSnapshot: LearnerProfileSnapshot
  profileVersion: string
  profileRevision: number
}

export interface RoleBLearningProgressAdapterOptions {
  knowledgeBase: KnowledgeBase
  learners: RoleBLearnerProgressRegistration[]
}

interface MutableLearnerProgressState extends RoleBLearnerProgressState {
  lastResult: ReceiveProgressResult | null
}

/**
 * B 侧的 C→B 学习进展端口。
 *
 * 该适配器校验 C 信封、按 delivery_id 去重，并由 B 保存当前画像和版本。
 * C 事件没有完整轮次总分，因此只用 source_id + evidence_score 更新概念，
 * 不从事件批次推断 learner level。
 */
export class RoleBLearningProgressAdapter implements RoleBLearningProgressPort {
  private readonly knowledgeBase: KnowledgeBase
  private readonly knowledgeItemsBySourceId: Map<string, KnowledgeBase["items"][number]>
  private readonly learnerStates = new Map<string, MutableLearnerProgressState>()
  private readonly committedDeliveryIds = new Set<string>()

  constructor(options: RoleBLearningProgressAdapterOptions) {
    this.knowledgeBase = structuredClone(options.knowledgeBase)
    this.knowledgeItemsBySourceId = new Map(
      this.knowledgeBase.items.map((item) => [item.sourceId, item] as const),
    )

    for (const learner of options.learners) {
      assertRegistration(learner)
      if (this.learnerStates.has(learner.learnerIdHash)) {
        throw new Error("ROLE_B_PROGRESS_DUPLICATE_LEARNER_REGISTRATION")
      }
      const currentProfile = structuredClone(learner.currentProfile)
      const currentSnapshot = adaptLearnerProfile(currentProfile, {
        profile_version: learner.profileVersion,
        provenance_ref: "role-b:learning-progress:initial",
      })
      this.learnerStates.set(learner.learnerIdHash, {
        learnerIdHash: learner.learnerIdHash,
        currentProfile,
        currentSnapshot,
        profileVersion: learner.profileVersion,
        profileRevision: learner.profileRevision,
        lastResult: null,
      })
    }
  }

  async publishLearningProgress(
    delivery: RoleCLearningProgressDelivery,
  ): Promise<RoleCDeliveryAck> {
    this.assertDelivery(delivery)

    // 幂等检查必须早于画像版本检查：成功提交后的原信封重放仍应返回 duplicate。
    if (this.committedDeliveryIds.has(delivery.delivery_id)) {
      return buildAck(delivery, "duplicate")
    }

    const state = this.learnerStates.get(delivery.learner_id_hash)
    if (!state) throw new Error("ROLE_B_PROGRESS_LEARNER_UNKNOWN")
    if (delivery.profile_version !== state.profileVersion) {
      throw new Error("ROLE_B_PROGRESS_PROFILE_VERSION_MISMATCH")
    }

    const nextRevision = state.profileRevision + 1
    const nextProfileVersion = buildNextProfileVersion(nextRevision, delivery.delivery_id)
    const observation = this.toProgressObservation(delivery)
    const result = applyProgressObservation({
      observation,
      currentProfile: state.currentProfile,
      profileVersion: nextProfileVersion,
      conceptMatches: (profileConcept, evidence) =>
        conceptMatchesSource(
          profileConcept,
          evidence.sourceId,
          evidence.concept,
          this.knowledgeBase,
        ),
    })

    // 所有校验与画像计算成功后再一次性提交状态和幂等账本。
    state.currentProfile = structuredClone(result.profile)
    state.currentSnapshot = structuredClone(result.snapshot)
    state.profileVersion = nextProfileVersion
    state.profileRevision = nextRevision
    state.lastResult = structuredClone(result)
    this.committedDeliveryIds.add(delivery.delivery_id)

    return buildAck(delivery, "accepted")
  }

  getCurrentProfile(learnerIdHash: string): LearnerProfile | null {
    const state = this.learnerStates.get(learnerIdHash)
    return state ? structuredClone(state.currentProfile) : null
  }

  getCurrentSnapshot(learnerIdHash: string): LearnerProfileSnapshot | null {
    const state = this.learnerStates.get(learnerIdHash)
    return state ? structuredClone(state.currentSnapshot) : null
  }

  getCurrentState(learnerIdHash: string): RoleBLearnerProgressState | null {
    const state = this.learnerStates.get(learnerIdHash)
    if (!state) return null
    return {
      learnerIdHash: state.learnerIdHash,
      currentProfile: structuredClone(state.currentProfile),
      currentSnapshot: structuredClone(state.currentSnapshot),
      profileVersion: state.profileVersion,
      profileRevision: state.profileRevision,
    }
  }

  private assertDelivery(delivery: RoleCLearningProgressDelivery): void {
    const schema = validateRoleCSchema("learning_progress_delivery.schema.json", delivery)
    if (!schema.ok) {
      throw new Error(`ROLE_B_PROGRESS_DELIVERY_SCHEMA_INVALID:${schema.issues[0]?.code ?? "unknown"}`)
    }

    const { delivery_id: deliveryId, ...body } = delivery
    if (contentHash(body) !== deliveryId) {
      throw new Error("ROLE_B_PROGRESS_DELIVERY_HASH_MISMATCH")
    }

    const eventIds = delivery.evidence_events.map((event) => event.event_id)
    if (new Set(eventIds).size !== eventIds.length) {
      throw new Error("ROLE_B_PROGRESS_DUPLICATE_EVENT")
    }
    if (delivery.evidence_events.some((event) =>
      event.learner_id_hash !== delivery.learner_id_hash
        || event.profile_version !== delivery.profile_version
    )) {
      throw new Error("ROLE_B_PROGRESS_EVENT_IDENTITY_MISMATCH")
    }

    const drift = delivery.profile_drift_suggestion
    if (
      drift
      && (
        drift.learner_id_hash !== delivery.learner_id_hash
        || drift.profile_version !== delivery.profile_version
      )
    ) {
      throw new Error("ROLE_B_PROGRESS_DRIFT_IDENTITY_MISMATCH")
    }

    const recommendationKeys = new Set(
      delivery.evidence_events.map((event) => contentHash({
        ...event.recommendation,
        reason_codes: [...event.recommendation.reason_codes].sort(),
      })),
    )
    if (recommendationKeys.size > 1) {
      throw new Error("ROLE_B_PROGRESS_RECOMMENDATION_MISMATCH")
    }
    if (
      drift
      && delivery.evidence_events.some((event) => event.recommendation.action !== "reprofile")
    ) {
      throw new Error("ROLE_B_PROGRESS_DRIFT_RECOMMENDATION_MISMATCH")
    }

    for (const event of delivery.evidence_events) {
      if (!this.knowledgeItemsBySourceId.has(event.source_id)) {
        throw new Error(`ROLE_B_PROGRESS_SOURCE_UNKNOWN:${event.source_id}`)
      }
    }
  }

  private toProgressObservation(
    delivery: RoleCLearningProgressDelivery,
  ): ProgressObservation {
    const objectiveEvidence = aggregateEvidence(
      delivery.evidence_events,
      (event) => event.objective_id,
    )
    const conceptEvidence = aggregateEvidence(
      delivery.evidence_events,
      (event) => event.source_id,
    )
    const action = delivery.profile_drift_suggestion
      ? "reprofile"
      : delivery.evidence_events[0]!.recommendation.action

    return {
      observationId: delivery.delivery_id,
      action,
      overallAccuracy: null,
      mastery: [...objectiveEvidence.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([objectiveId, evidence]) => ({
          objectiveId,
          mastery: average(evidence),
          evidenceBatches: evidence.length,
        })),
      conceptEvidence: [...conceptEvidence.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([sourceId, evidence]) => ({
          sourceId,
          concept: this.knowledgeItemsBySourceId.get(sourceId)!.title,
          evidenceScore: average(evidence),
          evidenceBatches: evidence.length,
        })),
    }
  }
}

function aggregateEvidence(
  events: RoleCLearningProgressDelivery["evidence_events"],
  keyOf: (event: RoleCLearningProgressDelivery["evidence_events"][number]) => string,
): Map<string, number[]> {
  const grouped = new Map<string, number[]>()
  for (const event of events) {
    const key = keyOf(event)
    const current = grouped.get(key) ?? []
    current.push(event.evidence.evidence_score)
    grouped.set(key, current)
  }
  return grouped
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function conceptMatchesSource(
  profileConcept: string,
  sourceId: string,
  canonicalTitle: string,
  knowledgeBase: KnowledgeBase,
): boolean {
  const normalized = profileConcept.trim().toLowerCase()
  if (normalized === sourceId.toLowerCase() || normalized === canonicalTitle.trim().toLowerCase()) {
    return true
  }
  const canonical = canonicalizeConcept(profileConcept, knowledgeBase)
  if (!canonical.sourceIds.includes(sourceId)) return false

  // A project may repeat component keywords (for example K018 contains
  // "列表/循环/函数"). Its own prerequisite graph identifies those
  // components without relying on source-id ordering. Project evidence updates
  // the project concept, while evidence from K007/K008/K009/K013 can update the
  // corresponding component concept.
  const source = knowledgeBase.items.find((item) => item.sourceId === sourceId)
  const canonicalSources = new Set(canonical.sourceIds)
  const aliasesAComponentPrerequisite = source?.prerequisites
    .some((prerequisiteId) => canonicalSources.has(prerequisiteId)) ?? false
  return !aliasesAComponentPrerequisite
}

function buildNextProfileVersion(profileRevision: number, deliveryId: string): string {
  const digestPrefix = deliveryId.slice("sha256:".length, "sha256:".length + 12)
  return `role-b-profile-v${profileRevision}-${digestPrefix}`
}

function buildAck(
  delivery: RoleCLearningProgressDelivery,
  status: RoleCDeliveryAck["status"],
): RoleCDeliveryAck {
  const ack: RoleCDeliveryAck = {
    schema_version: C_SCHEMA_VERSION,
    delivery_kind: "learning_progress",
    delivery_id: delivery.delivery_id,
    status,
  }
  const schema = validateRoleCSchema("delivery_ack.schema.json", ack)
  if (!schema.ok) throw new Error("ROLE_B_PROGRESS_ACK_SCHEMA_INVALID")
  return ack
}

function assertRegistration(learner: RoleBLearnerProgressRegistration): void {
  if (
    learner.learnerIdHash.trim() === ""
    || learner.currentProfile.learner_id.trim() === ""
    || learner.profileVersion.trim() === ""
  ) {
    throw new Error("ROLE_B_PROGRESS_REGISTRATION_IDENTITY_EMPTY")
  }
  if (!Number.isSafeInteger(learner.profileRevision) || learner.profileRevision < 0) {
    throw new Error("ROLE_B_PROGRESS_REGISTRATION_REVISION_INVALID")
  }
}
