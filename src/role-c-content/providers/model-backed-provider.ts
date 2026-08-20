import type {
  ArtifactDraft,
  AssessmentDraft,
  AssessmentVerificationFeedback,
  CodeLabDraft,
  CodeLabRequest,
  CodeLabVerificationFeedback,
  ConceptTutorRequest,
  PriorAssessmentItem,
  RoleCContentProvider,
  TieredEvaluatorRequest,
} from "../agents/types"
import { buildConceptTutorModelInput } from "../context/concept-context"
import { buildCodeLabModelInput } from "../context/code-lab-context"
import { buildAssessmentAuthorModelInput } from "../context/assessment-context"
import type {
  AssessmentPublicPayload,
  AssessmentSecurePayload,
  AssessmentStructureMeta,
  CodeLabPublicPayload,
  CodeLabSecurePayload,
  ConceptLessonPayload,
} from "../contracts/artifacts"
import { contentHash } from "../contracts/common"
import {
  ModelGatewayError,
  ModelOutputValidationError,
  ModelProviderUnavailableError,
  type ModelGateway,
} from "../contracts/model-gateway"
import {
  CONCEPT_TUTOR_PROMPT_VERSION,
  CONCEPT_TUTOR_SYSTEM_PROMPT,
  conceptTutorRepairPrompt,
  CODE_LAB_PROMPT_VERSION,
  CODE_LAB_SYSTEM_PROMPT,
  codeLabRepairPrompt,
  EVALUATOR_AUTHOR_PROMPT_VERSION,
  EVALUATOR_AUTHOR_SYSTEM_PROMPT,
  evaluatorAuthorRepairPrompt,
  ASSESSMENT_PUBLIC_STAGE_SYSTEM_PROMPT,
  ASSESSMENT_SECURE_STAGE_SYSTEM_PROMPT,
  ASSESSMENT_EXECUTION_REPAIR_SYSTEM_PROMPT,
  ASSESSMENT_NOVELTY_REPAIR_SYSTEM_PROMPT,
  CODE_LAB_PUBLIC_STAGE_SYSTEM_PROMPT,
  CODE_LAB_SECURE_STAGE_SYSTEM_PROMPT,
  CODE_LAB_EXECUTION_REPAIR_SYSTEM_PROMPT,
  CODE_LAB_PUBLIC_SAFETY_REPAIR_SYSTEM_PROMPT,
  CODE_LAB_STARTER_REPAIR_SYSTEM_PROMPT,
  CONCEPT_SEGMENT_SYSTEM_PROMPT,
  STAGED_AUTHOR_PROMPT_VERSION,
  ROLE_C_PROMPT_MANIFEST_VERSION,
  stagedRepairPrompt,
} from "../prompts"
import { isTrustedExpectedDerivationIssue, validateCodeLabDraftStructure, validateCodeLabPublicStage } from "../validators/code-lab-validator"
import { validateAssessmentDraftStructure, validateAssessmentPublicStage } from "../validators/assessment-validator"
import { validateConceptLesson } from "../validators/concept-validator"
import {
  getRoleCModelOutputSchema,
  getRoleCModelOutputSchemaFragment,
  validateRoleCSchema,
  validateRoleCSchemaFragment,
  type RoleCSchemaFile,
} from "../validators/runtime-schema-validator"
import {
  buildAssessmentFormId,
  buildAssessmentItemPlan,
  buildCodeLabObjectivePlan,
  buildCodeLabSecurePlan,
  buildLabIdentity,
  applyCodeLabExecutionRepairPatch,
  materializeConceptSegmentAuthorPayload,
  materializeAssessmentSecureAuthorPayload,
  materializeAssessmentPublicAuthorPayload,
  projectAssessmentPublicAuthorPayload,
  materializeCodeLabPublicAuthorPayload,
  materializeCodeLabSecureAuthorPayload,
  mapWithConcurrency,
  mergeConceptSegments,
  canonicalizeTestComparison,
  asStandardInput,
  normalizeAssessmentPair,
  expectedOnlyReferenceFailureCodes,
  isExpectedOnlyReferenceFailure,
  normalizeCodeLabSecure,
  patchExpectedFromReferenceFailures,
  normalizeCodeLabSecureAuthorPayloadLenient,
  normalizeConceptSegmentAuthorPayloadLenient,
  splitConceptRequest,
  validateAssessmentPublicAuthorAgainstPlan,
  validateAssessmentNovelty,
  validateAssessmentSecureAuthorAgainstPublic,
  validateAssessmentSecureAgainstPublic,
  deterministicAssessmentStarterRepair,
  assessmentStarterIsIncomplete,
  validateCodeLabPublicAuthorAgainstPlan,
  validateCodeLabSecureAuthorAgainstPlan,
  validateCodeLabSecureAgainstPlan,
  validateConceptSegmentAuthorAgainstRequest,
  deriveCodeLabExecutionMode,
  freezeCodeLabExecutionContract,
  type CodeLabExecutionRepairPatch,
  type CodeLabPublicAuthorPayload,
  type CodeLabSecureAuthorPayload,
  type AssessmentSecureAuthorPayload,
  type AssessmentPublicAuthorPayload,
  type AssessmentItemPlan,
  type ConceptSegmentAuthorPayload,
} from "./staged-generation"
import { fastModelPolicy } from "../../model-runtime"

export interface ModelBackedProviderOptions {
  /** Staged is the production path; monolithic remains available for compatibility and benchmarks. */
  generation_strategy?: "staged" | "monolithic"
  /** Production defaults to one targeted repair; diagnostics may explicitly disable it. */
  max_repair_attempts?: 0 | 1 | 2
  concept_temperature?: number
  concept_max_tokens?: number
  concept_group_size?: number
  concept_concurrency?: number
  concept_segment_max_tokens?: number
  code_lab_temperature?: number
  code_lab_max_tokens?: number
  code_lab_public_max_tokens?: number
  code_lab_secure_max_tokens?: number
  assessment_temperature?: number
  assessment_max_tokens?: number
  assessment_public_max_tokens?: number
  assessment_secure_max_tokens?: number
  stage_failure_diagnostic_sink?: (diagnostic: SafeStageFailureDiagnostic) => void | Promise<void>
}

export interface StageFailureDiagnostic {
  task: string
  attempt: number
  max_repairs: number
  output_schema_id: string
  issues: string[]
  output_hash?: string
}

export interface SafeStageFailureDiagnostic {
  task: string
  attempt: number
  max_repairs: number
  output_schema_id: string
  issue_codes: string[]
  issue_count: number
  output_hash?: string
}

export function sanitizeStageFailureDiagnostic(input: StageFailureDiagnostic): SafeStageFailureDiagnostic {
  return {
    task: input.task,
    attempt: input.attempt,
    max_repairs: input.max_repairs,
    output_schema_id: input.output_schema_id,
    issue_codes: input.issues.map((entry) => {
      const coded = /^\[([^\]]+)\]/.exec(entry)
      return coded?.[1] ?? entry.split(":", 1)[0]!.trim()
    }),
    issue_count: input.issues.length,
    ...(input.output_hash ? { output_hash: input.output_hash } : {}),
  }
}

interface StructuredStage<T> {
  task: string
  system_prompt: string
  input: unknown
  output_schema_id: string
  output_schema: Record<string, unknown>
  temperature: number
  max_tokens: number
  idempotency_identity: Record<string, unknown>
  max_repairs: number
  validate: (value: T) => string[]
  diagnostic_sink?: (diagnostic: SafeStageFailureDiagnostic) => void | Promise<void>
}

interface CodeLabStarterRepairPatch {
  starter_code: string
}

interface CodeLabPublicSafetyRepairPatch {
  starter_code: string
  instruction_texts: string[]
  public_test_descriptions: string[]
  public_test_expected_behaviors: string[]
  hint_texts: string[][]
  reflection_questions: string[]
}

function normalizeAssessmentAuthorFields(
  authored: AssessmentPublicAuthorPayload,
  plan: AssessmentItemPlan[],
): void {
  if (!Array.isArray(authored.items)) return
  for (let index = 0; index < authored.items.length; index += 1) {
    const item = authored.items[index]
    const expected = plan[index]
    if (!item || !expected) continue
    const isChoice = expected.modality === "mcq"
      || expected.modality === "true_false"
    if (!isChoice) item.options = null
    if (expected.modality !== "code") item.starter_code = null
    else if (!assessmentStarterIsIncomplete(item.starter_code)) {
      item.starter_code = deterministicAssessmentStarterRepair(
        item.starter_code,
        item.prompt,
      )
    }
  }
}

/** Model-backed Provider. Stages are internal; public Role C contracts remain unchanged. */
export class ModelBackedRoleCContentProvider implements RoleCContentProvider {
  private readonly generationStrategy: "staged" | "monolithic"
  private readonly maxRepairAttempts: 0 | 1 | 2
  private readonly conceptTemperature: number
  private readonly conceptMaxTokens: number
  private readonly conceptGroupSize: number
  private readonly conceptConcurrency: number
  private readonly conceptSegmentMaxTokens: number
  private readonly codeLabTemperature: number
  private readonly codeLabMaxTokens: number
  private readonly codeLabPublicMaxTokens: number
  private readonly codeLabSecureMaxTokens: number
  private readonly assessmentTemperature: number
  private readonly assessmentMaxTokens: number
  private readonly assessmentPublicMaxTokens: number
  private readonly assessmentSecureMaxTokens: number
  private readonly stageFailureDiagnosticSink?: (diagnostic: SafeStageFailureDiagnostic) => void | Promise<void>

  constructor(
    private readonly gateway: ModelGateway,
    options: ModelBackedProviderOptions = {},
  ) {
    this.generationStrategy = options.generation_strategy ?? "staged"
    this.maxRepairAttempts = options.max_repair_attempts ?? 1
    this.conceptTemperature = options.concept_temperature ?? 0.2
    this.conceptMaxTokens = options.concept_max_tokens ?? 4_500
    this.conceptGroupSize = positiveInteger(options.concept_group_size, 1, "concept_group_size")
    this.conceptConcurrency = positiveInteger(options.concept_concurrency, 2, "concept_concurrency")
    this.conceptSegmentMaxTokens = positiveInteger(options.concept_segment_max_tokens, 3_500, "concept_segment_max_tokens")
    this.codeLabTemperature = options.code_lab_temperature ?? 0
    this.codeLabMaxTokens = options.code_lab_max_tokens ?? 7_000
    this.codeLabPublicMaxTokens = positiveInteger(options.code_lab_public_max_tokens, 3_500, "code_lab_public_max_tokens")
    this.codeLabSecureMaxTokens = positiveInteger(options.code_lab_secure_max_tokens, 5_000, "code_lab_secure_max_tokens")
    this.assessmentTemperature = options.assessment_temperature ?? 0
    this.assessmentMaxTokens = options.assessment_max_tokens ?? 8_000
    this.assessmentPublicMaxTokens = positiveInteger(options.assessment_public_max_tokens, 4_500, "assessment_public_max_tokens")
    this.assessmentSecureMaxTokens = positiveInteger(options.assessment_secure_max_tokens, 5_500, "assessment_secure_max_tokens")
    this.stageFailureDiagnosticSink = options.stage_failure_diagnostic_sink
  }

  async generateConceptLesson(
    request: ConceptTutorRequest,
  ): Promise<ArtifactDraft<ConceptLessonPayload>> {
    assertVersionCompatibility(request, this.gateway)
    if (this.generationStrategy === "monolithic") return this.generateConceptLessonMonolithic(request)

    const maxRepairs = boundedRepairs(this.maxRepairAttempts, request)
    const segments = splitConceptRequest(request, this.conceptGroupSize)
    const payloads = await mapWithConcurrency(segments, this.conceptConcurrency, async (segment) => {
      const modelInput = buildConceptTutorModelInput(segment)
      const authored = await this.generateStage<ConceptSegmentAuthorPayload>({
        task: "role-c.concept-tutor.segment",
        system_prompt: CONCEPT_SEGMENT_SYSTEM_PROMPT,
        input: {
          ...modelInput,
          segment: {
            index: segment.segment_index,
            count: segment.segment_count,
            objective_ids: segment.generation_spec.targets.map((target) => target.objective_id),
          },
        },
        output_schema_id: "role_c_concept_segment_author_payload_v1",
        output_schema: fragment(
          "concept_lesson_payload.schema.json",
          "/$defs/author_payload",
        ),
        temperature: this.conceptTemperature,
        max_tokens: this.conceptSegmentMaxTokens,
        idempotency_identity: {
          spec_id: segment.generation_spec.spec_id,
          evidence_ref: segment.generation_spec.evidence_ref,
          prompt_version: STAGED_AUTHOR_PROMPT_VERSION,
          model_config_hash: this.gateway.model_config_hash,
          seed: segment.generation_spec.policies.seed,
        },
        max_repairs: maxRepairs,
        diagnostic_sink: this.stageFailureDiagnosticSink,
        validate: (payload) => {
          const schema = validateRoleCSchemaFragment(
            "concept_lesson_payload.schema.json",
            "/$defs/author_payload",
            payload,
          )
          if (!schema.ok) return validationIssues(schema)
          const lenientAuthor = normalizeConceptSegmentAuthorPayloadLenient(payload)
          const planIssues = validateConceptSegmentAuthorAgainstRequest(
            segment,
            lenientAuthor,
          )
          if (planIssues.length > 0) return planIssues
          return validationIssues(validateConceptLesson({
            payload: materializeConceptSegmentAuthorPayload(segment, lenientAuthor),
            spec: segment.generation_spec,
            evidence: segment.evidence_pack,
          }))
        },
      })
      return materializeConceptSegmentAuthorPayload(
        segment,
        normalizeConceptSegmentAuthorPayloadLenient(authored),
      )
    })
    const payload = mergeConceptSegments(request, payloads)
    const validation = validateConceptLesson({
      payload,
      spec: request.generation_spec,
      evidence: request.evidence_pack,
    })
    if (!validation.ok) {
      throw new ModelOutputValidationError("concept.merge", validationIssues(validation))
    }
    return { payload }
  }

