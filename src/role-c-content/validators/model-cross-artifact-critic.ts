import { stableId, contentHash } from "../contracts/common"
import type { ModelGateway } from "../contracts/model-gateway"
import {
  CROSS_ARTIFACT_CRITIC_PROMPT_VERSION,
  CROSS_ARTIFACT_CRITIC_SYSTEM_PROMPT,
} from "../prompts"
import { getRoleCModelOutputSchema, validateRoleCSchema } from "./runtime-schema-validator"
import type {
  AlignmentObjection,
  CrossArtifactAlignmentInput,
  CrossArtifactCritic,
} from "./alignment-validator"
import { validateCrossArtifactAlignment } from "./alignment-validator"

interface CriticCheckDraft {
  target_artifact_id: string
  objective_id: string
  issue_type: AlignmentObjection["issue_type"]
  severity: AlignmentObjection["severity"]
  evidence_refs: string[]
  proposed_action: string
}

interface CriticJudgment { checks: CriticCheckDraft[] }

/** Optional semantic critic. The deterministic alignment gate always runs independently. */
export class ModelBackedCrossArtifactCritic implements CrossArtifactCritic {
  constructor(private readonly gateway: ModelGateway) {}

  async review(input: CrossArtifactAlignmentInput): Promise<AlignmentObjection[]> {
    const safeInput = buildCriticModelInput(input)
    const output = await this.gateway.generateStructured<unknown>({
      task: "role-c.cross-artifact-critic.review",
      system_prompt: CROSS_ARTIFACT_CRITIC_SYSTEM_PROMPT,
      input: safeInput,
      output_schema_id: "role_c_alignment_critic_judgment_v1",
      output_schema: getRoleCModelOutputSchema("alignment_critic_judgment.schema.json"),
      temperature: 0,
      max_tokens: 3_000,
      idempotency_key: `IDEMP-${contentHash({
        safeInput,
        prompt_version: CROSS_ARTIFACT_CRITIC_PROMPT_VERSION,
        model_config_hash: this.gateway.model_config_hash,
      }).slice("sha256:".length)}`,
    })
    const schema = validateRoleCSchema("alignment_critic_judgment.schema.json", output)
    if (!schema.ok) throw new Error(`INVALID_CRITIC_JUDGMENT:${schema.issues.map((issue) => issue.path).join(",")}`)
    return validateAndFinalizeChecks(input, output as CriticJudgment)
  }
}

function buildCriticModelInput(input: CrossArtifactAlignmentInput): unknown {
  return {
    spec: {
      spec_id: input.spec.spec_id,
      path_node: structuredClone(input.spec.path_node),
      targets: structuredClone(input.spec.targets),
      difficulty: structuredClone(input.spec.difficulty),
    },
    public_artifacts: {
      concept: publicView(input.concept),
      code_lab: publicView(input.lab),
      assessment: publicView(input.assessment),
    },
    trusted_verification: {
      code_lab: {
        artifact_id: input.lab_secure?.artifact_id,
        execution_verified: input.lab.quality.execution_verified === true
          && input.lab_secure?.quality.execution_verified === true,
      },
      assessment: {
        artifact_id: input.assessment_secure?.artifact_id,
        answer_key_verified: input.assessment.quality.answer_key_verified === true
          && input.assessment_secure?.quality.answer_key_verified === true,
      },
    },
  }
}

function publicView(artifact: CrossArtifactAlignmentInput["concept"] | CrossArtifactAlignmentInput["lab"] | CrossArtifactAlignmentInput["assessment"]): unknown {
  return {
    artifact_id: artifact.artifact_id,
    status: artifact.status,
    quality: structuredClone(artifact.quality),
    payload: structuredClone(artifact.payload),
  }
}

