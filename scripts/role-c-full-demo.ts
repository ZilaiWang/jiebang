import { loadKnowledgeBase } from "../src/knowledge/loader"
import { retrieveStructuredEvidence } from "../src/rag/structured-evidence"
import { executeProfileRetrieval } from "../src/role-b-profile/rag-bridge"
import type { LearnerProfile } from "../src/role-b-profile/types"
import {
  adaptLearnerProfile,
  adaptRagResult,
  buildGenerationSpec,
  contentHash,
  createLocalABContentReviewPort,
  createDockerPythonCodeRunnerFromEnv,
  createRoleCAgents,
  defineLearningPathNode,
  deliverDynamicFeedbackToD,
  deliverRoleCToB,
  deliverRoleCToD,
  executePreparedNextRound,
  InMemoryLearningCycleStore,
  InMemoryMasteryStateStore,
  InMemoryNextRoundExecutionJournal,
  InMemorySecureArtifactStore,
  LearningCycleService,
  ModelBackedRoleCContentProvider,
  modelBackedProviderOptionsFromEnv,
  ROLE_C_PROMPT_MANIFEST_VERSION,
  runReviewedCPipeline,
  TrustedAssessmentVerifier,
  TrustedCodeLabVerifier,
  type LearningPathNode,
  type RoleBLearningProgressPort,
  type RoleDDynamicFeedbackPort,
  type RoleDPublicDeliveryPort,
  type SubmissionEnvelope,
} from "../src/role-c-content"
import { createRoleCModelGatewayFromEnv } from "../src/role-c-content/contracts/model-gateway"

function resolveProvider(): ModelBackedRoleCContentProvider {
  try {
    const gateway = createRoleCModelGatewayFromEnv(process.env)
    return new ModelBackedRoleCContentProvider(gateway, modelBackedProviderOptionsFromEnv(process.env))
  } catch (error) {
    console.error("模型 Provider 不可用。请复制 .env.role-c.example 为 .env.role-c.local 并配置模型参数。")
    process.exit(1)
  }
}

const runner = await createDockerPythonCodeRunnerFromEnv()
const profileFixture = (await Bun.file("examples/learner_loop_weak.json").json()) as LearnerProfile
const profile: LearnerProfile = {
  ...profileFixture,
  level: "integrated",
  known_concepts: [...profileFixture.known_concepts, "函数定义与调用"],
  goal: "理解循环与列表，并完成一个成绩统计程序",
}
const rawPath = (await Bun.file("examples/role-c-content/learning_path_node_score_project.json").json()) as LearningPathNode
const kb = await loadKnowledgeBase()
const { rag_result: ragResult } = await executeProfileRetrieval(profile)
const snapshot = adaptLearnerProfile(profile, { profile_version: "profile-full-demo-v1" })
const path = defineLearningPathNode({
  node_id: rawPath.node_id,
  target_source_ids: rawPath.target_source_ids,
  prerequisite_source_ids: rawPath.prerequisite_source_ids,
  goal: rawPath.goal,
  objectives: rawPath.objectives,
  assessment_blueprint: rawPath.assessment_blueprint,
})
const requiredSourceIds = [...new Set([
  ...path.target_source_ids,
  ...path.prerequisite_source_ids,
])]
const exactEvidence = await retrieveStructuredEvidence({
  source_ids: requiredSourceIds,
})
if (exactEvidence.missing_source_ids.length > 0) {
  throw new Error(`路径证据缺失：${exactEvidence.missing_source_ids.join("、")}`)
}
const exactBySource = new Map(
  exactEvidence.results.map((item) => [item.sourceId, item]),
)
const recalledBySource = new Map(
  ragResult.results.map((item) => [item.sourceId, item]),
)
const completeRagResult = {
  ...ragResult,
  topK: requiredSourceIds.length,
  results: requiredSourceIds.map((sourceId) => {
    const exact = exactBySource.get(sourceId)
    if (!exact) throw new Error(`路径证据缺失：${sourceId}`)
    const recalled = recalledBySource.get(sourceId)
    return recalled
      ? {
          ...exact,
          score: recalled.score,
          reason: recalled.reason,
          retrievalTrace: structuredClone(recalled.retrievalTrace),
          retrieval_trace: structuredClone(recalled.retrieval_trace),
        }
      : exact
  }),
}
const evidence = adaptRagResult(completeRagResult, {
  kb_version: kb.version,
  rag_version: "rule-rag+structured-path-evidence-1.0",
})
const built = buildGenerationSpec({
  run_id: "RUN-C-FULL-DEMO",
  profile_snapshot: snapshot,
  path_node: path,
  evidence_pack: evidence,
  versions: {
    prompt_version: ROLE_C_PROMPT_MANIFEST_VERSION,
    model_config_hash: "deterministic-full-reference-v1",
    runner_image_digest: runner.runner_image_digest,
  },
  seed: 42,
})