  async generateCodeLab(request: CodeLabRequest): Promise<CodeLabDraft> {
    assertVersionCompatibility(request, this.gateway, CODE_LAB_PROMPT_VERSION)
    if (this.generationStrategy === "monolithic") {
      // monolithic 是兼容/基准路径（非生产入口），不走 staged_contract；
      // 生产入口（content-pipeline / worker-adapters）一律 staged + blueprint。
      return this.generateCodeLabMonolithic(request)
    }

    const modelInput = buildCodeLabModelInput(request)
    const identity = request.resource_blueprint?.code_lab ?? buildLabIdentity(request.generation_spec)
    const objectivePlan = request.resource_blueprint?.code_lab.objective_plan
      ?? buildCodeLabObjectivePlan(request.generation_spec)
    const maxRepairs = boundedRepairs(this.maxRepairAttempts, request)
    const taskContract = request.resource_blueprint?.code_lab.task_contract
    // 执行接口由 planning 层的 CodeLabTaskContract 决定（先设计题，再定判题接口）。
    // 生产路径（content-pipeline / worker-adapters）必须先构建 blueprint 传入契约；
    // deriveCodeLabExecutionMode 仅作为显式标记的兼容 fallback（单测/脚本/旧数据），
    // 不得静默用于生产。
    const executionMode = taskContract?.execution_mode
      ?? deriveCodeLabExecutionMode(request)
    const publicAuthor = await this.generateStage<CodeLabPublicAuthorPayload>({
      task: "role-c.code-lab.public",
      system_prompt: CODE_LAB_PUBLIC_STAGE_SYSTEM_PROMPT,
      input: {
        ...modelInput,
        staged_contract: {
          lab_id: identity.lab_id,
          objective_ids: request.generation_spec.targets.map((target) => target.objective_id),
          objective_plan: objectivePlan,
          execution_mode: executionMode,
          ...(taskContract
            ? {
                task_contract: {
                  task_kind: taskContract.task_kind,
                  learner_action: taskContract.learner_action,
                  learner_owned_region: taskContract.learner_owned_region,
                  primary_objective_id: taskContract.primary_objective_id,
                  program_entry: taskContract.program_entry,
                  input_form: taskContract.input_form,
                  output_form: taskContract.output_form,
                  grading_invocation: taskContract.grading_invocation,
                  output_constraint: taskContract.output_constraint,
                },
              }
            : {}),
        },
      },
      output_schema_id: "role_c_code_lab_public_author_payload_v1",
      output_schema: fragment(
        "code_lab_draft.schema.json",
        "/$defs/public_author_payload",
      ),
      temperature: this.codeLabTemperature,
      max_tokens: this.codeLabPublicMaxTokens,
      idempotency_identity: {
        spec_id: request.generation_spec.spec_id,
        concept_artifact_id: request.concept_artifact.artifact_id,
        stage: "public",
        prompt_version: STAGED_AUTHOR_PROMPT_VERSION,
      },
      max_repairs: maxRepairs,
      diagnostic_sink: this.stageFailureDiagnosticSink,
      validate: (payload) => {
        // Freeze platform-owned execution fields before strict schema
        // validation. Otherwise a model-proposed unsupported import is
        // rejected before the trusted planning projection can remove it.
        const normalizedAuthor = normalizeCodeLabPublicAuthorPayload(payload)
        normalizedAuthor.execution_contract = freezeCodeLabExecutionContract(
          normalizedAuthor.execution_contract,
          executionMode,
          taskContract,
        )
        const schema = validateRoleCSchemaFragment(
          "code_lab_draft.schema.json",
          "/$defs/public_author_payload",
          normalizedAuthor,
        )
        if (!schema.ok) return validationIssues(schema)
        const planIssues = validateCodeLabPublicAuthorAgainstPlan(
          normalizedAuthor,
          objectivePlan,
          taskContract,
        )
        if (planIssues.length > 0) return planIssues
        const normalized = materializeCodeLabPublicAuthorPayload(
          request,
          normalizedAuthor,
          identity.lab_id,
          objectivePlan,
        )
        return validationIssues(validateCodeLabPublicStage(request, normalized))
      },
    })
    const normalizedPublicAuthor = normalizeCodeLabPublicAuthorPayload(
      publicAuthor,
    )
    normalizedPublicAuthor.execution_contract = freezeCodeLabExecutionContract(
      normalizedPublicAuthor.execution_contract,
      executionMode,
      taskContract,
    )
    let normalizedPublic = materializeCodeLabPublicAuthorPayload(
      request,
      normalizedPublicAuthor,
      identity.lab_id,
      objectivePlan,
    )
    const securePlan = request.resource_blueprint?.code_lab.secure_plan
      ?? buildCodeLabSecurePlan(request.generation_spec, identity.test_suite_id)
    const publicTestInputs = normalizedPublic.public_tests.map((test) => test.input)
    const secureInputRules = `\n\nPRIVATE INPUT GUIDANCE (follow):\n- 若本任务需要读取输入：hidden_tests[].input 请用能覆盖边界、反例、极端情况的「新数据」，避开这些 public 已用的输入：${JSON.stringify(publicTestInputs)}，并根据 reference_solution 重算 expected。\n- 若本任务是纯输出（不读取输入）：public 和 hidden 的 input 都留空（""）是合法的，区分度放在 expected 输出内容上，不要求 input 不同。\n- function 模式的参数用结构不同的非空封装，并重算 expected。`
    const secureAuthorPayload = await this.generateStage<CodeLabSecureAuthorPayload>({
      task: "role-c.code-lab.secure",
      system_prompt: CODE_LAB_SECURE_STAGE_SYSTEM_PROMPT,
      input: {
        contract: modelInput.contract,
        evidence: modelInput.evidence,
        concept: modelInput.concept,
        upstream: modelInput.upstream,
        public_payload: normalizedPublic,
        staged_contract: {
          lab_id: identity.lab_id,
          test_suite_id: identity.test_suite_id,
          execution_contract: normalizedPublic.execution_contract,
          objective_plan: securePlan,
        },
        private_input_rules: secureInputRules,
      },
      output_schema_id: "role_c_code_lab_secure_author_payload_v1",
      output_schema: fragment("code_lab_draft.schema.json", "/$defs/secure_author_payload"),
      temperature: this.codeLabTemperature,
      max_tokens: this.codeLabSecureMaxTokens,
      idempotency_identity: {
        spec_id: request.generation_spec.spec_id,
        lab_id: identity.lab_id,
        public_hash: contentHash(normalizedPublic),
        stage: "secure",
        prompt_version: STAGED_AUTHOR_PROMPT_VERSION,
      },
      max_repairs: maxRepairs,
      diagnostic_sink: this.stageFailureDiagnosticSink,
      validate: (payload) => {
        const schema = validateRoleCSchemaFragment("code_lab_draft.schema.json", "/$defs/secure_author_payload", payload)
        if (!schema.ok) return validationIssues(schema)
        const normalizedAuthor = normalizeCodeLabSecureAuthorPayload(
          normalizeCodeLabSecureAuthorPayloadLenient(
            payload,
            securePlan,
            normalizedPublic.execution_contract.execution_mode,
            normalizedPublic.public_tests.map((test) => test.input),
            normalizedPublic.execution_contract.output_contract,
          ),
          normalizedPublic.execution_contract,
        )
        const authorIssues = validateCodeLabSecureAuthorAgainstPlan(
          normalizedAuthor,
          securePlan,
          normalizedPublic.execution_contract.execution_mode,
        )
        if (authorIssues.length > 0) return authorIssues
        const normalized = materializeCodeLabSecureAuthorPayload(
          request.generation_spec,
          normalizedAuthor,
          normalizedPublic,
          identity.test_suite_id,
          securePlan,
        )
        const planIssues = validateCodeLabSecureAgainstPlan(normalized, securePlan)
        if (planIssues.length > 0) return planIssues
        const report = validateCodeLabDraftStructure(request, {
          public_draft: { payload: normalizedPublic },
          secure_draft: { payload: normalized },
        })
        return validationIssuesExcludingRepairablePublicAnswerLeak(report)
      },
    })
    const normalizedSecureAuthorPayload = normalizeCodeLabSecureAuthorPayload(
      normalizeCodeLabSecureAuthorPayloadLenient(
        secureAuthorPayload,
        securePlan,
        normalizedPublic.execution_contract.execution_mode,
        normalizedPublic.public_tests.map((test) => test.input),
        normalizedPublic.execution_contract.output_contract,
      ),
      normalizedPublic.execution_contract,
    )
    let securePayload = materializeCodeLabSecureAuthorPayload(
      request.generation_spec,
      normalizedSecureAuthorPayload,
      normalizedPublic,
      identity.test_suite_id,
      securePlan,
    )
    const initialReport = validateCodeLabDraftStructure(request, {
      public_draft: { payload: normalizedPublic },
      secure_draft: { payload: securePayload },
    })
    if (hasRepairablePublicAnswerLeak(initialReport)) {
      normalizedPublic = await this.repairCodeLabPublicSafety({
        request,
        public_payload: normalizedPublic,
        secure_payload: securePayload,
        repair_reason: "公开材料可单独或组合还原完整实现，必须保留任务边界并删除完整答案与逐行解法",
        revision_identity: "initial-security-gate",
      })
      securePayload = normalizeCodeLabSecure(
        request.generation_spec,
        securePayload,
        normalizedPublic,
        identity.test_suite_id,
        securePlan,
      )
    }
    const finalReport = validateCodeLabDraftStructure(request, {
      public_draft: { payload: normalizedPublic },
      secure_draft: { payload: securePayload },
    })
    const blockingFinalIssues = finalReport.issues.filter((issue) =>
      !isTrustedExpectedDerivationIssue(issue.code))
    if (blockingFinalIssues.length > 0) {
      throw new ModelOutputValidationError(
        "role-c.code-lab.compose",
        validationIssueStrings({ issues: blockingFinalIssues }),
      )
    }
    return {
      public_draft: { payload: normalizedPublic },
      secure_draft: { payload: securePayload },
    }
  }

