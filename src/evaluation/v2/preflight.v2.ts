import type { KnowledgeBase } from "../../knowledge/types"
import {
  adaptRagResult,
  adaptLearnerProfile,
  buildGenerationSpec,
} from "../../role-c-content"
import { buildRoleCProfileSnapshotOptions } from "../../role-b-profile/learner-profile-v2"
import { validateRoleCSchema } from "../../role-c-content/validators/runtime-schema-validator"
import { buildResourceBlueprint } from "../../role-c-content/planning/resource-blueprint"
import { buildConceptSectionPlansForSegment } from "../../role-c-content/planning/concept-section-plan"
import { planAssessmentCapacityForPipeline } from "../../role-c-content/orchestrator/content-pipeline"
import { COMPETITION_CASES_V2 } from "./competition-cases.v2"
import { assertDynamicTrajectoryCatalogV2 } from "./competition-dynamic-trajectories.v2"
import {
  assertFrozenManifestMatchesCurrentV2,
  type FrozenCompetitionManifestV2,
} from "./competition-manifest.v2"
import { prepareCompetitionV2Input } from "./competition-runner.v2"

export async function preflightCompetitionV2(
  kb: KnowledgeBase,
  manifest: FrozenCompetitionManifestV2,
) {
  assertFrozenManifestMatchesCurrentV2({ frozen: manifest, knowledgeBase: kb })
  assertDynamicTrajectoryCatalogV2()
  const rows = []
  for (const c of COMPETITION_CASES_V2) {
    try {
      const p = await prepareCompetitionV2Input({
        evaluationCase: c,
        expectation: manifest.cases.find((e) => e.case_id === c.case_id)!,
        knowledgeBase: kb,
      })
      const evidence_pack = adaptRagResult(p.ragResult, {
        kb_version: kb.version,
        rag_version: "rule-rag-0.1",
      })
      const profile_snapshot = adaptLearnerProfile(
        p.profile,
        buildRoleCProfileSnapshotOptions(p.profile),
      )
      const built = buildGenerationSpec({
        run_id: `PREFLIGHT-${c.case_id}`,
        path_node: p.pathNode,
        profile_snapshot,
        evidence_pack,
        artifact_tasks: p.artifactTaskContracts,
        versions: {
          prompt_version: "preflight",
          model_config_hash: "no-model",
        },
      })
      if (!built.ok) throw new Error(built.errors.join(";"))
      const schema = validateRoleCSchema(
        "generation_spec.schema.json",
        built.spec,
      )
      if (!schema.ok) throw new Error(JSON.stringify(schema.issues))
      const blueprint = buildResourceBlueprint(built.spec, evidence_pack)
      const capacity = planAssessmentCapacityForPipeline({ generation_spec: built.spec, evidence_pack })
      if (capacity.decision !== "FULL") throw new Error(`PREFLIGHT_FROZEN_ASSESSMENT_CAPACITY:${capacity.feasible_items}/${capacity.requested_items}`)
      if (
        blueprint.code_lab.task_contract.input_form === "none" &&
        blueprint.code_lab.programming_problem.public_case_count > 1
      )
        throw new Error("PREFLIGHT_DISTINCT_INPUTS_IMPOSSIBLE")
      const labTask = built.spec.artifact_tasks!.code_lab.lab!
      if (
        labTask.boundary_case_minimum > 0 &&
        !blueprint.code_lab.programming_problem.test_partitions.some(
          (p) =>
            p.kind === "boundary" &&
            p.minimum_cases >= labTask.boundary_case_minimum,
        )
      )
        throw new Error("PREFLIGHT_BOUNDARY_PARTITION_MISSING")
      if (
        built.spec.artifact_tasks!.assessment.assessment!
          .require_independent_code_item &&
        !blueprint.assessment.item_plan.some((p) => p.modality === "code")
      )
        throw new Error("PREFLIGHT_INDEPENDENT_CODE_ITEM_MISSING")
      if (
        built.spec.artifact_tasks!.assessment.assessment!
          .require_boundary_or_counterexample_item &&
        !blueprint.assessment.item_plan.some(
          (p) => p.task_requirements?.boundary_or_counterexample,
        )
      )
        throw new Error("PREFLIGHT_BOUNDARY_ITEM_MISSING")
      const sections = buildConceptSectionPlansForSegment({
        generation_spec: built.spec,
        evidence_pack,
        resource_blueprint: blueprint,
      })
      if (
        blueprint.assessment.total_items !==
        c.artifact_plan.assessment.blueprint.tier_1_count +
          c.artifact_plan.assessment.blueprint.tier_2_count +
          c.artifact_plan.assessment.blueprint.tier_3_count
      )
        throw new Error("PREFLIGHT_ITEM_COUNT")
      rows.push({
        case_id: c.case_id,
        ok: true,
        objectives: built.spec.targets.length,
        sections: sections.reduce((n, s) => n + s.slots.length, 0),
        items: blueprint.assessment.total_items,
        task_kind: blueprint.code_lab.programming_problem.task_kind,
        public_tests: blueprint.code_lab.programming_problem.public_case_count,
        hidden_tests: blueprint.code_lab.secure_plan.hidden_tests.length,
      })
    } catch (error) {
      rows.push({
        case_id: c.case_id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return {
    version: "competition-preflight.v2",
    model_calls: 0,
    total: rows.length,
    passed: rows.every((r) => r.ok),
    rows,
  }
}
