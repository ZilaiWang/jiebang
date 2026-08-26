import { selectEvidenceBundle, type CapabilityFactLike } from "../../knowledge/capabilities"
import type { LearningObjective } from "../contracts/profile-adapter"

export interface EvidenceSourceLike {
  source_id?: string
  sourceId?: string
  facts: Array<CapabilityFactLike & { source_id?: string; sourceId?: string }>
  coreFactIds?: string[]
}

export interface BoundObjectiveEvidence {
  required_fact_ids: string[]
  capabilities: ReturnType<typeof selectEvidenceBundle>["capabilities"]
  missing_capabilities: ReturnType<typeof selectEvidenceBundle>["missing_capabilities"]
  sufficient: boolean
}

/** The only source-to-objective fact binding policy used by live entrypoints. */
export function bindObjectiveEvidence(
  objective: Pick<LearningObjective, "source_id" | "observable_behavior" | "required_fact_ids">,
  evidenceSources: EvidenceSourceLike[],
): BoundObjectiveEvidence {
  const source = evidenceSources.find((item) =>
    (item.source_id ?? item.sourceId) === objective.source_id)
  if (!source) {
    return {
      required_fact_ids: [],
      capabilities: [],
      missing_capabilities: [],
      sufficient: false,
    }
  }
  const facts = source.facts.filter((fact) =>
    (fact.source_id ?? fact.sourceId ?? objective.source_id) === objective.source_id)
  const availableFactIds = new Set(facts.map((fact) => fact.fact_id ?? fact.factId).filter(
    (factId): factId is string => typeof factId === "string" && factId.length > 0,
  ))
  const sourceCoreFactIds = (source.coreFactIds ?? []).filter((factId) => availableFactIds.has(factId))
  const selection = selectEvidenceBundle({
    behavior: objective.observable_behavior,
    facts,
    preferred_fact_ids: objective.required_fact_ids.length > 0
      ? objective.required_fact_ids
      : sourceCoreFactIds,
    max_facts: 5,
  })
  // Non-empty required_fact_ids is an upstream/frozen contract, not merely a
  // ranking hint.  Capability selection may prove whether that contract is
  // teachable, but must not silently replace twelve required facts with one
  // minimal explain fact during recovery.  Empty drafts are the only case in
  // which C is authorised to choose a fresh minimal bundle.
  const boundFactIds = objective.required_fact_ids.length > 0
    ? [...new Set([...selection.fact_ids, ...objective.required_fact_ids])]
    : sourceCoreFactIds.length > 0
      ? [...new Set([...selection.fact_ids, ...sourceCoreFactIds])]
      : selection.fact_ids
  return {
    required_fact_ids: boundFactIds,
    capabilities: selection.capabilities,
    missing_capabilities: selection.missing_capabilities,
    sufficient: selection.sufficient,
  }
}