  async repairCodeLabAfterVerification(
    request: CodeLabRequest,
    draft: CodeLabDraft,
    feedback: CodeLabVerificationFeedback,
  ): Promise<CodeLabDraft> {
    assertVersionCompatibility(request, this.gateway, CODE_LAB_PROMPT_VERSION)
    if (this.generationStrategy !== "staged") {
      throw new ModelProviderUnavailableError(
        "可信执行后的私有修订仅支持 staged 模型生成策略",
      )
    }

    const modelInput = buildCodeLabModelInput(request)
    const identity = buildLabIdentity(request.generation_spec)
    const objectivePlan = buildCodeLabSecurePlan(
      request.generation_spec,
      identity.test_suite_id,
    )
    let publicPayload = structuredClone(draft.public_draft.payload)
    const maxRepairs = boundedRepairs(this.maxRepairAttempts, request)
    const verificationIssues = feedback.issues
      .slice(0, 32)
      .map((issue) => issue.slice(0, 500))
    if (feedback.starter_status === "passed") {
      publicPayload = await this.repairCodeLabStarter({
        request,
        public_payload: publicPayload,
        secure_payload: draft.secure_draft.payload,
        repair_reason: "公开 starter 已完整通过可信隐藏测试，必须恢复为实质未完成的学习骨架",
        revision_identity: `trusted-execution-${feedback.revision_round}`,
      })
    }

    const needsSecureRepair = trustedReferenceFailed(feedback)
    const expectedOnlyCodes = expectedOnlyReferenceFailureCodes(feedback)
    if (needsSecureRepair && expectedOnlyCodes.length > 0 && isExpectedOnlyReferenceFailure(expectedOnlyCodes)) {
      const repaired = patchExpectedFromReferenceFailures(draft.secure_draft.payload, expectedOnlyCodes)
      return {
        public_draft: { payload: publicPayload },
        secure_draft: {
          payload: normalizeCodeLabSecure(
            request.generation_spec,
            repaired,
            publicPayload,
            identity.test_suite_id,
            objectivePlan,
          ),
        },
      }
    }
    if (!needsSecureRepair) {
      return {
        public_draft: { payload: publicPayload },
        secure_draft: {
          payload: normalizeCodeLabSecure(
            request.generation_spec,
            draft.secure_draft.payload,
            publicPayload,
            identity.test_suite_id,
            objectivePlan,
          ),
        },
      }
    }
    const repairPatch = await this.generateStage<CodeLabExecutionRepairPatch>({
      task: "role-c.code-lab.secure.execution-repair",
      system_prompt: CODE_LAB_EXECUTION_REPAIR_SYSTEM_PROMPT,
      input: {
        contract: modelInput.contract,
        evidence: modelInput.evidence,
        concept: modelInput.concept,
        upstream: modelInput.upstream,
        public_payload: publicPayload,
        prior_secure_payload: draft.secure_draft.payload,
        trusted_execution_report: {
          revision_round: feedback.revision_round,
          diagnostic_code: feedback.failure_diagnostic?.code ?? null,
          diagnostic_message: feedback.failure_diagnostic?.safe_message ?? null,
          issues: verificationIssues,
          reference_failed: feedback.reference_failed ?? false,
          reference_failure_codes: feedback.reference_failure_codes ?? [],
          reference_failure_raw: expectedOnlyReferenceFailureCodes(feedback),
          reference_failure_ids: [...trustedReferenceFailureTestIds(feedback)],
          starter_status: feedback.starter_status ?? null,
          starter_repaired_by_public_patch: feedback.starter_status === "passed",
          failed_mutations: [],
        },
        staged_contract: {
          lab_id: identity.lab_id,
          test_suite_id: identity.test_suite_id,
          execution_contract: publicPayload.execution_contract,
          objective_plan: objectivePlan,
        },
      },
      output_schema_id: "role_c_code_lab_execution_repair_patch_v1",
      output_schema: codeLabExecutionRepairSchema(
        draft.secure_draft.payload,
        feedback,
      ),
      temperature: this.codeLabTemperature,
      max_tokens: this.codeLabSecureMaxTokens,
      idempotency_identity: {
        spec_id: request.generation_spec.spec_id,
        lab_id: identity.lab_id,
        public_hash: contentHash(publicPayload),
        prior_secure_hash: contentHash(draft.secure_draft.payload),
        trusted_execution_feedback_hash: contentHash(verificationIssues),
        verification_revision_round: feedback.revision_round,
        stage: "secure-execution-repair",
        prompt_version: ROLE_C_PROMPT_MANIFEST_VERSION,
      },
      max_repairs: maxRepairs,
      diagnostic_sink: this.stageFailureDiagnosticSink,
      validate: (patch) => {
        const schema = validateRoleCSchemaFragment(
          "code_lab_draft.schema.json",
          "/$defs/execution_repair_patch",
          patch,
        )
        if (!schema.ok) return validationIssues(schema)
        const normalizedPatch = normalizeCodeLabExecutionRepairPatch(
          patch,
          draft.secure_draft.payload,
          publicPayload.execution_contract,
        )
        const patchIssues = validateCodeLabExecutionRepairPatch(
          draft.secure_draft.payload,
          normalizedPatch,
          feedback,
        )
        if (patchIssues.length > 0) return patchIssues
        const repaired = normalizeCodeLabSecure(
          request.generation_spec,
          applyCodeLabExecutionRepairPatch(
            draft.secure_draft.payload,
            normalizedPatch,
          ),
          publicPayload,
          identity.test_suite_id,
          objectivePlan,
        )
        const planIssues = validateCodeLabSecureAgainstPlan(
          repaired,
          objectivePlan,
        )
        if (planIssues.length > 0) return planIssues
        const progressIssues = validateCodeLabExecutionRepairProgress(
          draft.secure_draft.payload,
          repaired,
          feedback,
        )
        if (progressIssues.length > 0) return progressIssues
        return validationIssues(validateCodeLabDraftStructure(request, {
          public_draft: { payload: publicPayload },
          secure_draft: { payload: repaired },
        }))
      },
    })
    const normalizedRepairPatch = normalizeCodeLabExecutionRepairPatch(
      repairPatch,
      draft.secure_draft.payload,
      publicPayload.execution_contract,
    )
    const repairedSecure = applyCodeLabExecutionRepairPatch(
      draft.secure_draft.payload,
      normalizedRepairPatch,
    )
    const securedWithExpected = patchExpectedFromReferenceFailures(
      repairedSecure,
      verificationIssues,
    )
    const securePayload = normalizeCodeLabSecure(
      request.generation_spec,
      securedWithExpected,
      publicPayload,
      identity.test_suite_id,
      objectivePlan,
    )
    return {
      public_draft: { payload: publicPayload },
      secure_draft: { payload: securePayload },
    }
  }

  async generateAssessment(request: TieredEvaluatorRequest): Promise<AssessmentDraft> {
    assertVersionCompatibility(request, this.gateway, EVALUATOR_AUTHOR_PROMPT_VERSION)
    if (this.generationStrategy === "monolithic") return this.generateAssessmentMonolithic(request)

    const modelInput = buildAssessmentAuthorModelInput(request)
    const plan = request.resource_blueprint?.assessment.item_plan
      ?? buildAssessmentItemPlan(request.generation_spec)
    const formId = buildAssessmentFormId(request.generation_spec)
    const maxRepairs = boundedRepairs(this.maxRepairAttempts, request)
    const noveltyBrief = buildAssessmentNoveltyDesignBrief(
      plan,
      request.prior_assessment_items ?? [],
    )
    // Author each public item against only its own frozen citations.  A
    // monolithic form prompt exposed every target fact to every question and
    // repeatedly produced hidden cross-objective dependencies (for example a
    // K004 trace item quietly requiring K005 arithmetic).  Item-isolated
    // authoring preserves AI-generated questions while making the evidence
    // boundary constructive instead of relying on a late audit to disentangle
    // an already-written form.
    const publicItemAuthors = await mapWithConcurrency(
      plan,
      Math.min(3, this.conceptConcurrency),
      async (itemPlan, itemIndex) => {
        const factKeys = new Set(itemPlan.citations.map((citation) =>
          `${citation.source_id}:${citation.fact_id}`))
        const itemEvidence = modelInput.evidence.flatMap((source) => {
          const facts = source.facts.filter((fact) =>
            factKeys.has(`${source.source_id}:${fact.fact_id}`))
          return facts.length > 0 ? [{ ...source, facts }] : []
        })
        const itemTarget = modelInput.contract.targets.find((target) =>
          target.objective_id === itemPlan.objective_id)
        const itemUpstream = {
          ...modelInput.upstream,
          objective_summaries: modelInput.upstream.objective_summaries.filter(
            (entry) => entry.objective_id === itemPlan.objective_id,
          ),
          misconceptions: modelInput.upstream.misconceptions.filter(
            (entry) => entry.objective_id === itemPlan.objective_id,
          ),
          // The shared semantic plan may legitimately coordinate the whole
          // form, but it must not inject another objective's facts into one
          // item's authoring surface.
          round_semantic_plan: undefined,
          resource_blueprint: modelInput.upstream.resource_blueprint
            ? {
                ...modelInput.upstream.resource_blueprint,
                objectives: modelInput.upstream.resource_blueprint.objectives.filter(
                  (entry) => entry.objective_id === itemPlan.objective_id,
                ),
                assessment: {
                  ...modelInput.upstream.resource_blueprint.assessment,
                  item_plan: [structuredClone(itemPlan)],
                  total_items: 1,
                  total_score: itemPlan.max_score,
                },
              }
            : undefined,
        }
        return this.generateStage<AssessmentPublicAuthorPayload>({
          task: "role-c.tiered-evaluator.public-item",
          system_prompt: ASSESSMENT_PUBLIC_STAGE_SYSTEM_PROMPT,
          input: {
            contract: {
              ...modelInput.contract,
              targets: itemTarget ? [structuredClone(itemTarget)] : [],
            },
            evidence: itemEvidence,
            upstream: itemUpstream,
            staged_contract: {
              form_id: formId,
              objective_ids: [itemPlan.objective_id],
              item_plan: [itemPlan],
              novelty_design_brief: {
                history_count: noveltyBrief.history_count,
                items: [noveltyBrief.items[itemIndex]!],
              },
            },
          },
          output_schema_id: "role_c_assessment_public_author_payload_v1",
          output_schema: fragment("assessment_draft.schema.json", "/$defs/public_author_payload"),
          temperature: (request.prior_assessment_items?.length ?? 0) > 0
            ? Math.max(this.assessmentTemperature, 0.6)
            : this.assessmentTemperature,
          max_tokens: Math.min(this.assessmentPublicMaxTokens, 2_400),
          idempotency_identity: {
            spec_id: request.generation_spec.spec_id,
            concept_artifact_id: request.concept_artifact.artifact_id,
            stage: "public-item",
            item_id: itemPlan.item_id,
            prompt_version: STAGED_AUTHOR_PROMPT_VERSION,
          },
          max_repairs: maxRepairs,
          diagnostic_sink: this.stageFailureDiagnosticSink,
          validate: (payload) => {
            const authored = projectAssessmentPublicAuthorPayload(payload)
            normalizeAssessmentAuthorFields(authored, [itemPlan])
            const schema = validateRoleCSchemaFragment(
              "assessment_draft.schema.json",
              "/$defs/public_author_payload",
              authored,
            )
            if (!schema.ok) return validationIssues(schema)
            const planIssues = validateAssessmentPublicAuthorAgainstPlan(
              authored,
              [itemPlan],
            )
            if (planIssues.length > 0) return planIssues
            const materialized = materializeAssessmentPublicAuthorPayload(
              request.generation_spec,
              authored,
              [itemPlan],
              formId,
            )
            return validateAssessmentNovelty(
              materialized,
              request.prior_assessment_items ?? [],
            )
          },
        })
      },
    )
    let publicAuthorPayload: AssessmentPublicAuthorPayload = {
      title: publicItemAuthors[0]?.title?.trim() || "本轮学习测评",
      items: publicItemAuthors.map((author) =>
        projectAssessmentPublicAuthorPayload(author).items[0]!),
    }
    normalizeAssessmentAuthorFields(publicAuthorPayload, plan)
    let normalizedPublic = materializeAssessmentPublicAuthorPayload(
      request.generation_spec,
      projectAssessmentPublicAuthorPayload(publicAuthorPayload),
      plan,
      formId,
    )
    let composedPublicIssues = [
      ...validationIssues(validateAssessmentPublicStage(request, normalizedPublic)),
      ...validateAssessmentNovelty(
        normalizedPublic,
        request.prior_assessment_items ?? [],
      ),
    ]
    // Single-item authoring is parallel, so an item cannot observe the prose
    // independently authored for its siblings. Perform one form-level
    // comparison afterwards and rewrite only the colliding item(s); accepted
    // items keep their identity and text, and secure answers are authored only
    // after the public form is stable.
    for (let repairAttempt = 1;
      composedPublicIssues.length > 0 && repairAttempt <= maxRepairs;
      repairAttempt += 1) {
      const repairStage: StructuredStage<AssessmentPublicAuthorPayload> = {
        task: "role-c.tiered-evaluator.public",
        system_prompt: ASSESSMENT_PUBLIC_STAGE_SYSTEM_PROMPT,
        input: {
          ...modelInput,
          staged_contract: {
            form_id: formId,
            objective_ids: request.generation_spec.targets.map((target) => target.objective_id),
            item_plan: plan,
            novelty_design_brief: noveltyBrief,
          },
        },
        output_schema_id: "role_c_assessment_public_author_payload_v1",
        output_schema: fragment("assessment_draft.schema.json", "/$defs/public_author_payload"),
        temperature: Math.max(this.assessmentTemperature, 0.4),
        max_tokens: this.assessmentPublicMaxTokens,
        idempotency_identity: {
          spec_id: request.generation_spec.spec_id,
          concept_artifact_id: request.concept_artifact.artifact_id,
          form_id: formId,
          stage: "public-compose-repair",
          prompt_version: STAGED_AUTHOR_PROMPT_VERSION,
        },
        max_repairs: 0,
        validate: () => [],
      }
      const directive = stageRepairDirective(
        repairStage.task,
        composedPublicIssues,
        repairAttempt,
        repairStage.idempotency_identity,
      )
      if (directive.required_change_indices.length === 0) break
      publicAuthorPayload = await this.generateAssessmentNoveltyRepair(
        repairStage,
        publicAuthorPayload,
        composedPublicIssues,
        directive,
      )
      normalizeAssessmentAuthorFields(publicAuthorPayload, plan)
      normalizedPublic = materializeAssessmentPublicAuthorPayload(
        request.generation_spec,
        projectAssessmentPublicAuthorPayload(publicAuthorPayload),
        plan,
        formId,
      )
      composedPublicIssues = [
        ...validationIssues(validateAssessmentPublicStage(request, normalizedPublic)),
        ...validateAssessmentNovelty(
          normalizedPublic,
          request.prior_assessment_items ?? [],
        ),
      ]
    }
    if (composedPublicIssues.length > 0) {
      throw new ModelOutputValidationError(
        "role-c.tiered-evaluator.public.compose",
        composedPublicIssues,
      )
    }
    const secureAuthorPayload = await this.generateStage<AssessmentSecureAuthorPayload>({
      task: "role-c.tiered-evaluator.secure",
      system_prompt: ASSESSMENT_SECURE_STAGE_SYSTEM_PROMPT,
      input: {
        contract: modelInput.contract,
        evidence: modelInput.evidence,
        upstream: assessmentUpstreamWithoutHistory(modelInput.upstream),
        public_payload: normalizedPublic,
        staged_contract: {
          form_id: formId,
          option_order_seed: request.generation_spec.policies.seed,
          item_plan: plan,
        },
      },
      output_schema_id: "role_c_assessment_secure_author_payload_v1",
      output_schema: fragment("assessment_draft.schema.json", "/$defs/secure_author_payload"),
      temperature: this.assessmentTemperature,
      max_tokens: this.assessmentSecureMaxTokens,
      idempotency_identity: {
        spec_id: request.generation_spec.spec_id,
        form_id: formId,
        public_hash: contentHash(normalizedPublic),
        stage: "secure",
        prompt_version: STAGED_AUTHOR_PROMPT_VERSION,
      },
      max_repairs: maxRepairs,
      diagnostic_sink: this.stageFailureDiagnosticSink,
      validate: (payload) => {
        const schema = validateRoleCSchemaFragment("assessment_draft.schema.json", "/$defs/secure_author_payload", payload)
        if (!schema.ok) return validationIssues(schema)
        const normalizedAuthor = normalizeAssessmentSecureAuthorPayload(
          payload,
          normalizedPublic,
        )
        const crossIssues = validateAssessmentSecureAuthorAgainstPublic(normalizedAuthor, normalizedPublic)
        if (crossIssues.length > 0) return crossIssues
        const secure = materializeAssessmentSecureAuthorPayload(
          request.generation_spec,
          normalizedPublic,
          normalizedAuthor,
        )
        const normalized = normalizeAssessmentPair(request.generation_spec, normalizedPublic, secure)
        return validationIssues(validateAssessmentDraftStructure(request, {
          public_draft: { payload: normalized.public_payload },
          secure_draft: { payload: normalized.secure_payload },
        }))
      },
    })
    const normalizedSecureAuthorPayload = normalizeAssessmentSecureAuthorPayload(
      secureAuthorPayload,
      normalizedPublic,
    )
    let securePayload = materializeAssessmentSecureAuthorPayload(
      request.generation_spec,
      normalizedPublic,
      normalizedSecureAuthorPayload,
    )
    let normalized = normalizeAssessmentPair(request.generation_spec, normalizedPublic, securePayload)
    const separation = validateAssessmentDraftStructure(request, {
      public_draft: { payload: normalized.public_payload },
      secure_draft: { payload: normalized.secure_payload },
    })
    if (separation.issues.some((issue) => REPAIRABLE_STARTER_LEAK_CODES.has(issue.code))) {
      const sanitizedPublic = conservativeAssessmentPublicSafetyRepair(normalized.public_payload)
      securePayload = materializeAssessmentSecureAuthorPayload(
        request.generation_spec,
        sanitizedPublic,
        normalizedSecureAuthorPayload,
      )
      normalized = normalizeAssessmentPair(request.generation_spec, sanitizedPublic, securePayload)
    }
    return {
      public_draft: { payload: normalized.public_payload },
      secure_draft: { payload: normalized.secure_payload },
    }
  }

