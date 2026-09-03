import type {
  AssessmentSecurePayload,
  SubmissionAnswer,
} from "../../role-c-content/contracts/artifacts"
import {
  createAtomicRoleCLearningPersistence,
  submitRoleCAssessment,
  continueRoleCAfterSubmission,
  routeRoleCAssessmentAnchors,
  type RoleCForRoleDRuntimeOptions,
} from "../../role-d-integration/role-c-service"
import { contentHash } from "../../role-c-content/contracts/common"
import { validateAssessmentNovelty } from "../../role-c-content/providers/staged-generation"
import type { PriorAssessmentItem } from "../../role-c-content/agents/types"
import { COMPETITION_DYNAMIC_TRAJECTORIES_V2 } from "./competition-dynamic-trajectories.v2"
import type { RoleDAdaptiveLearningLoopPort } from "../../role-c-content"
import {
  adaptLearnerProfile,
  defineLearningPathNode,
} from "../../role-c-content"
import { loadKnowledgeBase } from "../../knowledge/loader"
import { updateLearnerProfileV2 } from "../../role-b-profile/learner-profile-v2"
import { createLocalBPathPlanningPort } from "../../role-c-content/review/local-b-path-planning-port"
import { COMPETITION_CASES_V2 } from "./competition-cases.v2"
import { COMPETITION_PROFILE_FIXTURES_V2 } from "./competition-profiles.v2"

/** Synthetic responses are constructed only inside the private evaluation process. */
export function syntheticAnswersV2(
  secure: AssessmentSecurePayload,
  requiredIds: string[],
  policy: string,
  expectations: Record<string, "known" | "weak">,
): SubmissionAnswer[] {
  const items = secure.items.filter((i) => requiredIds.includes(i.item_id))
  if (items.length !== new Set(requiredIds).size)
    throw new Error("SYNTHETIC_REQUIRED_ITEM_MISSING")
  let correct = new Set(
    items
      .filter(
        (i) =>
          policy === "all_correct" ||
          (policy === "profile_conflict_sequence" &&
            expectations[i.objective_id] === "weak"),
      )
      .map((i) => i.item_id),
  )
  if (policy === "mostly_incorrect") {
    // Isolate an unmastered objective: widespread failure on several explicitly
    // known objectives belongs to reprofile, not the remediation experiment.
    const focus =
      items.find((i) => expectations[i.objective_id] === "weak")
        ?.objective_id ?? items[0]?.objective_id
    correct = new Set(
      items.filter((i) => i.objective_id !== focus).map((i) => i.item_id),
    )
  }
  if (policy === "partial_60_percent") {
    if (items.length > 20) throw new Error("SYNTHETIC_SUBSET_TOO_LARGE")
    const total = items.reduce((n, i) => n + i.max_score, 0)
    let best = Infinity
    let selected: number | undefined
    for (let mask = 0; mask < 2 ** items.length; mask++) {
      const byObjective = new Map<string, { raw: number; max: number }>()
      items.forEach((item, index) => {
        const score = byObjective.get(item.objective_id) ?? { raw: 0, max: 0 }
        score.max += item.max_score
        if (mask & (1 << index)) score.raw += item.max_score
        byObjective.set(item.objective_id, score)
      })
      const weakest = Math.min(
        ...[...byObjective.values()].map((s) => s.raw / s.max),
      )
      if (weakest < 0.4 || weakest >= 0.8) continue
      // Beta evidence averages item outcomes, while round routing uses points.
      // Keep the first corroborating round from already contradicting a known
      // objective merely because one high-point item was selected correctly.
      if (
        [...byObjective.keys()].some((id) => {
          if (expectations[id] !== "known") return false
          const indices = items.flatMap((item, index) =>
            item.objective_id === id ? [index] : [],
          )
          return (
            indices.filter((index) => mask & (1 << index)).length * 2 <
            indices.length
          )
        })
      )
        continue
      const score =
        [...byObjective.values()].reduce((n, s) => n + s.raw, 0) / total
      if (Math.abs(score - 0.6) < best) {
        best = Math.abs(score - 0.6)
        selected = mask
      }
    }
    if (selected === undefined)
      throw new Error("SYNTHETIC_REINFORCE_NOT_REPRESENTABLE_BY_THIS_FORM")
    correct = new Set(
      items
        .filter((_, index) => selected! & (1 << index))
        .map((i) => i.item_id),
    )
  }
  return items.map((item) => {
    const base = { item_id: item.item_id, hint_level_used: 0 as const },
      ok = correct.has(item.item_id)
    if (item.correct_option_id) {
      const wrong = Object.keys(item.misconception_by_option).find(
        (id) => id !== item.correct_option_id,
      )
      if (!ok && !wrong)
        throw new Error(`SYNTHETIC_DISTRACTOR_MISSING:${item.item_id}`)
      return {
        ...base,
        selected_option_id: ok ? item.correct_option_id : wrong!,
      }
    }
    const a = item.answer_spec
    if (a.kind === "code") {
      const suite = secure.code_test_suites.find(
        (s) => s.test_suite_id === a.test_suite_id,
      )
      if (!suite) throw new Error("SYNTHETIC_CODE_SUITE_MISSING")
      return {
        ...base,
        code_response: ok
          ? suite.reference_solution
          : 'raise RuntimeError("synthetic incorrect submission")',
      }
    }
    const answer =
      a.kind === "exact_set"
        ? a.accepted[0]
        : a.kind === "numeric"
          ? String(a.target)
          : a.criteria.flatMap((c) => c.required_evidence).join("；")
    return { ...base, text_response: ok ? answer : "我目前无法回答这道题。" }
  })
}

