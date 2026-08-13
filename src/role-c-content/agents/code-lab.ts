import {
  ModelOutputValidationError,
  ModelProviderUnavailableError,
  UnsupportedTargetError,
} from "../contracts/model-gateway"
import type { CodeLabArtifactPair } from "../contracts/artifacts"
import type { RagEvidencePack } from "../contracts/evidence-pack"
import type { GenerationSpec } from "../contracts/generation-spec"
import {
  finalizeDraft,
  invalidOutputEnvelope,
  providerBlockedEnvelope,
  unsupportedTargetEnvelope,
} from "./harness"
import type { CodeLabAgent, CodeLabDraftVerifier, CodeLabRequest, RoleCContentProvider } from "./types"
import { validateCodeLabDraftStructure, classifyCodeLabVerificationFailure } from "../validators/code-lab-validator"

export function generateCodeLab(
  request: CodeLabRequest,
  provider: RoleCContentProvider,
  verifier?: CodeLabDraftVerifier,
) {
  return createCodeLabAgent(provider, verifier).generate(request)
}

export function createCodeLabAgent(
  provider: RoleCContentProvider,
  verifier?: CodeLabDraftVerifier,
): CodeLabAgent {
  return {
    async generate(request): Promise<CodeLabArtifactPair> {
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
          await provider.generateCodeLab(request),
        )
        let structural = validateCodeLabDraftStructure(request, draft)
        if (!structural.ok) {
          return invalidPair(
            common,
            "code-lab Draft 未通过结构、引用、public/secure 或目标覆盖门禁",
            structural.issues.map((issue) => `${issue.path}: ${issue.message}`),
          )
        }
        let verification = verifier
          ? await verifier.verifyCodeLab(request, structuredClone(draft))
          : { execution_verified: false, issues: ["未配置独立 code-lab verifier"] }
        const activeVerifier = verifier
        const repairAfterVerification = provider.repairCodeLabAfterVerification?.bind(provider)
        const verificationRepairLimit = activeVerifier
          && repairAfterVerification
          && request.generation_spec.policies.max_semantic_revision >= 1
          ? request.generation_spec.policies.max_tool_retry
          : 0
        for (let revisionRound = 1;
          !verification.execution_verified
            && revisionRound <= verificationRepairLimit;
          revisionRound += 1) {
          if (!activeVerifier || !repairAfterVerification) break
          draft = structuredClone(await repairAfterVerification(
            request,
            structuredClone(draft),
            {
              revision_round: revisionRound,
              issues: [...verification.issues],
              reference_failed: verification.reference_failed,
              reference_failure_codes: verification.reference_failure_codes
                ? [...verification.reference_failure_codes]
                : undefined,
              starter_status: verification.starter_status,
              failed_mutations: verification.failed_mutations?.map((entry) => ({
                ...entry,
                failure_codes: [...entry.failure_codes],
                must_fail_test_ids: [...entry.must_fail_test_ids],
              })),
              failure_diagnostic: classifyCodeLabVerificationFailure({
                issues: verification.issues,
                reference_failed: verification.reference_failed,
                reference_failure_codes: verification.reference_failure_codes,
                starter_status: verification.starter_status,
                failed_mutations: verification.failed_mutations,
                public_payload: draft.public_draft.payload,
                secure_payload: draft.secure_draft.payload,
              }),
            },
          ))
          structural = validateCodeLabDraftStructure(request, draft)
          if (!structural.ok) {
            return invalidPair(
              common,
              "code-lab 执行修订稿未通过结构、引用、public/secure 或目标覆盖门禁",
              structural.issues.map((issue) => `${issue.path}: ${issue.message}`),
            )
          }
          verification = await activeVerifier.verifyCodeLab(
            request,
            structuredClone(draft),
          )
        }
        const objectiveCoverage = verification.objective_coverage ?? structural.objective_coverage
        return {
          public_artifact: finalizeDraft({
            ...common,
            agent: "code-lab",
            artifact_type: "code_lab_public",
            draft: draft.public_draft,
            public_payload: true,
            objective_ids: draft.public_draft.payload.objective_ids,
            execution_verified: verification.execution_verified,
            runner_image_digest: verification.runner_image_digest,
            mutation_kill_rate: verification.mutation_kill_rate,
            verified_test_count: verification.verified_test_count,
            trusted_objective_coverage: objectiveCoverage,
            verification_issues: verification.execution_verified
              ? []
              : publicVerificationIssues(verification.issues),
          }),
          secure_artifact: finalizeDraft({
            ...common,
            agent: "code-lab",
            artifact_type: "code_lab_secure",
            draft: draft.secure_draft,
            public_payload: false,
            objective_ids: draft.public_draft.payload.objective_ids,
            execution_verified: verification.execution_verified,
            runner_image_digest: verification.runner_image_digest,
            mutation_kill_rate: verification.mutation_kill_rate,
            verified_test_count: verification.verified_test_count,
            trusted_objective_coverage: objectiveCoverage,
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
    if (issue.includes("reference_solution")) {
      categories.add("参考实现未通过全部隐藏测试")
    } else if (issue.includes("starter code")) {
      categories.add("起始代码没有保持为待完成状态")
    } else if (issue.includes("mutation") || issue.includes("错误变体")) {
      categories.add("错误变体没有被指定隐藏测试稳定检出")
    } else if (issue.includes("runner_image_digest")) {
      categories.add("可信执行镜像身份不一致")
    } else {
      categories.add("代码实验未通过可信执行验证")
    }
  }
  return categories.size > 0
    ? [...categories]
    : ["代码实验未通过可信执行验证"]
}

function unsupportedPair(
  common: { spec: GenerationSpec; evidence: RagEvidencePack; input_refs: string[] },
  message: string,
  targetSourceIds: string[],
): CodeLabArtifactPair {
  return {
    public_artifact: unsupportedTargetEnvelope({
      ...common,
      agent: "code-lab",
      artifact_type: "code_lab_public",
      message,
      target_source_ids: targetSourceIds,
    }),
    secure_artifact: unsupportedTargetEnvelope({
      ...common,
      agent: "code-lab",
      artifact_type: "code_lab_secure",
      message,
      target_source_ids: targetSourceIds,
    }),
  }
}

function invalidPair(
  common: { spec: GenerationSpec; evidence: RagEvidencePack; input_refs: string[] },
  message: string,
  details: string[],
  publicDetails: string[] = ["code-lab Draft 未通过可信门禁"],
): CodeLabArtifactPair {
  return {
    public_artifact: invalidOutputEnvelope({
      ...common,
      agent: "code-lab",
      artifact_type: "code_lab_public",
      message,
      details: publicDetails,
    }),
    secure_artifact: invalidOutputEnvelope({
      ...common,
      agent: "code-lab",
      artifact_type: "code_lab_secure",
      message,
      details,
    }),
  }
}

function blockedPair(
  common: { spec: GenerationSpec; evidence: RagEvidencePack; input_refs: string[] },
  message: string,
): CodeLabArtifactPair {
  return {
    public_artifact: providerBlockedEnvelope({
      ...common,
      agent: "code-lab",
      artifact_type: "code_lab_public",
      message,
    }),
    secure_artifact: providerBlockedEnvelope({
      ...common,
      agent: "code-lab",
      artifact_type: "code_lab_secure",
      message,
    }),
  }
}