  async repairAssessmentAfterVerification(
    request: TieredEvaluatorRequest,
    draft: AssessmentDraft,
    feedback: AssessmentVerificationFeedback,
  ): Promise<AssessmentDraft> {
    assertVersionCompatibility(request, this.gateway, EVALUATOR_AUTHOR_PROMPT_VERSION)
    if (this.generationStrategy !== "staged") {
      throw new ModelProviderUnavailableError(
        "可信验证后的测评私有修订仅支持 staged 模型生成策略",
      )
    }

    const modelInput = buildAssessmentAuthorModelInput(request)
    const plan = request.resource_blueprint?.assessment.item_plan
      ?? buildAssessmentItemPlan(request.generation_spec)
    const formId = buildAssessmentFormId(request.generation_spec)
    const publicPayload = structuredClone(draft.public_draft.payload)
    const expectedOnlyCodes = assessmentExpectedOnlyReferenceFailureCodes(feedback)
    if (expectedOnlyCodes.length > 0 && isExpectedOnlyReferenceFailure(expectedOnlyCodes)) {
      const deterministicSecure = patchAssessmentExpectedFromReferenceFailures(
        draft.secure_draft.payload,
        expectedOnlyCodes,
      )
      const normalized = normalizeAssessmentPair(
        request.generation_spec,
        publicPayload,
        deterministicSecure,
      )
      return {
        public_draft: { payload: normalized.public_payload },
        secure_draft: { payload: normalized.secure_payload },
      }
    }
    const maxRepairs = boundedRepairs(this.maxRepairAttempts, request)
    const verificationIssues = feedback.issues
      .slice(0, 32)
      .map((issue) => issue.slice(0, 500))
    const secureAuthorPayload = await this.generateStage<AssessmentSecureAuthorPayload>({
      task: "role-c.tiered-evaluator.secure.execution-repair",
      system_prompt: ASSESSMENT_EXECUTION_REPAIR_SYSTEM_PROMPT,
      input: {
        contract: modelInput.contract,
        evidence: modelInput.evidence,
        upstream: assessmentUpstreamWithoutHistory(modelInput.upstream),
        public_payload: publicPayload,
        prior_secure_payload: draft.secure_draft.payload,
        trusted_verification_report: {
          revision_round: feedback.revision_round,
          issues: verificationIssues,
        },
        staged_contract: {
          form_id: formId,
          option_order_seed: request.generation_spec.policies.seed,
          item_plan: plan,
        },
      },
      output_schema_id: "role_c_assessment_secure_author_payload_v1",
      output_schema: fragment(
        "assessment_draft.schema.json",
        "/$defs/secure_author_payload",
      ),
      temperature: this.assessmentTemperature,
      max_tokens: this.assessmentSecureMaxTokens,
      idempotency_identity: {
        spec_id: request.generation_spec.spec_id,
        form_id: formId,
        public_hash: contentHash(publicPayload),
        prior_secure_hash: contentHash(draft.secure_draft.payload),
        trusted_verification_feedback_hash: contentHash(verificationIssues),
        verification_revision_round: feedback.revision_round,
        stage: "secure-execution-repair",
        prompt_version: ROLE_C_PROMPT_MANIFEST_VERSION,
      },
      max_repairs: maxRepairs,
      diagnostic_sink: this.stageFailureDiagnosticSink,
      validate: (payload) => {
        const schema = validateRoleCSchemaFragment(
          "assessment_draft.schema.json",
          "/$defs/secure_author_payload",
          payload,
        )
        if (!schema.ok) return validationIssues(schema)
        const normalizedAuthor = normalizeAssessmentSecureAuthorPayload(
          payload,
          publicPayload,
        )
        const crossIssues = validateAssessmentSecureAuthorAgainstPublic(
          normalizedAuthor,
          publicPayload,
        )
        if (crossIssues.length > 0) return crossIssues
        const materialized = materializeAssessmentSecureAuthorPayload(
          request.generation_spec,
          publicPayload,
          normalizedAuthor,
        )
        const normalized = normalizeAssessmentPair(
          request.generation_spec,
          publicPayload,
          materialized,
        )
        return validationIssues(validateAssessmentDraftStructure(request, {
          public_draft: { payload: normalized.public_payload },
          secure_draft: { payload: normalized.secure_payload },
        }))
      },
    })
    const normalizedSecureAuthorPayload = normalizeAssessmentSecureAuthorPayload(
      secureAuthorPayload,
      publicPayload,
    )
    const materialized = materializeAssessmentSecureAuthorPayload(
      request.generation_spec,
      publicPayload,
      normalizedSecureAuthorPayload,
    )
    const normalized = normalizeAssessmentPair(
      request.generation_spec,
      publicPayload,
      materialized,
    )
    return {
      public_draft: { payload: normalized.public_payload },
      secure_draft: { payload: normalized.secure_payload },
    }
  }

  /**
   * Rewrites only learner-visible material when public strings can reconstruct
   * the trusted reference. Secure values are used by the local validator only
   * and are never included in the model request.
   */
  private async repairCodeLabPublicSafety(input: {
    request: CodeLabRequest
    public_payload: CodeLabPublicPayload
    secure_payload: CodeLabSecurePayload
    repair_reason: string
    revision_identity: string
  }): Promise<CodeLabPublicPayload> {
    const { request } = input
    const modelInput = buildCodeLabModelInput(request)
    const identity = buildLabIdentity(request.generation_spec)
    const securePlan = buildCodeLabSecurePlan(
      request.generation_spec,
      identity.test_suite_id,
    )
    const maxRepairs = boundedRepairs(this.maxRepairAttempts, request)
    const validatePatch = (candidatePatch: CodeLabPublicSafetyRepairPatch): string[] => {
      const schema = validateRoleCSchemaFragment(
        "code_lab_draft.schema.json",
        "/$defs/public_safety_repair_patch",
        candidatePatch,
      )
      if (!schema.ok) return validationIssues(schema)
      const shapeIssues = validateCodeLabPublicSafetyPatchShape(
        input.public_payload,
        candidatePatch,
      )
      if (shapeIssues.length > 0) return shapeIssues
      const candidate = applyCodeLabPublicSafetyPatch(
        input.public_payload,
        candidatePatch,
      )
      if (contentHash(candidate) === contentHash(input.public_payload)) {
        return ["公开安全修订未改变学习者可见内容"]
      }
      const publicIssues = validationIssues(
        validateCodeLabPublicStage(request, candidate),
      )
      if (publicIssues.length > 0) return publicIssues
      const frozenSecure = normalizeCodeLabSecure(
        request.generation_spec,
        input.secure_payload,
        candidate,
        identity.test_suite_id,
        securePlan,
      )
      return validationIssues(validateCodeLabDraftStructure(request, {
        public_draft: { payload: candidate },
        secure_draft: { payload: frozenSecure },
      }))
    }
    const issueCodes = validateCodeLabDraftStructure(request, {
      public_draft: { payload: input.public_payload },
      secure_draft: { payload: input.secure_payload },
    }).issues.map((issue) => issue.code)
    const deterministicRepair = shouldUseDeterministicPublicSafetyRepair(issueCodes)
    let patch: CodeLabPublicSafetyRepairPatch
    if (deterministicRepair) {
      patch = conservativeCodeLabPublicSafetyPatch(input.public_payload)
      const fallbackIssues = validatePatch(patch)
      if (fallbackIssues.length > 0) {
        throw new ModelOutputValidationError(
          "role-c.code-lab.public.safety-repair",
          fallbackIssues,
        )
      }
      return applyCodeLabPublicSafetyPatch(input.public_payload, patch)
    }
    try {
      patch = await this.generateStage<CodeLabPublicSafetyRepairPatch>({
        task: "role-c.code-lab.public.safety-repair",
        system_prompt: CODE_LAB_PUBLIC_SAFETY_REPAIR_SYSTEM_PROMPT,
        input: {
          contract: modelInput.contract,
          evidence: modelInput.evidence,
          concept: modelInput.concept,
          public_payload: input.public_payload,
          trusted_public_report: { issue: input.repair_reason },
        },
        output_schema_id: "role_c_code_lab_public_safety_repair_patch_v1",
        output_schema: fragment(
          "code_lab_draft.schema.json",
          "/$defs/public_safety_repair_patch",
        ),
        temperature: this.codeLabTemperature,
        max_tokens: this.codeLabPublicMaxTokens,
        idempotency_identity: {
          spec_id: request.generation_spec.spec_id,
          lab_id: identity.lab_id,
          prior_public_hash: contentHash(input.public_payload),
          revision_identity: input.revision_identity,
          stage: "public-safety-repair",
          prompt_version: STAGED_AUTHOR_PROMPT_VERSION,
        },
        max_repairs: maxRepairs,
        validate: validatePatch,
      })
    } catch (error) {
      if (!(error instanceof ModelOutputValidationError)) throw error
      const conservativePatch = conservativeCodeLabPublicSafetyPatch(
        input.public_payload,
      )
      const fallbackIssues = validatePatch(conservativePatch)
      if (fallbackIssues.length > 0) {
        throw new ModelOutputValidationError(error.stage, [
          ...error.issues,
          ...fallbackIssues,
        ])
      }
      patch = conservativePatch
    }
    return applyCodeLabPublicSafetyPatch(input.public_payload, patch)
  }

