import { expectedMarkerForWorker } from "./worker-contract"
import { ORCHESTRATION_WORKER_SEQUENCE } from "./state-machine"
import { loadKnowledgeBase } from "../knowledge/loader"
import { resolveLearningGoalSpec } from "../knowledge/curriculum"
import { synthesizeProfile } from "../role-b-profile/profile-synthesizer"
import {
  assessProfileIntake,
  buildRoleCProfileSnapshotOptions,
  createLearnerProfileV2,
  isLearnerProfileV2,
} from "../role-b-profile/learner-profile-v2"
import { executeProfileRetrieval } from "../role-b-profile/rag-bridge"
import { buildLearningEvidenceRequest, retrieveLearningEvidence } from "../rag/learning-evidence"
import { buildFormalPath, startPath } from "../role-b-profile/teaching-audit/formal-path"
import { adaptLearnerProfile, type ProfileSnapshotOptions } from "../role-c-content/contracts/profile-adapter"
import { adaptRagResult } from "../role-c-content/contracts/evidence-pack"
import { buildGenerationSpec } from "../role-c-content/contracts/generation-spec"
import { generateConceptLesson } from "../role-c-content/agents/concept-tutor"
import { generateCodeLab } from "../role-c-content/agents/code-lab"
import { buildResourceBlueprint } from "../role-c-content/planning/resource-blueprint"
import { bindObjectiveEvidence } from "../role-c-content/planning/objective-evidence-bundle"
import { generateAssessment } from "../role-c-content/agents/tiered-evaluator"
// 确定性模板 Provider 已于 2026-08 删除。
// 请改用 ModelBackedRoleCContentProvider 并确保模型已配置。
// 以下为临时占位，抛出明确错误以便迁移。
import { ModelBackedRoleCContentProvider } from "../role-c-content/providers/model-backed-provider"
import { modelBackedProviderOptionsFromEnv } from "../role-c-content/providers/model-backed-provider-env"
import { createRoleCModelGatewayFromEnv } from "../role-c-content/contracts/model-gateway"
import { ROLE_C_PROMPT_MANIFEST_VERSION } from "../role-c-content/prompts/common-policy"
import { TrustedCodeLabVerifier } from "../role-c-content/validators/code-lab-validator"
import { TrustedAssessmentVerifier } from "../role-c-content/validators/assessment-validator"
import { createDockerPythonCodeRunnerFromEnv } from "../role-c-content/security/code-runner"
import type { RagResult } from "../rag/retriever"
import type { LearningPathNode } from "../role-c-content/contracts/profile-adapter"

import type { CodeLabPublicArtifact, ConceptLessonArtifact } from "../role-c-content/contracts/artifacts"
import type {
  BackgroundEvidence,
  LearnerProfile,
  ObjectiveDiagnosisEvidence,
  ProfileProvenance,
  RagRequest,
  SelfAssessmentEvidence,
} from "../role-b-profile/types"
import type {
  ClarificationRequest,
  EvidenceRef,
  LearnerRequest,
  MasteryUpdate,
  OrchestrationState,
  WorkerInvocation,
  WorkerName,
  WorkerResult,
} from "./types"
import type { LearnerMemorySnapshot, PersistenceEvent } from "./learner-memory"

export interface CreateScaffoldWorkerInvocationInput {
  session_id: string
  run_id: string
  step_index: number
  stage: OrchestrationState
  worker: WorkerName
  learner_request: LearnerRequest
  upstream_artifacts: Record<string, unknown>
  input_refs: string[]
  evidence_refs: EvidenceRef[]
}

const ROLE_B_EVIDENCE_FILE = "examples/learner_evidence_loop_weak.json"

/** 由 run_id 派生确定性 seed：同一轮次可复现，跨轮/跨学习者不同（替代硬编码 0）。 */
function seedFromRunId(runId: string): number {
  let hash = 0
  for (let i = 0; i < runId.length; i += 1) {
    hash = (hash * 31 + runId.charCodeAt(i)) | 0
  }
  return Math.abs(hash) >>> 0
}