if (!built.ok) {
  console.log(JSON.stringify({ status: "blocked", stage: "intake", result: built }, null, 2))
  process.exit(1)
}

const provider = resolveProvider()
const agents = createRoleCAgents(provider, {
  code_lab: new TrustedCodeLabVerifier(runner),
  assessment: new TrustedAssessmentVerifier(runner),
})
const secureStore = new InMemorySecureArtifactStore()
const pipeline = await runReviewedCPipeline(
  { generation_spec: built.spec, evidence_pack: evidence },
  agents,
  secureStore,
  {
    review_port: createLocalABContentReviewPort({ knowledge_base: kb }),
  },
)

if (pipeline.status !== "ready" || !pipeline.public_artifacts.assessment?.payload) {
  console.log(JSON.stringify({ status: pipeline.status, stage: "content_pipeline", pipeline }, null, 2))
  process.exit(1)
}
const acceptedDeliveryIds = new Set<string>()
const releasePort: RoleDPublicDeliveryPort = {
  async publishReviewedRelease(release) {
    const status = acceptedDeliveryIds.has(release.delivery_id)
      ? "duplicate" as const
      : "accepted" as const
    acceptedDeliveryIds.add(release.delivery_id)
    return {
      schema_version: "1.0",
      delivery_kind: release.delivery_kind,
      delivery_id: release.delivery_id,
      status,
    }
  },
}
const feedbackPort: RoleDDynamicFeedbackPort = {
  async publishDynamicFeedback(delivery) {
    const status = acceptedDeliveryIds.has(delivery.delivery_id)
      ? "duplicate" as const
      : "accepted" as const
    acceptedDeliveryIds.add(delivery.delivery_id)
    return {
      schema_version: "1.0",
      delivery_kind: delivery.delivery_kind,
      delivery_id: delivery.delivery_id,
      status,
    }
  },
}
const progressPort: RoleBLearningProgressPort = {
  async publishLearningProgress(delivery) {
    const status = acceptedDeliveryIds.has(delivery.delivery_id)
      ? "duplicate" as const
      : "accepted" as const
    acceptedDeliveryIds.add(delivery.delivery_id)
    return {
      schema_version: "1.0",
      delivery_kind: delivery.delivery_kind,
      delivery_id: delivery.delivery_id,
      status,
    }
  },
}
const initialReleaseAck = await deliverRoleCToD(releasePort, pipeline)