export async function runDynamicTrajectoryV2(input: {
  case_id: string
  session_id: string
  data_directory: string
  runtime: RoleCForRoleDRuntimeOptions
  persistDelivery: (delivery: unknown) => Promise<void>
}) {
  const trajectory = COMPETITION_DYNAMIC_TRAJECTORIES_V2.find(
    (t) => t.case_id === input.case_id,
  )
  if (!trajectory) throw new Error("UNKNOWN_DYNAMIC_TRAJECTORY")
  const persistence = createAtomicRoleCLearningPersistence(input.data_directory)
  const receive = async (
    delivery:
      | Parameters<RoleDAdaptiveLearningLoopPort["publishReviewedRelease"]>[0]
      | Parameters<RoleDAdaptiveLearningLoopPort["publishLearningSession"]>[0]
      | Parameters<
          RoleDAdaptiveLearningLoopPort["publishReviewRecoveryStatus"]
        >[0],
  ) => {
    await input.persistDelivery(delivery)
    return {
      schema_version: "1.0" as const,
      delivery_kind: delivery.delivery_kind,
      delivery_id: delivery.delivery_id,
      status: "accepted" as const,
    }
  }
  const runtime = {
    ...input.runtime,
    providerMode: "model" as const,
    dataDirectory: input.data_directory,
    learningPersistence: persistence,
    roleDPort: {
      publishReviewedRelease: receive,
      publishLearningSession: receive,
      publishReviewRecoveryStatus: receive,
    },
  }
  let sessionId = input.session_id
  const rounds: Array<Record<string, unknown>> = []
  for (let round = 1; round <= trajectory.minimum_rounds + 1; round++) {
    let session = await persistence.cycleStore.loadSession(sessionId)
    if (!session) throw new Error("DYNAMIC_SESSION_MISSING")
    const run = await persistence.cycleStore.loadRun(session.run_id)
    if (!run) throw new Error("DYNAMIC_RUN_MISSING")
    const artifact = await persistence.secureStore.get(
      run.secure_artifact_refs.assessment,
      { principal: "role-c-grader", run_id: run.run_id },
    )
    if (artifact.artifact_type !== "assessment_secure" || !artifact.payload)
      throw new Error("DYNAMIC_SECURE_ASSESSMENT_MISSING")
    const answerPolicy =
      trajectory.expected_action === "reprofile" && round === 1
        ? "partial_60_percent"
        : trajectory.synthetic_answer_policy
    const privateAnswers = syntheticAnswersV2(
      artifact.payload,
      artifact.payload.items.map((i) => i.item_id),
      answerPolicy,
      session.profile_expectations_by_objective,
    )
    const identity = {
      sessionId,
      runId: run.run_id,
      learnerId: run.learner_id_hash,
      formId: session.session_state.current_form_id,
      attemptNo: session.session_state.attempt_no,
    }
    const submissionId = `SUB-V2-${contentHash({ case_id: input.case_id, sessionId, round }).slice(-20)}`
    if (session.assessment_routing_state?.phase === "ANCHOR_PENDING") {
      const routing = session.assessment_routing_state
      const routed = await routeRoleCAssessmentAnchors(
        {
          ...identity,
          routingRequestId: routing.routing_request_id,
          submissionId: `${submissionId}-anchor`,
          answers: privateAnswers.filter((a) =>
            routing.anchor_item_ids.includes(a.item_id),
          ),
        },
        runtime,
      )
      if (routed.status === "blocked")
        return {
          case_id: input.case_id,
          passed: false,
          rounds,
          error: "ANCHOR_ROUTING_BLOCKED",
        }
      session = (await persistence.cycleStore.loadSession(sessionId))!
    }
    const outcome = await submitRoleCAssessment(
      {
        ...identity,
        submissionId,
        answers: privateAnswers.filter((a) =>
          session!.session_state.required_item_ids.includes(a.item_id),
        ),
      },
      runtime,
    )
    if (outcome.status !== "completed")
      return {
        case_id: input.case_id,
        passed: false,
        rounds,
        error: `SUBMISSION_${outcome.status}`,
      }
    const action = outcome.feedback.final_decision.action
    let continuation = await continueRoleCAfterSubmission(
      { sessionId, submissionId, learnerId: run.learner_id_hash },
      runtime,
    )
    const row: Record<string, unknown> = {
      round,
      action,
      answer_policy: answerPolicy,
      feedback: outcome.feedback,
      continuation_status: continuation.status,
    }
    rounds.push(row)
    if (
      continuation.status === "awaiting_input" &&
      continuation.action === "reprofile"
    ) {
      const c = COMPETITION_CASES_V2.find((c) => c.case_id === input.case_id)!
      const fixture = structuredClone(
        COMPETITION_PROFILE_FIXTURES_V2[c.profile_fixture_id],
      )
      const snapshot = run.profile_snapshot!
      Object.assign(fixture, {
        profile_id: snapshot.profile_id,
        profile_version: snapshot.profile_version,
        level: snapshot.level,
        known_concepts: snapshot.known_concepts,
        weak_concepts: snapshot.weak_concepts,
      })
      const feedback = outcome.feedback,
        spec = run.pipeline_input.generation_spec
      const updated = updateLearnerProfileV2({
        profile: fixture,
        next_profile_version: `${snapshot.profile_version}-reprofile-${round}`,
        completed_session_id: sessionId,
        observation: {
          observationId: feedback.feedback_id,
          action,
          overallAccuracy: feedback.round_score.accuracy,
          mastery: feedback.mastery_snapshot.map((m) => ({
            objectiveId: m.objective_id,
            mastery: m.mastery,
            evidenceBatches: m.evidence_batches,
          })),
          conceptEvidence: feedback.objective_results.map((o) => ({
            sourceId: spec.targets.find(
              (t) => t.objective_id === o.objective_id,
            )!.source_id,
            concept: spec.targets.find(
              (t) => t.objective_id === o.objective_id,
            )!.source_id,
            evidenceScore: o.accuracy,
            evidenceBatches:
              feedback.mastery_snapshot.find(
                (m) => m.objective_id === o.objective_id,
              )?.evidence_batches ?? 1,
          })),
        },
      })
      const profile = adaptLearnerProfile(
        updated.profile,
        updated.role_c_snapshot_options,
      )
      const path = await createLocalBPathPlanningPort(
        await loadKnowledgeBase(),
      ).replanLearningPath({
        schema_version: "1.0",
        request_id: `REPROFILE-${submissionId}`,
        run_id: run.run_id,
        current_spec_id: spec.spec_id,
        profile_snapshot: profile,
        current_path_node: defineLearningPathNode({
          ...spec.path_node,
          objectives: spec.targets,
          assessment_blueprint: spec.assessment_blueprint,
        }),
        failed_dimensions: ["difficulty_match"],
        missing_prerequisite_source_ids: [],
        required_action: "replan_path",
        fix_scope: "new_spec",
        review_instruction_ids: [],
      })
      if (path.status !== "ready")
        return {
          case_id: input.case_id,
          passed: false,
          rounds,
          error: `B_REPROFILE_PATH:${path.reason}`,
        }
      continuation = await continueRoleCAfterSubmission(
        {
          sessionId,
          submissionId,
          learnerId: run.learner_id_hash,
          nextProfileSnapshot: profile,
          nextPathNode: path.path_draft,
          nextGenerationAction:
            feedback.round_score.accuracy < 0.4
              ? "remediate"
              : feedback.round_score.accuracy < 0.8
                ? "reinforce"
                : "advance",
        },
        runtime,
      )
      row.profile_version_changed =
        profile.profile_version !== snapshot.profile_version
      row.profile_update = {
        observation_id: feedback.feedback_id,
        before: {
          version: snapshot.profile_version,
          known: snapshot.known_concepts,
          weak: snapshot.weak_concepts,
        },
        after: {
          version: profile.profile_version,
          known: profile.known_concepts,
          weak: profile.weak_concepts,
        },
      }
      row.continuation_status = continuation.status
    }
    if (continuation.status === "awaiting_input")
      return {
        case_id: input.case_id,
        passed: false,
        rounds,
        error: "B_INPUT_REQUIRED",
        requires: continuation.requiredInputs,
      }
    if (continuation.status !== "published")
      return {
        case_id: input.case_id,
        passed: false,
        rounds,
        error: continuation.reason,
      }
    const nextSession = continuation.learningSession.session
    const nextRun = await persistence.cycleStore.loadRun(nextSession.run_id)
    if (!nextRun) throw new Error("DYNAMIC_NEXT_RUN_MISSING")
    const oldSpec = run.pipeline_input.generation_spec,
      newSpec = nextRun.pipeline_input.generation_spec
    const sameFacts =
      contentHash(oldSpec.targets) === contentHash(newSpec.targets)
    const sameNode = oldSpec.path_node.node_id === newSpec.path_node.node_id
    const expectedNext =
      "next_target_source_ids" in trajectory
        ? trajectory.next_target_source_ids
        : undefined
    const nextTargetMatch =
      !expectedNext ||
      action !== "advance" ||
      contentHash([...expectedNext].sort()) ===
        contentHash([...newSpec.path_node.target_source_ids].sort())
    const oldAssessment = run.pipeline_result.public_artifacts.assessment
    const nextAssessment = continuation.reviewedRelease.artifacts.find(
      (a) => a.artifact_type === "assessment_public",
    )
    const history: PriorAssessmentItem[] = (
      oldAssessment?.payload?.items ?? []
    ).map((item) => ({
      form_id: artifact.payload!.form_id,
      item_id: item.item_id,
      objective_id: item.objective_id,
      modality: item.modality,
      prompt: item.prompt,
      options: (item.options ?? []).map((o) => o.text),
      starter_code: item.starter_code,
      structure_meta: item.structure_meta,
    }))
    const novelty = nextAssessment?.payload
      ? validateAssessmentNovelty(nextAssessment.payload, history)
      : ["missing assessment"]
    Object.assign(row, {
      same_node: sameNode,
      locked_targets_preserved: sameFacts,
      next_targets: newSpec.path_node.target_source_ids,
      expected_next_targets: expectedNext,
      next_targets_match: nextTargetMatch,
      novelty_issues: novelty,
      artifact_tasks_preserved: !!newSpec.artifact_tasks,
      follow_up_release: continuation.reviewedRelease,
    })
    if (trajectory.expected_action !== "reprofile" || action === "reprofile")
      return {
        case_id: input.case_id,
        expected_action: trajectory.expected_action,
        actual_action: action,
        rounds,
        passed:
          round >= trajectory.minimum_rounds &&
          action === trajectory.expected_action &&
          nextTargetMatch &&
          novelty.length === 0 &&
          !!newSpec.artifact_tasks &&
          (action === "reprofile"
            ? row.profile_version_changed === true
            : action === "advance"
              ? !sameNode
              : sameNode && sameFacts),
      }
    sessionId = nextSession.session_id
  }
  return {
    case_id: input.case_id,
    passed: false,
    rounds,
    error: "REPROFILE_NOT_TRIGGERED_WITHIN_FROZEN_TRAJECTORY",
  }
}
