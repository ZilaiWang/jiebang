import { projectAssessmentTask } from "../contracts/artifact-task"
import { applyPublicFileFixtures, publicLabInputCases } from "../security/public-lab-inputs"
import { conceptOwnedTeachingContract } from "../planning/teaching-unit-contract"
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
  CODE_LAB_REFERENCE_STAGE_SYSTEM_PROMPT,
  CODE_LAB_TEST_INPUT_STAGE_SYSTEM_PROMPT,
  CODE_LAB_EXECUTION_REPAIR_SYSTEM_PROMPT,
  CODE_LAB_PUBLIC_SAFETY_REPAIR_SYSTEM_PROMPT,
  CODE_LAB_STARTER_REPAIR_SYSTEM_PROMPT,
  CONCEPT_SEGMENT_SYSTEM_PROMPT_V2,
  STAGED_AUTHOR_PROMPT_VERSION,
  ROLE_C_PROMPT_MANIFEST_VERSION,
  stagedRepairPrompt,
} from "../prompts"
import { isTrustedExpectedDerivationIssue, validateCodeLabDraftStructure, validateCodeLabPublicStage } from "../validators/code-lab-validator"
import { validateAssessmentDraftStructure, validateAssessmentPublicStage } from "../validators/assessment-validator"
import { validateConceptLesson } from "../validators/concept-validator"
import {
  buildConceptSectionPlansForSegment,
  materializeConceptSegmentV2,
  anchorConceptFactsInVisibleText,
  validateConceptSegmentV2AgainstPlans,
  validateConceptMicroCheckEvidenceDiscipline,
  validateConceptVisibleFactCoverage,
  type ConceptSegmentAuthorPayloadV2,
} from "../planning/concept-section-plan"
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
  materializeAssessmentSecureAuthorPayload,
  materializeAssessmentPublicAuthorPayload,
  projectAssessmentPublicAuthorPayload,
  materializeCodeLabPublicAuthorPayload,
  materializeCodeLabSecureAuthorPayload,
  materializeRecallFactSecureAuthorPayload,
  mapWithConcurrency,
  mergeConceptSegments,
  canonicalizeTestComparison,
  classifyOutputContract,
  asStandardInput,
  normalizeAssessmentPair,
  expectedOnlyReferenceFailureCodes,
  isExpectedOnlyReferenceFailure,
  normalizeCodeLabSecure,
  patchExpectedFromReferenceFailures,
  normalizeCodeLabSecureAuthorPayloadLenient,
  normalizeConceptSegment,
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
  deriveCodeLabExecutionMode,
  freezeCodeLabExecutionContract,
  normalizePracticalGuideLearnerVocabulary,
  type CodeLabExecutionRepairPatch,
  type CodeLabObjectivePlan,
  type CodeLabPublicAuthorPayload,
  type CodeLabSecureAuthorPayload,
  type CodeLabReferenceAuthorPayload,
  type CodeLabTestInputsAuthorPayload,
  type AssessmentSecureAuthorPayload,
  type AssessmentPublicAuthorPayload,
  type AssessmentItemPlan,
} from "./staged-generation"
import { fastModelPolicy } from "../../model-runtime"
import { buildLearningDesignSpecV2 } from "../planning/learning-design-spec-v2"
import type { PracticalGuidePlan } from "../planning/practical-guide-plan"
import { runPublicCandidateTournament } from "../quality/candidate-tournament"
import {
  candidateIdentity,
  evaluatePublicAuthorCandidate,
} from "../quality/public-candidate-quality"
import type { CandidateSelectionResult, PublicArtifactKind, PublicCandidateEvaluation } from "../quality/contracts"
import { reviewPublicCandidatesWithModel } from "../quality/model-candidate-critic"
import {
  type AssessmentEvidenceFactView,
  validateAssessmentAuthorEvidenceDiscipline,
  validateAssessmentPairValidity,
  validateAssessmentPublicValidity,
} from "../quality/assessment-validity"
import { validateInputCandidates } from "../programming/test-plan"
import type { ProgrammingProblemBlueprint } from "../programming/contracts"

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
  /** Public semantic alternatives; secure answers/reference solutions always remain one candidate. */
  public_candidate_count?: 1 | 2 | 3
  candidate_selection_sink?: (input: {
    task: string
    winner_candidate_id: string
    evaluations: PublicCandidateEvaluation[]
    rejected_generation_count: number
  }) => void | Promise<void>
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
  normalize_output?: (value: T) => T
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

/**
 * Multiple-choice items have a closed, evidence-bounded answer surface. The model still
 * authors the stem, context and task structure; the two answer surfaces are
 * projected from the cited facts as one faithful statement and one direct
 * negation. This prevents valid content from depending on free paraphrase and
 * prevents invented APIs, mechanisms or domains from becoming distractors.
 */
export function normalizeEvidenceBoundedAssessmentChoices(
  authored: AssessmentPublicAuthorPayload,
  _plan: AssessmentItemPlan[],
  _evidence: AssessmentEvidenceFactView[],
): AssessmentPublicAuthorPayload {
  const normalized = structuredClone(authored)
  // Preserve the AI-authored task-specific contrast. Earlier versions replaced
  // every MCQ with a verbatim fact and the same sentence prefixed by “不”;
  // that leaked the answer and removed all discrimination. Evidence closure is
  // enforced by deterministic vocabulary/scope checks plus independent model
  // review and the final semantic release audit.
  normalized.items.forEach((item) => {
    if (Array.isArray(item.options)) item.options = item.options.map((option) => typeof option === "string" ? option.trim() : option)
  })
  return normalized
}