/** 创建 Role C 的模型 Provider。确定性模板已删除，仅支持模型路径。 */
function resolveRoleCProvider(): { ok: true; provider: ModelBackedRoleCContentProvider } | { ok: false; reason: string } {
  try {
    const gateway = createRoleCModelGatewayFromEnv(process.env)
    return {
      ok: true,
      provider: new ModelBackedRoleCContentProvider(gateway, {
        ...modelBackedProviderOptionsFromEnv(process.env),
        max_repair_attempts: 2,
        concept_group_size: 1,
      }),
    }
  } catch (error) {
    return {
      ok: false,
      reason: `无法创建模型 Provider：${error instanceof Error ? error.message : "未知错误"}。请确认 ROLE_C_PROVIDER_MODE=model 且模型接口已配置。`,
    }
  }
}

function resolveRoleCProviderOrFail(): ModelBackedRoleCContentProvider {
  const resolved = resolveRoleCProvider()
  if (!resolved.ok) {
    throw new Error(resolved.reason)
  }
  return resolved.provider
}

interface RoleBEvidenceBundle {
  background: BackgroundEvidence
  self_assessment: SelfAssessmentEvidence
  objective_diagnosis: ObjectiveDiagnosisEvidence
}

export function createScaffoldWorkerInvocation(
  input: CreateScaffoldWorkerInvocationInput,
): WorkerInvocation {
  return {
    schema_version: "1.0",
    session_id: input.session_id,
    run_id: input.run_id,
    step_index: input.step_index,
    stage: input.stage,
    worker: input.worker,
    learner_request: input.learner_request,
    upstream_artifacts: input.upstream_artifacts,
    input_refs: input.input_refs,
    evidence_refs: input.evidence_refs,
    retry_count: 0,
    mode: "scaffold",
  }
}

export async function runWorkerAdapter(
  invocation: WorkerInvocation,
): Promise<WorkerResult> {
  if (invocation.mode === "scaffold") {
    return runScaffoldWorkerAdapter(invocation)
  }

  const deterministicResult = await runDeterministicWorkerAdapter(invocation)
  if (deterministicResult) return deterministicResult

  return failedResult(invocation, {
    code: "DETERMINISTIC_ADAPTER_NOT_IMPLEMENTED",
    message: `deterministic adapter for ${invocation.worker} is not implemented yet`,
    severity: "fatal",
  })
}

export async function runScaffoldWorkerAdapter(
  invocation: WorkerInvocation,
): Promise<WorkerResult> {
  const expected = ORCHESTRATION_WORKER_SEQUENCE.find((step) => step.from === invocation.stage)
  if (!expected || expected.worker !== invocation.worker) {
    return failedResult(invocation, {
      code: "ADAPTER_STAGE_WORKER_MISMATCH",
      message: `stage ${invocation.stage} expects ${expected?.worker ?? "no-worker"}, received ${invocation.worker}`,
      severity: "fatal",
    })
  }

  return completedResult(invocation, expected.to, {
    mode: "scaffold",
    learner_goal: invocation.learner_request.goal,
    received_input_refs: invocation.input_refs,
    received_evidence_refs: invocation.evidence_refs.map((ref) => ref.ref_id),
  }, `Scaffold worker ${invocation.worker} acknowledged ${invocation.stage}`)
}