  /**
   * Repairs only learner-visible starter code. The model receives no reference,
   * hidden test, score, or mutation material; the trust plane uses those values
   * solely to validate the returned public patch before it is accepted.
   */
  private async repairCodeLabStarter(input: {
    request: CodeLabRequest
    public_payload: CodeLabPublicPayload
    secure_payload: CodeLabSecurePayload
    repair_reason: string
    revision_identity: string
  }): Promise<CodeLabPublicPayload> {
    const { request } = input
    const modelInput = buildCodeLabModelInput(request)
    const identity = buildLabIdentity(request.generation_spec)
    const securePlan = buildCodeLabSecurePlan(
      request.generation_spec,
      identity.test_suite_id,
    )
    const maxRepairs = boundedRepairs(this.maxRepairAttempts, request)
    const starterPatch = await this.generateStage<CodeLabStarterRepairPatch>({
      task: "role-c.code-lab.public.starter-repair",
      system_prompt: CODE_LAB_STARTER_REPAIR_SYSTEM_PROMPT,
      input: {
        contract: modelInput.contract,
        evidence: modelInput.evidence,
        concept: modelInput.concept,
        public_payload: input.public_payload,
        trusted_public_report: {
          issue: input.repair_reason,
        },
      },
      output_schema_id: "role_c_code_lab_starter_repair_patch_v1",
      output_schema: fragment(
        "code_lab_draft.schema.json",
        "/$defs/starter_repair_patch",
      ),
      temperature: this.codeLabTemperature,
      max_tokens: this.codeLabPublicMaxTokens,
      idempotency_identity: {
        spec_id: request.generation_spec.spec_id,
        lab_id: identity.lab_id,
        prior_public_hash: contentHash(input.public_payload),
        revision_identity: input.revision_identity,
        stage: "public-starter-repair",
        prompt_version: STAGED_AUTHOR_PROMPT_VERSION,
      },
      max_repairs: maxRepairs,
      validate: (patch) => {
        const schema = validateRoleCSchemaFragment(
          "code_lab_draft.schema.json",
          "/$defs/starter_repair_patch",
          patch,
        )
        if (!schema.ok) return validationIssues(schema)
        if (contentHash(patch.starter_code)
          === contentHash(input.public_payload.starter_code)) {
          return ["starter_code 未发生实质变化"]
        }
        const candidate: CodeLabPublicPayload = {
          ...structuredClone(input.public_payload),
          starter_code: patch.starter_code,
        }
        const publicIssues = validationIssues(
          validateCodeLabPublicStage(request, candidate),
        )
        if (publicIssues.length > 0) return publicIssues
        const frozenSecure = normalizeCodeLabSecure(
          request.generation_spec,
          input.secure_payload,
          candidate,
          identity.test_suite_id,
          securePlan,
        )
        return validationIssues(validateCodeLabDraftStructure(request, {
          public_draft: { payload: candidate },
          secure_draft: { payload: frozenSecure },
        }))
      },
    })
    return {
      ...structuredClone(input.public_payload),
      starter_code: starterPatch.starter_code,
    }
  }

  private async generateStage<T>(stage: StructuredStage<T>): Promise<T> {
    let issues: string[] = []
    let previousOutput: T | undefined
    let renderMaxTokens = stage.max_tokens
    for (let attempt = 0; attempt <= stage.max_repairs; attempt += 1) {
      let value: T
      const systemPrompt = attempt === 0
        ? stage.system_prompt
        : stagedRepairPrompt(stage.system_prompt, issues)
      const requestInput = attempt === 0
        ? stage.input
        : {
            ...asRecord(stage.input),
            ...(previousOutput === undefined
              ? {}
              : { previous_output: previousOutput }),
            validator_report: issues,
            repair_directive: stageRepairDirective(
              stage.task,
              issues,
              attempt,
              stage.idempotency_identity,
            ),
            repair_context: stageRepairContext(
              stage.task,
              stage.input,
              issues,
            ),
          }
      try {
        const repairDirective = stageRepairDirective(
          stage.task,
          issues,
          attempt,
          stage.idempotency_identity,
        )
        value = attempt > 0
          && previousOutput !== undefined
          && repairDirective.replace_entire_item
          ? await this.generateAssessmentNoveltyRepair(
              stage,
              previousOutput,
              issues,
              repairDirective,
            )
          : await this.gateway.generateStructured<T>({
          task: stage.task,
          system_prompt: systemPrompt,
          input: requestInput,
          output_schema_id: stage.output_schema_id,
          output_schema: stage.output_schema,
          temperature: stage.temperature,
          max_tokens: renderMaxTokens,
          policy: fastModelPolicy(
            attempt === 0 ? "ROLE_C_STRUCTURED_RENDER" : "ROLE_C_TARGETED_REPAIR",
            renderMaxTokens,
            { max_transport_retries: attempt === 0 ? 1 : 0 },
          ),
          idempotency_key: idempotencyKey({
            ...stage.idempotency_identity,
            model_config_hash: this.gateway.model_config_hash,
            task: stage.task,
            output_schema_id: stage.output_schema_id,
            request_hash: contentHash({
              system_prompt: systemPrompt,
              input: requestInput,
            }),
            attempt,
          }),
          })
      } catch (error) {
        if (
          attempt < stage.max_repairs
          && error instanceof ModelGatewayError
          && ["INVALID_JSON", "INVALID_RESPONSE", "OUTPUT_TRUNCATED"].includes(error.code)
        ) {
          issues = [`模型输出格式错误：${error.message}`]
          if (error.code === "OUTPUT_TRUNCATED") {
            // Retry only this structured stage. The semantic plan and completed
            // checkpoints remain unchanged, and the retry always stays FAST.
            renderMaxTokens = Math.min(
              Math.ceil(stage.max_tokens * 1.5),
              stageTokenCeiling(stage.task, stage.max_tokens),
            )
          }
          continue
        }
        throw error
      }
      const priorOutput = previousOutput
      const priorIssues = issues
      previousOutput = structuredClone(value)
      issues = stage.validate(value)
      if (issues.length === 0) return value
      const progressIssues = validateStageRepairProgress(priorOutput, value, priorIssues, issues)
      if (progressIssues.length > 0) {
        issues = [...issues, ...progressIssues]
        await stage.diagnostic_sink?.(sanitizeStageFailureDiagnostic({
          task: stage.task,
          attempt,
          max_repairs: stage.max_repairs,
          output_schema_id: stage.output_schema_id,
          issues,
          output_hash: contentHash(value),
        }))
        if (attempt < stage.max_repairs) continue
        break
      }
      await stage.diagnostic_sink?.(sanitizeStageFailureDiagnostic({
        task: stage.task,
        attempt,
        max_repairs: stage.max_repairs,
        output_schema_id: stage.output_schema_id,
        issues,
        output_hash: contentHash(value),
      }))
    }
    throw new ModelOutputValidationError(stage.task, issues)
  }

  private async generateAssessmentNoveltyRepair<T>(
    stage: StructuredStage<T>,
    previousOutput: T,
    issues: string[],
    repairDirective: ReturnType<typeof stageRepairDirective>,
  ): Promise<T> {
    const indices = repairDirective.required_change_indices
    const patch = await this.gateway.generateStructured<{
      replacements: Array<{
        index: number
        prompt: string
        options: string[] | null
        starter_code: string | null
        structure_meta: AssessmentStructureMeta
      }>
    }>({
      task: "role-c.tiered-evaluator.public.novelty-repair",
      system_prompt: ASSESSMENT_NOVELTY_REPAIR_SYSTEM_PROMPT,
      input: {
        ...asRecord(stage.input),
        previous_output: previousOutput,
        validator_report: issues,
        repair_directive: repairDirective,
      },
      output_schema_id: "role_c_assessment_public_novelty_patch_v1",
      output_schema: assessmentNoveltyPatchSchema(indices),
      temperature: stage.temperature,
      max_tokens: Math.min(stage.max_tokens, 4_000),
      policy: fastModelPolicy("ASSESSMENT_NOVELTY_PATCH", Math.min(stage.max_tokens, 4_000), {
        max_transport_retries: 0,
        do_sample: true,
      }),
      idempotency_key: idempotencyKey({
        ...stage.idempotency_identity,
        task: "role-c.tiered-evaluator.public.novelty-repair",
        model_config_hash: this.gateway.model_config_hash,
        repair_directive: repairDirective,
      }),
    })
    return applyAssessmentNoveltyPatch(previousOutput, patch.replacements, indices)
  }

  private async generateConceptLessonMonolithic(
    request: ConceptTutorRequest,
  ): Promise<ArtifactDraft<ConceptLessonPayload>> {
    const modelInput = buildConceptTutorModelInput(request)
    const schema = getRoleCModelOutputSchema("concept_lesson_payload.schema.json")
    const maxRepairs = boundedRepairs(this.maxRepairAttempts, request)
    let payload: unknown
    let issues: string[] = []
    for (let attempt = 0; attempt <= maxRepairs; attempt += 1) {
      try {
        payload = await this.gateway.generateStructured<unknown>({
          task: "role-c.concept-tutor.generate",
          system_prompt: attempt === 0 ? CONCEPT_TUTOR_SYSTEM_PROMPT : conceptTutorRepairPrompt(issues),
          input: attempt === 0 ? modelInput : { ...modelInput, validator_report: issues },
          output_schema_id: "role_c_concept_lesson_payload_v1",
          output_schema: schema,
          temperature: this.conceptTemperature,
          max_tokens: this.conceptMaxTokens,
          policy: fastModelPolicy("ROLE_C_MONOLITHIC_CONCEPT", this.conceptMaxTokens),
          idempotency_key: idempotencyKey({
            spec_id: request.generation_spec.spec_id,
            evidence_ref: request.generation_spec.evidence_ref,
            prompt_version: CONCEPT_TUTOR_PROMPT_VERSION,
            model_config_hash: this.gateway.model_config_hash,
            seed: request.generation_spec.policies.seed,
            input_hash: contentHash(modelInput),
            attempt,
          }),
        })
      } catch (error) {
        if (repairable(error, attempt, maxRepairs)) {
          issues = [`模型输出格式错误：${(error as Error).message}`]
          continue
        }
        throw error
      }
      const validation = validateConceptLesson({ payload, spec: request.generation_spec, evidence: request.evidence_pack })
      if (validation.ok) return { payload: payload as ConceptLessonPayload }
      issues = validationIssues(validation)
    }
    return { payload: payload as ConceptLessonPayload }
  }

  private async generateCodeLabMonolithic(request: CodeLabRequest): Promise<CodeLabDraft> {
    const modelInput = buildCodeLabModelInput(request)
    const schema = getRoleCModelOutputSchema("code_lab_draft.schema.json")
    const maxRepairs = boundedRepairs(this.maxRepairAttempts, request)
    let draft: unknown
    let issues: string[] = []
    for (let attempt = 0; attempt <= maxRepairs; attempt += 1) {
      try {
        draft = await this.gateway.generateStructured<unknown>({
          task: "role-c.code-lab.generate",
          system_prompt: attempt === 0 ? CODE_LAB_SYSTEM_PROMPT : codeLabRepairPrompt(issues),
          input: attempt === 0 ? modelInput : { ...modelInput, validator_report: issues },
          output_schema_id: "role_c_code_lab_draft_v1",
          output_schema: schema,
          temperature: this.codeLabTemperature,
          max_tokens: this.codeLabMaxTokens,
          policy: fastModelPolicy("ROLE_C_MONOLITHIC_CODE_LAB", this.codeLabMaxTokens),
          idempotency_key: idempotencyKey({
            spec_id: request.generation_spec.spec_id,
            concept_artifact_id: request.concept_artifact.artifact_id,
            evidence_ref: request.generation_spec.evidence_ref,
            prompt_version: CODE_LAB_PROMPT_VERSION,
            model_config_hash: this.gateway.model_config_hash,
            seed: request.generation_spec.policies.seed,
            input_hash: contentHash(modelInput),
            attempt,
          }),
        })
      } catch (error) {
        if (repairable(error, attempt, maxRepairs)) {
          issues = [`模型输出格式错误：${(error as Error).message}`]
          continue
        }
        throw error
      }
      const validation = validateCodeLabDraftStructure(request, draft as CodeLabDraft)
      if (validation.ok) return draft as CodeLabDraft
      issues = validationIssues(validation)
    }
    return draft as CodeLabDraft
  }

