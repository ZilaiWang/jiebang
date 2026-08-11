import { describe, expect, test } from "bun:test"
import { loadKnowledgeBase } from "../src/knowledge/loader"
import { retrieveKnowledge } from "../src/rag/retriever"
import {
  adaptLearnerProfile,
  adaptRagResult,
  buildGenerationSpec,
  createRoleCAgents,
  defineLearningPathNode,
  deliverLearningSessionToD,
  InMemoryLearningCycleStore,
  InMemoryMasteryStateStore,
  InMemorySecureArtifactStore,
  LearningCycleService,
  runReviewedCPipeline,
  SecureArtifactStoreError,
  type AssessmentDraftVerifier,
  type CodeExecutionRequest,
  type CodeLabDraftVerifier,
  type CodeRunner,
  type ContentReviewPort,
  type LearningCycleStore,
  type LearningPathNode,
  type ObjectiveMasteryState,
  type RoleBLearningProgressPort,
  type RoleCLearningProgressDelivery,
  type SubmissionEnvelope,
  type SecureArtifactStore,
} from "../src/role-c-content"
import { createReviewedReleaseDelivery } from "../src/role-c-content/contracts/external-api"
import { generateConceptLesson } from "../src/role-c-content/agents/concept-tutor"
import {
  buildNextRoundContext,
  focusObjectivesForNextRound,
} from "../src/orchestration/interactive-session"
import { generateAssessment } from "../src/role-c-content/agents/tiered-evaluator"
import { contentHash } from "../src/role-c-content/contracts/common"
import type { AssessmentItemSecure, AssessmentSecureArtifact } from "../src/role-c-content/contracts/artifacts"
import type { DynamicFeedbackResult } from "../src/role-c-content/contracts/dynamic-feedback"
import type { SecureArtifact } from "../src/role-c-content/security/secure-artifact-store"
import type { LearnerProfile } from "../src/role-b-profile/types"
import { ROLE_C_PROMPT_MANIFEST_VERSION } from "../src/role-c-content/prompts/common-policy"
import { ModelBackedRoleCContentProvider } from "../src/role-c-content/providers/model-backed-provider"
import { modelBackedProviderOptionsFromEnv } from "../src/role-c-content/providers/model-backed-provider-env"
import { createRoleCModelGatewayFromEnv } from "../src/role-c-content/contracts/model-gateway"
import {
  loadCachedRoleCFixture,
  saveCachedRoleCFixture,
} from "./helpers/role-c-fixture-cache"

function createProvider() {
  const gateway = createRoleCModelGatewayFromEnv(process.env)
  return new ModelBackedRoleCContentProvider(gateway, modelBackedProviderOptionsFromEnv(process.env))
}

function currentModelHash(): string {
  return createRoleCModelGatewayFromEnv(process.env).model_config_hash
}
const runnerDigest = `sha256:${"d".repeat(64)}`

class FixtureCodeRunner implements CodeRunner {
  readonly runner_image_digest = runnerDigest
  readonly started: Promise<void>
  calls = 0
  private signalStarted!: () => void

  constructor(private readonly delayMs = 0) {
    this.started = new Promise((resolve) => {
      this.signalStarted = resolve
    })
  }

  async execute(request: CodeExecutionRequest) {
    this.calls += 1
    this.signalStarted()
    if (this.delayMs > 0) await Bun.sleep(this.delayMs)
    const correct = request.code.includes("return total / len(scores)")
      || request.code.includes("return sum(scores) / len(scores)")
    return {
      status: correct ? "passed" as const : "failed" as const,
      passed_tests: correct ? request.test_suite!.tests.length : 0,
      total_tests: request.test_suite!.tests.length,
      score_ratio: correct ? 1 : 0,
      failure_codes: correct ? [] : ["fixture:assertion_failed"],
      runner_image_digest: this.runner_image_digest,
    }
  }
}

const codeVerifier: CodeLabDraftVerifier = {
  async verifyCodeLab(_request, draft) {
    return {
      execution_verified: true,
      issues: [],
      runner_image_digest: runnerDigest,
      mutation_kill_rate: 1,
      verified_test_count: draft.secure_draft.payload.hidden_tests.length,
      objective_coverage: 1,
    }
  },
}

const assessmentVerifier: AssessmentDraftVerifier = {
  async verifyAssessment(_request, draft) {
    return {
      answer_key_verified: true,
      issues: [],
      runner_image_digest: runnerDigest,
      verified_item_count: draft.secure_draft.payload.items.length,
      verified_test_count: draft.secure_draft.payload.code_test_suites
        .reduce((sum, suite) => sum + suite.hidden_tests.length, 0),
      objective_coverage: 1,
    }
  },
}

const passingReviewPort: ContentReviewPort = {
  policy_version: "cycle-test-review-v1",
  async review(request) {
    return {
      run_id: request.run_id,
      pipeline_input_hash: request.pipeline_input_hash,
      generation_spec_hash: request.generation_spec_hash,
      policy_version: this.policy_version,
      revision_round: request.revision_round,
      max_revision_rounds: 2,
      evidence_hash: request.evidence_hash,
      decision: "pass",
      artifact_results: request.artifacts.map((target) => ({
        artifact_kind: target.kind,
        artifact_id: target.artifact.artifact_id,
        artifact_hash: target.artifact_hash,
        fact_status: "pass",
        teaching_status: "pass",
        decision: "pass",
        can_revise: false,
        findings: [],
        revision_instructions: [],
      })),
      revision_instructions: [],
    }
  },
}

/**
 * 学习循环测试共享同一个真实模型生成的 run（concept + lab + assessment）。
 * 首次运行真实生成并写入 .tmp/role-c-fixtures/ 缓存；之后全部读缓存，
 * 秒级加载且不受模型输出波动影响。生成质量验证由
 * scripts/role-c-real-model-smoke.ts 承担。
 *
 * 单飞锁：并发测试同时请求时只有第一次真正生成/加载，其余等待同一结果。
 */
type CycleFixture = Awaited<ReturnType<typeof buildSharedCycleFixture>>
let sharedCycleFixture: Promise<CycleFixture> | undefined

function readyFixture(_runId: string): Promise<CycleFixture> {
  if (!sharedCycleFixture) sharedCycleFixture = buildSharedCycleFixture()
  return sharedCycleFixture
}