async function runDeterministicWorkerAdapter(
  invocation: WorkerInvocation,
): Promise<WorkerResult | undefined> {
  const expected = ORCHESTRATION_WORKER_SEQUENCE.find((step) => step.from === invocation.stage)
  if (!expected || expected.worker !== invocation.worker) {
    return failedResult(invocation, {
      code: "ADAPTER_STAGE_WORKER_MISMATCH",
      message: `stage ${invocation.stage} expects ${expected?.worker ?? "no-worker"}, received ${invocation.worker}`,
      severity: "fatal",
    })
  }

  if (invocation.worker === "background-collector") {
    const bundle = await loadRoleBEvidenceBundle()
    return completedResult(invocation, expected.to, {
      mode: "deterministic",
      evidence: bundle.background,
      evidence_source: ROLE_B_EVIDENCE_FILE,
    }, "Loaded deterministic Role B background evidence")
  }

  if (invocation.worker === "self-assessor") {
    const bundle = await loadRoleBEvidenceBundle()
    return completedResult(invocation, expected.to, {
      mode: "deterministic",
      evidence: bundle.self_assessment,
      evidence_source: ROLE_B_EVIDENCE_FILE,
    }, "Loaded deterministic Role B self-assessment evidence")
  }

  if (invocation.worker === "objective-diagnostician") {
    const bundle = await loadRoleBEvidenceBundle()
    const learningGoalSpec = resolveLearningGoalSpec(invocation.learner_request.learning_goal_spec ?? {
      mode: "custom_goal",
      custom_goal: invocation.learner_request.goal,
    })
    return completedResult(invocation, expected.to, {
      mode: "deterministic",
      evidence: bundle.objective_diagnosis,
      learning_goal_spec: learningGoalSpec,
      evidence_source: ROLE_B_EVIDENCE_FILE,
    }, "Loaded deterministic Role B objective diagnosis evidence")
  }

  if (invocation.worker === "profile-builder") {
    const background = extractRoleBEvidence<BackgroundEvidence>(invocation, "background-collector", "background evidence")
    const selfAssessment = extractRoleBEvidence<SelfAssessmentEvidence>(invocation, "self-assessor", "self-assessment evidence")
    const objectiveDiagnosis = extractRoleBEvidence<ObjectiveDiagnosisEvidence>(invocation, "objective-diagnostician", "objective diagnosis evidence")
    if (!background.ok) return background.result
    if (!selfAssessment.ok) return selfAssessment.result
    if (!objectiveDiagnosis.ok) return objectiveDiagnosis.result

    const knowledgeBase = await loadKnowledgeBase()
    const synthesis = synthesizeProfile({
      background: background.value,
      selfAssessment: selfAssessment.value,
      objectiveDiagnosis: objectiveDiagnosis.value,
      knowledgeBase,
    })
    const intake = invocation.learner_request.profile_intake
    if (intake) {
      const intakeAssessment = assessProfileIntake(intake, { include_recommended: false, max_questions: 10 })
      if (intakeAssessment.status !== "ready") {
        return blockedResult(invocation, {
          code: "PROFILE_INTAKE_INCOMPLETE",
          message: `结构化画像缺少必要字段：${intakeAssessment.missing_required_fields.join("、")}`,
          severity: "recoverable",
          details: { questions: intakeAssessment.questions },
        })
      }
    }
    const profile = intake
      ? createLearnerProfileV2({
          core_profile: synthesis.profile,
          intake,
          profile_version: `${invocation.run_id}-profile-v2-r1`,
        })
      : synthesis.profile
    const ragRequest: RagRequest = {
      ...synthesis.rag_request,
      learner_profile: profile,
    }

    return completedResult(invocation, expected.to, {
      mode: "deterministic",
      profile,
      provenance: synthesis.provenance,
      rag_request: ragRequest,
    }, intake
      ? "Synthesized structured Role B learner profile v2"
      : "Synthesized deterministic Role B learner profile")
  }

  if (invocation.worker === "path-planner") {
    const profileArtifact = extractProfileBuilderArtifact(invocation)
    if (!profileArtifact.ok) return profileArtifact.result

    const knowledgeBase = await loadKnowledgeBase()
    const { rag_request, rag_result } = await executeProfileRetrieval(
      profileArtifact.value.profile,
      undefined,
      {
        run_id: invocation.run_id,
        profile_version: `${invocation.run_id}-profile-v1`,
      },
    )
    if (rag_result.match_status !== "strong") {
      return blockedResult(invocation, {
        code: rag_result.match_status === "no_match" ? "A_RAG_NO_MATCH" : "A_RAG_WEAK_MATCH",
        message: "A 尚未形成足以规划正式路径的目标发现结果",
        severity: "recoverable",
      })
    }

    const profileSnapshot = adaptLearnerProfile(
      profileArtifact.value.profile,
      snapshotOptions(profileArtifact.value.profile, `${invocation.run_id}-profile-v1`),
    )
    const learningGoalSpec = resolveLearningGoalSpec(invocation.learner_request.learning_goal_spec ?? {
      mode: "custom_goal",
      custom_goal: invocation.learner_request.goal,
    })
    const goalSourceIds = learningGoalSpec.mapped_source_ids.length > 0
      ? learningGoalSpec.mapped_source_ids
      : rag_result.results.map((item) => item.source_id)
    const formalPath = buildFormalPath({
      learnerProfile: profileArtifact.value.profile,
      knowledgeBase,
      profileSnapshot,
      goalSourceIds,
    })
    if (formalPath.planning_outcome.status !== "ready") {
      return blockedResult(invocation, {
        code: formalPath.planning_outcome.code,
        message: formalPath.planning_outcome.message,
        severity: "recoverable",
        details: {
          requested_source_ids: formalPath.planning_outcome.requested_source_ids,
          resolved_source_ids: formalPath.planning_outcome.resolved_source_ids,
          unresolved_source_ids: formalPath.planning_outcome.unresolved_source_ids,
        },
      })
    }
    const startedPath = startPath(formalPath)
    const pathRagResult = startedPath.nextPathNode
      ? await retrieveLearningEvidence(buildLearningEvidenceRequest({
          run_id: invocation.run_id,
          retrieval_mode: "identity_hydration",
          learner_profile: {
            profile_version: profileSnapshot.profile_version,
            level: profileArtifact.value.profile.level,
            known_concepts: [...profileArtifact.value.profile.known_concepts],
            weak_concepts: [...profileArtifact.value.profile.weak_concepts],
            goal: profileArtifact.value.profile.goal,
          },
          path_context: startedPath.nextPathNode,
          learning_context: {
            action: "advance",
            focus_objective_ids: startedPath.nextPathNode.objectives.map((item) => item.objective_id),
            misconception_tags: [],
            reason_codes: ["initial_path_node_activated"],
          },
          resource_needs: ["fact", "prerequisite", "example", "practice_task"],
          parent_retrieval_id: rag_result.retrieval_id ?? rag_result.retrieval_context?.request_id,
          top_k: Math.max(1, startedPath.nextPathNode.target_source_ids.length
            + startedPath.nextPathNode.prerequisite_source_ids.length),
        }), knowledgeBase)
      : rag_result
    if (startedPath.nextPathNode && pathRagResult.match_status !== "strong") {
      return blockedResult(invocation, {
        code: pathRagResult.match_status === "no_match" ? "A_RAG_NO_MATCH" : "A_RAG_WEAK_MATCH",
        message: "当前路径节点没有形成完整的目标级事实覆盖",
        severity: "recoverable",
      })
    }

    return completedResult(invocation, expected.to, {
      mode: "deterministic",
      profile: profileArtifact.value.profile,
      provenance: profileArtifact.value.provenance,
      a_rag_request: rag_request,
      a_rag_result: pathRagResult,
      formal_path: startedPath.path,
      next_path_node: startedPath.nextPathNode,
      path_completed: startedPath.pathCompleted,
    }, "Planned deterministic Role B formal path with A RAG evidence")
  }

  if (invocation.worker === "concept-tutor") {
    const pathArtifact = extractPathPlannerArtifact(invocation)
    if (!pathArtifact.ok) return pathArtifact.result
    if (!pathArtifact.value.next_path_node) {
      return failedResult(invocation, {
        code: "MISSING_UPSTREAM_ARTIFACT",
        message: "concept-tutor requires a non-null next_path_node from path-planner",
        severity: "fatal",
      })
    }

    const profileSnapshot = adaptLearnerProfile(
      pathArtifact.value.profile,
      snapshotOptions(pathArtifact.value.profile, `${invocation.run_id}-profile-v1`),
    )
    const knowledgeBase = await loadKnowledgeBase()
    const evidencePack = adaptRagResult(pathArtifact.value.a_rag_result, {
      kb_version: knowledgeBase.version,
      rag_version: "deterministic-rag-v1",
    })
    const pathNode = fillRequiredFacts(pathArtifact.value.next_path_node, evidencePack)
    const gateway = createRoleCModelGatewayFromEnv(process.env)
    const runner = await createDockerPythonCodeRunnerFromEnv(process.env)
    const specResult = buildGenerationSpec({
      run_id: invocation.run_id,
      profile_snapshot: profileSnapshot,
      path_node: pathNode,
      evidence_pack: evidencePack,
      versions: {
        prompt_version: ROLE_C_PROMPT_MANIFEST_VERSION,
        model_config_hash: gateway.model_config_hash,
        runner_image_digest: runner.runner_image_digest,
      },
      seed: seedFromRunId(invocation.run_id),
    })
    if (!specResult.ok) {
      return failedResult(invocation, {
        code: specResult.code,
        message: specResult.errors.join("；"),
        severity: "fatal",
      })
    }

    const conceptLesson = await generateConceptLesson({
      generation_spec: specResult.spec,
      evidence_pack: evidencePack,
    }, resolveRoleCProviderOrFail())
    if (conceptLesson.status !== "ready") {
      return failedResult(invocation, {
        code: conceptLesson.blocked_reason?.code ?? conceptLesson.failure_reason?.code ?? "CONCEPT_TUTOR_NOT_READY",
        message: conceptLesson.blocked_reason?.message ?? conceptLesson.failure_reason?.message ?? "concept-tutor did not produce a ready lesson",
        severity: "fatal",
      })
    }

    return completedResult(invocation, expected.to, {
      mode: "deterministic",
      generation_spec: specResult.spec,
      evidence_pack: evidencePack,
      concept_lesson: conceptLesson,
    }, "Generated deterministic Role C concept lesson")
  }

  if (invocation.worker === "code-lab") {
    const conceptArtifact = extractConceptTutorArtifact(invocation)
    if (!conceptArtifact.ok) return conceptArtifact.result

    const runner = await createDockerPythonCodeRunnerFromEnv(process.env)
    // 与 content-pipeline 一致：先构建 ResourceBlueprint（CodeLabTaskContract 由
    // planning 层决定执行接口），不再让生成阶段静默回退 deriveCodeLabExecutionMode。
    const spec = conceptArtifact.value.generation_spec
    const evidencePack = conceptArtifact.value.evidence_pack
    const resourceBlueprint = buildResourceBlueprint(spec, evidencePack)
    const pair = await generateCodeLab({
      generation_spec: spec,
      evidence_pack: evidencePack,
      concept_artifact: conceptArtifact.value.concept_lesson,
      resource_blueprint: resourceBlueprint,
    }, resolveRoleCProviderOrFail(), new TrustedCodeLabVerifier(runner))

    if (pair.public_artifact.status !== "ready" || pair.secure_artifact.status !== "ready") {
      return failedResult(invocation, {
        code: pair.public_artifact.blocked_reason?.code ?? pair.public_artifact.failure_reason?.code ?? "CODE_LAB_NOT_READY",
        message: pair.public_artifact.blocked_reason?.message ?? pair.public_artifact.failure_reason?.message ?? "code-lab did not produce ready public and secure artifacts",
        severity: "fatal",
      })
    }

    return completedResult(invocation, expected.to, {
      mode: "deterministic",
      generation_spec: conceptArtifact.value.generation_spec,
      evidence_pack: conceptArtifact.value.evidence_pack,
      concept_lesson: conceptArtifact.value.concept_lesson,
      code_lab_public: pair.public_artifact,
      code_lab_secure: pair.secure_artifact,
    }, "Generated deterministic Role C code-lab artifacts")
  }

  if (invocation.worker === "tiered-evaluator") {
    const codeLabArtifact = extractCodeLabArtifact(invocation)
    if (!codeLabArtifact.ok) return codeLabArtifact.result

    const runner = await createDockerPythonCodeRunnerFromEnv(process.env)
    const pair = await generateAssessment({
      generation_spec: codeLabArtifact.value.generation_spec,
      evidence_pack: codeLabArtifact.value.evidence_pack,
      concept_artifact: codeLabArtifact.value.concept_lesson,
      code_lab_summary: {
        lab_id: codeLabArtifact.value.code_lab_public.payload?.lab_id ?? "unknown-lab",
        objective_ids: codeLabArtifact.value.code_lab_public.payload?.objective_ids ?? [],
        execution_verified: codeLabArtifact.value.code_lab_public.quality.execution_verified === true,
      },
    }, resolveRoleCProviderOrFail(), new TrustedAssessmentVerifier(runner))

    if (pair.public_artifact.status !== "ready" || pair.secure_artifact.status !== "ready") {
      return failedResult(invocation, {
        code: pair.public_artifact.blocked_reason?.code ?? pair.public_artifact.failure_reason?.code ?? "ASSESSMENT_NOT_READY",
        message: pair.public_artifact.blocked_reason?.message ?? pair.public_artifact.failure_reason?.message ?? "tiered-evaluator did not produce ready public and secure artifacts",
        severity: "fatal",
      })
    }

    return completedResult(invocation, expected.to, {
      mode: "deterministic",
      generation_spec: codeLabArtifact.value.generation_spec,
      evidence_pack: codeLabArtifact.value.evidence_pack,
      concept_lesson: codeLabArtifact.value.concept_lesson,
      code_lab_public: codeLabArtifact.value.code_lab_public,
      assessment_public: pair.public_artifact,
      assessment_secure: pair.secure_artifact,
    }, "Generated deterministic Role C assessment artifacts")
  }

  return undefined
}

