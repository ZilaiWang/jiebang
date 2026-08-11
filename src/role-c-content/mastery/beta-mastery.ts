import { C_SCHEMA_VERSION, stableId, type SchemaVersion } from "../contracts/common"
import type { LearningEvidenceEvent, ProfileDriftSuggestion } from "../contracts/learning-evidence-event"
import { decideNextAction, type NextActionDecision } from "./next-action-policy"
import { validateRoleCSchema } from "../validators/runtime-schema-validator"

export interface ObjectiveMasteryState {
  schema_version: SchemaVersion
  learner_id_hash: string
  profile_version: string
  objective_id: string
  alpha: number
  beta: number
  mastery: number
  evidence_batches: number
  observed_modalities: LearningEvidenceEvent["evidence"]["modality"][]
  /** Durable idempotency ledger of cryptographic evidence-batch identities. */
  processed_artifact_ids: string[]
  last_action: NextActionDecision["action"]
  revision: number
}

export interface MasteryStateStore {
  load(learnerIdHash: string, profileVersion: string, objectiveId: string): Promise<ObjectiveMasteryState | undefined>
  save(state: ObjectiveMasteryState, expectedRevision: number): Promise<void>
  /** Checks every expected revision before committing any objective. */
  saveBatch(writes: MasteryStateWrite[]): Promise<void>
}

export interface MasteryStateWrite {
  state: ObjectiveMasteryState
  expected_revision: number
}

export class InMemoryMasteryStateStore implements MasteryStateStore {
  private readonly states = new Map<string, ObjectiveMasteryState>()

  async load(learnerIdHash: string, profileVersion: string, objectiveId: string): Promise<ObjectiveMasteryState | undefined> {
    const value = this.states.get(keyOf(learnerIdHash, profileVersion, objectiveId))
    return value ? structuredClone(value) : undefined
  }

  async save(state: ObjectiveMasteryState, expectedRevision: number): Promise<void> {
    await this.saveBatch([{ state, expected_revision: expectedRevision }])
  }

  async saveBatch(writes: MasteryStateWrite[]): Promise<void> {
    assertUniqueWrites(writes)
    for (const write of writes) assertRevisionStep(write)
    for (const write of writes) {
      const key = keyOf(write.state.learner_id_hash, write.state.profile_version, write.state.objective_id)
      const current = this.states.get(key)
      if ((current?.revision ?? 0) !== write.expected_revision) throw new Error("MASTERY_REVISION_CONFLICT")
    }
    for (const write of writes) {
      const key = keyOf(write.state.learner_id_hash, write.state.profile_version, write.state.objective_id)
      this.states.set(key, structuredClone(write.state))
    }
  }
}

export interface MasteryUpdateResult {
  states: ObjectiveMasteryState[]
  decisions: Record<string, NextActionDecision>
}

export interface MasteryUpdatePlan extends MasteryUpdateResult {
  writes: MasteryStateWrite[]
}

/**
 * Pure with respect to persistence: computes the complete multi-objective transition
 * so drift can be evaluated before one authoritative public decision is frozen.
 */
export async function prepareMasteryUpdateFromEvidence(
  events: LearningEvidenceEvent[],
  store: MasteryStateStore,
): Promise<MasteryUpdatePlan> {
  const seenEventIds = new Set<string>()
  for (const event of events) {
    const report = validateRoleCSchema("learning_evidence_event.schema.json", event)
    if (!report.ok) throw new Error(`INVALID_LEARNING_EVIDENCE:${report.issues.map((entry) => entry.path).join(",")}`)
    if (seenEventIds.has(event.event_id)) throw new Error(`DUPLICATE_LEARNING_EVIDENCE:${event.event_id}`)
    seenEventIds.add(event.event_id)
  }
  const grouped = groupEvidenceBatches(events)
  const finalStates = new Map<string, ObjectiveMasteryState>()
  const initialRevisions = new Map<string, number>()
  const decisions: Record<string, NextActionDecision> = {}
  for (const batch of grouped) {
    const first = batch[0]!
    const itemIds = batch.map((event) => event.provenance.item_id)
    if (new Set(itemIds).size !== itemIds.length) {
      throw new Error(`DUPLICATE_EVIDENCE_ITEM_IN_BATCH:${first.provenance.idempotency_key}`)
    }
    const stateKey = keyOf(first.learner_id_hash, first.profile_version, first.objective_id)
    const staged = finalStates.get(stateKey)
    const existing = staged ?? await store.load(first.learner_id_hash, first.profile_version, first.objective_id)
    // Normalize states written before the durable idempotency ledger was introduced.
    // This keeps even the replay/no-save path conformant to the current interface.
    const base: ObjectiveMasteryState = existing
      ? { ...existing, processed_artifact_ids: existing.processed_artifact_ids ?? [] }
      : initialState(first)
    if (!initialRevisions.has(stateKey)) initialRevisions.set(stateKey, base.revision)
    const processedArtifactIds = base.processed_artifact_ids
    if (processedArtifactIds.includes(first.provenance.idempotency_key)) {
      const sufficient = base.observed_modalities.includes("code") || base.observed_modalities.includes("trace")
      finalStates.set(stateKey, base)
      decisions[base.objective_id] = decideNextAction({
        mastery: base.mastery,
        sufficient_modalities: sufficient,
        previous_action: base.last_action,
      })
      continue
    }
    const evidence = clamp01(batch.reduce((sum, event) => sum + event.evidence.evidence_score, 0) / batch.length)
    const modalities = [...new Set([...base.observed_modalities, ...batch.map((event) => event.evidence.modality)])]
    const alpha = base.alpha + evidence
    const beta = base.beta + (1 - evidence)
    const mastery = alpha / (alpha + beta)
    const sufficient = modalities.includes("code") || modalities.includes("trace")
    const decision = decideNextAction({ mastery, sufficient_modalities: sufficient, previous_action: base.last_action })
    const next: ObjectiveMasteryState = {
      ...base,
      alpha: round(alpha),
      beta: round(beta),
      mastery: round(mastery),
      evidence_batches: base.evidence_batches + 1,
      observed_modalities: modalities,
      processed_artifact_ids: [...processedArtifactIds, first.provenance.idempotency_key],
      last_action: decision.action,
      // One atomic save is one CAS revision even when the plan folds multiple
      // evidence batches for this objective into the same persisted state.
      revision: initialRevisions.get(stateKey)! + 1,
    }
    finalStates.set(stateKey, next)
    decisions[next.objective_id] = decision
  }
  const states = [...finalStates.values()]
    .sort((left, right) => left.objective_id.localeCompare(right.objective_id))
  const writes = states
    .filter((state) => state.revision !== initialRevisions.get(keyOf(
      state.learner_id_hash,
      state.profile_version,
      state.objective_id,
    )))
    .map((state) => ({
      state,
      expected_revision: initialRevisions.get(keyOf(
        state.learner_id_hash,
        state.profile_version,
        state.objective_id,
      ))!,
    }))
  return { states, decisions, writes }
}

