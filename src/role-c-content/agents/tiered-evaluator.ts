import {
  ModelOutputValidationError,
  ModelProviderUnavailableError,
  UnsupportedTargetError,
} from "../contracts/model-gateway"
import type { AssessmentArtifactPair } from "../contracts/artifacts"
import type { RagEvidencePack } from "../contracts/evidence-pack"
import type { GenerationSpec } from "../contracts/generation-spec"
import {
  finalizeDraft,
  invalidOutputEnvelope,
  providerBlockedEnvelope,
  unsupportedTargetEnvelope,
} from "./harness"
import type {
  AssessmentDraftVerifier,
  RoleCContentProvider,
  TieredEvaluatorAgent,
  TieredEvaluatorRequest,
} from "./types"
import { validateAssessmentDraftStructure } from "../validators/assessment-validator"

export function generateAssessment(
  request: TieredEvaluatorRequest,
  provider: RoleCContentProvider,
  verifier?: AssessmentDraftVerifier,
) {
  return createTieredEvaluatorAgent(provider, verifier).generate(request)
}

export function createTieredEvaluatorAgent(
  provider: RoleCContentProvider,
  verifier?: AssessmentDraftVerifier,
): TieredEvaluatorAgent {
  return {
    async generate(request): Promise<AssessmentArtifactPair> {
      const common = {
        spec: request.generation_spec,
        evidence: request.evidence_pack,
        input_refs: [
          request.generation_spec.spec_id,
          request.evidence_pack.retrieval_id,
          request.concept_artifact.artifact_id,
        ],
      }
      try {
        let draft = structuredClone(
          await provider.generateAssessment(request),
        )
        let structural = validateAssessmentDraftStructure(request, draft)
        if (!structural.ok) {
          return invalidPair(
            common,
            "tiered-evaluator Draft 未通过结构、答案合同、public/secure 或蓝图门禁",
            structural.issues.map((issue) => `${issue.path}: ${issue.message}`),
          )
        }
        let verification: Awaited<ReturnType<AssessmentDraftVerifier["verifyAssessment"]>> = verifier
          ? await verifier.verifyAssessment(
              request,
              structuredClone(draft),
            )
          : { answer_key_verified: false, issues: ["未配置独立 assessment verifier"] }
        const activeVerifier = verifier
        const repairAfterVerification = provider.repairAssessmentAfterVerification?.bind(provider)
        const verificationRepairLimit = activeVerifier
          && repairAfterVerification
          && request.generation_spec.policies.max_semantic_revision >= 1
          ? request.generation_spec.policies.max_tool_retry
          : 0
        for (let revisionRound = 1;
          !verification.answer_key_verified
            && revisionRound <= verificationRepairLimit;
          revisionRound += 1) {
          if (!activeVerifier || !repairAfterVerification) break
          draft = structuredClone(await repairAfterVerification(
            request,
            structuredClone(draft),
            {
              revision_round: revisionRound,
              issues: [...verification.issues],
            },
          ))
          structural = validateAssessmentDraftStructure(request, draft)
          if (!structural.ok) {
            return invalidPair(
              common,
              "tiered-evaluator 可信验证修订稿未通过结构、答案合同、public/secure 或蓝图门禁",
              structural.issues.map((issue) => `${issue.path}: ${issue.message}`),
            )
          }
          verification = await activeVerifier.verifyAssessment(
            request,
            structuredClone(draft),
          )
        }
        const citations = structural.citations
        const objectiveCoverage = verification.objective_coverage ?? structural.objective_coverage
        return {
          public_artifact: finalizeDraft({
            ...common,
            agent: "tiered-evaluator",
            artifact_type: "assessment_public",
            draft: draft.public_draft,
            public_payload: true,
            objective_ids: draft.public_draft.payload.objective_ids,
            trusted_citations: citations,
            trusted_objective_coverage: objectiveCoverage,
            answer_key_verified: verification.answer_key_verified,
            runner_image_digest: verification.runner_image_digest,
            verified_item_count: verification.verified_item_count,
            verified_test_count: verification.verified_test_count,
            verification_issues: verification.answer_key_verified
              ? []
              : publicVerificationIssues(verification.issues),
          }),
          secure_artifact: finalizeDraft({
            ...common,
            agent: "tiered-evaluator",
            artifact_type: "assessment_secure",
            draft: draft.secure_draft,
            public_payload: false,
            objective_ids: draft.public_draft.payload.objective_ids,
            trusted_citations: citations,
            trusted_objective_coverage: objectiveCoverage,
            answer_key_verified: verification.answer_key_verified,
            runner_image_digest: verification.runner_image_digest,
            verified_item_count: verification.verified_item_count,
            verified_test_count: verification.verified_test_count,
            verification_issues: verification.issues,
          }),
        }
      } catch (error) {
        if (error instanceof ModelOutputValidationError) {
          return invalidPair(
            common,
            `${error.stage} 未在有限修复次数内通过校验`,
            error.issues,
            error.stage.includes(".public") ? error.issues : undefined,
          )
        }
        if (error instanceof UnsupportedTargetError) {
          return unsupportedPair(
            common,
            error.message,
            error.target_source_ids,
          )
        }
        if (!(error instanceof ModelProviderUnavailableError)) throw error
        return blockedPair(common, error.message)
      }
    },
  }
}