function completedResult(
  invocation: WorkerInvocation,
  next: OrchestrationState,
  artifacts: Record<string, unknown>,
  summary: string,
): WorkerResult {
  const callbacks = buildWorkerCallbacks(invocation, artifacts)
  return {
    schema_version: "1.0",
    run_id: invocation.run_id,
    step_index: invocation.step_index,
    worker: invocation.worker,
    stage: invocation.stage,
    status: "completed",
    marker: expectedMarkerForWorker(invocation.worker),
    execution: {
      worker: invocation.worker,
      status: "completed",
      execution_id: `${invocation.run_id}:${invocation.step_index}:${invocation.worker}`,
      marker: expectedMarkerForWorker(invocation.worker),
    },
    summary,
    artifacts: {
      ...artifacts,
      worker: invocation.worker,
      stage: invocation.stage,
    },
    output_refs: [`${invocation.worker}:${invocation.mode}-result`],
    evidence_refs: invocation.evidence_refs,
    next,
    errors: [],
    ...callbacks,
  }
}

function buildWorkerCallbacks(
  invocation: WorkerInvocation,
  artifacts: Record<string, unknown>,
): Pick<WorkerResult, "persistence_events" | "mastery_updates" | "learned_facts_about_user" | "clarification_requests" | "next_step_recommendation"> {
  const persistenceEvents: PersistenceEvent[] = []
  const masteryUpdates: MasteryUpdate[] = []
  const clarificationRequests: ClarificationRequest[] = []

  if (invocation.worker === "objective-diagnostician" && isRecord(artifacts.evidence)) {
    const evidence = artifacts.evidence as unknown as ObjectiveDiagnosisEvidence
    for (const item of evidence.items) {
      if (item.verdict === "unanswered") continue
      const mastery = item.verdict === "correct" ? 0.82 : 0.25
      masteryUpdates.push({ source_id: item.source_id, mastery, evidence: `objective diagnosis ${item.verdict}: ${item.question}` })
      persistenceEvents.push({ event_type: "mastery_update", source: invocation.worker, source_id: item.source_id, mastery, evidence: `objective diagnosis ${item.verdict}` })
    }
  }

  if (invocation.worker === "profile-builder") {
    const profile = isRecord(artifacts.profile) ? artifacts.profile as unknown as LearnerProfile : null
    if (profile?.goal.includes("成绩统计") && !memoryHasSource(invocation, "K013")) {
      clarificationRequests.push({
        question: "你是否学过函数定义与调用？",
        reason: "成绩统计项目需要函数基础，但历史记录缺少 K013 掌握证据",
        expected_answer_type: "choice",
        options: ["学过并能使用", "学过但不熟", "没学过"],
      })
    }
  }

  if (invocation.worker === "tiered-evaluator") {
    for (const sourceId of ["K007", "K009", "K018"]) {
      masteryUpdates.push({ source_id: sourceId, mastery: 0.86, evidence: "deterministic assessment artifact generated and verified" })
      persistenceEvents.push({ event_type: "mastery_update", source: invocation.worker, source_id: sourceId, mastery: 0.86, evidence: "deterministic assessment artifact generated and verified" })
    }
  }

  return {
    persistence_events: persistenceEvents,
    mastery_updates: masteryUpdates,
    learned_facts_about_user: invocation.worker === "background-collector"
      ? [{ key: "learning_goal", value: invocation.learner_request.goal, confidence: 1 }]
      : [],
    clarification_requests: clarificationRequests,
    next_step_recommendation: {
      action: clarificationRequests.length > 0 ? "ask_clarification" : "continue",
      reason: clarificationRequests.length > 0 ? "worker requested additional learner context" : "worker completed with enough context to continue",
    },
  }
}