function validateAndFinalizeChecks(
  input: CrossArtifactAlignmentInput,
  judgment: CriticJudgment,
): AlignmentObjection[] {
  const artifactIds = new Set([
    input.concept.artifact_id,
    input.lab.artifact_id,
    input.assessment.artifact_id,
    ...(input.lab_secure ? [input.lab_secure.artifact_id] : []),
    ...(input.assessment_secure ? [input.assessment_secure.artifact_id] : []),
  ])
  const objectiveIds = new Set(["pipeline", ...input.spec.targets.map((target) => target.objective_id)])
  const evidenceRefs = collectEvidenceRefs(input)
  const concretePublicRefs = collectConcretePublicRefs(input)
  const deterministicObjections = new Set(
    validateCrossArtifactAlignment(input).objections.map(objectionKey),
  )
  const objections: AlignmentObjection[] = []
  for (const check of judgment.checks) {
    if (!artifactIds.has(check.target_artifact_id)) throw new Error(`CRITIC_UNKNOWN_ARTIFACT:${check.target_artifact_id}`)
    if (!objectiveIds.has(check.objective_id)) throw new Error(`CRITIC_UNKNOWN_OBJECTIVE:${check.objective_id}`)
    if (check.evidence_refs.some((ref) => !evidenceRefs.has(ref))) {
      throw new Error(`CRITIC_UNKNOWN_EVIDENCE_REF:${check.evidence_refs.filter((ref) => !evidenceRefs.has(ref)).join(",")}`)
    }
    const deterministicKey = objectionKey(check)
    const citesConcretePublicContent = check.evidence_refs.some((ref) =>
      concretePublicRefs.has(ref))
    const isSemanticJudgment = check.issue_type === "unsupported_claim"
      || check.issue_type === "difficulty_mismatch"
    if (isSemanticJudgment) {
      if (!deterministicObjections.has(deterministicKey)
        && !citesConcretePublicContent) continue
    } else if (!deterministicObjections.has(deterministicKey)) {
      // Semantic review cannot override trusted execution, answer verification,
      // stable mappings, or deterministic coverage checks.
      continue
    }
    const core = {
      from_agent: "cross-artifact-gate" as const,
      target_artifact_id: check.target_artifact_id,
      objective_id: check.objective_id,
      issue_type: check.issue_type,
      severity: check.severity,
      evidence: [...check.evidence_refs],
      proposed_action: check.proposed_action,
    }
    objections.push({ objection_id: stableId("OBJ", core), ...core })
  }
  return [...new Map(objections.map((entry) => [entry.objection_id, entry])).values()]
}

function objectionKey(input: Pick<
  AlignmentObjection,
  "target_artifact_id" | "objective_id" | "issue_type"
>): string {
  return `${input.target_artifact_id}:${input.objective_id}:${input.issue_type}`
}

function collectConcretePublicRefs(input: CrossArtifactAlignmentInput): Set<string> {
  return new Set([
    ...(input.concept.payload?.objective_coverage.flatMap((entry) =>
      entry.block_ids) ?? []),
    ...(input.lab.payload?.instructions.map((block) => block.block_id) ?? []),
    ...(input.lab.payload?.public_tests.map((test) => test.test_id) ?? []),
    ...(input.assessment.payload?.items.map((item) => item.item_id) ?? []),
  ])
}

function collectEvidenceRefs(input: CrossArtifactAlignmentInput): Set<string> {
  const refs = new Set<string>([
    input.spec.spec_id,
    input.concept.artifact_id,
    input.lab.artifact_id,
    input.assessment.artifact_id,
    ...input.spec.targets.map((target) => target.objective_id),
  ])
  input.concept.payload?.objective_coverage.forEach((entry) => entry.block_ids.forEach((id) => refs.add(id)))
  input.lab.payload?.instructions.forEach((block) => refs.add(block.block_id))
  input.lab.payload?.public_tests.forEach((test) => refs.add(test.test_id))
  input.assessment.payload?.items.forEach((item) => refs.add(item.item_id))
  if (input.lab_secure) refs.add(input.lab_secure.artifact_id)
  if (input.assessment_secure) refs.add(input.assessment_secure.artifact_id)
  return refs
}