function projectCodeLabPublicModelInput(
  input: ReturnType<typeof buildCodeLabModelInput>,
  plan: CodeLabObjectivePlan[],
): ReturnType<typeof buildCodeLabModelInput> {
  const allowedByObjective = new Map(plan.map((entry) => [
    entry.objective_id,
    new Set(entry.citations.map((citation) => `${citation.source_id}:${citation.fact_id}`)),
  ]))
  const allowedKeys = new Set([...allowedByObjective.values()].flatMap((set) => [...set]))
  const allowedForObjective = (objectiveId: string, sourceId: string, factId: string) =>
    allowedByObjective.get(objectiveId)?.has(`${sourceId}:${factId}`) ?? false
  const projected = structuredClone(input)
  projected.contract.targets = projected.contract.targets.map((target) => ({
    ...target,
    required_fact_ids: target.required_fact_ids.filter((factId) =>
      allowedForObjective(target.objective_id, target.source_id, factId)),
  }))
  projected.evidence = projected.evidence.flatMap((source) => {
    const facts = source.facts.filter((fact) =>
      allowedKeys.has(`${source.source_id}:${fact.fact_id}`))
    return facts.length > 0 ? [{ ...source, facts }] : []
  })
  projected.concept.objective_summaries = projected.concept.objective_summaries.map((summary) => ({
    ...summary,
    // A summary text may combine several lesson slots.  Keep only its exact
    // citations; the lab author writes against the projected evidence facts.
    texts: [],
    citations: summary.citations.filter((citation) =>
      allowedForObjective(summary.objective_id, citation.source_id, citation.fact_id)),
  }))
  projected.concept.misconceptions = projected.concept.misconceptions.filter((entry) =>
    entry.citations.length === 0 || entry.citations.some((citation) =>
      allowedForObjective(entry.objective_id, citation.source_id, citation.fact_id)))
  if (projected.upstream.resource_blueprint) {
    projected.upstream.resource_blueprint.objectives = projected.upstream.resource_blueprint.objectives.map((objective) => ({
      ...objective,
      required_fact_ids: objective.required_fact_ids.filter((factId) =>
        allowedForObjective(objective.objective_id, objective.source_id, factId)),
    }))
  }
  return projected
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
  private readonly publicCandidateCount: 1 | 2 | 3
  private readonly candidateSelectionSink?: ModelBackedProviderOptions["candidate_selection_sink"]
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
    this.publicCandidateCount = candidateCount(options.public_candidate_count)
    this.candidateSelectionSink = options.candidate_selection_sink
    this.stageFailureDiagnosticSink = options.stage_failure_diagnostic_sink
  }

  async generateConceptLesson(
    request: ConceptTutorRequest,
  ): Promise<ArtifactDraft<ConceptLessonPayload>> {
    assertVersionCompatibility(request, this.gateway)
    assertGenerationSpecProviderInput(request.generation_spec)
    if (this.generationStrategy === "monolithic") return this.generateConceptLessonMonolithic(request)

    const maxRepairs = boundedRepairs(this.maxRepairAttempts, request)
    const segments = splitConceptRequest(request, this.conceptGroupSize)
    const payloads = await mapWithConcurrency(segments, this.conceptConcurrency, async (segment) => {
      const modelInput = buildConceptTutorModelInput(segment)
      const sectionPlans = buildConceptSectionPlansForSegment(segment)
      const sectionPlanContract = sectionPlans.map((plan) => ({
        objective_id: plan.objective_id,
        mode: plan.mode,
        terminology: plan.terminology,
        slots: plan.slots,
        micro_check: plan.micro_check,
        ...(plan.teaching_unit_contract
          ? { teaching_unit_contract: conceptOwnedTeachingContract(plan.teaching_unit_contract) }
          : {}),
      }))
      const materialize = (payload: ConceptSegmentAuthorPayloadV2) =>
        normalizeConceptSegment(
          segment,
          materializeConceptSegmentV2(segment, payload, sectionPlans),
        )
      const learningDesign = buildLearningDesignSpecV2({
        spec: segment.generation_spec,
        evidence: segment.evidence_pack,
        assessment_plan: segment.generation_spec.assessment_blueprint
          ? buildAssessmentItemPlan(segment.generation_spec, segment.evidence_pack)
          : [],
      })
      const tournament = await runPublicCandidateTournament<ConceptSegmentAuthorPayloadV2>({
        candidate_count: this.publicCandidateCount,
        generate: (variantIndex) => this.generateStage<ConceptSegmentAuthorPayloadV2>({
          task: "role-c.concept-tutor.segment-v2",
          system_prompt: CONCEPT_SEGMENT_SYSTEM_PROMPT_V2,
          input: {
            ...modelInput,
            // Prerequisite bridges are materialized separately with their own
            // citations. Section authors only own the current target sources.
            evidence: modelInput.evidence.filter(source => segment.generation_spec.targets.some(target => target.source_id === source.source_id)),
            author_scope: { prerequisite_bridge: "materialized_by_program" },
            upstream: { ...modelInput.upstream, round_semantic_plan: undefined },
            learning_design: learningDesign,
            candidate_context: publicCandidateContext("concept_lesson", variantIndex),
            staged_contract: {
              objective_ids: segment.generation_spec.targets.map((target) => target.objective_id),
              section_plan: sectionPlanContract,
            },
            segment: {
              index: segment.segment_index,
              count: segment.segment_count,
              objective_ids: segment.generation_spec.targets.map((target) => target.objective_id),
            },
          },
          output_schema_id: "role_c_concept_segment_author_payload_v2",
          output_schema: fragment(
            "concept_lesson_payload.schema.json",
            "/$defs/author_payload_v2",
          ),
          temperature: Math.max(this.conceptTemperature, 0.3),
          max_tokens: this.conceptSegmentMaxTokens,
          idempotency_identity: {
            spec_id: segment.generation_spec.spec_id,
            evidence_ref: segment.generation_spec.evidence_ref,
            prompt_version: STAGED_AUTHOR_PROMPT_VERSION,
            model_config_hash: this.gateway.model_config_hash,
            seed: segment.generation_spec.policies.seed,
            variant_index: variantIndex,
          },
          max_repairs: maxRepairs,
          normalize_output: (payload) => anchorConceptFactsInVisibleText({
            payload,
            request: segment,
            plans: sectionPlans,
          }),
          diagnostic_sink: this.stageFailureDiagnosticSink,
          validate: (payload) => {
            const schema = validateRoleCSchemaFragment(
              "concept_lesson_payload.schema.json",
              "/$defs/author_payload_v2",
              payload,
            )
            if (!schema.ok) return validationIssues(schema)
            const issues = validateConceptSegmentV2AgainstPlans(payload, sectionPlans)
            if (issues.length > 0) return issues
            const factTextByObjective = new Map(segment.generation_spec.targets.map((target) => {
              const source = segment.evidence_pack.results.find((entry) =>
                entry.source_id === target.source_id)
              const required = new Set(target.required_fact_ids)
              return [target.objective_id, (source?.facts ?? [])
                .filter((fact) => required.has(fact.fact_id))
                .map((fact) => fact.content)] as const
            }))
            const microCheckIssues = validateConceptMicroCheckEvidenceDiscipline(
              payload,
              sectionPlans,
              factTextByObjective,
            )
            if (microCheckIssues.length > 0) return microCheckIssues
            const visibleCoverageIssues = validateConceptVisibleFactCoverage(
              segment,
              payload,
              sectionPlans,
            )
            if (visibleCoverageIssues.length > 0) return visibleCoverageIssues
            return validationIssues(validateConceptLesson({
              payload: materialize(payload),
              spec: segment.generation_spec,
              evidence: segment.evidence_pack,
            }))
          },
        }),
        evaluate: (payload, variantIndex) => evaluatePublicAuthorCandidate({
          candidate_id: candidateIdentity("concept_lesson", payload, variantIndex),
          artifact_kind: "concept_lesson",
          payload,
          learning_design: learningDesign,
          concept_section_plans: sectionPlans,
          expression_context: segment.generation_spec.learner_adaptation.expression_context,
          minimum_score: learningDesign.candidate_policy.minimum_quality_score - 0.07,
        }),
        review: (entries) => reviewPublicCandidatesWithModel({
          gateway: this.gateway,
          task: "role-c.concept-tutor.segment-v2",
          artifact_kind: "concept_lesson",
          candidates: entries,
          evidence: modelInput.evidence,
          contract: {
            targets: modelInput.contract.targets,
            artifact_task: modelInput.contract.artifact_task,
            section_plan: sectionPlanContract,
          },
        }),
        on_rejected: (evaluations, rejectedGenerationCount) => this.recordRejectedCandidates(
          "role-c.concept-tutor.segment-v2", evaluations, rejectedGenerationCount,
        ),
      })
      await this.recordCandidateSelection("role-c.concept-tutor.segment-v2", tournament)
      const authored = tournament.winner
      return materialize(authored)
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
    assertGenerationSpecProviderInput(request.generation_spec)
    if (this.generationStrategy === "monolithic") {
      // monolithic 是兼容/基准路径（非生产入口），不走 staged_contract；
      // 生产入口（content-pipeline / worker-adapters）一律 staged + blueprint。
      return this.generateCodeLabMonolithic(request)
    }

    const modelInput = buildCodeLabModelInput(request)
    const identity = request.resource_blueprint?.code_lab ?? buildLabIdentity(request.generation_spec)
    const objectivePlan = request.resource_blueprint?.code_lab.objective_plan
      ?? buildCodeLabObjectivePlan(request.generation_spec, request.evidence_pack)
    const publicModelInput = projectCodeLabPublicModelInput(modelInput, objectivePlan)
    const maxRepairs = boundedRepairs(this.maxRepairAttempts, request)
    const taskContract = request.resource_blueprint?.code_lab.task_contract
    const practicalGuidePlan = request.resource_blueprint?.code_lab.practical_guide_plan
    const programmingProblem = request.resource_blueprint?.code_lab.programming_problem
    // 执行接口由 planning 层的 CodeLabTaskContract 决定（先设计题，再定判题接口）。
    // 生产路径（content-pipeline / worker-adapters）必须先构建 blueprint 传入契约；
    // deriveCodeLabExecutionMode 仅作为显式标记的兼容 fallback（单测/脚本/旧数据），
    // 不得静默用于生产。
    const executionMode = taskContract?.execution_mode
      ?? deriveCodeLabExecutionMode(request)
    const learningDesign = request.resource_blueprint?.learning_design
      ?? buildLearningDesignSpecV2({
        spec: request.generation_spec,
        evidence: request.evidence_pack,
        assessment_plan: buildAssessmentItemPlan(request.generation_spec, request.evidence_pack),
      })
    const normalizePublicAuthor = (payload: CodeLabPublicAuthorPayload): CodeLabPublicAuthorPayload => {
      const normalized = normalizeCodeLabPublicAuthorPayload(
        payload,
        taskContract,
        practicalGuidePlan,
        programmingProblem,
        objectivePlan,
        request.evidence_pack,
      )
      normalized.execution_contract = freezeCodeLabExecutionContract(
        normalized.execution_contract,
        executionMode,
        taskContract,
      )
      return normalized
    }
    const publicTournament = await runPublicCandidateTournament<CodeLabPublicAuthorPayload>({
      candidate_count: this.publicCandidateCount,
      generate: (variantIndex) => this.generateStage<CodeLabPublicAuthorPayload>({
      task: "role-c.code-lab.public",
      system_prompt: CODE_LAB_PUBLIC_STAGE_SYSTEM_PROMPT,
      input: {
        ...publicModelInput,
        learning_design: learningDesign,
        candidate_context: publicCandidateContext("code_lab", variantIndex),
        staged_contract: {
          lab_id: identity.lab_id,
          objective_ids: request.generation_spec.targets.map((target) => target.objective_id),
          objective_plan: objectivePlan,
          execution_mode: executionMode,
          ...(taskContract ? { task_contract: structuredClone(taskContract) } : {}),
          ...(practicalGuidePlan ? { practical_guide_plan: structuredClone(practicalGuidePlan) } : {}),
          ...(programmingProblem ? { programming_problem: structuredClone(programmingProblem) } : {}),
        },
      },
      output_schema_id: "role_c_code_lab_public_author_payload_v1",
      output_schema: codeLabPublicAuthorSchema(programmingProblem),
      temperature: Math.max(this.codeLabTemperature, 0.2),
      max_tokens: this.codeLabPublicMaxTokens,
      idempotency_identity: {
        spec_id: request.generation_spec.spec_id,
        concept_artifact_id: request.concept_artifact.artifact_id,
        stage: "public",
        prompt_version: STAGED_AUTHOR_PROMPT_VERSION,
        variant_index: variantIndex,
      },
      max_repairs: maxRepairs,
      // Validate, score, review and finally materialize the exact same
      // platform-normalized candidate.  Previously validate() normalized a
      // temporary copy while the tournament ranked and returned the raw model
      // object, which could reintroduce internal vocabulary or malformed
      // learner-facing fields after a successful validation pass.
      normalize_output: normalizePublicAuthor,
      diagnostic_sink: this.stageFailureDiagnosticSink,
      validate: (payload) => {
        const schema = validateRoleCSchemaFragment(
          "code_lab_draft.schema.json",
          "/$defs/public_author_payload",
          payload,
        )
        if (!schema.ok) return validationIssues(schema)
        const planIssues = validateCodeLabPublicAuthorAgainstPlan(
          payload,
          objectivePlan,
          taskContract,
          practicalGuidePlan,
          programmingProblem,
          request.evidence_pack,
        )
        if (planIssues.length > 0) return planIssues
        const normalized = materializeCodeLabPublicAuthorPayload(
          request,
          payload,
          identity.lab_id,
          objectivePlan,
          practicalGuidePlan,
          programmingProblem,
        )
        return validationIssues(validateCodeLabPublicStage(request, normalized))
      },
      }),
      evaluate: (payload, variantIndex) => evaluatePublicAuthorCandidate({
        candidate_id: candidateIdentity("code_lab", payload, variantIndex),
        artifact_kind: "code_lab",
        payload,
        learning_design: learningDesign,
        expression_context: request.generation_spec.learner_adaptation.expression_context,
        minimum_score: learningDesign.candidate_policy.minimum_quality_score - 0.05,
      }),
      review: (entries) => reviewPublicCandidatesWithModel({
        gateway: this.gateway,
        task: "role-c.code-lab.public",
        artifact_kind: "code_lab",
        candidates: entries,
        evidence: publicModelInput.evidence,
        contract: {
          targets: publicModelInput.contract.targets,
          artifact_task: publicModelInput.contract.artifact_task,
          task_contract: taskContract,
          programming_problem: programmingProblem,
          objective_plan: objectivePlan,
        },
      }),
      on_rejected: (evaluations, rejectedGenerationCount) => this.recordRejectedCandidates(
        "role-c.code-lab.public", evaluations, rejectedGenerationCount,
      ),
    })
    await this.recordCandidateSelection("role-c.code-lab.public", publicTournament)
    const publicAuthor = publicTournament.winner
    const normalizedPublicAuthor = publicAuthor
    let normalizedPublic = materializeCodeLabPublicAuthorPayload(
      request,
      normalizedPublicAuthor,
      identity.lab_id,
      objectivePlan,
      practicalGuidePlan,
      programmingProblem,
    )
    const securePlan = request.resource_blueprint?.code_lab.secure_plan
      ?? buildCodeLabSecurePlan(request.generation_spec, identity.test_suite_id)
    const publicInputRecords = [
      ...normalizedPublic.public_tests.map((test) => ({ input: structuredClone(test.input) })),
      ...(normalizedPublic.programming_task?.public_examples.map((test) => ({ input: structuredClone(test.input) })) ?? []),
    ].filter((entry, index, entries) => entries.findIndex((candidate) =>
      contentHash(candidate.input) === contentHash(entry.input)) === index)
    const publicTestInputs = publicInputRecords.map((entry) => entry.input)
    const secureInputRules = `\n\nPRIVATE INPUT GUIDANCE (follow):\n- hidden_tests[].input 使用覆盖典型、边界、防硬编码和错误路径的新数据，避开 public 输入：${JSON.stringify(publicTestInputs)}。\n- 只输出 input/partition_id/note/misconception_tag；不得输出 expected 或 comparison，可信 Docker 会执行参考解计算标准答案。\n- 纯输出任务可以使用空 input；function 模式必须使用 args/kwargs 调用封装。`
    const secureStageInput = {
        contract: modelInput.contract,
        evidence: modelInput.evidence,
        concept: modelInput.concept,
        upstream: modelInput.upstream,
        public_payload: normalizedPublic,
        staged_contract: {
          lab_id: identity.lab_id,
          test_suite_id: identity.test_suite_id,
          execution_contract: normalizedPublic.execution_contract,
          ...(taskContract ? { task_contract: structuredClone(taskContract) } : {}),
          ...(programmingProblem ? { programming_problem: structuredClone(programmingProblem) } : {}),
          objective_plan: securePlan,
        },
        private_input_rules: secureInputRules,
      }
    const secureAuthorPayload: CodeLabSecureAuthorPayload = taskContract?.learner_action === "recall_fact"
      ? materializeRecallFactSecureAuthorPayload(request, securePlan)
      : await (async () => {
          const identityBase = {
            spec_id: request.generation_spec.spec_id,
            lab_id: identity.lab_id,
            public_hash: contentHash(normalizedPublic),
            prompt_version: STAGED_AUTHOR_PROMPT_VERSION,
          }
          const reference = await this.generateStage<CodeLabReferenceAuthorPayload>({
            task: "role-c.code-lab.reference",
            system_prompt: CODE_LAB_REFERENCE_STAGE_SYSTEM_PROMPT,
            input: secureStageInput,
            output_schema_id: "role_c_code_lab_secure_reference_author_payload_v1",
            output_schema: fragment("code_lab_draft.schema.json", "/$defs/secure_reference_author_payload"),
            temperature: 0,
            max_tokens: this.codeLabSecureMaxTokens,
            idempotency_identity: { ...identityBase, stage: "reference" },
            max_repairs: maxRepairs,
            diagnostic_sink: this.stageFailureDiagnosticSink,
            validate: (payload) => {
              const schema = validateRoleCSchemaFragment("code_lab_draft.schema.json", "/$defs/secure_reference_author_payload", payload)
              if (!schema.ok) return validationIssues(schema)
              const issues: string[] = []
              if (Boolean(payload.secondary_reference_solution) !== Boolean(programmingProblem?.require_secondary_oracle)) {
                issues.push(programmingProblem?.require_secondary_oracle
                  ? "高难任务必须提供 secondary_reference_solution"
                  : "当前任务不得提供 secondary_reference_solution")
              }
              if (payload.mutation_variants.length !== securePlan.mutation_variants.length) {
                issues.push(`mutation_variants 数量应为 ${securePlan.mutation_variants.length}`)
              }
              payload.mutation_variants.forEach((entry, index) => {
                const planned = securePlan.mutation_variants[index]
                if (planned && entry.misconception_tag !== planned.misconception_id) {
                  issues.push(`mutation_variants[${index}] misconception_tag 应为 ${planned.misconception_id}`)
                }
              })
              return issues
            },
          })
          const inputs = await this.generateStage<CodeLabTestInputsAuthorPayload>({
            task: "role-c.code-lab.test-inputs",
            system_prompt: CODE_LAB_TEST_INPUT_STAGE_SYSTEM_PROMPT,
            input: { ...secureStageInput, reference_contract: { reference_hash: contentHash(reference.reference_solution) } },
            output_schema_id: "role_c_code_lab_secure_test_inputs_author_payload_v1",
            output_schema: fragment("code_lab_draft.schema.json", "/$defs/secure_test_inputs_author_payload"),
            temperature: 0.15,
            max_tokens: this.codeLabSecureMaxTokens,
            idempotency_identity: { ...identityBase, reference_hash: contentHash(reference.reference_solution), stage: "test-inputs" },
            max_repairs: maxRepairs,
            diagnostic_sink: this.stageFailureDiagnosticSink,
            validate: (payload) => {
              const schema = validateRoleCSchemaFragment("code_lab_draft.schema.json", "/$defs/secure_test_inputs_author_payload", payload)
              if (!schema.ok) return validationIssues(schema)
              const combined: CodeLabSecureAuthorPayload = { ...reference, hidden_tests: payload.hidden_tests.map((test) => ({ ...test, comparison: { kind: "exact" as const } })) }
              const normalized = normalizeCodeLabSecureAuthorPayload(
                normalizeCodeLabSecureAuthorPayloadLenient(combined, securePlan, normalizedPublic.execution_contract.execution_mode, publicTestInputs, normalizedPublic.execution_contract.output_contract),
                normalizedPublic.execution_contract,
              )
              const planIssues = validateCodeLabSecureAuthorAgainstPlan(
                normalized,
                securePlan,
                normalizedPublic.execution_contract.execution_mode,
                programmingProblem,
              )
              if (!programmingProblem) return planIssues
              return [
                ...planIssues,
                ...validateInputCandidates(
                  programmingProblem,
                  publicInputRecords,
                  normalized.hidden_tests.map((test, index) => ({
                    case_id: securePlan.hidden_tests[index]?.test_id ?? `hidden-${index + 1}`,
                    input: structuredClone(test.input),
                    partition_id: test.partition_id ?? "nominal",
                    note: test.note ?? "",
                    ...(test.misconception_tag ? { misconception_tag: test.misconception_tag } : {}),
                  })),
                ).issues,
              ]
            },
          })
          return {
            ...reference,
            hidden_tests: inputs.hidden_tests.map((test) => ({ ...test, comparison: { kind: "exact" as const } })),
          }
        })()
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
      Boolean(programmingProblem),
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
    const objectivePlan = request.resource_blueprint?.code_lab.secure_plan
      ?? buildCodeLabSecurePlan(request.generation_spec, identity.test_suite_id)
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

    if (feedback.issues.some(issue => issue.startsWith("PUBLIC_REFERENCE_INPUT_FAILED:") && issue.includes("FileNotFoundError"))) {
      const cases = publicLabInputCases(publicPayload)
      const patch = await this.generateStage<{ fixtures: Array<{ case_id: string; files: Record<string, string> }> }>({
        task: "role-c.code-lab.public.file-fixtures",
        system_prompt: `${CODE_LAB_PUBLIC_STAGE_SYSTEM_PROMPT}\n本次只补齐公开样例已承诺的初始文件夹具。根据题面和公开参数确定文件名，生成合理的初始文本；保持已有 files 内容不变。不得修改 args/kwargs、题意、预期行为或其他字段，不提供参考实现，不猜测隐藏测试。每个公开 case_id 输出一项 files 字典；纯创建文件的样例可以为空字典。`,
        input: { public_payload: publicPayload, cases, execution_issues: feedback.issues.filter(issue => issue.startsWith("PUBLIC_REFERENCE_INPUT_FAILED:")) },
        output_schema_id: "public_file_fixtures_v1",
        output_schema: { type: "object", additionalProperties: false, required: ["fixtures"], properties: { fixtures: { type: "array", minItems: cases.length, maxItems: cases.length, items: { type: "object", additionalProperties: false, required: ["case_id", "files"], properties: { case_id: { type: "string", enum: cases.map(c => c.case_id) }, files: { type: "object", additionalProperties: { type: "string" } } } } } } },
        temperature: 0.2, max_tokens: 1800, max_repairs: 1,
        idempotency_identity: { spec_id: request.generation_spec.spec_id, public_hash: contentHash(publicPayload), phase: "public-file-fixtures" },
        validate: patch => { try { applyPublicFileFixtures(publicPayload, patch.fixtures); return [] } catch (error) { return [error instanceof Error ? error.message : "invalid_public_fixtures"] } },
      })
      publicPayload = applyPublicFileFixtures(publicPayload, patch.fixtures)
      return { public_draft: { payload: publicPayload }, secure_draft: draft.secure_draft }
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
          ...(request.resource_blueprint?.code_lab.task_contract
            ? { task_contract: structuredClone(request.resource_blueprint.code_lab.task_contract) }
            : {}),
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
        let repaired = normalizeCodeLabSecure(
          request.generation_spec,
          applyCodeLabExecutionRepairPatch(
            draft.secure_draft.payload,
            normalizedPatch,
          ),
          publicPayload,
          identity.test_suite_id,
          objectivePlan,
        )
        if (request.resource_blueprint?.code_lab.programming_problem) {
          repaired = markTrustedExpectedPending(repaired)
        }
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
        return validationIssuesExcludingRepairablePublicAnswerLeak(validateCodeLabDraftStructure(request, {
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
    let securePayload = normalizeCodeLabSecure(
      request.generation_spec,
      securedWithExpected,
      publicPayload,
      identity.test_suite_id,
      objectivePlan,
    )
    if (request.resource_blueprint?.code_lab.programming_problem) {
      securePayload = markTrustedExpectedPending(securePayload)
    }
    return {
      public_draft: { payload: publicPayload },
      secure_draft: { payload: securePayload },
    }
  }

  async generateAssessment(request: TieredEvaluatorRequest): Promise<AssessmentDraft> {
    assertVersionCompatibility(request, this.gateway, EVALUATOR_AUTHOR_PROMPT_VERSION)
    assertGenerationSpecProviderInput(request.generation_spec)
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
    const learningDesign = request.resource_blueprint?.learning_design
      ?? buildLearningDesignSpecV2({
        spec: request.generation_spec,
        evidence: request.evidence_pack,
        assessment_plan: plan,
      })
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
          // The item evidence is the complete authoring surface.  Aggregated
          // lesson summaries span several fact slots and previously leaked a
          // non-cited fact back into an otherwise isolated question.
          objective_summaries: [],
          code_lab_summary: undefined,
          misconceptions: modelInput.upstream.misconceptions.filter((entry) =>
            entry.objective_id === itemPlan.objective_id
            && entry.citations.length > 0 && entry.citations.every((citation) =>
              factKeys.has(`${citation.source_id}:${citation.fact_id}`))),
          // The shared semantic plan may legitimately coordinate the whole
          // form, but it must not inject another objective's facts into one
          // item's authoring surface.
          round_semantic_plan: undefined,
          resource_blueprint: modelInput.upstream.resource_blueprint
            ? {
                ...modelInput.upstream.resource_blueprint,
                objectives: modelInput.upstream.resource_blueprint.objectives.filter(
                  (entry) => entry.objective_id === itemPlan.objective_id,
                ).map(entry => ({ ...entry, required_fact_ids: itemPlan.citations.filter(c => c.source_id === entry.source_id).map(c => c.fact_id), assessment: entry.assessment.filter(item => item.item_id === itemPlan.item_id) })),
                assessment: {
                  ...modelInput.upstream.resource_blueprint.assessment,
                  item_plan: [structuredClone(itemPlan)],
                  total_items: 1,
                  total_score: itemPlan.max_score,
                },
              }
            : undefined,
        }
        const itemTournament = await runPublicCandidateTournament<AssessmentPublicAuthorPayload>({
          candidate_count: this.publicCandidateCount,
          generate: (variantIndex) => this.generateStage<AssessmentPublicAuthorPayload>({
          task: "role-c.tiered-evaluator.public-item",
          system_prompt: ASSESSMENT_PUBLIC_STAGE_SYSTEM_PROMPT,
          input: {
            contract: {
              ...modelInput.contract,
              targets: itemTarget ? [{ ...structuredClone(itemTarget), required_fact_ids: itemPlan.citations.filter(c => c.source_id === itemTarget.source_id).map(c => c.fact_id) }] : [],
              assessment_blueprint: { tier_1_count: itemPlan.tier === 1 ? 1 : 0, tier_2_count: itemPlan.tier === 2 ? 1 : 0, tier_3_count: itemPlan.tier === 3 ? 1 : 0, required_modalities: [itemPlan.modality] },
              artifact_task: projectAssessmentTask(modelInput.contract.artifact_task, itemPlan),
            },
            evidence: itemEvidence,
            upstream: itemUpstream,
            learning_design: {
              ...learningDesign,
              learner: { ...learningDesign.learner, misconceptions: [] },
              objectives: learningDesign.objectives.filter((entry) => entry.objective_id === itemPlan.objective_id).map(entry => ({ ...entry, required_fact_ids: itemPlan.citations.map(c => c.fact_id) })),
              lesson_sequence: [],
              assessment_plan: [itemPlan],
            },
            candidate_context: publicCandidateContext("assessment", variantIndex),
            staged_contract: {
              form_id: formId,
              objective_ids: [itemPlan.objective_id],
              item_plan: [itemPlan],
              novelty_design_brief: {
                history_count: noveltyBrief.history_count,
                // 单题作者看到的是局部 items[0]。将全卷下标重映射为 0，
                // 避免修订指令要求替换 items[0]，而设计说明却仍指向 items[2/3]。
                items: [{ ...noveltyBrief.items[itemIndex]!, index: 0 }],
              },
            },
          },
          output_schema_id: "role_c_assessment_public_author_payload_v1",
          output_schema: assessmentPublicAuthorOutputSchema([itemPlan]),
          temperature: (request.prior_assessment_items?.length ?? 0) > 0
            ? Math.max(this.assessmentTemperature, 0.5)
            : Math.max(this.assessmentTemperature, 0.25),
          max_tokens: Math.min(this.assessmentPublicMaxTokens, 2_400),
          idempotency_identity: {
            spec_id: request.generation_spec.spec_id,
            concept_artifact_id: request.concept_artifact.artifact_id,
            stage: "public-item",
            item_id: itemPlan.item_id,
            prompt_version: STAGED_AUTHOR_PROMPT_VERSION,
            variant_index: variantIndex,
          },
          max_repairs: maxRepairs,
          normalize_output: (payload) => normalizeEvidenceBoundedAssessmentChoices(
            projectAssessmentPublicAuthorPayload(payload),
            [itemPlan],
            itemEvidence.flatMap((source) => source.facts.map((fact) => ({
              source_id: source.source_id,
              fact_id: fact.fact_id,
              content: fact.content,
            }))),
          ),
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
            const evidenceIssues = validateAssessmentAuthorEvidenceDiscipline(
              authored,
              [itemPlan],
              modelInput.evidence.flatMap((source) => source.facts.map((fact) => ({
                source_id: source.source_id,
                fact_id: fact.fact_id,
                content: fact.content,
              }))),
            )
            if (evidenceIssues.length > 0) {
              return evidenceIssues.map((issue) =>
                `[${issue.code}] ${issue.path}: ${issue.message}`)
            }
            const materialized = materializeAssessmentPublicAuthorPayload(
              request.generation_spec,
              authored,
              [itemPlan],
              formId,
            )
            return [
              ...validateAssessmentNovelty(
                materialized,
                request.prior_assessment_items ?? [],
              ),
              ...validateAssessmentPublicValidity(materialized, [itemPlan])
                .map((issue) => `[${issue.code}] ${issue.path}: ${issue.message}`),
            ]
          },
          }),
          evaluate: (payload, variantIndex) => evaluatePublicAuthorCandidate({
            candidate_id: candidateIdentity("assessment", payload, variantIndex),
            artifact_kind: "assessment",
            payload,
            learning_design: {
              ...learningDesign,
              objectives: learningDesign.objectives.filter((entry) => entry.objective_id === itemPlan.objective_id),
              lesson_sequence: learningDesign.lesson_sequence.filter((entry) => entry.objective_id === itemPlan.objective_id),
              assessment_plan: [itemPlan],
            },
            assessment_plan: [itemPlan],
            expression_context: request.generation_spec.learner_adaptation.expression_context,
            minimum_score: learningDesign.candidate_policy.minimum_quality_score - 0.08,
          }),
          review: (entries) => reviewPublicCandidatesWithModel({
            gateway: this.gateway,
            task: "role-c.tiered-evaluator.public-item",
            artifact_kind: "assessment",
            candidates: entries,
            evidence: itemEvidence,
            contract: {
              target: itemTarget,
              artifact_task: projectAssessmentTask(modelInput.contract.artifact_task, itemPlan),
              item_plan: itemPlan,
            },
          }),
          on_rejected: (evaluations, rejectedGenerationCount) => this.recordRejectedCandidates(
            "role-c.tiered-evaluator.public-item", evaluations, rejectedGenerationCount,
          ),
        })
        await this.recordCandidateSelection("role-c.tiered-evaluator.public-item", itemTournament)
        return itemTournament.winner
      },
    )
    const assessmentEvidenceFacts = modelInput.evidence.flatMap((source) =>
      source.facts.map((fact) => ({
        source_id: source.source_id,
        fact_id: fact.fact_id,
        content: fact.content,
      })))
    let publicAuthorPayload: AssessmentPublicAuthorPayload = normalizeEvidenceBoundedAssessmentChoices({
      title: publicItemAuthors[0]?.title?.trim() || "本轮学习测评",
      items: publicItemAuthors.map((author) =>
        projectAssessmentPublicAuthorPayload(author).items[0]!),
    }, plan, assessmentEvidenceFacts)
    normalizeAssessmentAuthorFields(publicAuthorPayload, plan)
    let normalizedPublic = materializeAssessmentPublicAuthorPayload(
      request.generation_spec,
      projectAssessmentPublicAuthorPayload(publicAuthorPayload),
      plan,
      formId,
    )
    let composedPublicIssues = [
      ...validateAssessmentAuthorEvidenceDiscipline(
        publicAuthorPayload,
        plan,
        modelInput.evidence.flatMap((source) => source.facts.map((fact) => ({
          source_id: source.source_id,
          fact_id: fact.fact_id,
          content: fact.content,
        }))),
      ).map((issue) => `[${issue.code}] ${issue.path}: ${issue.message}`),
      ...validationIssues(validateAssessmentPublicStage(request, normalizedPublic)),
      ...validateAssessmentNovelty(
        normalizedPublic,
        request.prior_assessment_items ?? [],
      ),
      ...validateAssessmentPublicValidity(normalizedPublic, plan)
        .map((issue) => `[${issue.code}] ${issue.path}: ${issue.message}`),
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
          learning_design: learningDesign,
          candidate_context: publicCandidateContext("assessment", repairAttempt % 3),
          staged_contract: {
            form_id: formId,
            objective_ids: request.generation_spec.targets.map((target) => target.objective_id),
            item_plan: plan,
            novelty_design_brief: noveltyBrief,
          },
        },
        output_schema_id: "role_c_assessment_public_author_payload_v1",
        output_schema: assessmentPublicAuthorOutputSchema(plan),
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
      publicAuthorPayload = normalizeEvidenceBoundedAssessmentChoices(
        await this.generateAssessmentNoveltyRepair(
          repairStage,
          publicAuthorPayload,
          composedPublicIssues,
          directive,
        ),
        plan,
        assessmentEvidenceFacts,
      )
      normalizeAssessmentAuthorFields(publicAuthorPayload, plan)
      normalizedPublic = materializeAssessmentPublicAuthorPayload(
        request.generation_spec,
        projectAssessmentPublicAuthorPayload(publicAuthorPayload),
        plan,
        formId,
      )
      composedPublicIssues = [
        ...validateAssessmentAuthorEvidenceDiscipline(
          publicAuthorPayload,
          plan,
          modelInput.evidence.flatMap((source) => source.facts.map((fact) => ({
            source_id: source.source_id,
            fact_id: fact.fact_id,
            content: fact.content,
          }))),
        ).map((issue) => `[${issue.code}] ${issue.path}: ${issue.message}`),
        ...validationIssues(validateAssessmentPublicStage(request, normalizedPublic)),
        ...validateAssessmentNovelty(
          normalizedPublic,
          request.prior_assessment_items ?? [],
        ),
        ...validateAssessmentPublicValidity(normalizedPublic, plan)
          .map((issue) => `[${issue.code}] ${issue.path}: ${issue.message}`),
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
        learning_design: learningDesign,
        public_payload: normalizedPublic,
        staged_contract: {
          form_id: formId,
          option_order_seed: request.generation_spec.policies.seed,
          item_plan: plan,
        },
      },
      output_schema_id: "role_c_assessment_secure_author_payload_v1",
      output_schema: fragment("assessment_draft.schema.json", "/$defs/secure_author_payload"),
      temperature: 0,
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
          plan,
          request.evidence_pack,
        )
        const crossIssues = validateAssessmentSecureAuthorAgainstPublic(normalizedAuthor, normalizedPublic)
        if (crossIssues.length > 0) return crossIssues
        const secure = materializeAssessmentSecureAuthorPayload(
          request.generation_spec,
          normalizedPublic,
          normalizedAuthor,
        )
        const normalized = normalizeAssessmentPair(request.generation_spec, normalizedPublic, secure)
        return [
          ...validationIssues(validateAssessmentDraftStructure(request, {
          public_draft: { payload: normalized.public_payload },
          secure_draft: { payload: normalized.secure_payload },
          })),
          ...validateAssessmentPairValidity(
            normalized.public_payload,
            normalized.secure_payload,
            plan,
          ).map((issue) => `[${issue.code}] ${issue.path}: ${issue.message}`),
        ]
      },
    })
    const normalizedSecureAuthorPayload = normalizeAssessmentSecureAuthorPayload(
      secureAuthorPayload,
      normalizedPublic,
      plan,
      request.evidence_pack,
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
    if (separation.issues.some((issue) => REPAIRABLE_PUBLIC_ANSWER_LEAK_CODES.has(issue.code))) {
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
          plan,
          request.evidence_pack,
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
      plan,
      request.evidence_pack,
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
    const securePlan = request.resource_blueprint?.code_lab.secure_plan
      ?? buildCodeLabSecurePlan(request.generation_spec, identity.test_suite_id)
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
      return validationIssueStrings({ issues: validateCodeLabDraftStructure(request, {
        public_draft: { payload: candidate },
        secure_draft: { payload: frozenSecure },
      }).issues.filter((issue) => !isTrustedExpectedDerivationIssue(issue.code)) })
    }
    const issueCodes = validateCodeLabDraftStructure(request, {
      public_draft: { payload: input.public_payload },
      secure_draft: { payload: input.secure_payload },
    }).issues.map((issue) => issue.code)
    const deterministicRepair = shouldUseDeterministicPublicSafetyRepair(issueCodes)
    let patch: CodeLabPublicSafetyRepairPatch
    if (deterministicRepair) {
      const candidate = conservativeCodeLabPublicSafetyRepair(
        input.public_payload,
        input.secure_payload.reference_solution,
      )
      const fallbackIssues = validateCodeLabPublicSafetyRepairCandidate(
        request,
        candidate,
        input.secure_payload,
        identity.test_suite_id,
        securePlan,
      )
      if (fallbackIssues.length > 0) {
        throw new ModelOutputValidationError(
          "role-c.code-lab.public.safety-repair",
          fallbackIssues,
        )
      }
      return candidate
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
        output_schema: codeLabPublicSafetyRepairSchema(input.public_payload),
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
        input.secure_payload.reference_solution,
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
    const securePlan = request.resource_blueprint?.code_lab.secure_plan
      ?? buildCodeLabSecurePlan(request.generation_spec, identity.test_suite_id)
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
        if (stage.normalize_output) value = stage.normalize_output(value)
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

  private async recordCandidateSelection<T>(
    task: string,
    result: CandidateSelectionResult<T>,
  ): Promise<void> {
    await this.candidateSelectionSink?.({
      task,
      winner_candidate_id: result.winner_evaluation.candidate_id,
      evaluations: structuredClone(result.evaluations),
      rejected_generation_count: result.rejected_generation_count,
    })
  }

  private async recordRejectedCandidates(
    task: string,
    evaluations: PublicCandidateEvaluation[],
    rejectedGenerationCount: number,
  ): Promise<void> {
    await this.candidateSelectionSink?.({
      task,
      winner_candidate_id: "none",
      evaluations: structuredClone(evaluations),
      rejected_generation_count: rejectedGenerationCount,
    })
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
      output_schema: assessmentNoveltyPatchSchema(indices, stage.input),
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
  const currentOccurrences = new Map<string, number>()
  return {
    history_count: history.length,
    items: plan.map((item, index) => {
      const historyKey = `${item.objective_id}\u0000${item.modality}`
      const relevantHistory = history.filter((prior) =>
        prior.objective_id === item.objective_id
        && prior.modality === item.modality)
      const occurrence = currentOccurrences.get(historyKey) ?? 0
      currentOccurrences.set(historyKey, occurrence + 1)
      // 旧实现只按本卷 index 选 shape，同一位置每轮都会得到同一结构，
      // 与 novelty 门禁天然冲突。现在按该目标/题型的真实历史次数继续轮换。
      const semanticTurn = relevantHistory.length + occurrence
      return {
        index,
        objective_id: item.objective_id,
        tier: item.tier,
        modality: item.modality,
        planned_cognitive_operation: item.cognitive_operation,
        variation_axis: axes[semanticTurn % axes.length]!,
        in_form_role: item.tier === 1
          ? "direct_foundation"
          : item.tier === 2
            ? "guided_application"
            : "integrated_transfer",
        planned_task_shape: assessmentTaskShape(item.modality, semanticTurn),
        forbidden_history: relevantHistory
          .slice(-8)
          .map((prior) => ({
            prompt: prior.prompt,
            ...(prior.structure_meta
              ? { structure_meta: structuredClone(prior.structure_meta) }
              : {}),
          })),
      }
    }),
  }
}

function assessmentTaskShape(
  modality: AssessmentItemPlan["modality"],
  index: number,
): string {
  const shapes: Record<AssessmentItemPlan["modality"], string[]> = {
    mcq: [
      "select_one_supported_statement",
      "choose_best_fact_summary",
      "match_subject_to_supported_description",
      "identify_supported_relation",
    ],
    true_false: [
      "verify_one_atomic_claim",
      "judge_direct_fact_paraphrase",
      "verify_supported_relation",
      "judge_explicitly_negated_claim",
    ],
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
    replace_entire_item: (task === "role-c.tiered-evaluator.public"
      || task === "role-c.tiered-evaluator.public-item") && indices.length > 0,
  }
}

function assessmentNoveltyPatchSchema(
  indices: number[],
  stageInput?: unknown,
): Record<string, unknown> {
  const plan = assessmentPlanFromStageInput(stageInput)
  const patchOptionBounds = commonOptionCountForPlan(plan, indices)
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
                {
                  type: "array",
                  minItems: patchOptionBounds.min,
                  maxItems: patchOptionBounds.max,
                  items: { type: "string", minLength: 1 },
                },
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

/**
 * 让模型输出合同与冻结题目计划一致。选项正文由模型依据本题 citations
 * 设计，后处理不得把它覆盖为“事实原句 + 直接否定”；证据边界与唯一答案
 * 由作者校验、secure 阶段和语义审核共同验证。
 */
export function assessmentPublicAuthorOutputSchema(
  plan: AssessmentItemPlan[],
): Record<string, unknown> {
  const schema = structuredClone(fragment(
    "assessment_draft.schema.json",
    "/$defs/public_author_payload",
  ))
  const root = schema as {
    properties?: { items?: { items?: { properties?: { options?: { oneOf?: Array<Record<string, unknown>> } } } } }
  }
  const optionArray = root.properties?.items?.items?.properties?.options?.oneOf
    ?.find((entry) => entry.type === "array")
  // 单题作者使用精确合同；整卷修订仍由逐题 validator 校验各题差异。
  if (optionArray && plan.length === 1) {
    const bounds = optionCountForPlan(plan, 0)
    optionArray.minItems = bounds.min
    optionArray.maxItems = bounds.max
  }
  return schema
}

function assessmentPlanFromStageInput(input: unknown): AssessmentItemPlan[] {
  const stagedContract = asRecord(asRecord(input).staged_contract)
  return Array.isArray(stagedContract.item_plan)
    ? stagedContract.item_plan as AssessmentItemPlan[]
    : []
}

function optionCountForPlan(
  plan: AssessmentItemPlan[],
  index = 0,
): { min: number; max: number } {
  const item = plan[index]
  if (!item) return { min: 2, max: 4 }
  if (item.modality === "true_false") return { min: 2, max: 2 }
  if (item.modality === "mcq"
    && item.citations.length === 1
    && (item.cognitive_operation === "recognize_fact"
      || item.cognitive_operation === "explain_reasoning")) {
    return { min: 2, max: 2 }
  }
  return { min: 2, max: 4 }
}

function commonOptionCountForPlan(
  plan: AssessmentItemPlan[],
  indices: number[],
): { min: number; max: number } {
  const bounds = indices.map((index) => optionCountForPlan(plan, index))
  return bounds.length > 0
    && bounds.every((entry) => entry.min === bounds[0]!.min && entry.max === bounds[0]!.max)
    ? bounds[0]!
    : { min: 2, max: 4 }
}

function assessmentUpstreamWithoutHistory<T extends { prior_assessment_items?: unknown }>(upstream: T): T {
  const result = structuredClone(upstream) as T & {
    prior_assessment_items?: unknown
  }
  delete result.prior_assessment_items
  return result
}

const REPAIRABLE_PUBLIC_ANSWER_LEAK_CODES = new Set([
  "reference_solution_leak",
  "starter_equals_reference",
])

const DETERMINISTIC_STARTER_LEAK_CODES = new Set([
  "reference_solution_leak",
  "starter_equals_reference",
])

function hasRepairablePublicAnswerLeak(
  report: ReturnType<typeof validateCodeLabDraftStructure>,
): boolean {
  return report.issues.some((issue) =>
    REPAIRABLE_PUBLIC_ANSWER_LEAK_CODES.has(issue.code))
}

function validationIssuesExcludingRepairablePublicAnswerLeak(
  report: ReturnType<typeof validateCodeLabDraftStructure>,
): string[] {
  return validationIssueStrings({
    issues: report.issues.filter((issue) =>
      !REPAIRABLE_PUBLIC_ANSWER_LEAK_CODES.has(issue.code)
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
  return issueCodes.some((code) => DETERMINISTIC_STARTER_LEAK_CODES.has(code))
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
  referenceSolution?: string,
): CodeLabPublicSafetyRepairPatch {
  const normalize = (text: string) => text.replace(/#[^\n]*/g, "").replace(/\s+/g, "").trim()
  const normalizedReference = normalize(referenceSolution ?? "")
  const normalizedStarter = normalize(prior.starter_code)
  const starterContainsCompleteReference = Boolean(
    normalizedReference && normalizedStarter.includes(normalizedReference),
  )
  const starterCode = starterContainsCompleteReference
    ? minimalSafeStarter(prior.starter_code, prior.execution_contract)
    : prior.starter_code
  const sanitize = (value: string, fallback: string) =>
    referenceSolution && containsReferenceImplementationLine(
      value,
      referenceSolution,
      starterCode,
    )
      ? fallback
      : value
  return {
    starter_code: starterCode,
    // 泄漏只发生在 starter/reference 等价时，不应把已经通过公开质量审核的
    // instruction、测试说明、提示和反思题一起降级为通用模板。
    instruction_texts: prior.instructions.map((block) =>
      "text" in block && typeof block.text === "string"
        ? sanitize(block.text, "先明确输入、输出与待完成区域，再在 TODO 处实现核心逻辑。")
        : "完成题目要求的学习者代码区域。"),
    public_test_descriptions: prior.public_tests.map((test, index) =>
      typeof test.description === "string"
        ? sanitize(test.description, `公开测试 ${index + 1}：检查实现是否满足题目声明的行为。`)
        : `公开测试 ${index + 1}：检查实现是否满足题目的可观察行为。`),
    public_test_expected_behaviors: prior.public_tests.map((test) =>
      typeof test.expected_behavior === "string"
        ? sanitize(test.expected_behavior, "结果应符合题目给出的输入输出约束。")
        : "结果应符合执行合同和题目中的输出约束。"),
    hint_texts: prior.hint_ladders.map((ladder) =>
      ladder.hints.map((hint, index) => typeof hint.text === "string"
        ? sanitize(hint.text, [
            "先确认题目要求的输入与输出。",
            "把任务拆成读取、处理和产生结果三个部分。",
            "只在 TODO 区域补全核心逻辑，并逐项对照公开测试。",
          ][index]!)
        : [
            "先明确输入、输出和需要处理的步骤。",
            "将核心处理保留在 TODO 位置。",
            "逐项对照公开测试检查结果。",
          ][index]!) as [string, string, string]),
    reflection_questions: prior.reflection_questions.map((question) =>
      sanitize(question, "你的实现如何对应题目的输入、处理和输出要求？")),
  }
}

/**
 * Removes reference implementation material from every learner-visible code-lab
 * surface.  The legacy repair patch predates programming_task/practical_guide,
 * so applying it alone can leave the exact answer in the richer task card.
 */
export function conservativeCodeLabPublicSafetyRepair(
  prior: CodeLabPublicPayload,
  referenceSolution: string,
): CodeLabPublicPayload {
  const repaired = applyCodeLabPublicSafetyPatch(
    prior,
    conservativeCodeLabPublicSafetyPatch(prior, referenceSolution),
  )
  const sanitize = (value: string, fallback: string): string =>
    containsReferenceImplementationLine(value, referenceSolution, repaired.starter_code)
      ? fallback
      : value

  if (repaired.programming_task) {
    const task = structuredClone(repaired.programming_task)
    task.statement = sanitize(
      task.statement,
      "请按照输入、输出和约束完成程序；只修改题目指定的学习者作答区域。",
    )
    task.input_description = sanitize(task.input_description, "输入格式以执行合同为准。")
    task.output_description = sanitize(task.output_description, "输出应满足题目声明的可观察行为。")
    task.constraints = task.constraints.map((entry) =>
      sanitize(entry, "实现必须满足题目给出的执行合同与边界约束。"))
    if (task.starter_code) {
      task.starter_code = sanitizeCodeLabPublicCode(
        task.starter_code,
        referenceSolution,
        repaired.starter_code,
      )
    }
    if (task.gap_template) {
      task.gap_template.template_code = sanitizeCodeLabPublicCode(
        task.gap_template.template_code,
        referenceSolution,
        task.gap_template.template_code,
      )
      task.gap_template.gaps = task.gap_template.gaps.map((gap, index) => ({
        ...gap,
        label: sanitize(gap.label, `待填写代码片段 ${index + 1}`),
        ...(gap.placeholder
          ? { placeholder: sanitize(gap.placeholder, "# 按题目要求填写") }
          : {}),
      }))
    }
    task.public_examples = task.public_examples.map((example, index) => ({
      ...example,
      description: sanitize(example.description, `公开样例 ${index + 1}`),
      expected_behavior: sanitize(
        example.expected_behavior,
        "输出应满足题面声明的行为。",
      ),
    }))
    task.hint_ladders = task.hint_ladders.map((hint) => ({
      ...hint,
      text: sanitize(hint.text, [
        "先确认输入、输出和待完成区域。",
        "把任务拆成读取、处理与输出三个步骤。",
        "用公开样例逐项检查自己的实现。",
      ][hint.level - 1]!),
    }))
    repaired.programming_task = task
  }

  if (repaired.practical_guide) {
    const guide = structuredClone(repaired.practical_guide)
    guide.practice_goal = sanitize(guide.practice_goal, "完成并验证本轮编程任务。")
    guide.deliverable = sanitize(guide.deliverable, "一份满足执行合同的可运行程序。")
    guide.readiness_checks = guide.readiness_checks.map((check) => ({
      ...check,
      title: sanitize(check.title, "准备检查"),
      check: sanitize(check.check, "确认输入、输出和允许使用的工具。"),
      ready_when: sanitize(check.ready_when, "能够说明任务的输入与输出。"),
    }))
    guide.steps = guide.steps.map((step) => ({
      ...step,
      title: sanitize(step.title, `步骤 ${step.sequence}`),
      action: sanitize(step.action, "实现当前步骤要求的行为。"),
      input: sanitize(step.input, "使用题目给出的公开输入。"),
      expected_result: sanitize(step.expected_result, "结果符合当前步骤的公开约束。"),
      verification: sanitize(step.verification, "运行公开样例并核对结果。"),
    }))
    guide.acceptance_criteria = guide.acceptance_criteria.map((criterion) => ({
      ...criterion,
      description: sanitize(criterion.description, "通过对应公开测试。"),
      expected_behavior: sanitize(criterion.expected_behavior, "行为符合题面约束。"),
    }))
    guide.troubleshooting = guide.troubleshooting.map((item) => ({
      ...item,
      symptom: sanitize(item.symptom, "运行结果与公开样例不一致。"),
      likely_cause: sanitize(item.likely_cause, "输入、处理或输出步骤存在偏差。"),
      recovery_steps: item.recovery_steps.map((step) =>
        sanitize(step, "逐项对照执行合同和公开样例定位偏差。")),
      verification: sanitize(item.verification, "重新运行公开样例确认修复。"),
    }))
    guide.extension_task = {
      ...guide.extension_task,
      task: sanitize(guide.extension_task.task, "在保持执行合同的前提下完成一个变式。"),
      changed_dimension: sanitize(guide.extension_task.changed_dimension, "输入边界"),
      verification: sanitize(guide.extension_task.verification, "运行公开样例和新增边界样例。"),
    }
    repaired.practical_guide = guide
  }
  return repaired
}

function sanitizeCodeLabPublicCode(
  value: string,
  referenceSolution: string,
  fallback: string,
): string {
  const normalize = (text: string) => text.replace(/#[^\n]*/g, "").replace(/\s+/g, "").trim()
  const reference = normalize(referenceSolution)
  const current = normalize(value)
  if (reference && current.includes(reference)) return fallback
  const referenceLines = referenceSolution.split(/\r?\n/u)
    // Function/class/import declarations are the public execution ABI, not the
    // implementation. Removing a shared signature makes every gap answer fail.
    .filter((line) => !/^\s*(?:async\s+def|def|class|import|from)\b/u.test(line))
    .map(normalize)
    .filter((line) => line.length >= 6)
  if (!referenceLines.some((line) => current.includes(line))) return value
  return value.split(/\r?\n/u).map((line) => {
    const normalized = normalize(line)
    if (!referenceLines.includes(normalized)) return line
    const indent = /^\s*/u.exec(line)?.[0] ?? ""
    return `${indent}# TODO: 完成此步骤`
  }).join("\n")
}

function validateCodeLabPublicSafetyRepairCandidate(
  request: CodeLabRequest,
  candidate: CodeLabPublicPayload,
  securePayload: CodeLabSecurePayload,
  testSuiteId: string,
  securePlan: ReturnType<typeof buildCodeLabSecurePlan>,
): string[] {
  const publicIssues = validationIssues(validateCodeLabPublicStage(request, candidate))
  if (publicIssues.length > 0) return publicIssues
  const frozenSecure = normalizeCodeLabSecure(
    request.generation_spec,
    securePayload,
    candidate,
    testSuiteId,
    securePlan,
  )
  return validationIssueStrings({ issues: validateCodeLabDraftStructure(request, {
    public_draft: { payload: candidate },
    secure_draft: { payload: frozenSecure },
  }).issues.filter((issue) => !isTrustedExpectedDerivationIssue(issue.code)) })
}

function codeLabPublicSafetyRepairSchema(
  prior: CodeLabPublicPayload,
): Record<string, unknown> {
  const schema = structuredClone(fragment(
    "code_lab_draft.schema.json",
    "/$defs/public_safety_repair_patch",
  )) as {
    properties: Record<string, { minItems?: number; maxItems?: number }>
  }
  const exact = (field: string, count: number) => {
    schema.properties[field]!.minItems = count
    schema.properties[field]!.maxItems = count
  }
  exact("instruction_texts", prior.instructions.length)
  exact("public_test_descriptions", prior.public_tests.length)
  exact("public_test_expected_behaviors", prior.public_tests.length)
  exact("hint_texts", prior.hint_ladders.length)
  exact("reflection_questions", prior.reflection_questions.length)
  return schema as unknown as Record<string, unknown>
}

function containsReferenceImplementationLine(
  value: string,
  referenceSolution: string,
  starterCode: string,
): boolean {
  const normalize = (text: string) => text.replace(/#[^\n]*/g, "").replace(/\s+/g, "").trim()
  const starterLines = new Set(starterCode.split(/\r?\n/u).map(normalize).filter((line) => line.length >= 6))
  const deltaLines = referenceSolution.split(/\r?\n/u)
    .map(normalize)
    .filter((line) => line.length >= 6 && !starterLines.has(line))
  const normalizedValue = normalize(value)
  return deltaLines.some((line) => normalizedValue.includes(line))
}

export function normalizeCodeLabPublicAuthorPayload(
  payload: CodeLabPublicAuthorPayload,
  taskContract?: { learner_action: "recall_fact" | "implement_program" | "implement_function" },
  practicalGuidePlan?: PracticalGuidePlan,
  programmingProblem?: ProgrammingProblemBlueprint,
  objectivePlan?: CodeLabObjectivePlan[],
  evidence?: CodeLabRequest["evidence_pack"],
): CodeLabPublicAuthorPayload {
  // Authoring validation must see unsafe or undeclared imports so the model can
  // rewrite the actual starter. Silently replacing it with a one-line TODO
  // produces a schema-valid but instructionally unusable lab.
  const normalized = structuredClone(payload)
  if (taskContract?.learner_action !== "recall_fact" && objectivePlan && evidence) {
    normalizeCodeLabHintsToEvidence(normalized, objectivePlan, evidence)
  }
  if (practicalGuidePlan && normalized.practical_guide) {
    normalized.practical_guide = normalizePracticalGuideLearnerVocabulary(
      normalized.practical_guide,
    )
    // The plan owns guide cardinality. Extra prose items do not represent new
    // instructional obligations, so project them away before strict review;
    // missing items still fail validation and are repaired by the authoring
    // stage instead of being fabricated here.
    if (Array.isArray(normalized.practical_guide.readiness_checks)) {
      normalized.practical_guide.readiness_checks = normalized.practical_guide.readiness_checks
        .slice(0, practicalGuidePlan.readiness_slots.length)
    }
    if (Array.isArray(normalized.practical_guide.steps)) {
      normalized.practical_guide.steps = normalized.practical_guide.steps
        .slice(0, practicalGuidePlan.step_slots.length)
    }
    if (Array.isArray(normalized.practical_guide.troubleshooting)) {
      normalized.practical_guide.troubleshooting = normalized.practical_guide.troubleshooting
        .slice(0, practicalGuidePlan.troubleshooting_slots.length)
    }
  }
  if (programmingProblem && normalized.programming_task) {
    // The response action is fixed by the UI contract, not a model-authored
    // programming requirement. State it consistently alongside the AI task.
    if (programmingProblem.task_kind === "code_completion"
      && typeof normalized.programming_task.statement === "string"
      && !/(?:填|补全|完成|替换)/u.test(normalized.programming_task.statement)) {
      normalized.programming_task.statement = `请补全程序中标出的待填写部分。${normalized.programming_task.statement}`
    }
    const requiredAdditional = Math.max(
      0,
      programmingProblem.public_case_count - normalized.objectives.length,
    )
    const seen = new Set(normalized.objectives.map((objective) =>
      contentHash(objective.public_test.input)))
    normalized.programming_task.additional_public_examples =
      (normalized.programming_task.additional_public_examples ?? []).filter((example) => {
        const hash = contentHash(example.input)
        if (seen.has(hash)) return false
        seen.add(hash)
        return true
      })
    if (requiredAdditional === 0) {
      delete normalized.programming_task.additional_public_examples
    }
  }
  if (taskContract?.learner_action === "recall_fact") {
    normalized.starter_code = [
      "# TODO: 只替换引号内的占位文本，保留变量和输出语句",
      "fact_text = \"TODO：填写题目要求的事实文本\"",
      "print(fact_text)",
      "",
    ].join("\n")
    for (const objective of normalized.objectives) {
      objective.instruction_text = "阅读本目标给出的事实，在 starter_code 的 TODO 字符串中填写对应事实文本，然后运行程序核对标准输出。"
      objective.public_test.input = ""
      objective.public_test.description = "运行程序，检查事实文本是否按题目要求输出。"
      objective.public_test.expected_behavior = "标准输出应与本目标要求填写的事实文本一致。"
      objective.reflection_question = "你填写的文本如何完整表达本目标给出的事实？"
    }
    if (normalized.programming_task) {
      normalized.programming_task.gap_template = {
        schema_version: "code-gap-template.v1",
        template_code: [
          "# 只填写当前事实对应的字符串表达式",
          "fact_text = {{gap:fact_text}}",
          "print(fact_text)",
          "",
        ].join("\n"),
        gaps: [{
          gap_id: "fact_text",
          label: "要输出的文字（需要包含引号）",
          kind: "expression",
          answer_format: "python_string_literal",
          max_chars: 500,
          max_lines: 1,
          placeholder: "例如：\"一行文字\"",
        }],
      }
    }
  }
  normalized.programming_task?.gap_template?.gaps.forEach((gap, index) => {
    gap.answer_format ??= gap.kind === "identifier"
      ? "python_identifier"
      : gap.kind === "statement" || gap.kind === "block"
        ? "python_statement"
        : "python_expression"
    if (typeof gap.label !== "string") return
    if (!gap.label.trim() || /^(?:gap|空|todo|待填)$/iu.test(gap.label.trim())) {
      gap.label = `第 ${index + 1} 处要补全的代码`
    }
    gap.placeholder ??= gap.answer_format === "python_identifier"
      ? "例如：total"
      : gap.answer_format === "python_statement"
        ? "填写一条 Python 语句"
        : "填写一个 Python 表达式"
  })
  return normalized
}

/**
 * Keep the model-authored progression while binding it to the current lesson.
 * This runs before strict author validation so a useful task is not discarded
 * merely because the model omitted the knowledge title from otherwise sound
 * hints. No answer, reference implementation, or hidden test is introduced.
 */
export function normalizeCodeLabHintsToEvidence(
  payload: CodeLabPublicAuthorPayload,
  plan: CodeLabObjectivePlan[],
  evidence: CodeLabRequest["evidence_pack"],
): void {
  const normalize = (value: unknown) => typeof value === "string" ? value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s，。！？；：、,.!?;:'"“”‘’`()（）\[\]【】_-]+/gu, "") : ""
  payload.objectives.forEach((objective, index) => {
    const objectivePlan = plan[index]
    if (!objectivePlan || !Array.isArray(objective.hints)
      || objective.hints.length !== 3
      || objective.hints.some((hint) => typeof hint !== "string")) return
    const cited = new Set(objectivePlan.citations.map((citation) =>
      `${citation.source_id}:${citation.fact_id}`))
    const source = evidence.results.find((entry) => entry.source_id === objectivePlan.source_id)
    const facts = evidence.results.flatMap((entry) => entry.facts.filter((fact) =>
      cited.has(`${fact.source_id}:${fact.fact_id}`)).map((fact) => fact.content.trim()))
    const title = source?.title?.trim() || objectivePlan.source_id
    const tokens = [title, ...facts]
      .flatMap((text) => text.match(/[A-Za-z_][A-Za-z0-9_]{2,}|[\p{Script=Han}]{2,8}/gu) ?? [])
      .map(normalize)
      .filter((token) => token.length >= 2)
    const isAnchored = (hint: string) => tokens.some((token) => normalize(hint).includes(token))
    let anchored = objective.hints.filter(isAnchored).length
    const prefixes = [
      `围绕“${title}”这项当前操作，`,
      `结合本题引用事实“${facts[0] ?? title}”，`,
    ]
    for (let hintIndex = 0; hintIndex < objective.hints.length && anchored < 2; hintIndex += 1) {
      if (isAnchored(objective.hints[hintIndex]!)) continue
      objective.hints[hintIndex] = `${prefixes[Math.min(anchored, prefixes.length - 1)]}${objective.hints[hintIndex]}`
      anchored += 1
    }
  })
}

function minimalSafeStarter(
  priorStarter: string,
  contract: CodeLabPublicPayload["execution_contract"],
): string {
  const recallFact = contract.execution_mode === "stdin_stdout"
    && contract.input_contract.type === "none"
    && (contract.output_contract.constraints ?? []).some((entry) =>
      /事实文本|替换\s*TODO|只需替换/u.test(entry))
  if (recallFact) {
    return [
      "# TODO: 只替换引号内的占位文本，保留变量和输出语句",
      "fact_text = \"TODO：填写题目要求的事实文本\"",
      "print(fact_text)",
      "",
    ].join("\n")
  }
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
    if (normalized.secondary_reference_solution) {
      normalized.secondary_reference_solution = ensureZeroArgumentEntryPoint(
        normalizeFunctionReturnSemantics(normalized.secondary_reference_solution),
        contract.entry_point,
        normalized.hidden_tests.map((test) => test.input),
      )
    }
  } else {
    normalized.reference_solution = ensureZeroArgumentFunctionIsInvoked(
      normalized.reference_solution,
    )
    if (normalized.secondary_reference_solution) {
      normalized.secondary_reference_solution = ensureZeroArgumentFunctionIsInvoked(
        normalized.secondary_reference_solution,
      )
    }
    const legacyExpected = normalized.hidden_tests.filter((test): test is typeof test & {
      expected: unknown
      comparison: { kind: string }
    } => test.expected !== undefined && test.comparison !== undefined)
    normalizePrintedStdoutExpectations(normalized.reference_solution, legacyExpected)
  }
  return normalized
}

function markTrustedExpectedPending(payload: CodeLabSecurePayload): CodeLabSecurePayload {
  const pending = structuredClone(payload)
  pending.hidden_tests.forEach((test) => {
    test.expected = { __trusted_expected_pending__: true }
    test.comparison = classifyOutputContract(pending.execution_contract.output_contract) === "number"
      ? { kind: "numeric", abs_tolerance: 1e-9, rel_tolerance: 1e-9 }
      : { kind: "exact" }
  })
  return pending
}

function normalizeAssessmentSecureAuthorPayload(
  payload: AssessmentSecureAuthorPayload,
  publicPayload: AssessmentPublicPayload,
  plan?: AssessmentItemPlan[],
  evidence?: TieredEvaluatorRequest["evidence_pack"],
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
    } else {
      restorePlannedMisconceptionBinding(
        item,
        publicPayload.items[index],
        plan?.[index],
        evidence,
      )
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

/**
 * Secure author 偶尔会把冻结的 misconception ID 改写成一段自然语言。
 * 只有当某个公开错误选项与知识库中该误区的错误信念确实匹配时，才把稳定
 * ID 恢复到该选项；找不到语义锚点就保持失败关闭，绝不盲绑第一个干扰项。
 */
function restorePlannedMisconceptionBinding(
  item: AssessmentSecureAuthorPayload["items"][number],
  publicItem: AssessmentPublicPayload["items"][number] | undefined,
  itemPlan: AssessmentItemPlan | undefined,
  evidence: TieredEvaluatorRequest["evidence_pack"] | undefined,
): void {
  const targetId = itemPlan?.target_misconception_id
  if (!targetId || Object.values(item.misconception_by_option).includes(targetId)) return
  const misconception = evidence?.results
    .flatMap((entry) => entry.misconceptions ?? [])
    .find((entry) => entry.misconceptionId === targetId)
  if (!misconception || !publicItem?.options?.length || !item.correct_option_id) return
  const anchor = normalizeMisconceptionText(misconception.incorrectBelief)
  const candidates = publicItem.options.filter((option) =>
    option.option_id !== item.correct_option_id)
  const matched = candidates
    .map((option) => ({ option, score: textSimilarity(
      normalizeMisconceptionText(option.text),
      anchor,
    ) }))
    .sort((left, right) => right.score - left.score)[0]
  if (!matched || matched.score < 0.58) return
  item.misconception_by_option[matched.option.option_id] = targetId
}

function normalizeMisconceptionText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[\s，。！？；：,.!?;:'"“”‘’（）()]/gu, "")
}

function textSimilarity(left: string, right: string): number {
  if (!left || !right) return 0
  if (left.includes(right) || right.includes(left)) {
    return Math.min(left.length, right.length) / Math.max(left.length, right.length)
  }
  const leftPairs = characterPairs(left)
  const rightPairs = characterPairs(right)
  if (leftPairs.size === 0 || rightPairs.size === 0) return 0
  const overlap = [...leftPairs].filter((pair) => rightPairs.has(pair)).length
  return (2 * overlap) / (leftPairs.size + rightPairs.size)
}

function characterPairs(value: string): Set<string> {
  return new Set(Array.from({ length: Math.max(0, value.length - 1) }, (_, index) =>
    value.slice(index, index + 2)))
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
  const envelope = input as { args?: unknown[]; kwargs?: Record<string, unknown>; files?: Record<string, unknown> }
  return Array.isArray(envelope.args)
    && envelope.args.length === 0
    && Object.keys(envelope.kwargs ?? {}).length === 0
    && Object.keys(envelope.files ?? {}).length === 0
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

/** Make the planned submission shape explicit before the first model call. */
export function codeLabPublicAuthorSchema(problem?: Pick<ProgrammingProblemBlueprint, "task_kind">): Record<string, unknown> {
  const schema = fragment("code_lab_draft.schema.json", "/$defs/public_author_payload")
  if (!problem) return schema
  schema.required = [...new Set([...(schema.required as string[]), "programming_task"])]
  const task = asRecord(asRecord(schema.properties).programming_task)
  if (problem.task_kind === "code_completion") {
    task.required = [...new Set([...(task.required as string[]), "gap_template"])]
  } else {
    delete asRecord(task.properties).gap_template
  }
  return schema
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

function assertGenerationSpecProviderInput(
  spec: ConceptTutorRequest["generation_spec"],
): void {
  const report = validateRoleCSchema("generation_spec.schema.json", spec)
  if (!report.ok) {
    throw new ModelOutputValidationError(
      "generation_spec.preflight",
      validationIssueStrings(report),
    )
  }
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

function candidateCount(value: ModelBackedProviderOptions["public_candidate_count"]): 1 | 2 | 3 {
  return value ?? 1
}

function publicCandidateContext(kind: PublicArtifactKind, variantIndex: number): {
  candidate_id: string
  variant_index: number
  design_emphasis: string
  diversity_rule: string
} {
  const emphases: Record<PublicArtifactKind, string[]> = {
    concept_lesson: [
      "先建立清晰心智模型，再用直接实例和误区对比推进",
      "以问题驱动的解释组织内容，并在关键步骤安排即时检查",
      "以渐退式 worked example 组织讲解，最后改变表示方式做迁移",
    ],
    code_lab: [
      "采用真实但紧凑的任务分解，starter 只保留必要脚手架",
      "围绕典型误区设计公开自查，提示从方向到局部线索逐级展开",
      "改变输入组织或实现路径，突出边界行为与反思价值",
    ],
    assessment: [
      "直接测量冻结构念，干扰项对应真实误区且长度结构均衡",
      "改变认知操作与表示方式，避免复述讲义或代码实验",
      "高阶题改变任务结构形成迁移，同时控制无关阅读负担",
    ],
  }
  return {
    candidate_id: `${kind}-candidate-${variantIndex + 1}`,
    variant_index: variantIndex,
    design_emphasis: emphases[kind][variantIndex] ?? emphases[kind][0]!,
    diversity_rule: "与同轮其他候选在教学组织或认知操作上实质不同；不得只换名称、数字、句序或场景词。",
  }
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