function extractLearnerMemory(invocation: WorkerInvocation): LearnerMemorySnapshot | undefined {
  const memory = invocation.upstream_artifacts["learner-memory"]
  return isRecord(memory) ? memory as unknown as LearnerMemorySnapshot : undefined
}

function memoryHasSource(invocation: WorkerInvocation, sourceId: string): boolean {
  const memory = extractLearnerMemory(invocation)
  return Boolean(memory?.mastered_source_ids.includes(sourceId) || memory?.weak_source_ids.includes(sourceId))
}

function failedResult(
  invocation: WorkerInvocation,
  error: WorkerResult["errors"][number],
): WorkerResult {
  return {
    schema_version: "1.0",
    run_id: invocation.run_id,
    step_index: invocation.step_index,
    worker: invocation.worker,
    stage: invocation.stage,
    status: "failed",
    marker: expectedMarkerForWorker(invocation.worker),
    execution: {
      worker: invocation.worker,
      status: "failed",
      execution_id: `${invocation.run_id}:${invocation.step_index}:${invocation.worker}`,
      marker: expectedMarkerForWorker(invocation.worker),
    },
    summary: error.message,
    artifacts: {
      mode: invocation.mode,
      worker: invocation.worker,
      stage: invocation.stage,
    },
    output_refs: [],
    evidence_refs: invocation.evidence_refs,
    next: "failed",
    errors: [error],
  }
}