const publicAssessment = pipeline.public_artifacts.assessment
const formId = publicAssessment.payload.form_id
const answers: SubmissionEnvelope["answers"] = [
  { item_id: "ITEM-O1-T1-MCQ", selected_option_id: "opt_iterate", hint_level_used: 0 },
  { item_id: "ITEM-O2-T1-TF", selected_option_id: "opt_true", hint_level_used: 0 },
  { item_id: "ITEM-O1-T2-TRACE", text_response: "8", hint_level_used: 0 },
  { item_id: "ITEM-O2-T2-SHORT", text_response: "列表保存一组成绩并保持顺序，程序可逐项处理。", hint_level_used: 0 },
  { item_id: "ITEM-O3-T3-CODE", code_response: "def average_score(scores):\n    return 0", hint_level_used: 0 },
]
const submission: SubmissionEnvelope = {
  schema_version: "1.0",
  submission_id: "SUB-C-FULL-DEMO-01",
  run_id: built.spec.run_id,
  learner_id_hash: "learner-demo-hash",
  form_id: formId,
  attempt_no: 1,
  answers,
}
const masteryStore = new InMemoryMasteryStateStore()
const cycleService = new LearningCycleService({
  cycle_store: new InMemoryLearningCycleStore(),
  secure_store: secureStore,
  mastery_store: masteryStore,
  code_runner: runner,
})
await cycleService.registerReadyRun({
  pipeline_input: { generation_spec: built.spec, evidence_pack: evidence },
  pipeline_result: pipeline,
  profile_snapshot: snapshot,
  learner_id_hash: submission.learner_id_hash,
})
const session = await cycleService.openTrustedPreselectedSession({
  routing_policy: "trusted_preselected_v1",
  session_id: "SESSION-C-FULL-DEMO",
  run_id: built.spec.run_id,
  authenticated_learner_id_hash: submission.learner_id_hash,
  attempt_no: submission.attempt_no,
  required_item_ids: answers.map((answer) => answer.item_id),
  revealed_hint_levels: Object.fromEntries(
    answers.map((answer) => [answer.item_id, answer.hint_level_used]),
  ),
  profile_expectations_by_objective: Object.fromEntries(
    built.spec.targets.map((target) => [target.objective_id, "weak" as const]),
  ),
})
const cycle = await cycleService.processSubmissionInternal({
  session_id: session.session_id,
  authenticated_learner_id_hash: submission.learner_id_hash,
  submission,
})
if (cycle.status !== "completed") {
  console.log(JSON.stringify({ status: cycle.status, stage: "learning_cycle", cycle }, null, 2))
  process.exit(1)
}
const completion = cycle.completion
const feedbackAck = await deliverDynamicFeedbackToD(
  feedbackPort,
  completion.feedback,
)
const learningProgressAck = await deliverRoleCToB(
  progressPort,
  completion.outbound_to_b.evidence_events,
  completion.outbound_to_b.profile_drift_suggestion,
)
const nextRound = await cycleService.prepareNextRoundFromCompletedSubmission({
  session_id: session.session_id,
  submission_id: submission.submission_id,
  authenticated_learner_id_hash: completion.feedback.learner_id_hash,
  profile_snapshot: snapshot,
})
if (nextRound.status !== "generation_ready") {
  console.log(JSON.stringify({ status: nextRound.status, stage: "next_round_prepare", next_round: nextRound }, null, 2))
  process.exit(1)
}
const nextRoundJournal = new InMemoryNextRoundExecutionJournal()
const nextRoundDependencies = {
  agents,
  secure_store: secureStore,
  review_options: {
    review_port: createLocalABContentReviewPort({ knowledge_base: kb }),
  },
  review_execution_config_version: "role-c-full-demo-review-v1",
  execution_journal: nextRoundJournal,
}
const generatedNextRound = await executePreparedNextRound(
  nextRound,
  nextRoundDependencies,
)
const replayedNextRound = await executePreparedNextRound(
  structuredClone(nextRound),
  nextRoundDependencies,
)
if (generatedNextRound.status !== "ready"
  || contentHash(replayedNextRound) !== contentHash(generatedNextRound)) {
  console.log(JSON.stringify({
    status: generatedNextRound.status,
    stage: "next_round_execute",
    generated_next_round: generatedNextRound,
  }, null, 2))
  process.exit(1)
}
const nextReleaseAck = await deliverRoleCToD(
  releasePort,
  generatedNextRound,
)

const output = {
  workflow: "B_profile_to_A_evidence_to_C_content_assessment_grade_to_B_mastery",
  status: "ready",
  runner_mode: "docker",
  runner_image_digest: runner.runner_image_digest,
  public_artifacts: {
    concept_lesson: pipeline.public_artifacts.concept_lesson,
    code_lab: pipeline.public_artifacts.code_lab,
    assessment: publicAssessment,
    grade_result: completion.feedback.grade_result,
  },
  grading_summary: {
    status: "graded",
    final_decision: completion.feedback.final_decision,
    round_score: completion.feedback.round_score,
  },
  content_review: {
    policy_version: pipeline.review_policy_version,
    decisions: pipeline.review_reports.map((report) => report.decision),
  },
  delivery_acknowledgements: {
    initial_release: initialReleaseAck,
    dynamic_feedback: feedbackAck,
    learning_progress: learningProgressAck,
    next_release: nextReleaseAck,
  },
  secure_artifact_count: pipeline.secure_refs.length,
  dynamic_feedback: completion.feedback,
  learning_evidence_to_b: completion.outbound_to_b.evidence_events,
  mastery_snapshot: completion.feedback.mastery_snapshot,
  profile_drift_suggestion: completion.outbound_to_b.profile_drift_suggestion ?? null,
  next_round: {
    action: nextRound.action,
    request_id: nextRound.request_id,
    run_id: generatedNextRound.generation_spec.run_id,
    status: generatedNextRound.status,
    public_artifact_ids: Object.values(generatedNextRound.public_artifacts)
      .filter((artifact): artifact is NonNullable<typeof artifact> => Boolean(artifact))
      .map((artifact) => artifact.artifact_id),
    review_decisions: generatedNextRound.review_reports.map((report) => report.decision),
    sequential_replay_verified: true,
  },
  trace_events: pipeline.trace_events,
  security_assertion: "Only public artifacts, public feedback, learning evidence, and trace metadata are included.",
}
console.log(JSON.stringify(output, null, 2))
if (output.status !== "ready") process.exit(1)