export async function commitMasteryUpdatePlan(
  plan: MasteryUpdatePlan,
  store: MasteryStateStore,
): Promise<MasteryUpdateResult> {
  if (plan.writes.length > 0) await store.saveBatch(structuredClone(plan.writes))
  return {
    states: structuredClone(plan.states),
    decisions: structuredClone(plan.decisions),
  }
}

/** One submission/artifact contributes at most one atomic Beta update per objective. */
export async function updateMasteryFromEvidence(
  events: LearningEvidenceEvent[],
  store: MasteryStateStore,
): Promise<MasteryUpdateResult> {
  const plan = await prepareMasteryUpdateFromEvidence(events, store)
  return commitMasteryUpdatePlan(plan, store)
}

export interface ProfileExpectationObservation {
  objective_id: string
  expected: "known" | "weak"
  mastery: number
}

export function detectProfileDrift(input: {
  learner_id_hash: string
  profile_version: string
  observations: ProfileExpectationObservation[]
  minimum_conflicts?: number
}): ProfileDriftSuggestion | undefined {
  const conflicts = input.observations.filter((observation) =>
    (observation.expected === "known" && observation.mastery < 0.45)
      || (observation.expected === "weak" && observation.mastery > 0.85),
  )
  const objectiveIds = [...new Set(conflicts.map((entry) => entry.objective_id))]
  if (objectiveIds.length < (input.minimum_conflicts ?? 2)) return undefined
  return {
    schema_version: C_SCHEMA_VERSION,
    suggestion_id: stableId("PDS", { learner: input.learner_id_hash, profile: input.profile_version, objectiveIds }),
    learner_id_hash: input.learner_id_hash,
    profile_version: input.profile_version,
    conflicting_objective_ids: objectiveIds,
    reason_codes: ["repeated_profile_evidence_conflict", "profile_refresh_recommended"],
    confidence: round(Math.min(0.95, 0.7 + objectiveIds.length * 0.08)),
    action: "reprofile",
  }
}

function groupEvidenceBatches(events: LearningEvidenceEvent[]): LearningEvidenceEvent[][] {
  const groups = new Map<string, LearningEvidenceEvent[]>()
  for (const event of events) {
    const key = `${event.learner_id_hash}\u0000${event.profile_version}\u0000${event.objective_id}\u0000${event.provenance.idempotency_key}`
    const bucket = groups.get(key) ?? []
    bucket.push(event)
    groups.set(key, bucket)
  }
  return [...groups.values()]
}

function initialState(event: LearningEvidenceEvent): ObjectiveMasteryState {
  return {
    schema_version: C_SCHEMA_VERSION,
    learner_id_hash: event.learner_id_hash,
    profile_version: event.profile_version,
    objective_id: event.objective_id,
    alpha: 1,
    beta: 1,
    mastery: 0.5,
    evidence_batches: 0,
    observed_modalities: [],
    processed_artifact_ids: [],
    last_action: "reinforce",
    revision: 0,
  }
}

function keyOf(learner: string, profile: string, objective: string): string {
  return `${learner}\u0000${profile}\u0000${objective}`
}

function assertUniqueWrites(writes: MasteryStateWrite[]): void {
  const keys = writes.map((write) => keyOf(
    write.state.learner_id_hash,
    write.state.profile_version,
    write.state.objective_id,
  ))
  if (new Set(keys).size !== keys.length) throw new Error("MASTERY_DUPLICATE_BATCH_WRITE")
}

function assertRevisionStep(write: MasteryStateWrite): void {
  if (!Number.isSafeInteger(write.expected_revision)
    || write.expected_revision < 0
    || !Number.isSafeInteger(write.state.revision)
    || write.state.revision !== write.expected_revision + 1) {
    throw new Error("MASTERY_REVISION_STEP_INVALID")
  }
}

function clamp01(value: number): number { return Math.max(0, Math.min(1, value)) }
function round(value: number): number { return Math.round(value * 1_000_000) / 1_000_000 }