function blockedResult(
  invocation: WorkerInvocation,
  error: WorkerResult["errors"][number],
): WorkerResult {
  return {
    schema_version: "1.0",
    run_id: invocation.run_id,
    step_index: invocation.step_index,
    worker: invocation.worker,
    stage: invocation.stage,
    status: "blocked",
    marker: expectedMarkerForWorker(invocation.worker),
    execution: {
      worker: invocation.worker,
      status: "blocked",
      execution_id: `${invocation.run_id}:${invocation.step_index}:${invocation.worker}`,
      marker: expectedMarkerForWorker(invocation.worker),
    },
    summary: error.message,
    artifacts: {
      mode: invocation.mode,
      worker: invocation.worker,
      stage: invocation.stage,
      retrieval_issue: error.code,
    },
    output_refs: [],
    evidence_refs: invocation.evidence_refs,
    next: "blocked",
    errors: [error],
  }
}

async function loadRoleBEvidenceBundle(): Promise<RoleBEvidenceBundle> {
  return Bun.file(ROLE_B_EVIDENCE_FILE).json() as Promise<RoleBEvidenceBundle>
}

function extractRoleBEvidence<T>(
  invocation: WorkerInvocation,
  worker: WorkerName,
  label: string,
): { ok: true; value: T } | { ok: false; result: WorkerResult } {
  const artifact = invocation.upstream_artifacts[worker]
  if (!isRecord(artifact) || !("evidence" in artifact)) {
    return {
      ok: false,
      result: failedResult(invocation, {
        code: "MISSING_UPSTREAM_ARTIFACT",
        message: `profile-builder requires ${label} from ${worker}`,
        severity: "fatal",
      }),
    }
  }
  return { ok: true, value: artifact.evidence as T }
}