function publicVerificationIssues(issues: string[]): string[] {
  const categories = new Set<string>()
  for (const issue of issues) {
    if (issue.includes("reference") || issue.includes("隐藏测试")) {
      categories.add("代码题参考实现未通过全部隐藏测试")
    } else if (issue.includes("runner_image_digest") || issue.includes("CodeRunner")) {
      categories.add("测评代码题的可信执行环境不可用或身份不一致")
    } else {
      categories.add("测评答案未通过可信验证")
    }
  }
  return categories.size > 0
    ? [...categories]
    : ["测评答案未通过可信验证"]
}

function unsupportedPair(
  common: { spec: GenerationSpec; evidence: RagEvidencePack; input_refs: string[] },
  message: string,
  targetSourceIds: string[],
): AssessmentArtifactPair {
  return {
    public_artifact: unsupportedTargetEnvelope({
      ...common,
      agent: "tiered-evaluator",
      artifact_type: "assessment_public",
      message,
      target_source_ids: targetSourceIds,
    }),
    secure_artifact: unsupportedTargetEnvelope({
      ...common,
      agent: "tiered-evaluator",
      artifact_type: "assessment_secure",
      message,
      target_source_ids: targetSourceIds,
    }),
  }
}

function invalidPair(
  common: { spec: GenerationSpec; evidence: RagEvidencePack; input_refs: string[] },
  message: string,
  details: string[],
  publicDetails: string[] = ["tiered-evaluator Draft 未通过可信门禁"],
): AssessmentArtifactPair {
  return {
    public_artifact: invalidOutputEnvelope({
      ...common,
      agent: "tiered-evaluator",
      artifact_type: "assessment_public",
      message,
      details: publicDetails,
    }),
    secure_artifact: invalidOutputEnvelope({
      ...common,
      agent: "tiered-evaluator",
      artifact_type: "assessment_secure",
      message,
      details,
    }),
  }
}

function blockedPair(
  common: { spec: GenerationSpec; evidence: RagEvidencePack; input_refs: string[] },
  message: string,
): AssessmentArtifactPair {
  return {
    public_artifact: providerBlockedEnvelope({
      ...common,
      agent: "tiered-evaluator",
      artifact_type: "assessment_public",
      message,
    }),
    secure_artifact: providerBlockedEnvelope({
      ...common,
      agent: "tiered-evaluator",
      artifact_type: "assessment_secure",
      message,
    }),
  }
}