  private async generateAssessmentMonolithic(request: TieredEvaluatorRequest): Promise<AssessmentDraft> {
    const modelInput = buildAssessmentAuthorModelInput(request)
    const schema = getRoleCModelOutputSchema("assessment_draft.schema.json")
    const maxRepairs = boundedRepairs(this.maxRepairAttempts, request)
    let draft: unknown
    let issues: string[] = []
    for (let attempt = 0; attempt <= maxRepairs; attempt += 1) {
      try {
        draft = await this.gateway.generateStructured<unknown>({
          task: "role-c.tiered-evaluator.author",
          system_prompt: attempt === 0 ? EVALUATOR_AUTHOR_SYSTEM_PROMPT : evaluatorAuthorRepairPrompt(issues),
          input: attempt === 0 ? modelInput : { ...modelInput, validator_report: issues },
          output_schema_id: "role_c_assessment_draft_v1",
          output_schema: schema,
          temperature: this.assessmentTemperature,
          max_tokens: this.assessmentMaxTokens,
          policy: fastModelPolicy("ROLE_C_MONOLITHIC_ASSESSMENT", this.assessmentMaxTokens),
          idempotency_key: idempotencyKey({
            spec_id: request.generation_spec.spec_id,
            concept_artifact_id: request.concept_artifact.artifact_id,
            evidence_ref: request.generation_spec.evidence_ref,
            prompt_version: EVALUATOR_AUTHOR_PROMPT_VERSION,
            model_config_hash: this.gateway.model_config_hash,
            seed: request.generation_spec.policies.seed,
            input_hash: contentHash(modelInput),
            attempt,
          }),
        })
      } catch (error) {
        if (repairable(error, attempt, maxRepairs)) {
          issues = [`模型输出格式错误：${(error as Error).message}`]
          continue
        }
        throw error
      }
      const validation = validateAssessmentDraftStructure(request, draft as AssessmentDraft)
      const noveltyIssues = validateAssessmentNovelty(
        (draft as AssessmentDraft).public_draft.payload,
        request.prior_assessment_items ?? [],
      )
      if (validation.ok && noveltyIssues.length === 0) return draft as AssessmentDraft
      issues = [...validationIssues(validation), ...noveltyIssues]
    }
    return draft as AssessmentDraft
  }
}

export interface AssessmentNoveltyDesignBrief {
  history_count: number
  items: Array<{
    index: number
    objective_id: string
    tier: 1 | 2 | 3
    modality: AssessmentItemPlan["modality"]
    planned_cognitive_operation: AssessmentItemPlan["cognitive_operation"]
    variation_axis: "operation" | "reasoning_pattern" | "representation" | "context_family"
    in_form_role: "direct_foundation" | "guided_application" | "integrated_transfer"
    planned_task_shape: string
    forbidden_history: Array<{
      prompt: string
      structure_meta?: AssessmentStructureMeta
    }>
  }>
}

/**
 * Gives the author a compact, item-specific novelty plan before it writes any
 * question. The plan does not contain question text or answers: it identifies
 * the relevant historical tasks and rotates the semantic dimension that the
 * model should vary. This keeps novelty in the positive authoring path instead
 * of relying on repeated validator failures to explain the task afterwards.
 */
export function buildAssessmentNoveltyDesignBrief(
  plan: AssessmentItemPlan[],
  history: PriorAssessmentItem[],
): AssessmentNoveltyDesignBrief {
  const axes: AssessmentNoveltyDesignBrief["items"][number]["variation_axis"][] = [
    "operation",
    "reasoning_pattern",
    "representation",
    "context_family",
  ]
  return {
    history_count: history.length,
    items: plan.map((item, index) => ({
      index,
      objective_id: item.objective_id,
      tier: item.tier,
      modality: item.modality,
      planned_cognitive_operation: item.cognitive_operation,
      variation_axis: axes[(history.length + index) % axes.length]!,
      in_form_role: item.tier === 1
        ? "direct_foundation"
        : item.tier === 2
          ? "guided_application"
          : "integrated_transfer",
      planned_task_shape: assessmentTaskShape(item.modality, index),
      forbidden_history: history
        .filter((prior) => prior.objective_id === item.objective_id
          && prior.modality === item.modality)
        .slice(-8)
        .map((prior) => ({
          prompt: prior.prompt,
          ...(prior.structure_meta
            ? { structure_meta: structuredClone(prior.structure_meta) }
            : {}),
        })),
    })),
  }
}

function assessmentTaskShape(
  modality: AssessmentItemPlan["modality"],
  index: number,
): string {
  const shapes: Record<AssessmentItemPlan["modality"], string[]> = {
    mcq: [
      "select_one_supported_statement",
      "identify_one_direct_contradiction",
      "choose_best_fact_summary",
      "match_fact_to_description",
    ],
    true_false: ["verify_one_atomic_claim", "detect_one_scope_distortion"],
    short_answer: ["restate_supported_fact", "compare_given_facts", "explain_given_relation"],
    trace: ["trace_given_state", "complete_given_trace", "locate_trace_divergence"],
    code: ["complete_missing_branch", "complete_missing_expression", "complete_missing_transformation"],
  }
  const choices = shapes[modality]
  return choices[index % choices.length]!
}

export interface AssessmentNoveltyReplacement {
  index: number
  prompt: string
  options: string[] | null
  starter_code: string | null
  structure_meta: AssessmentStructureMeta
}

/**
 * Applies a targeted novelty rewrite without changing the frozen assessment
 * identity and plan fields. `null` means that the modality does not expose the
 * optional field; it must be omitted rather than serialized as null.
 */
export function applyAssessmentNoveltyPatch<T>(
  previousOutput: T,
  replacements: AssessmentNoveltyReplacement[],
  allowedIndices: number[],
): T {
  const candidate = structuredClone(previousOutput) as T
  const items = asRecord(candidate).items
  if (!Array.isArray(items)) return candidate
  for (const replacement of replacements) {
    const existing = items[replacement.index]
    if (!allowedIndices.includes(replacement.index)
      || !existing
      || typeof existing !== "object"
      || Array.isArray(existing)) continue
    const updated = {
      ...existing,
      prompt: replacement.prompt,
      structure_meta: structuredClone(replacement.structure_meta),
    }
    if (replacement.options === null) delete updated.options
    else updated.options = structuredClone(replacement.options)
    if (replacement.starter_code === null) delete updated.starter_code
    else updated.starter_code = replacement.starter_code
    items[replacement.index] = updated
  }
  return candidate
}

function stageRepairContext(
  task: string,
  input: unknown,
  issues: string[],
): Record<string, unknown> {
  if (task !== "role-c.code-lab.secure"
    || !issues.some((issue) => issue.includes("hidden_test_input_leak"))) {
    return {}
  }
  const record = asRecord(input)
  const publicPayload = asRecord(record.public_payload)
  const publicTests = Array.isArray(publicPayload.public_tests)
    ? publicPayload.public_tests
    : []
  const publicInputs = publicTests.map((test) => asRecord(test).input)
  return {
    forbidden_public_inputs: structuredClone(publicInputs),
    forbidden_public_scalar_values: uniqueJsonScalars(publicInputs),
    required_change: "为每个失败 hidden test 重新选择不含任何公开输入标量的 input，并根据 reference_solution 同步重算 expected",
  }
}

function uniqueJsonScalars(values: unknown[]): unknown[] {
  const scalars: unknown[] = []
  const seen = new Set<string>()
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    if (value && typeof value === "object") {
      Object.values(value as Record<string, unknown>).forEach(visit)
      return
    }
    if (value === undefined) return
    const key = JSON.stringify(value)
    if (!seen.has(key)) {
      seen.add(key)
      scalars.push(value)
    }
  }
  values.forEach(visit)
  return scalars
}

function stageRepairDirective(
  task: string,
  issues: string[],
  attempt: number,
  identity: Record<string, unknown>,
): {
  repair_attempt: number
  variation_token: string
  required_change_indices: number[]
  replace_entire_item: boolean
} {
  const indices = [...new Set(issues.flatMap((issue) => {
    const match = issue.match(/items\[(\d+)\]/u)
    return match ? [Number(match[1])] : []
  }))]
  return {
    repair_attempt: attempt,
    variation_token: contentHash({ task, identity, attempt, issues }).slice("sha256:".length, "sha256:".length + 20),
    required_change_indices: indices,
    replace_entire_item: task === "role-c.tiered-evaluator.public" && indices.length > 0,
  }
}

function assessmentNoveltyPatchSchema(indices: number[]): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["replacements"],
    properties: {
      replacements: {
        type: "array",
        minItems: indices.length,
        maxItems: indices.length,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["index", "prompt", "options", "starter_code", "structure_meta"],
          properties: {
            index: { type: "integer", enum: indices },
            prompt: { type: "string", minLength: 1 },
            options: {
              anyOf: [
                { type: "null" },
                { type: "array", minItems: 2, maxItems: 4, items: { type: "string", minLength: 1 } },
              ],
            },
            starter_code: {
              anyOf: [
                { type: "null" },
                { type: "string", minLength: 1 },
              ],
            },
            structure_meta: {
              type: "object",
              additionalProperties: false,
              required: ["operation", "reasoning_pattern", "representation", "context_family", "answer_form"],
              properties: {
                operation: { type: "string", minLength: 1 },
                reasoning_pattern: { type: "string", minLength: 1 },
                representation: { type: "string", minLength: 1 },
                context_family: { type: "string", minLength: 1 },
                answer_form: { type: "string", minLength: 1 },
              },
            },
          },
        },
      },
    },
  }
}

function assessmentUpstreamWithoutHistory<T extends { prior_assessment_items?: unknown }>(upstream: T): T {
  const result = structuredClone(upstream) as T & {
    prior_assessment_items?: unknown
  }
  delete result.prior_assessment_items
  return result
}

const REPAIRABLE_STARTER_LEAK_CODES = new Set([
  "reference_solution_leak",
  "starter_equals_reference",
])

function hasRepairablePublicAnswerLeak(
  report: ReturnType<typeof validateCodeLabDraftStructure>,
): boolean {
  return report.issues.some((issue) =>
    REPAIRABLE_STARTER_LEAK_CODES.has(issue.code))
}

function validationIssuesExcludingRepairablePublicAnswerLeak(
  report: ReturnType<typeof validateCodeLabDraftStructure>,
): string[] {
  return validationIssueStrings({
    issues: report.issues.filter((issue) =>
      !REPAIRABLE_STARTER_LEAK_CODES.has(issue.code)
      && !isTrustedExpectedDerivationIssue(issue.code)),
  })
}

function validateCodeLabPublicSafetyPatchShape(
  prior: CodeLabPublicPayload,
  patch: CodeLabPublicSafetyRepairPatch,
): string[] {
  const issues: string[] = []
  const expected = prior.instructions.length
  if (patch.instruction_texts.length !== expected) {
    issues.push(`instruction_texts 数量应为 ${expected}`)
  }
  if (patch.public_test_descriptions.length !== prior.public_tests.length) {
    issues.push(`public_test_descriptions 数量应为 ${prior.public_tests.length}`)
  }
  if (patch.public_test_expected_behaviors.length !== prior.public_tests.length) {
    issues.push(`public_test_expected_behaviors 数量应为 ${prior.public_tests.length}`)
  }
  if (patch.hint_texts.length !== prior.hint_ladders.length) {
    issues.push(`hint_texts 数量应为 ${prior.hint_ladders.length}`)
  }
  patch.hint_texts.forEach((hints, index) => {
    if (hints.length !== 3) issues.push(`hint_texts[${index}] 必须恰好包含三条提示`)
  })
  return issues
}