interface ProfileBuilderArtifact {
  profile: LearnerProfile
  provenance: ProfileProvenance
  rag_request: RagRequest
}

function snapshotOptions(profile: LearnerProfile, fallbackVersion: string): ProfileSnapshotOptions {
  return isLearnerProfileV2(profile)
    ? buildRoleCProfileSnapshotOptions(profile)
    : {
        profile_version: fallbackVersion,
        provenance_ref: "profile-builder:deterministic-result",
      }
}

function extractProfileBuilderArtifact(
  invocation: WorkerInvocation,
): { ok: true; value: ProfileBuilderArtifact } | { ok: false; result: WorkerResult } {
  const artifact = invocation.upstream_artifacts["profile-builder"]
  if (!isRecord(artifact) || !isRecord(artifact.profile) || !isRecord(artifact.rag_request)) {
    return {
      ok: false,
      result: failedResult(invocation, {
        code: "MISSING_UPSTREAM_ARTIFACT",
        message: "path-planner requires profile, provenance, and rag_request from profile-builder",
        severity: "fatal",
      }),
    }
  }
  return { ok: true, value: artifact as unknown as ProfileBuilderArtifact }
}

interface PathPlannerArtifact {
  profile: LearnerProfile
  a_rag_result: RagResult
  next_path_node: LearningPathNode | null
}

