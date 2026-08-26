import { selectEvidenceBundle, type CapabilityFactLike } from "../../knowledge/capabilities"
import type { LearningObjective } from "../contracts/profile-adapter"

export interface EvidenceSourceLike {
  source_id?: string
  sourceId?: string
  facts: Array<CapabilityFactLike & { source_id?: string; sourceId?: string }>
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
  const selection = selectEvidenceBundle({
    behavior: objective.observable_behavior,
    facts,
    preferred_fact_ids: objective.required_fact_ids,
    max_facts: 5,
  })
  return {
    required_fact_ids: selection.fact_ids,
    capabilities: selection.capabilities,
    missing_capabilities: selection.missing_capabilities,
    sufficient: selection.sufficient,
  }
}