export function applyCodeLabPublicSafetyPatch(
  prior: CodeLabPublicPayload,
  patch: CodeLabPublicSafetyRepairPatch,
): CodeLabPublicPayload {
  return {
    ...structuredClone(prior),
    starter_code: patch.starter_code,
    instructions: prior.instructions.map((block, index) => {
      const claims = "claims" in block ? structuredClone(block.claims) : []
      const evidenceAnchor = claims.map((claim) => claim.text).join("；")
      return {
        block_id: block.block_id,
        block_type: "paragraph" as const,
        text: `${patch.instruction_texts[index]!.trim()}${evidenceAnchor
          ? `\n证据事实：${evidenceAnchor}`
          : ""}`,
        claims,
      }
    }),
    public_tests: prior.public_tests.map((test, index) => ({
      ...structuredClone(test),
      description: patch.public_test_descriptions[index]!.trim(),
      expected_behavior: patch.public_test_expected_behaviors[index]!.trim(),
    })),
    hint_ladders: prior.hint_ladders.map((ladder, index) => ({
      ...structuredClone(ladder),
      hints: ladder.hints.map((hint, hintIndex) => ({
        ...structuredClone(hint),
        text: patch.hint_texts[index]![hintIndex]!.trim(),
      })),
    })),
    reflection_questions: patch.reflection_questions.map((question) =>
      question.trim()),
  }
}

export function shouldUseDeterministicPublicSafetyRepair(issueCodes: string[]): boolean {
  return issueCodes.some((code) => REPAIRABLE_STARTER_LEAK_CODES.has(code))
}

export function conservativeAssessmentPublicSafetyRepair(
  prior: AssessmentPublicPayload,
): AssessmentPublicPayload {
  const repaired = structuredClone(prior)
  repaired.items = repaired.items.map((item) => {
    if (item.modality !== "code") return item
    return {
      ...item,
      prompt: "根据题目要求完成函数中的 TODO 部分，保持给定函数名、参数和返回值形式。不要打印答案，返回可 JSON 序列化的结果。",
      starter_code: deterministicAssessmentStarterRepair(item.starter_code),
    }
  })
  return repaired
}

export function conservativeCodeLabPublicSafetyPatch(
  prior: CodeLabPublicPayload,
): CodeLabPublicSafetyRepairPatch {
  return {
    starter_code: minimalSafeStarter(
      prior.starter_code,
      prior.execution_contract,
    ),
    instruction_texts: prior.instructions.map((_, index) =>
      `按执行合同完成第 ${index + 1} 个目标，保持规定的输入与输出形式，核心实现由学习者补全。`),
    public_test_descriptions: prior.public_tests.map((_, index) =>
      `公开测试 ${index + 1}：检查实现是否满足题目的可观察行为。`),
    public_test_expected_behaviors: prior.public_tests.map(() =>
      "结果应符合执行合同和题目中的输出约束。"),
    hint_texts: prior.hint_ladders.map(() => [
      "先明确输入、输出和需要处理的步骤。",
      "选择合适的控制结构，将核心处理保留在 TODO 位置。",
      "逐项对照公开测试检查边界、顺序和返回形式。",
    ]),
    reflection_questions: prior.reflection_questions.map(() =>
      "你的实现如何满足输入、输出和边界约束？"),
  }
}

export function normalizeCodeLabPublicAuthorPayload(
  payload: CodeLabPublicAuthorPayload,
): CodeLabPublicAuthorPayload {
  // Authoring validation must see unsafe or undeclared imports so the model can
  // rewrite the actual starter. Silently replacing it with a one-line TODO
  // produces a schema-valid but instructionally unusable lab.
  return structuredClone(payload)
}

function minimalSafeStarter(
  priorStarter: string,
  contract: CodeLabPublicPayload["execution_contract"],
): string {
  const entryPoint = contract.entry_point?.trim()
  const signature = entryPoint
    ? priorStarter.split(/\r?\n/).find((line) =>
        new RegExp(`^\\s*(?:async\\s+)?def\\s+${escapeRegExp(entryPoint)}\\s*\\(`).test(line))
    : undefined
  return contract.execution_mode === "function"
    ? `${signature?.trim() ?? `def ${entryPoint || "solution"}(*args, **kwargs):`}\n    raise NotImplementedError("TODO")\n`
    : "raise NotImplementedError(\"TODO\")\n"
}

function normalizeCodeLabSecureAuthorPayload(
  payload: CodeLabSecureAuthorPayload,
  contract: CodeLabPublicPayload["execution_contract"],
): CodeLabSecureAuthorPayload {
  const normalized = structuredClone(payload)
  if (contract.execution_mode === "function") {
    normalized.reference_solution = normalizeFunctionReturnSemantics(
      normalized.reference_solution,
    )
    normalized.hidden_tests.forEach((test) => {
      test.input = normalizeEmptyFunctionInvocation(test.input)
    })
    normalized.reference_solution = ensureZeroArgumentEntryPoint(
      normalized.reference_solution,
      contract.entry_point,
      normalized.hidden_tests.map((test) => test.input),
    )
  } else {
    normalized.reference_solution = ensureZeroArgumentFunctionIsInvoked(
      normalized.reference_solution,
    )
    normalizePrintedStdoutExpectations(
      normalized.reference_solution,
      normalized.hidden_tests,
    )
  }
  return normalized
}

function normalizeAssessmentSecureAuthorPayload(
  payload: AssessmentSecureAuthorPayload,
  publicPayload: AssessmentPublicPayload,
): AssessmentSecureAuthorPayload {
  const normalized = structuredClone(payload)
  normalized.items.forEach((item, index) => {
    const modality = publicPayload.items[index]?.modality
    if (modality === "mcq" || modality === "true_false" || modality === "code") {
      item.answer_spec = null
    }
    if (modality !== "mcq" && modality !== "true_false") {
      item.correct_option_id = null
      item.misconception_by_option = {}
    }
  })
  normalized.code_test_suites.forEach((suite) => {
    if (suite.execution_contract.execution_mode === "function") {
      suite.reference_solution = normalizeFunctionReturnSemantics(
        suite.reference_solution,
      )
      suite.hidden_tests.forEach((test) => {
        test.input = normalizeEmptyFunctionInvocation(test.input)
      })
      suite.reference_solution = ensureZeroArgumentEntryPoint(
        suite.reference_solution,
        suite.execution_contract.entry_point,
        suite.hidden_tests.map((test) => test.input),
      )
    } else {
      suite.reference_solution = ensureZeroArgumentFunctionIsInvoked(
        suite.reference_solution,
      )
      normalizePrintedStdoutExpectations(
        suite.reference_solution,
        suite.hidden_tests,
      )
    }
  })
  return normalized
}

function ensureZeroArgumentEntryPoint(
  source: string,
  entryPoint: string | undefined,
  inputs: unknown[],
): string {
  if (!entryPoint || new RegExp(
    `^\\s*def\\s+${escapeRegExp(entryPoint)}\\s*\\(`,
    "mu",
  ).test(source)) return source
  if (!inputs.every(isEmptyFunctionInvocation)) return source
  const lines = source.trim().split(/\r?\n/)
  if (lines.length === 0 || lines.some((line) => /^\s*(?:class|def)\s+/u.test(line))) {
    return source
  }
  let returnExpression: string | undefined
  let lastMeaningfulIndex = -1
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]!
    if (line.trim() !== "" && !line.trimStart().startsWith("#")) {
      lastMeaningfulIndex = index
      break
    }
  }
  const lastLine = lines[lastMeaningfulIndex]?.trim()
  const printed = lastLine?.match(/^print\((.*)\)$/u)
  const returned = lastLine?.match(/^return\s+(.+)$/u)
  if (printed || returned) {
    returnExpression = (printed ?? returned)![1]!.trim()
    lines.splice(lastMeaningfulIndex, 1)
  } else {
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const assigned = lines[index]!.trim().match(
        /^([A-Za-z_][A-Za-z0-9_]*)\s*(?:[+\-*/%]?=)(?!=)/u,
      )
      if (assigned) {
        returnExpression = assigned[1]
        break
      }
    }
  }
  if (!returnExpression) return source
  const body = lines
    .filter((line, index) => index <= lastMeaningfulIndex || line.trim() !== "")
    .map((line) => `    ${line}`)
  body.push(`    return ${returnExpression}`)
  return `def ${entryPoint}():\n${body.join("\n")}\n`
}

function isEmptyFunctionInvocation(input: unknown): boolean {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false
  const envelope = input as { args?: unknown[]; kwargs?: Record<string, unknown> }
  return Array.isArray(envelope.args)
    && envelope.args.length === 0
    && Object.keys(envelope.kwargs ?? {}).length === 0
}

function normalizeCodeLabExecutionRepairPatch(
  patch: CodeLabExecutionRepairPatch,
  prior: CodeLabSecurePayload,
  contract: CodeLabPublicPayload["execution_contract"],
): CodeLabExecutionRepairPatch {
  const normalized = structuredClone(patch)
  const effectiveInputs = new Map(prior.hidden_tests.map((test) => [
    test.test_id,
    structuredClone(test.input),
  ]))
  normalized.hidden_test_repairs.forEach((test) => {
    test.comparison = canonicalizeTestComparison(test.comparison as unknown, test.expected)
    if (test.comparison.kind === "numeric" && typeof test.expected === "string") {
      const coerced = Number(test.expected.trim())
      if (Number.isFinite(coerced)) test.expected = coerced
    }
    const input = contract.execution_mode === "function"
      ? normalizeEmptyFunctionInvocation(test.input)
      : asStandardInput(test.input)
    test.input = input
    effectiveInputs.set(test.test_id, structuredClone(input))
  })
  if (normalized.reference_solution !== null) {
    if (contract.execution_mode === "function") {
      normalized.reference_solution = ensureZeroArgumentEntryPoint(
        normalizeFunctionReturnSemantics(normalized.reference_solution),
        contract.entry_point,
        [...effectiveInputs.values()],
      )
    } else {
      normalized.reference_solution = ensureZeroArgumentFunctionIsInvoked(
        normalized.reference_solution,
      )
      normalizePrintedStdoutExpectations(
        normalized.reference_solution,
        normalized.hidden_test_repairs,
      )
    }
  }
  return normalized
}

function stdoutSafeStarter(
  priorStarter: string,
  entryPoint: string | undefined,
): string {
  if (!entryPoint) {
    return "# TODO: 读取输入、完成计算，并按题目要求输出结果。\n"
  }
  const signature = priorStarter.split(/\r?\n/).find((line) =>
    new RegExp(`^\\s*def\\s+${escapeRegExp(entryPoint)}\\s*\\(\\s*\\)`).test(line))
  if (!signature) {
    return "# TODO: 读取输入、完成计算，并按题目要求输出结果。\n"
  }
  return `${signature.trim()}\n    raise NotImplementedError("TODO")\n\n${entryPoint}()\n`
}

function ensureZeroArgumentFunctionIsInvoked(source: string): string {
  const definition = source.match(/^def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*\)\s*:/mu)
  if (!definition) return source
  const functionName = definition[1]!
  const topLevelInvocation = new RegExp(
    `^${escapeRegExp(functionName)}\\s*\\(`,
    "mu",
  )
  const topLevelPrintedInvocation = new RegExp(
    `^print\\s*\\(\\s*${escapeRegExp(functionName)}\\s*\\(`,
    "mu",
  )
  if (topLevelInvocation.test(source) || topLevelPrintedInvocation.test(source)) {
    return source
  }
  const invocation = /(?:^|\n)[ \t]+print\s*\(/u.test(source)
    ? `${functionName}()`
    : `print(${functionName}())`
  return `${source.trimEnd()}\n\n${invocation}\n`
}

function normalizeFunctionReturnSemantics(source: string): string {
  return source.replace(
    /^([ \t]+)print\((.*)\)\s*$/gmu,
    (_line, indentation: string, expression: string) =>
      `${indentation}return ${expression}`,
  )
}

function normalizePrintedStdoutExpectations(
  referenceSolution: string,
  tests: Array<{ expected: unknown; comparison: { kind: string } }>,
): void {
  const defaultPrint = /\bprint\s*\((?![^\n)]*\bend\s*=)/u.test(referenceSolution)
  if (!defaultPrint) return
  tests.forEach((test) => {
    if (test.comparison.kind === "exact"
      && typeof test.expected === "string"
      && !test.expected.endsWith("\n")) {
      test.expected = `${test.expected}\n`
    }
  })
}