function extractPathPlannerArtifact(
  invocation: WorkerInvocation,
): { ok: true; value: PathPlannerArtifact } | { ok: false; result: WorkerResult } {
  const artifact = invocation.upstream_artifacts["path-planner"]
  if (!isRecord(artifact) || !isRecord(artifact.profile) || !isRecord(artifact.a_rag_result)) {
    return {
      ok: false,
      result: failedResult(invocation, {
        code: "MISSING_UPSTREAM_ARTIFACT",
        message: "concept-tutor requires profile, A RAG result, and next_path_node from path-planner",
        severity: "fatal",
      }),
    }
  }
  return { ok: true, value: artifact as unknown as PathPlannerArtifact }
}

interface ConceptTutorArtifact {
  generation_spec: ReturnType<typeof buildGenerationSpec> extends { ok: true; spec: infer T } ? T : never
  evidence_pack: ReturnType<typeof adaptRagResult>
  concept_lesson: ConceptLessonArtifact
}

function extractConceptTutorArtifact(
  invocation: WorkerInvocation,
): { ok: true; value: ConceptTutorArtifact } | { ok: false; result: WorkerResult } {
  const artifact = invocation.upstream_artifacts["concept-tutor"]
  if (!isRecord(artifact) || !isRecord(artifact.generation_spec) || !isRecord(artifact.evidence_pack) || !isRecord(artifact.concept_lesson)) {
    return {
      ok: false,
      result: failedResult(invocation, {
        code: "MISSING_UPSTREAM_ARTIFACT",
        message: "code-lab requires generation_spec, evidence_pack, and concept_lesson from concept-tutor",
        severity: "fatal",
      }),
    }
  }
  return { ok: true, value: artifact as unknown as ConceptTutorArtifact }
}

interface CodeLabArtifact extends ConceptTutorArtifact {
  code_lab_public: CodeLabPublicArtifact
}

function extractCodeLabArtifact(
  invocation: WorkerInvocation,
): { ok: true; value: CodeLabArtifact } | { ok: false; result: WorkerResult } {
  const artifact = invocation.upstream_artifacts["code-lab"]
  if (!isRecord(artifact) || !isRecord(artifact.generation_spec) || !isRecord(artifact.evidence_pack) || !isRecord(artifact.concept_lesson) || !isRecord(artifact.code_lab_public)) {
    return {
      ok: false,
      result: failedResult(invocation, {
        code: "MISSING_UPSTREAM_ARTIFACT",
        message: "tiered-evaluator requires generation_spec, evidence_pack, concept_lesson, and code_lab_public from code-lab",
        severity: "fatal",
      }),
    }
  }
  return { ok: true, value: artifact as unknown as CodeLabArtifact }
}

function fillRequiredFacts(pathNode: LearningPathNode, evidencePack: ReturnType<typeof adaptRagResult>): LearningPathNode {
  return {
    ...pathNode,
    objectives: pathNode.objectives.map((objective) => {
      const bundle = bindObjectiveEvidence(objective, evidencePack.results)
      return {
        ...objective,
        required_fact_ids: bundle.required_fact_ids,
      }
    }),
    assessment_blueprint: { ...pathNode.assessment_blueprint },
  }
}


function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