async function buildSharedCycleFixture() {
  const modelHash = currentModelHash()
  const runId = "RUN-CYCLE-SHARED"
  const profile: LearnerProfile = {
    learner_id: "learner-cycle",
    level: "basic",
    known_concepts: ["变量", "条件判断"],
    weak_concepts: ["循环", "列表", "成绩统计"],
    goal: "完成循环、列表和成绩统计练习",
  }
  const kb = await loadKnowledgeBase()
  const rag = await retrieveKnowledge({
    query: "循环 列表 成绩统计 变量 条件判断",
    learnerLevel: profile.level,
    topK: 5,
  })
  const evidence = adaptRagResult(rag, {
    kb_version: kb.version,
    rag_version: "rule-rag-cycle-test",
  })
  const rawPath = await Bun.file(
    "examples/role-c-content/learning_path_node_score_project.json",
  ).json() as LearningPathNode
  const path = defineLearningPathNode({
    node_id: rawPath.node_id,
    target_source_ids: [...rawPath.target_source_ids],
    prerequisite_source_ids: [...rawPath.prerequisite_source_ids],
    goal: rawPath.goal,
    objectives: structuredClone(rawPath.objectives),
    assessment_blueprint: structuredClone(rawPath.assessment_blueprint),
  })
  const snapshot = adaptLearnerProfile(profile, { profile_version: "profile-cycle-v1" })
  const built = buildGenerationSpec({
    run_id: `RUN-CYCLE-SHARED`,
    profile_snapshot: snapshot,
    path_node: path,
    evidence_pack: evidence,
    versions: {
      prompt_version: ROLE_C_PROMPT_MANIFEST_VERSION,
      model_config_hash: modelHash,
      runner_image_digest: runnerDigest,
    },
    seed: 29,
  })
  if (!built.ok) throw new Error(JSON.stringify(built))

  const cacheKey = `cycle-shared-${ROLE_C_PROMPT_MANIFEST_VERSION}-${modelHash.slice(0, 8)}`
  const cached = loadCachedRoleCFixture(cacheKey)

  const secureStore = new InMemorySecureArtifactStore()
  let pipelineInput: { generation_spec: typeof built.spec; evidence_pack: typeof evidence }
  let pipelineResult: Awaited<ReturnType<typeof runReviewedCPipeline>>

  if (cached) {
    pipelineInput = cached.pipeline_input as typeof pipelineInput
    pipelineResult = cached.pipeline_result as typeof pipelineResult
    const cachedArtifacts = cached.secure_artifacts as SecureArtifact[]
    if (pipelineResult.secure_refs.length > 0 && cachedArtifacts.length > 0) {
      const refs = await secureStore.putBatch(cachedArtifacts, {
        principal: "role-c-pipeline",
        run_id: built.spec.run_id,
      })
      pipelineResult = { ...pipelineResult, secure_refs: refs }
    }
  } else {
    pipelineInput = { generation_spec: built.spec, evidence_pack: evidence }
    const agents = createRoleCAgents(createProvider(), {
      code_lab: codeVerifier,
      assessment: assessmentVerifier,
    })
    // 真实模型生成有少量随机失败（如 code-lab secure 阶段），失败时自动重跑一次。
    pipelineResult = await runReviewedCPipeline(
      pipelineInput,
      agents,
      secureStore,
      { review_port: passingReviewPort },
    )
    if (pipelineResult.status !== "ready"
      || !pipelineResult.public_artifacts.assessment?.payload) {
      pipelineResult = await runReviewedCPipeline(
        pipelineInput,
        agents,
        secureStore,
        { review_port: passingReviewPort },
      )
    }
    if (pipelineResult.status !== "ready"
      || !pipelineResult.public_artifacts.assessment?.payload) {
      throw new Error(JSON.stringify(pipelineResult))
    }
    const secureArtifacts = []
    for (const ref of pipelineResult.secure_refs) {
      secureArtifacts.push(await secureStore.get(ref, {
        principal: "role-c-pipeline",
        run_id: built.spec.run_id,
      }))
    }
    saveCachedRoleCFixture(cacheKey, {
      pipeline_input: pipelineInput,
      pipeline_result: pipelineResult,
      secure_artifacts: secureArtifacts,
      snapshot,
    })
  }

  let secureAssessment: NonNullable<AssessmentSecureArtifact["payload"]> | null = null
  for (const ref of pipelineResult.secure_refs) {
    const artifact = await secureStore.get(ref, {
      principal: "role-c-pipeline",
      run_id: built.spec.run_id,
    })
    if (artifact.artifact_type === "assessment_secure") {
      secureAssessment = artifact.payload
    }
  }
  if (!secureAssessment) throw new Error("secure assessment artifact missing")
  return { pipelineInput, pipelineResult, secureStore, snapshot, secureAssessment }
}

async function fullScoreSubmission(
  fixture: Awaited<ReturnType<typeof readyFixture>>,
  submissionId = "SUB-CYCLE-01",
  attemptNo = 1,
): Promise<SubmissionEnvelope> {
  const assessment = fixture.pipelineResult.public_artifacts.assessment!
  const securePayload = fixture.secureAssessment
  const secureById = new Map(securePayload!.items.map((item) => [item.item_id, item]))
  const answers: SubmissionEnvelope["answers"] = assessment.payload!.items.map((item) => {
    const secureItem = secureById.get(item.item_id)!
    if (item.modality === "mcq" || item.modality === "true_false") {
      return { item_id: item.item_id, selected_option_id: secureItem.correct_option_id!, hint_level_used: 0 }
    }
    if (item.modality === "code") {
      return {
        item_id: item.item_id,
        code_response: codeAnswerFor(item.starter_code ?? ""),
        hint_level_used: 0,
      }
    }
    return { item_id: item.item_id, text_response: textAnswerFor(secureItem), hint_level_used: 0 }
  })
  return {
    schema_version: "1.0",
    submission_id: submissionId,
    run_id: fixture.pipelineInput.generation_spec.run_id,
    learner_id_hash: "learner-cycle-hash",
    form_id: assessment.payload!.form_id,
    attempt_no: attemptNo,
    answers,
  }
}

function textAnswerFor(secureItem: AssessmentItemSecure): string {
  const spec = secureItem.answer_spec
  if (spec.kind === "exact_set") return spec.accepted[0] ?? ""
  if (spec.kind === "numeric") return String(spec.target)
  if (spec.kind === "code") return ""
  return spec.criteria.flatMap((criterion) => criterion.required_evidence).join("，")
}

function codeAnswerFor(starterCode: string): string {
  const signature = starterCode.match(
    /^(?:async\s+)?def\s+[A-Za-z_][A-Za-z0-9_]*\s*\([^)]*\):/m,
  )?.[0] ?? "def solution():"
  return `${signature}\n    return sum(scores) / len(scores)`
}

function wrongOptionId(
  fixture: Awaited<ReturnType<typeof readyFixture>>,
  itemId: string,
): string {
  const assessment = fixture.pipelineResult.public_artifacts.assessment!
  const item = assessment.payload!.items.find((entry) => entry.item_id === itemId)
  const secureItem = fixture.secureAssessment!.items.find((entry) => entry.item_id === itemId)
  return item?.options?.find((option) => option.option_id !== secureItem?.correct_option_id)
    ?.option_id ?? ""
}

async function serviceFixture(
  runId: string,
  masteryStore = new InMemoryMasteryStateStore(),
  runner = new FixtureCodeRunner(),
  cycleStore: LearningCycleStore = new InMemoryLearningCycleStore(),
  submissionLeaseMs?: number,
  learningProgressPort?: RoleBLearningProgressPort,
) {
  const fixture = await readyFixture(runId)
  const service = new LearningCycleService({
    cycle_store: cycleStore,
    secure_store: fixture.secureStore,
    mastery_store: masteryStore,
    code_runner: runner,
    ...(learningProgressPort
      ? {
          learning_progress_delivery: {
            mode: "required" as const,
            port: learningProgressPort,
          },
        }
      : {}),
    ...(submissionLeaseMs === undefined
      ? {}
      : { submission_lease_ms: submissionLeaseMs }),
  })
  // Deliberately reverse the positional list: registration must resolve by artifact type.
  const reversed = {
    ...fixture.pipelineResult,
    secure_refs: [...fixture.pipelineResult.secure_refs].reverse(),
  }
  await service.registerReadyRun({
    pipeline_input: fixture.pipelineInput,
    pipeline_result: reversed,
    profile_snapshot: fixture.snapshot,
    learner_id_hash: "learner-cycle-hash",
  })
  const assessment = fixture.pipelineResult.public_artifacts.assessment!
  const requiredItemIds = assessment.payload!.items.map((item) => item.item_id)
  const session = await service.openTrustedPreselectedSession({
    routing_policy: "trusted_preselected_v1",
    session_id: `SESSION-${runId}`,
    run_id: fixture.pipelineInput.generation_spec.run_id,
    authenticated_learner_id_hash: "learner-cycle-hash",
    attempt_no: 1,
    required_item_ids: requiredItemIds,
    revealed_hint_levels: Object.fromEntries(requiredItemIds.map((itemId) => [itemId, 0])),
    profile_expectations_by_objective: { O1: "weak", O2: "weak", O3: "weak" },
  })
  return { ...fixture, service, cycleStore, masteryStore, runner, session, assessment }
}