function normalizeEmptyFunctionInvocation(input: unknown): unknown {
  return input
    && typeof input === "object"
    && !Array.isArray(input)
    && Object.keys(input as Record<string, unknown>).length === 0
    ? { args: [], kwargs: {} }
    : input
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function fragment(file: RoleCSchemaFile, pointer: string): Record<string, unknown> {
  return getRoleCModelOutputSchemaFragment(file, pointer)
}

function codeLabExecutionRepairSchema(
  prior: CodeLabSecurePayload,
  feedback: CodeLabVerificationFeedback,
): Record<string, unknown> {
  const schema = structuredClone(fragment(
    "code_lab_draft.schema.json",
    "/$defs/execution_repair_patch",
  ))
  const properties = asRecord(schema.properties)
  const hiddenRepairs = asRecord(properties.hidden_test_repairs)
  const item = asRecord(hiddenRepairs.items)
  const itemProperties = asRecord(item.properties)
  const failedIds = trustedReferenceFailureTestIds(feedback)
  const allowedIds = failedIds.size > 0
    ? [...failedIds]
    : prior.hidden_tests.map((test) => test.test_id)
  itemProperties.test_id = { type: "string", enum: allowedIds }
  item.properties = itemProperties
  item.additionalProperties = false
  hiddenRepairs.items = item
  properties.hidden_test_repairs = hiddenRepairs
  schema.properties = properties
  schema.additionalProperties = false
  if (trustedReferenceFailed(feedback)) {
    schema.anyOf = [
      {
        properties: {
          reference_solution: { type: "string", minLength: 1, maxLength: 20_000 },
        },
        required: ["reference_solution"],
      },
      {
        properties: {
          hidden_test_repairs: { type: "array", minItems: 1 },
        },
        required: ["hidden_test_repairs"],
      },
    ]
  }
  return schema
}

function validateCodeLabExecutionRepairProgress(
  prior: CodeLabSecurePayload,
  candidate: CodeLabSecurePayload,
  feedback: CodeLabVerificationFeedback,
): string[] {
  const issues: string[] = []
  if (trustedReferenceFailed(feedback)) {
    const failedTestIds = trustedReferenceFailureTestIds(feedback)
    const referenceChanged = contentHash(prior.reference_solution)
      !== contentHash(candidate.reference_solution)
    const testsChanged = relevantHiddenTestsChanged(
      prior,
      candidate,
      failedTestIds,
    )
    if (!referenceChanged && !testsChanged) {
      const referenceFailureCodes = expectedOnlyReferenceFailureCodes(feedback)
      const suffix = referenceFailureCodes.length > 0
        ? `；reference_failure_kinds=${referenceFailureCodes.map(referenceFailureKind).join("|")}；reference_failure_shapes=${referenceFailureCodes.map(referenceFailureShape).join("|")}`
        : ""
      issues.push(`参考实现未通过隐藏测试，修订稿却未改变参考源码或相应隐藏测试${suffix}`)
    }
  }
  return issues
}

function validateCodeLabExecutionRepairPatch(
  prior: CodeLabSecurePayload,
  patch: CodeLabExecutionRepairPatch,
  feedback: CodeLabVerificationFeedback,
): string[] {
  const issues: string[] = []
  const priorTestIds = new Set(prior.hidden_tests.map((entry) => entry.test_id))
  const seenTests = new Set<string>()
  for (const entry of patch.hidden_test_repairs) {
    if (seenTests.has(entry.test_id)) issues.push(`隐藏测试补丁重复：${entry.test_id}`)
    seenTests.add(entry.test_id)
    if (!priorTestIds.has(entry.test_id)) issues.push(`隐藏测试补丁引用未知 test_id：${entry.test_id}`)
  }
  if (patch.mutation_repairs.length > 0) {
    issues.push("mutation 是可选质量诊断，不进入可信执行修订")
  }

  if (trustedReferenceFailed(feedback)) {
    const failedTestIds = trustedReferenceFailureTestIds(feedback)
    const touchesFailedTest = patch.hidden_test_repairs.some((entry) =>
      failedTestIds.size === 0 || failedTestIds.has(entry.test_id))
    if (patch.reference_solution === null && !touchesFailedTest) {
      issues.push("参考实现失败时必须修订参考源码或实际失败的隐藏测试")
    }
    if (failedTestIds.size > 0) {
      for (const entry of patch.hidden_test_repairs) {
        if (!failedTestIds.has(entry.test_id)
          && feedback.starter_status !== "passed") {
          issues.push(`参考实现修订不得改写无关隐藏测试：${entry.test_id}`)
        }
      }
    }
  }
  if (patch.reference_solution === null
    && patch.hidden_test_repairs.length === 0
    && patch.mutation_repairs.length === 0) {
    issues.push("可信执行修订补丁为空")
  }
  return issues
}

function trustedReferenceFailed(feedback: CodeLabVerificationFeedback): boolean {
  return feedback.reference_failed
    ?? feedback.issues.some((entry) => entry.includes("reference_solution 未通过"))
}

function assessmentExpectedOnlyReferenceFailureCodes(feedback: AssessmentVerificationFeedback): string[] {
  return feedback.issues.flatMap((entry) => {
    const marker = "未通过全部隐藏测试："
    const markerIndex = entry.indexOf(marker)
    return markerIndex >= 0
      ? entry.slice(markerIndex + marker.length).split(/、/).map((part) => part.trim()).filter(Boolean)
      : []
  })
}

function patchAssessmentExpectedFromReferenceFailures(
  securePayload: AssessmentSecurePayload,
  failureCodes: string[],
): AssessmentSecurePayload {
  const patched = structuredClone(securePayload)
  const tests = new Map(patched.code_test_suites.flatMap((suite) =>
    suite.hidden_tests.map((test) => [test.test_id, test] as const),
  ))
  for (const code of failureCodes) {
    const prefix = ":assertion_failed:expected="
    const prefixIndex = code.indexOf(prefix)
    const actualMarker = ":actual="
    const actualIndex = code.indexOf(actualMarker, prefixIndex + prefix.length)
    if (prefixIndex <= 0 || actualIndex < 0) continue
    const testId = code.slice(0, prefixIndex)
    const target = tests.get(testId)
    if (!target) continue
    try {
      target.expected = JSON.parse(code.slice(actualIndex + actualMarker.length))
      target.comparison = canonicalizeTestComparison(target.comparison, target.expected)
    } catch {
      // Keep the original expected value if the trusted runner did not emit JSON.
    }
  }
  return patched
}

export function referenceFailureKind(code: string): string {
  if (code.startsWith("static:")) return "static_policy"
  const separator = code.indexOf(":")
  if (separator <= 0) return topLevelReferenceFailureKind(code)
  const reason = code.slice(separator + 1)
  if (reason.startsWith("static:") || reason === "static_policy") return "static_policy"
  if (reason.includes("assertion_failed")) return "assertion_failed"
  if (reason.includes("runtime_")) return "runtime_error"
  if (reason.includes("syntax_error")) return "syntax_error"
  if (reason.includes("output_limit")) return "output_limit"
  if (reason.includes("non_json_output")) return "non_json_output"
  if (reason.includes("timeout")) return "timeout"
  if (reason.includes("runner_error")) return "runner_error"
  return "other"
}

export function referenceFailureShape(code: string): string {
  if (code.startsWith("static:")) return `static_${code.slice("static:".length) || "policy"}`
  const separator = code.indexOf(":")
  if (separator <= 0) return topLevelReferenceFailureKind(code)
  const rest = code.slice(separator + 1)
  if (rest === "static_policy") return "static_policy"
  if (rest.startsWith("static:")) return `static_${rest.slice("static:".length) || "policy"}`
  if (rest.includes("assertion_failed")) return rest.includes("expected=") && rest.includes("actual=") ? "assertion_diff" : "assertion_tag_only"
  if (rest.includes("runtime_")) return "runtime_error"
  if (rest.includes("syntax_error")) return "syntax_error"
  if (rest.includes("output_limit")) return "output_limit"
  if (rest.includes("non_json_output")) return "non_json_output"
  if (rest.includes("timeout")) return "timeout"
  if (rest.includes("runner_error")) return "runner_error"
  return "other"
}

function topLevelReferenceFailureKind(code: string): string {
  if (code.startsWith("static:")) return "static_policy"
  if (code === "execution_timeout") return "timeout"
  if (code === "resource_limit_exceeded") return "resource_limit"
  if (code.includes("output_truncated") || code.includes("output_limit")) return "output_limit"
  if (code.includes("invalid_runner")
    || code.includes("runner_")
    || code.includes("docker_")
    || code.includes("test_suite_unavailable")) {
    return "runner_error"
  }
  return "other"
}

function trustedReferenceFailureTestIds(
  feedback: CodeLabVerificationFeedback,
): Set<string> {
  const failureCodes = feedback.reference_failure_codes
    ?? feedback.issues.flatMap((entry) => {
      if (!entry.includes("reference_solution 未通过")) return []
      const separator = entry.indexOf("：")
      return separator >= 0 ? entry.slice(separator + 1).split(/、/).map((part) => part.trim()).filter(Boolean) : []
    })
  return new Set(failureCodes.flatMap((entry) => {
    const separator = entry.indexOf(":")
    if (separator <= 0) return []
    return [entry.slice(0, separator)]
  }))
}

function relevantHiddenTestsChanged(
  prior: CodeLabSecurePayload,
  candidate: CodeLabSecurePayload,
  selectedIds: Set<string>,
): boolean {
  const candidateById = new Map(candidate.hidden_tests.map((entry) => [entry.test_id, entry]))
  return prior.hidden_tests.some((before) => {
    if (selectedIds.size > 0 && !selectedIds.has(before.test_id)) return false
    const after = candidateById.get(before.test_id)
    return Boolean(after && contentHash({
      input: before.input,
      expected: before.expected,
      comparison: before.comparison,
    }) !== contentHash({
      input: after.input,
      expected: after.expected,
      comparison: after.comparison,
    }))
  })
}

export function validationIssueStrings(report: { issues: Array<{ code?: string; path: string; message: string }> }): string[] {
  return report.issues.map((entry) => `${entry.code ? `[${entry.code}] ` : ""}${entry.path}: ${entry.message}`)
}

export function validateStageRepairProgress<T>(
  previous: T | undefined,
  current: T,
  previousIssues?: string[],
  currentIssues?: string[],
): string[] {
  if (previous === undefined) return []
  const identical = contentHash(previous) === contentHash(current)
  if (identical) {
    return ["[NO_REPAIR_PROGRESS] staged repair output is identical to the previous attempt"]
  }
  // 内容变了但问题集未单调减少 → 同样视为无进展（换汤不换药）。
  if (previousIssues && currentIssues) {
    const prevSet = new Set(previousIssues)
    const currSet = new Set(currentIssues)
    const resolved = [...prevSet].filter((issue) => !currSet.has(issue))
    const introduced = [...currSet].filter((issue) => !prevSet.has(issue))
    if (resolved.length === 0 && introduced.length === 0) {
      return ["[NO_REPAIR_PROGRESS] staged repair changed output but did not reduce any validation issue"]
    }
    if (resolved.length === 0 && introduced.length > 0) {
      return ["[NO_REPAIR_PROGRESS] staged repair resolved nothing and introduced new validation issues"]
    }
  }
  return []
}
function validationIssues(report: { issues: Array<{ code?: string; path: string; message: string }> }): string[] {
  return validationIssueStrings(report)
}

function boundedRepairs(
  configured: 0 | 1 | 2,
  request: ConceptTutorRequest | CodeLabRequest,
): number {
  return Math.min(configured, request.generation_spec.policies.max_semantic_revision)
}

function repairable(error: unknown, attempt: number, maxRepairs: number): boolean {
  return attempt < maxRepairs
    && error instanceof ModelGatewayError
    && ["INVALID_JSON", "INVALID_RESPONSE"].includes(error.code)
}

function idempotencyKey(value: unknown): string {
  return `IDEMP-${contentHash(value).slice("sha256:".length)}`
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const selected = value ?? fallback
  if (!Number.isSafeInteger(selected) || selected < 1) throw new Error(`${name} 必须是正整数`)
  return selected
}

function stageTokenCeiling(task: string, configured: number): number {
  if (task.includes("concept-tutor")) return Math.max(configured, 16_000)
  if (task.includes("assessment.public")) return Math.max(configured, 24_000)
  if (task.includes("assessment.secure")) return Math.max(configured, 16_000)
  if (task.includes("code-lab")) return Math.max(configured, 16_000)
  return Math.max(configured, 16_000)
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : { stage_input: value }
}

function assertVersionCompatibility(
  request: ConceptTutorRequest | CodeLabRequest,
  gateway: ModelGateway,
  promptVersion = CONCEPT_TUTOR_PROMPT_VERSION,
): void {
  if (request.generation_spec.versions.prompt_version !== promptVersion) {
    throw new ModelProviderUnavailableError(
      `GenerationSpec prompt_version=${request.generation_spec.versions.prompt_version}，当前 Provider 要求 ${promptVersion}`,
    )
  }
  if (request.generation_spec.versions.model_config_hash !== gateway.model_config_hash) {
    throw new ModelProviderUnavailableError(
      "GenerationSpec.model_config_hash 与当前 ModelGateway 不一致，请重新构建 Spec",
    )
  }
}