describe.skipIf(process.env.RUN_REAL_MODEL_TESTS !== "1")("role C formal learning cycle", () => {
  test("freezes the assessment route from trusted anchor scores before accepting a final submission", async () => {
    const fixture = await readyFixture("RUN-CYCLE-ANCHOR-ROUTING")
    const cycleStore = new InMemoryLearningCycleStore()
    const masteryStore = new InMemoryMasteryStateStore()
    const service = new LearningCycleService({
      cycle_store: cycleStore,
      secure_store: fixture.secureStore,
      mastery_store: masteryStore,
      code_runner: new FixtureCodeRunner(),
    })
    await service.registerReadyRun({
      pipeline_input: fixture.pipelineInput,
      pipeline_result: fixture.pipelineResult,
      profile_snapshot: fixture.snapshot,
      learner_id_hash: "learner-cycle-hash",
    })
    const assessment = fixture.pipelineResult.public_artifacts.assessment!
    const full = await fullScoreSubmission(
      fixture,
      "SUB-ANCHOR-FINAL",
      )
    const anchorIds = assessment.payload!.routing.anchor_item_ids
    const anchorSubmission: SubmissionEnvelope = {
      ...structuredClone(full),
      submission_id: "SUB-ANCHOR-ROUTE",
      answers: full.answers.filter((answer) =>
        anchorIds.includes(answer.item_id)),
    }
    const opened = await service.openAnchorFirstSession({
      routing_request_id: "ROUTING-CYCLE-ANCHOR",
      session_id: "SESSION-CYCLE-ANCHOR",
      run_id: fixture.pipelineInput.generation_spec.run_id,
      authenticated_learner_id_hash: "learner-cycle-hash",
      attempt_no: 1,
    })
    expect(opened.assessment_routing_state).toMatchObject({
      phase: "ANCHOR_PENDING",
      anchor_item_ids: anchorIds,
    })
    expect(opened.session_state.required_item_ids).toEqual(anchorIds)

    const premature = await service.processSubmissionInternal({
      session_id: opened.session_id,
      authenticated_learner_id_hash: "learner-cycle-hash",
      submission: structuredClone(full),
    })
    expect(premature).toMatchObject({
      status: "blocked",
      code: "ANCHOR_ROUTING_REQUIRED",
    })

    expect(await service.routeAssessmentAnchors({
      routing_request_id: "ROUTING-CYCLE-ANCHOR",
      session_id: opened.session_id,
      run_id: fixture.pipelineInput.generation_spec.run_id,
      authenticated_learner_id_hash: "learner-cycle-hash",
      attempt_no: 2,
      anchor_submission: anchorSubmission,
      revealed_anchor_hint_levels: Object.fromEntries(
        anchorIds.map((itemId) => [itemId, 0 as const]),
      ),
    })).toMatchObject({
      status: "blocked",
      issues: ["锚点路由 attempt_no 与会话不一致"],
    })

    const routed = await service.routeAssessmentAnchors({
      routing_request_id: "ROUTING-CYCLE-ANCHOR",
      session_id: opened.session_id,
      run_id: fixture.pipelineInput.generation_spec.run_id,
      authenticated_learner_id_hash: "learner-cycle-hash",
      attempt_no: 1,
      anchor_submission: anchorSubmission,
      revealed_anchor_hint_levels: Object.fromEntries(
        anchorIds.map((itemId) => [itemId, 0 as const]),
      ),
    })
    expect(routed.status).toBe("routed")
    if (routed.status !== "routed") return
    expect(routed.anchor_score_ratio).toBe(1)
    expect(routed.action).toBe("advance")
    expect(routed.learning_session).toMatchObject({
      phase: "route_locked",
      route_id: routed.route_id,
      required_item_ids: routed.required_item_ids,
    })
    expect(JSON.stringify(routed)).not.toContain("secure://")
    const deliveredSessions: string[] = []
    const sessionAck = await deliverLearningSessionToD({
      async publishLearningSession(delivery) {
        deliveredSessions.push(delivery.delivery_id)
        return {
          schema_version: "1.0" as const,
          delivery_kind: "learning_session" as const,
          delivery_id: delivery.delivery_id,
          status: "accepted" as const,
        }
      },
    }, fixture.pipelineResult, routed.learning_session)
    expect(sessionAck.status).toBe("accepted")
    expect(deliveredSessions).toHaveLength(1)
    expect((await service.openAnchorFirstSession({
      routing_request_id: "ROUTING-CYCLE-ANCHOR",
      session_id: "SESSION-CYCLE-ANCHOR",
      run_id: fixture.pipelineInput.generation_spec.run_id,
      authenticated_learner_id_hash: "learner-cycle-hash",
      attempt_no: 1,
    })).assessment_routing_state).toMatchObject({
      phase: "ROUTE_LOCKED",
      route_id: routed.route_id,
    })

    const replay = await service.routeAssessmentAnchors({
      routing_request_id: "ROUTING-CYCLE-ANCHOR",
      session_id: opened.session_id,
      run_id: fixture.pipelineInput.generation_spec.run_id,
      authenticated_learner_id_hash: "learner-cycle-hash",
      attempt_no: 1,
      anchor_submission: {
        ...structuredClone(anchorSubmission),
        answers: [...anchorSubmission.answers].reverse(),
      },
      revealed_anchor_hint_levels: Object.fromEntries(
        anchorIds.map((itemId) => [itemId, 0 as const]),
      ),
    })
    expect(replay).toEqual(routed)

    const changedAnchor = structuredClone(anchorSubmission)
    changedAnchor.answers[0]!.selected_option_id = wrongOptionId(
      fixture,
      changedAnchor.answers[0]!.item_id,
    )
    expect(await service.routeAssessmentAnchors({
      routing_request_id: "ROUTING-CYCLE-ANCHOR",
      session_id: opened.session_id,
      run_id: fixture.pipelineInput.generation_spec.run_id,
      authenticated_learner_id_hash: "learner-cycle-hash",
      attempt_no: 1,
      anchor_submission: changedAnchor,
      revealed_anchor_hint_levels: Object.fromEntries(
        anchorIds.map((itemId) => [itemId, 0 as const]),
      ),
    })).toMatchObject({
      status: "blocked",
      issues: ["锚点路由已由另一份答案冻结"],
    })

    const finalSubmission = {
      ...structuredClone(full),
      answers: full.answers.filter((answer) =>
        routed.required_item_ids.includes(answer.item_id)),
    }
    const tamperedFinal = structuredClone(finalSubmission)
    tamperedFinal.submission_id = "SUB-ANCHOR-TAMPERED"
    tamperedFinal.answers.find((answer) =>
      answer.item_id === anchorIds[0])!.selected_option_id = wrongOptionId(fixture, anchorIds[0]!)
    expect(await service.processSubmissionInternal({
      session_id: opened.session_id,
      authenticated_learner_id_hash: "learner-cycle-hash",
      submission: tamperedFinal,
    })).toMatchObject({
      status: "blocked",
      code: "ANCHOR_ANSWERS_CHANGED",
    })

    const completed = await service.processSubmissionInternal({
      session_id: opened.session_id,
      authenticated_learner_id_hash: "learner-cycle-hash",
      submission: finalSubmission,
    })
    expect(completed.status).toBe("completed")
  })

  test("resolves named secure artifacts and completes full-score grading", async () => {
    const fixture = await serviceFixture("RUN-CYCLE-FULL")
    const submission = await fullScoreSubmission(
      fixture,
      )
    const result = await fixture.service.processSubmissionInternal({
      session_id: fixture.session.session_id,
      authenticated_learner_id_hash: "learner-cycle-hash",
      submission,
    })
    expect(result.status).toBe("completed")
    if (result.status !== "completed") return
    expect(result.completion.feedback.round_score).toMatchObject({
      raw_score: 10,
      max_score: 10,
      accuracy: 1,
    })
    expect(result.completion.feedback.final_decision.action).toBe("advance")
    expect(result.completion.feedback.round_score.evidence_score).toBeLessThan(1)
    expect(result.completion.outbound_to_b.evidence_events.every(
      (event) => event.recommendation.action === "advance",
    )).toBe(true)
    expect(result.completion.delivery_to_b).toEqual({
      mode: "deferred",
      reason: "port_not_configured",
    })
    expect(JSON.stringify(result.completion.feedback)).not.toContain("secure://")
    const publicReplay = await fixture.service.processSubmission({
      session_id: fixture.session.session_id,
      authenticated_learner_id_hash: submission.learner_id_hash,
      submission: structuredClone(submission),
    })
    expect(publicReplay).toEqual({
      status: "completed",
      feedback: result.completion.feedback,
    })
    const serializedPublic = JSON.stringify(publicReplay)
    expect(serializedPublic).not.toContain("\"alpha\"")
    expect(serializedPublic).not.toContain("processed_artifact_ids")
    expect(serializedPublic).not.toContain("evidence_events")
    expect(await fixture.service.getResult(
      fixture.session.session_id,
      submission.submission_id,
      submission.learner_id_hash,
    )).toEqual(result.completion.feedback)
    expect(await fixture.service.getResult(
      fixture.session.session_id,
      submission.submission_id,
      "another-learner-hash",
    )).toBeUndefined()
    const stored = await fixture.cycleStore.loadSubmission(
      fixture.session.session_id,
      submission.submission_id,
    )
    expect(stored).toBeDefined()
    const forged = structuredClone(stored!)
    forged.feedback!.learner_id_hash = "another-learner-hash"
    forged.revision += 1
    await expect(fixture.cycleStore.saveSubmission(
      forged,
      stored!.revision,
    )).rejects.toMatchObject({ code: "INVALID_RECORD" })
  })

  test("delivers every completed formal submission to B through the production cycle", async () => {
    const received: RoleCLearningProgressDelivery[] = []
    const committed = new Set<string>()
    const port: RoleBLearningProgressPort = {
      async publishLearningProgress(delivery) {
        received.push(structuredClone(delivery))
        const duplicate = committed.has(delivery.delivery_id)
        committed.add(delivery.delivery_id)
        return {
          schema_version: "1.0",
          delivery_kind: "learning_progress",
          delivery_id: delivery.delivery_id,
          status: duplicate ? "duplicate" : "accepted",
        }
      },
    }
    const fixture = await serviceFixture(
      "RUN-CYCLE-B-DELIVERY",
      new InMemoryMasteryStateStore(),
      new FixtureCodeRunner(),
      new InMemoryLearningCycleStore(),
      undefined,
      port,
    )
    const submission = await fullScoreSubmission(
      fixture,
      "SUB-B-DELIVERY",
      )

    const first = await fixture.service.processSubmissionInternal({
      session_id: fixture.session.session_id,
      authenticated_learner_id_hash: submission.learner_id_hash,
      submission,
    })
    const replay = await fixture.service.processSubmissionInternal({
      session_id: fixture.session.session_id,
      authenticated_learner_id_hash: submission.learner_id_hash,
      submission: structuredClone(submission),
    })

    expect(first.status).toBe("completed")
    expect(replay.status).toBe("completed")
    if (first.status !== "completed" || replay.status !== "completed") return
    expect(first.completion.delivery_to_b).toMatchObject({
      mode: "required",
      ack: { status: "accepted" },
    })
    expect(replay.completion.delivery_to_b).toMatchObject({
      mode: "required",
      ack: { status: "duplicate" },
    })
    expect(received).toHaveLength(2)
    expect(received[0]!.delivery_id).toBe(received[1]!.delivery_id)
    expect(received[0]!.profile_version)
      .toBe(fixture.pipelineInput.generation_spec.profile_ref.profile_version)
    expect(received[0]!.evidence_events.length).toBeGreaterThan(0)
  })

  test("prepares the next round only from a persisted completed submission", async () => {
    const fixture = await serviceFixture("RUN-CYCLE-TRUSTED-NEXT")
    const submission = await fullScoreSubmission(
      fixture,
      "SUB-TRUSTED-NEXT",
      )
    const trustedInput = {
      session_id: fixture.session.session_id,
      submission_id: submission.submission_id,
      authenticated_learner_id_hash: submission.learner_id_hash,
      profile_snapshot: fixture.snapshot,
    }

    await expect(fixture.service.prepareNextRoundFromCompletedSubmission(
      trustedInput,
    )).rejects.toMatchObject({
      code: "INVALID_SESSION",
      message: "下一轮只能由已完成并冻结的提交生成",
    })

    const outcome = await fixture.service.processSubmissionInternal({
      session_id: fixture.session.session_id,
      authenticated_learner_id_hash: submission.learner_id_hash,
      submission,
    })
    expect(outcome.status).toBe("completed")
    const prepared = await fixture.service.prepareNextRoundFromCompletedSubmission(
      trustedInput,
    )
    expect(prepared).toMatchObject({
      status: "awaiting_path_node",
      action: "advance",
      current_path_node_id: fixture.pipelineInput.generation_spec.path_node.node_id,
      required_inputs: ["next_path_node", "next_evidence_pack"],
    })
    expect(await fixture.service.prepareNextRoundFromCompletedSubmission(
      structuredClone(trustedInput),
    )).toEqual(prepared)

    await expect(fixture.service.prepareNextRoundFromCompletedSubmission({
      ...trustedInput,
      authenticated_learner_id_hash: "another-learner-hash",
    })).rejects.toMatchObject({
      code: "INVALID_SESSION",
      message: "认证学习者与会话不一致",
    })
  })

  test("deduplicates concurrent identical submissions and updates mastery once", async () => {
    const fixture = await serviceFixture("RUN-CYCLE-CONCURRENT")
    const submission = await fullScoreSubmission(
      fixture,
      "SUB-CONCURRENT",
      )
    const outcomes = await Promise.all(Array.from({ length: 10 }, () =>
      fixture.service.processSubmissionInternal({
        session_id: fixture.session.session_id,
        authenticated_learner_id_hash: "learner-cycle-hash",
        submission: structuredClone(submission),
      })))
    expect(outcomes.every((outcome) => outcome.status === "completed")).toBe(true)
    const ids = outcomes.map((outcome) =>
      outcome.status === "completed" ? outcome.completion.feedback.feedback_id : "")
    expect(new Set(ids).size).toBe(1)
    const record = await fixture.cycleStore.loadSubmission(
      fixture.session.session_id,
      submission.submission_id,
    )
    expect(record?.status).toBe("COMPLETED")
    expect(record?.revision).toBe(5)
    const result = outcomes[0]!
    if (result.status !== "completed") return
    expect(result.completion.mastery_states.every((state) => state.revision === 1)).toBe(true)
    expect(fixture.runner.calls).toBe(1)
  })

  test("never shares an in-flight learner result with a different authenticated subject", async () => {
    const fixture = await serviceFixture(
      "RUN-CYCLE-PRINCIPAL-ISOLATION",
      new InMemoryMasteryStateStore(),
      new FixtureCodeRunner(30),
    )
    const submission = await fullScoreSubmission(
      fixture,
      "SUB-PRINCIPAL-ISOLATION",
      )
    const legitimate = fixture.service.processSubmissionInternal({
      session_id: fixture.session.session_id,
      authenticated_learner_id_hash: submission.learner_id_hash,
      submission,
    })
    const crossLearner = await fixture.service.processSubmissionInternal({
      session_id: fixture.session.session_id,
      authenticated_learner_id_hash: "another-learner-hash",
      submission: structuredClone(submission),
    })
    expect(crossLearner).toMatchObject({
      status: "blocked",
      code: "LEARNER_IDENTITY_MISMATCH",
    })
    expect(await legitimate).toMatchObject({ status: "completed" })
    expect(fixture.runner.calls).toBe(1)
  })

  test("releases the claim and retries after a transient secure-store read failure", async () => {
    const fixture = await readyFixture("RUN-CYCLE-SECURE-RETRY")
    let failNextGraderRead = false
    const secureStore: SecureArtifactStore = {
      namespace_id: fixture.secureStore.namespace_id,
      put: (artifact, context) => fixture.secureStore.put(artifact, context),
      putBatch: (artifacts, context) => fixture.secureStore.putBatch(artifacts, context),
      deleteBatch: (refs, context) => fixture.secureStore.deleteBatch(refs, context),
      async get(ref, context) {
        if (failNextGraderRead && context.principal === "role-c-grader") {
          failNextGraderRead = false
          throw new SecureArtifactStoreError("STORAGE_ERROR", "fixture transient I/O")
        }
        return fixture.secureStore.get(ref, context)
      },
    }
    const runner = new FixtureCodeRunner()
    const cycleStore = new InMemoryLearningCycleStore()
    const service = new LearningCycleService({
      cycle_store: cycleStore,
      secure_store: secureStore,
      mastery_store: new InMemoryMasteryStateStore(),
      code_runner: runner,
    })
    await service.registerReadyRun({
      pipeline_input: fixture.pipelineInput,
      pipeline_result: fixture.pipelineResult,
      profile_snapshot: fixture.snapshot,
      learner_id_hash: "learner-cycle-hash",
    })
    const assessment = fixture.pipelineResult.public_artifacts.assessment!
    const requiredItemIds = assessment.payload!.items.map((item) => item.item_id)
    const session = await service.openTrustedPreselectedSession({
      routing_policy: "trusted_preselected_v1",
      session_id: "SESSION-SECURE-RETRY",
      run_id: fixture.pipelineInput.generation_spec.run_id,
      authenticated_learner_id_hash: "learner-cycle-hash",
      attempt_no: 1,
      required_item_ids: requiredItemIds,
      revealed_hint_levels: Object.fromEntries(requiredItemIds.map((itemId) => [itemId, 0])),
    })
    const submission = await fullScoreSubmission(
      fixture,
      "SUB-SECURE-RETRY",
      )
    failNextGraderRead = true
    await expect(service.processSubmissionInternal({
      session_id: session.session_id,
      authenticated_learner_id_hash: submission.learner_id_hash,
      submission,
    })).rejects.toMatchObject({ code: "PERSISTENCE_ERROR" })
    expect((await cycleStore.loadSubmission(
      session.session_id,
      submission.submission_id,
    ))?.status).toBe("RECEIVED")
    expect((await cycleStore.loadSession(session.session_id))?.active_submission_id)
      .toBeUndefined()

    expect(await service.processSubmissionInternal({
      session_id: session.session_id,
      authenticated_learner_id_hash: submission.learner_id_hash,
      submission: structuredClone(submission),
    })).toMatchObject({ status: "completed" })
    expect(runner.calls).toBe(1)
  })

  test("rejects a reviewed run whose public and secure assessment identities diverge", async () => {
    const fixture = await readyFixture("RUN-CYCLE-PAIR-MISMATCH")
    const mismatchedStore: SecureArtifactStore = {
      namespace_id: fixture.secureStore.namespace_id,
      put: (artifact, context) => fixture.secureStore.put(artifact, context),
      putBatch: (artifacts, context) => fixture.secureStore.putBatch(artifacts, context),
      deleteBatch: (refs, context) => fixture.secureStore.deleteBatch(refs, context),
      async get(ref, context) {
        const artifact = await fixture.secureStore.get(ref, context)
        if (context.principal === "role-c-grader"
          && artifact.artifact_type === "assessment_secure"
          && artifact.payload
          && "form_id" in artifact.payload) {
          artifact.payload.form_id = "FORM-FORGED"
        }
        return artifact
      },
    }
    const service = new LearningCycleService({
      cycle_store: new InMemoryLearningCycleStore(),
      secure_store: mismatchedStore,
      mastery_store: new InMemoryMasteryStateStore(),
    })
    await expect(service.registerReadyRun({
      pipeline_input: fixture.pipelineInput,
      pipeline_result: fixture.pipelineResult,
      profile_snapshot: fixture.snapshot,
      learner_id_hash: "learner-cycle-hash",
    })).rejects.toMatchObject({ code: "INVALID_READY_RUN" })
  })

  test("replays a completed submission even when the caller repeats its original session revision", async () => {
    const fixture = await serviceFixture("RUN-CYCLE-REPLAY")
    const submission = await fullScoreSubmission(
      fixture,
      "SUB-REPLAY",
      )
    const first = await fixture.service.processSubmissionInternal({
      session_id: fixture.session.session_id,
      authenticated_learner_id_hash: "learner-cycle-hash",
      submission,
      expected_session_revision: fixture.session.revision,
    })
    const replay = await fixture.service.processSubmissionInternal({
      session_id: fixture.session.session_id,
      authenticated_learner_id_hash: "learner-cycle-hash",
      submission: {
        ...structuredClone(submission),
        answers: [...submission.answers].reverse(),
      },
      expected_session_revision: fixture.session.revision,
    })
    expect(first.status).toBe("completed")
    expect(replay.status).toBe("completed")
    if (first.status !== "completed" || replay.status !== "completed") return
    expect(replay.completion).toEqual(first.completion)
    expect(fixture.runner.calls).toBe(1)
  })

  test("replays the frozen completion after mastery and grader versions advance", async () => {
    const fixture = await serviceFixture("RUN-CYCLE-FROZEN-REPLAY")
    const submission = await fullScoreSubmission(
      fixture,
      "SUB-FROZEN-REPLAY",
      )
    const first = await fixture.service.processSubmissionInternal({
      session_id: fixture.session.session_id,
      authenticated_learner_id_hash: "learner-cycle-hash",
      submission,
    })
    expect(first.status).toBe("completed")
    if (first.status !== "completed") return
    const o1 = await fixture.masteryStore.load(
      submission.learner_id_hash,
      fixture.pipelineInput.generation_spec.profile_ref.profile_version,
      "O1",
    )
    expect(o1).toBeDefined()
    const alpha = o1!.alpha + 1
    const beta = o1!.beta
    await fixture.masteryStore.save({
      ...o1!,
      alpha,
      mastery: Math.round((alpha / (alpha + beta)) * 1_000_000) / 1_000_000,
      evidence_batches: o1!.evidence_batches + 1,
      processed_artifact_ids: [
        ...o1!.processed_artifact_ids,
        `sha256:${"9".repeat(64)}`,
      ],
      revision: o1!.revision + 1,
    }, o1!.revision)
    const upgraded = new LearningCycleService({
      cycle_store: fixture.cycleStore,
      secure_store: fixture.secureStore,
      mastery_store: fixture.masteryStore,
      code_runner: fixture.runner,
      grader_version: "role-c-upgraded-grader-v2",
    })
    const replay = await upgraded.processSubmissionInternal({
      session_id: fixture.session.session_id,
      authenticated_learner_id_hash: "learner-cycle-hash",
      submission: structuredClone(submission),
    })
    expect(replay.status).toBe("completed")
    if (replay.status !== "completed") return
    expect(replay.completion).toEqual(first.completion)
    expect(fixture.runner.calls).toBe(1)
  })

  test("recovers a durable DECIDED mastery outbox without applying evidence twice", async () => {
    const inner = new InMemoryLearningCycleStore()
    let failMasteryCheckpoint = true
    const cycleStore: LearningCycleStore = {
      createRun: inner.createRun.bind(inner),
      loadRun: inner.loadRun.bind(inner),
      saveRun: inner.saveRun.bind(inner),
      createSession: inner.createSession.bind(inner),
      loadSession: inner.loadSession.bind(inner),
      saveSession: inner.saveSession.bind(inner),
      createSubmission: inner.createSubmission.bind(inner),
      loadSubmission: inner.loadSubmission.bind(inner),
      async saveSubmission(record, expectedRevision) {
        if (record.status === "MASTERY_APPLIED" && failMasteryCheckpoint) {
          failMasteryCheckpoint = false
          throw new Error("fixture checkpoint failure")
        }
        await inner.saveSubmission(record, expectedRevision)
      },
    }
    const fixture = await serviceFixture(
      "RUN-CYCLE-OUTBOX",
      new InMemoryMasteryStateStore(),
      new FixtureCodeRunner(),
      cycleStore,
    )
    const submission = await fullScoreSubmission(
      fixture,
      "SUB-OUTBOX",
      )
    await expect(fixture.service.processSubmissionInternal({
      session_id: fixture.session.session_id,
      authenticated_learner_id_hash: "learner-cycle-hash",
      submission,
    })).rejects.toMatchObject({ code: "PERSISTENCE_ERROR" })
    expect((await cycleStore.loadSubmission(
      fixture.session.session_id,
      submission.submission_id,
    ))?.status).toBe("DECIDED")

    const recovered = await fixture.service.processSubmissionInternal({
      session_id: fixture.session.session_id,
      authenticated_learner_id_hash: "learner-cycle-hash",
      submission: structuredClone(submission),
    })
    expect(recovered.status).toBe("completed")
    if (recovered.status !== "completed") return
    expect(recovered.completion.mastery_states.every(
      (state) => state.revision === 1 && state.evidence_batches === 1,
    )).toBe(true)
    expect(fixture.runner.calls).toBe(1)
  })

  test("uses distinct cryptographic mastery identities when sessions reuse a client submission ID", async () => {
    const fixture = await serviceFixture("RUN-CYCLE-CROSS-SESSION")
    const submission = await fullScoreSubmission(
      fixture,
      "SUB-REUSED",
      )
    const first = await fixture.service.processSubmissionInternal({
      session_id: fixture.session.session_id,
      authenticated_learner_id_hash: "learner-cycle-hash",
      submission,
    })
    const requiredItemIds = fixture.assessment.payload!.items.map((item) => item.item_id)
    const secondSession =
      await fixture.service.openTrustedPreselectedSession({
      routing_policy: "trusted_preselected_v1",
      session_id: "SESSION-CROSS-SECOND",
      run_id: fixture.pipelineInput.generation_spec.run_id,
      authenticated_learner_id_hash: submission.learner_id_hash,
      attempt_no: 1,
      required_item_ids: requiredItemIds,
      revealed_hint_levels: Object.fromEntries(requiredItemIds.map((itemId) => [itemId, 0])),
      profile_expectations_by_objective: { O1: "weak", O2: "weak", O3: "weak" },
    })
    const second = await fixture.service.processSubmissionInternal({
      session_id: secondSession.session_id,
      authenticated_learner_id_hash: "learner-cycle-hash",
      submission: structuredClone(submission),
    })
    expect(first.status).toBe("completed")
    expect(second.status).toBe("completed")
    if (first.status !== "completed" || second.status !== "completed") return
    expect(second.completion.feedback.grade_result.artifact_id)
      .not.toBe(first.completion.feedback.grade_result.artifact_id)
    expect(second.completion.outbound_to_b.evidence_events[0]?.provenance.idempotency_key)
      .not.toBe(first.completion.outbound_to_b.evidence_events[0]?.provenance.idempotency_key)
    expect(second.completion.mastery_states.every((state) => state.revision === 2)).toBe(true)
  })

  test("serializes different submissions for one session and closes the completed attempt", async () => {
    const fixture = await serviceFixture(
      "RUN-CYCLE-SESSION-LOCK",
      new InMemoryMasteryStateStore(),
      new FixtureCodeRunner(30),
    )
    const first = await fullScoreSubmission(
      fixture,
      "SUB-SESSION-A",
      )
    const second = await fullScoreSubmission(
      fixture,
      "SUB-SESSION-B",
      )
    const outcomes = await Promise.all([
      fixture.service.processSubmissionInternal({
        session_id: fixture.session.session_id,
        authenticated_learner_id_hash: "learner-cycle-hash",
        submission: first,
      }),
      fixture.service.processSubmissionInternal({
        session_id: fixture.session.session_id,
        authenticated_learner_id_hash: "learner-cycle-hash",
        submission: second,
      }),
    ])
    expect(outcomes.filter((outcome) => outcome.status === "completed")).toHaveLength(1)
    expect(outcomes.filter((outcome) =>
      outcome.status === "blocked" && outcome.code === "SESSION_BUSY")).toHaveLength(1)
    expect(fixture.runner.calls).toBe(1)

    const losingSubmission = outcomes[0]?.status === "completed" ? second : first
    const retry = await fixture.service.processSubmissionInternal({
      session_id: fixture.session.session_id,
      authenticated_learner_id_hash: "learner-cycle-hash",
      submission: losingSubmission,
    })
    expect(retry).toMatchObject({
      status: "blocked",
      code: "SESSION_ALREADY_COMPLETED",
    })
    expect(fixture.runner.calls).toBe(1)
  })

  test("uses a persistent submission lease across service instances", async () => {
    const runner = new FixtureCodeRunner(30)
    const fixture = await serviceFixture(
      "RUN-CYCLE-MULTI-INSTANCE",
      new InMemoryMasteryStateStore(),
      runner,
    )
    const secondService = new LearningCycleService({
      cycle_store: fixture.cycleStore,
      secure_store: fixture.secureStore,
      mastery_store: fixture.masteryStore,
      code_runner: runner,
    })
    const submission = await fullScoreSubmission(
      fixture,
      "SUB-MULTI-INSTANCE",
      )
    const outcomes = await Promise.all([
      fixture.service.processSubmissionInternal({
        session_id: fixture.session.session_id,
        authenticated_learner_id_hash: "learner-cycle-hash",
        submission: structuredClone(submission),
      }),
      secondService.processSubmissionInternal({
        session_id: fixture.session.session_id,
        authenticated_learner_id_hash: "learner-cycle-hash",
        submission: structuredClone(submission),
      }),
    ])
    expect(outcomes.filter((outcome) => outcome.status === "completed")).toHaveLength(1)
    expect(outcomes.filter((outcome) =>
      outcome.status === "blocked" && outcome.code === "SUBMISSION_BUSY")).toHaveLength(1)
    expect(runner.calls).toBe(1)

    const replay = await secondService.processSubmissionInternal({
      session_id: fixture.session.session_id,
      authenticated_learner_id_hash: "learner-cycle-hash",
      submission,
    })
    expect(replay.status).toBe("completed")
    expect(runner.calls).toBe(1)
  })

  test("renews the persistent lease while trusted grading exceeds its original term", async () => {
    const runner = new FixtureCodeRunner(1_250)
    const fixture = await serviceFixture(
      "RUN-CYCLE-LEASE-HEARTBEAT",
      new InMemoryMasteryStateStore(),
      runner,
      new InMemoryLearningCycleStore(),
      1_000,
    )
    const secondService = new LearningCycleService({
      cycle_store: fixture.cycleStore,
      secure_store: fixture.secureStore,
      mastery_store: fixture.masteryStore,
      code_runner: runner,
      submission_lease_ms: 1_000,
    })
    const submission = await fullScoreSubmission(
      fixture,
      "SUB-LEASE-HEARTBEAT",
      )
    const first = fixture.service.processSubmissionInternal({
      session_id: fixture.session.session_id,
      authenticated_learner_id_hash: "learner-cycle-hash",
      submission: structuredClone(submission),
    })
    await runner.started
    await Bun.sleep(1_050)

    const contender = await secondService.processSubmissionInternal({
      session_id: fixture.session.session_id,
      authenticated_learner_id_hash: "learner-cycle-hash",
      submission: structuredClone(submission),
    })
    const completed = await first

    expect(contender).toMatchObject({
      status: "blocked",
      code: "SUBMISSION_BUSY",
    })
    expect(completed.status).toBe("completed")
    expect(runner.calls).toBe(1)
  })

  test("rejects reuse of a submission ID with different content", async () => {
    const fixture = await serviceFixture("RUN-CYCLE-CONFLICT")
    const submission = await fullScoreSubmission(
      fixture,
      "SUB-CONFLICT",
      )
    expect((await fixture.service.processSubmissionInternal({
      session_id: fixture.session.session_id,
      authenticated_learner_id_hash: "learner-cycle-hash",
      submission,
    })).status).toBe("completed")
    const changed = structuredClone(submission)
    changed.answers[0]!.selected_option_id = "opt_once"
    const conflict = await fixture.service.processSubmissionInternal({
      session_id: fixture.session.session_id,
      authenticated_learner_id_hash: "learner-cycle-hash",
      submission: changed,
    })
    expect(conflict).toMatchObject({ status: "blocked", code: "SUBMISSION_ID_CONFLICT" })
  })

  test("does not freeze a result or update mastery when trusted grading is blocked", async () => {
    const fixture = await readyFixture("RUN-CYCLE-BLOCKED")
    const cycleStore = new InMemoryLearningCycleStore()
    const masteryStore = new InMemoryMasteryStateStore()
    const service = new LearningCycleService({
      cycle_store: cycleStore,
      secure_store: fixture.secureStore,
      mastery_store: masteryStore,
      // No code runner: the code item must fail closed.
    })
    await service.registerReadyRun({
      pipeline_input: fixture.pipelineInput,
      pipeline_result: fixture.pipelineResult,
      profile_snapshot: fixture.snapshot,
      learner_id_hash: "learner-cycle-hash",
    })
    const assessment = fixture.pipelineResult.public_artifacts.assessment!
    const ids = assessment.payload!.items.map((item) => item.item_id)
    const session = await service.openTrustedPreselectedSession({
      routing_policy: "trusted_preselected_v1",
      session_id: "SESSION-BLOCKED",
      run_id: fixture.pipelineInput.generation_spec.run_id,
      authenticated_learner_id_hash: "learner-cycle-hash",
      attempt_no: 1,
      required_item_ids: ids,
      revealed_hint_levels: Object.fromEntries(ids.map((id) => [id, 0])),
    })
    const submission = await fullScoreSubmission(
      fixture,
      "SUB-BLOCKED",
      )
    const result = await service.processSubmissionInternal({
      session_id: session.session_id,
      authenticated_learner_id_hash: submission.learner_id_hash,
      submission,
    })
    expect(result).toMatchObject({ status: "blocked", code: "SUBMISSION_BOUNDARY_BLOCKED" })
    expect(await service.getResult(
      session.session_id,
      submission.submission_id,
      submission.learner_id_hash,
    )).toBeUndefined()
    for (const objectiveId of ["O1", "O2", "O3"]) {
      expect(await masteryStore.load(
        submission.learner_id_hash,
        fixture.pipelineInput.generation_spec.profile_ref.profile_version,
        objectiveId,
      )).toBeUndefined()
    }
  })

  test("does not expose hidden code-test identifiers in public feedback", async () => {
    const fixture = await serviceFixture("RUN-CYCLE-HIDDEN-ID")
    const submission = await fullScoreSubmission(
      fixture,
      "SUB-HIDDEN-ID",
      )
    const codeItemId = fixture.assessment.payload!.items
      .find((item) => item.modality === "code")!.item_id
    submission.answers.find((answer) => answer.item_id === codeItemId)!.code_response =
      "def average_score(scores):\n    return 0"
    const result = await fixture.service.processSubmissionInternal({
      session_id: fixture.session.session_id,
      authenticated_learner_id_hash: "learner-cycle-hash",
      submission,
    })
    expect(result.status).toBe("completed")
    if (result.status !== "completed") return
    const serialized = JSON.stringify(result.completion.feedback)
    expect(serialized).not.toContain("fixture")
    expect(serialized).toContain("code:assertion_failed")
  })

  test("lets explicit profile drift override a high round score without exposing Beta internals", async () => {
    const masteryStore = new InMemoryMasteryStateStore()
    const seedStates: ObjectiveMasteryState[] = ["O1", "O2"].map((objectiveId) => ({
      schema_version: "1.0",
      learner_id_hash: "learner-cycle-hash",
      profile_version: "profile-cycle-v1",
      objective_id: objectiveId,
      alpha: 19,
      beta: 1,
      mastery: 0.95,
      evidence_batches: 18,
      observed_modalities: ["trace"],
      processed_artifact_ids: [],
      last_action: "advance",
      revision: 1,
    }))
    await masteryStore.saveBatch(seedStates.map((state) => ({
      state,
      expected_revision: 0,
    })))
    const fixture = await serviceFixture("RUN-CYCLE-DRIFT", masteryStore)
    const submission = await fullScoreSubmission(
      fixture,
      "SUB-DRIFT",
      )
    const result = await fixture.service.processSubmissionInternal({
      session_id: fixture.session.session_id,
      authenticated_learner_id_hash: "learner-cycle-hash",
      submission,
    })
    expect(result.status).toBe("completed")
    if (result.status !== "completed") return
    expect(result.completion.feedback.final_decision).toMatchObject({
      action: "reprofile",
      basis: "profile_drift",
    })
    expect(result.completion.feedback.grade_result.payload?.recommendation.action).toBe("reprofile")
    expect(result.completion.outbound_to_b.evidence_events.every(
      (event) => event.recommendation.action === "reprofile",
    )).toBe(true)
    expect(JSON.stringify(result.completion.feedback)).not.toContain("\"alpha\"")
    expect(JSON.stringify(result.completion.feedback)).not.toContain("processed_artifact_ids")
  })

  test("reveals correct answers only inside post-submission feedback", async () => {
    const fixture = await serviceFixture("RUN-CYCLE-REVEALED")
    const assessment = fixture.assessment.payload!
    const submission = await fullScoreSubmission(fixture, "SUB-REVEALED")
    const result = await fixture.service.processSubmissionInternal({
      session_id: fixture.session.session_id,
      authenticated_learner_id_hash: "learner-cycle-hash",
      submission,
    })
    expect(result.status).toBe("completed")
    if (result.status !== "completed") return
    const feedback = result.completion.feedback.grade_result.payload!.feedback
    const secureById = new Map(fixture.secureAssessment!.items.map((item) => [item.item_id, item]))
    expect(feedback.item_feedback.length).toBeGreaterThan(0)
    for (const item of assessment.items) {
      const entry = feedback.item_feedback.find((fb) => fb.item_id === item.item_id)!
      expect(entry.revealed_answer).toBeDefined()
      const secureItem = secureById.get(item.item_id)!
      if (item.modality === "mcq" || item.modality === "true_false") {
        expect(entry.revealed_answer).toMatchObject({
          kind: "choice",
          option_id: secureItem.correct_option_id,
        })
      } else if (item.modality === "code") {
        expect(entry.revealed_answer).toMatchObject({ kind: "code" })
        expect(typeof (entry.revealed_answer as { code: string }).code).toBe("string")
      } else {
        const spec = secureItem.answer_spec
        if (spec.kind === "numeric") {
          expect(entry.revealed_answer).toMatchObject({ kind: "numeric", target: spec.target })
        } else if (spec.kind === "exact_set") {
          expect(entry.revealed_answer).toMatchObject({ kind: "text", accepted: spec.accepted })
        } else {
          expect(entry.revealed_answer).toMatchObject({ kind: "rubric" })
        }
      }
    }
    // 静态公开测评产物绝不能含答案
    expect(JSON.stringify(assessment)).not.toContain("correct_option_id")
    expect(JSON.stringify(assessment)).not.toContain("answer_spec")
  })

  test("attaches immediate-feedback answers to every lesson micro check", async () => {
    const fixture = await readyFixture("RUN-CYCLE-MICRO-CHECK")
    const checks = fixture.pipelineResult.public_artifacts.concept_lesson?.payload?.micro_checks ?? []
    expect(checks.length).toBeGreaterThan(0)
    for (const check of checks) {
      const optionIds = new Set((check.options ?? []).map((option) => option.option_id))
      expect(check.answer_option_id).toBeDefined()
      expect(optionIds.has(check.answer_option_id!)).toBe(true)
      expect(check.answer_explanation?.trim().length).toBeGreaterThan(0)
    }
  })

  test("allows same-form retries up to max_attempts then locks the session", async () => {
    const fixture = await serviceFixture("RUN-CYCLE-RETRY")
    const maxAttempts = fixture.assessment.payload!.submission_policy.max_attempts
    expect(maxAttempts).toBe(3)
    let latestFeedbackId: string | undefined
    for (let attemptNo = 1; attemptNo <= maxAttempts; attemptNo += 1) {
      const submission = await fullScoreSubmission(
        fixture,
        `SUB-RETRY-${attemptNo}`,
        attemptNo,
      )
      const result = await fixture.service.processSubmissionInternal({
        session_id: fixture.session.session_id,
        authenticated_learner_id_hash: "learner-cycle-hash",
        submission,
      })
      expect(result.status).toBe("completed")
      if (result.status !== "completed") return
      expect(result.completion.feedback.feedback_id).not.toBe(latestFeedbackId)
      latestFeedbackId = result.completion.feedback.feedback_id
      expect(latestFeedbackId).toBeDefined()
    }
    const exhausted = await fixture.service.processSubmissionInternal({
      session_id: fixture.session.session_id,
      authenticated_learner_id_hash: "learner-cycle-hash",
      submission: await fullScoreSubmission(fixture, "SUB-RETRY-EXHAUSTED"),
    })
    expect(exhausted).toMatchObject({
      status: "blocked",
      code: "SESSION_ALREADY_COMPLETED",
    })
    expect((await fixture.service.getResult(
      fixture.session.session_id,
      "SUB-RETRY-1",
      "learner-cycle-hash",
    ))?.feedback_id).toBeDefined()
    expect((await fixture.service.getResult(
      fixture.session.session_id,
      "SUB-RETRY-3",
      "learner-cycle-hash",
    ))?.feedback_id).toBeDefined()
  })

  test("attaches adaptation info to reviewed release from next round context", async () => {
    const fixture = await readyFixture("RUN-CYCLE-ADAPTATION")
    const remediateContext = {
      request_id: "REQ-ADAPT-R",
      parent_spec_id: fixture.pipelineInput.generation_spec.spec_id,
      prior_feedback_ref: "FB-R-1",
      trigger_grade_artifact_id: "GRADE-R-1",
      action: "remediate" as const,
      focus_objective_ids: ["O1"],
      reason_codes: ["round_accuracy_below_remediation_threshold"],
      misconception_tags: ["integer_division", "skips_last_element"],
    }
    const delivery = createReviewedReleaseDelivery(
      fixture.pipelineResult,
      remediateContext,
    )
    expect(delivery.adaptation).toMatchObject({
      adaptation_action: "remediate",
      target_objective_ids: ["O1"],
      addressed_misconception_tags: ["integer_division", "skips_last_element"],
      source_feedback_refs: ["FB-R-1", "GRADE-R-1"],
    })
    expect(delivery.adaptation?.adaptation_summary).toContain("针对性补救")

    const reinforceDelivery = createReviewedReleaseDelivery(
      fixture.pipelineResult,
      { ...remediateContext, action: "reinforce", reason_codes: ["round_accuracy_below_reinforce_threshold"] },
    )
    expect(reinforceDelivery.adaptation?.adaptation_action).toBe("reinforce")
    expect(reinforceDelivery.adaptation?.adaptation_summary).toContain("巩固强化")
    expect(reinforceDelivery.adaptation?.adaptation_summary).not.toContain("针对性补救")

    // 无 next_round_context（首轮生成）时不带 adaptation
    const initial = createReviewedReleaseDelivery(fixture.pipelineResult)
    expect(initial.adaptation).toBeUndefined()
  })

  test("generates distinct content for remediate vs reinforce", async () => {
    const fixture = await readyFixture("RUN-CYCLE-VARIANT-DIFF")
    const provider = createProvider()
    const baseRequest = {
      generation_spec: fixture.pipelineInput.generation_spec,
      evidence_pack: fixture.pipelineInput.evidence_pack,
    }
    const remediateContext = {
      request_id: "REQ-VARIANT-R",
      parent_spec_id: fixture.pipelineInput.generation_spec.spec_id,
      prior_feedback_ref: "FB-V-R",
      trigger_grade_artifact_id: "GRADE-V-R",
      action: "remediate" as const,
      focus_objective_ids: ["O1"],
      reason_codes: ["round_accuracy_below_remediation_threshold"],
      misconception_tags: ["integer_division"],
    }
    const reinforceContext = { ...remediateContext, action: "reinforce" as const, reason_codes: ["round_accuracy_below_reinforce_threshold"] }

    const remediateLesson = await generateConceptLesson(
      { ...baseRequest, next_round_context: remediateContext },
      provider,
    )
    const reinforceLesson = await generateConceptLesson(
      { ...baseRequest, next_round_context: reinforceContext },
      provider,
    )
    const remediateAssessment = await provider.generateAssessment({
      ...baseRequest,
      concept_artifact: remediateLesson,
      next_round_context: remediateContext,
    })
    const reinforceAssessment = await provider.generateAssessment({
      ...baseRequest,
      concept_artifact: reinforceLesson,
      next_round_context: reinforceContext,
    })
    const lessonDiffers = contentHash(remediateLesson.payload)
      !== contentHash(reinforceLesson.payload)
    const assessmentDiffers = contentHash(remediateAssessment.public_draft.payload)
      !== contentHash(reinforceAssessment.public_draft.payload)
    console.error("VARIANT-DIFF lesson:", lessonDiffers, "assessment:", assessmentDiffers)
    expect(lessonDiffers).toBe(true)
    expect(assessmentDiffers).toBe(true)
  }, { timeout: 300000 })

  test("selects next-round focus objectives and misconception tags from grading feedback", () => {
    const results = [
      { objective_id: "O1", raw_score: 0, max_score: 4, accuracy: 0, evidence_score: 0, misconception_tags: ["integer_division"] },
      { objective_id: "O2", raw_score: 3, max_score: 4, accuracy: 0.75, evidence_score: 0.6, misconception_tags: ["skips_last_element"] },
      { objective_id: "O3", raw_score: 4, max_score: 4, accuracy: 1, evidence_score: 0.9, misconception_tags: [] },
    ]
    expect(focusObjectivesForNextRound(results, "remediate")).toEqual(["O1"])
    expect(focusObjectivesForNextRound(results, "reinforce")).toEqual(["O2"])
    expect(focusObjectivesForNextRound(results, "advance")).toEqual(["O1", "O2", "O3"])
  })

  test("builds next round context with action, focus, misconception tags and feedback refs", () => {
    const feedback = {
      feedback_id: "FB-R2",
      run_id: "RUN-1",
      session_id: "S-1",
      submission_id: "SUB-1",
      learner_id_hash: "L-1",
      profile_version: "P-1",
      path_node_id: "N-1",
      form_id: "F-1",
      attempt_no: 1,
      round_score: { raw_score: 5, max_score: 10, accuracy: 0.5, evidence_score: 0.5 },
      objective_results: [
        { objective_id: "O1", raw_score: 0, max_score: 4, accuracy: 0, evidence_score: 0, misconception_tags: ["integer_division"] },
        { objective_id: "O2", raw_score: 3, max_score: 4, accuracy: 0.75, evidence_score: 0.6, misconception_tags: ["skips_last_element"] },
        { objective_id: "O3", raw_score: 2, max_score: 2, accuracy: 1, evidence_score: 0.9, misconception_tags: [] },
      ],
      grade_result: { artifact_id: "GRADE-R2", run_id: "RUN-1" } as never,
      mastery_snapshot: [],
      final_decision: {
        action: "remediate" as const,
        basis: "round_accuracy" as const,
        confidence: 0.8,
        reason_codes: ["round_accuracy_below_remediation_threshold"],
        target_objective_ids: ["O1"],
        policy_ref: "role-c-round-accuracy-v1",
      },
      profile_drift_suggestion: null,
      schema_version: "1.0",
    } as unknown as DynamicFeedbackResult

    const context = buildNextRoundContext(feedback, "RUN-1", "NRC-TEST-1")
    expect(context).toMatchObject({
      request_id: "NRC-TEST-1",
      parent_spec_id: "RUN-1",
      prior_feedback_ref: "FB-R2",
      trigger_grade_artifact_id: "GRADE-R2",
      action: "remediate",
      focus_objective_ids: ["O1"],
      misconception_tags: ["integer_division"],
      reason_codes: ["round_accuracy_below_remediation_threshold"],
    })

    const reprofile = buildNextRoundContext(
      { ...feedback, final_decision: { ...feedback.final_decision, action: "reprofile" as const } } as unknown as DynamicFeedbackResult,
      "RUN-1",
      "NRC-TEST-2",
    )
    expect(reprofile).toBeUndefined()
  })
})
