import { describe, expect, test } from "bun:test"
import {
  buildGradeFeedback,
  gradeSubmission,
  decideNextAction,
  type CodeExecutionRequest,
  type CodeRunner,
  type AssessmentSecureArtifact,
  type SubmissionEnvelope,
} from "../src/role-c-content"

const secureArtifact: AssessmentSecureArtifact = {
  schema_version: "1.0",
  run_id: "RUN-GRADE",
  artifact_id: "ART-ASSESS-SECURE",
  artifact_type: "assessment_secure",
  agent: "tiered-evaluator",
  status: "ready",
  versions: {
    profile_version: "p1", kb_version: "kb1", rag_version: "rag1", prompt_version: "prompt1",
    model_config_hash: "model1", schema_version: "1.0",
  },
  seed: 1,
  input_refs: [],
  citations: [],
  quality: {
    schema_ok: true, citation_coverage: 1, objective_coverage: 1, alignment_score: 1, answer_key_verified: true,
  },
  payload: {
    form_id: "FORM-01",
    option_order_seed: 1,
    code_test_suites: [],
    objective_coverage: [
      { objective_id: "O1", item_ids: ["I1"], answer_kinds: ["exact_set"] },
      { objective_id: "O2", item_ids: ["I2"], answer_kinds: ["numeric"] },
      { objective_id: "O3", item_ids: ["I3"], answer_kinds: ["code"] },
    ],
    items: [
      {
        item_id: "I1", objective_id: "O1", tier: 1, modality: "mcq", max_score: 1,
        answer_spec: { kind: "exact_set", accepted: ["opt_correct"], normalization: ["trim", "casefold"] },
        correct_option_id: "opt_correct", misconception_by_option: {}, evidence_weight: 1,
      },
      {
        item_id: "I2", objective_id: "O2", tier: 2, modality: "short_answer", max_score: 1,
        answer_spec: { kind: "numeric", target: 85, abs_tolerance: 0.01, rel_tolerance: 0 },
        misconception_by_option: {}, evidence_weight: 1,
      },
      {
        item_id: "I3", objective_id: "O3", tier: 3, modality: "code", max_score: 2,
        answer_spec: { kind: "code", test_suite_id: "TS-01" },
        misconception_by_option: {}, evidence_weight: 1,
      },
    ],
  },
  trace_ref: "TRACE-01",
}

const submission: SubmissionEnvelope = {
  schema_version: "1.0",
  submission_id: "SUB-01",
  run_id: "RUN-GRADE",
  learner_id_hash: "learner-hash",
  form_id: "FORM-01",
  attempt_no: 1,
  answers: [
    { item_id: "I1", selected_option_id: " OPT_CORRECT ", hint_level_used: 0 },
    { item_id: "I2", text_response: "85.005", hint_level_used: 1 },
    { item_id: "I3", code_response: "print('not executed on host')", hint_level_used: 0 },
  ],
}

describe("role C deterministic grading boundary", () => {
  test("grades exact and numeric items but blocks code without an isolated runner", async () => {
    const grade = await gradeSubmission(submission, secureArtifact)
    expect(grade.status).toBe("blocked")
    expect(grade.item_results[0]).toMatchObject({ raw_score: 1, grader_confidence: 1, feedback_code: "correct" })
    expect(grade.item_results[1]).toMatchObject({ raw_score: 1, grader_confidence: 1, feedback_code: "correct" })
    expect(grade.item_results[2]).toMatchObject({ raw_score: 0, grader_confidence: 0, feedback_code: "code_runner_unavailable" })
    expect(grade.unresolved_item_ids).toEqual(["I3"])
  })

  test("maps a wrong stable option to its misconception and preserves raw/evidence score separation", async () => {
    const artifact = structuredClone(secureArtifact)
    artifact.payload!.items = [artifact.payload!.items[0]!]
    artifact.payload!.objective_coverage = [{ objective_id: "O1", item_ids: ["I1"], answer_kinds: ["exact_set"] }]
    artifact.payload!.items[0]!.misconception_by_option = { opt_wrong: "confuses_iteration_with_condition" }
    const wrong = structuredClone(submission)
    wrong.answers = [{ item_id: "I1", selected_option_id: "opt_wrong", hint_level_used: 2 }]
    const grade = await gradeSubmission(wrong, artifact, { repeat_exposure_by_item: { I1: 2 } })
    expect(grade.status).toBe("graded")
    expect(grade.item_results[0]).toMatchObject({
      raw_score: 0,
      misconception_tags: ["option_misconception"],
      hint_factor: 0.65,
    })
    expect(grade.evidence_score).toBe(0)
  })

  test("does not copy secure misconception text or rubric IDs into public grades", async () => {
    const optionArtifact = structuredClone(secureArtifact)
    optionArtifact.payload!.items = [optionArtifact.payload!.items[0]!]
    optionArtifact.payload!.objective_coverage = [{
      objective_id: "O1",
      item_ids: ["I1"],
      answer_kinds: ["exact_set"],
    }]
    optionArtifact.payload!.items[0]!.misconception_by_option = {
      opt_wrong: "PRIVATE_CORRECT_ANSWER_IS_opt_correct",
    }
    const wrong = structuredClone(submission)
    wrong.answers = [{
      item_id: "I1",
      selected_option_id: "opt_wrong",
      hint_level_used: 0,
    }]
    const optionGrade = await gradeSubmission(wrong, optionArtifact)
    expect(JSON.stringify(optionGrade))
      .not.toContain("PRIVATE_CORRECT_ANSWER_IS_opt_correct")
    expect(optionGrade.item_results[0]!.misconception_tags)
      .toEqual(["option_misconception"])

    const rubricArtifact = structuredClone(secureArtifact)
    rubricArtifact.payload!.items = [{
      item_id: "I2",
      objective_id: "O2",
      tier: 2,
      modality: "short_answer",
      max_score: 1,
      answer_spec: {
        kind: "concept_rubric",
        criteria: [{
          criterion_id: "PRIVATE_ANSWER_IS_85",
          description: "说明顺序",
          weight: 1,
          required_evidence: ["顺序"],
        }],
        contradictions: [],
      },
      misconception_by_option: {},
      evidence_weight: 1,
    }]
    rubricArtifact.payload!.objective_coverage = [{
      objective_id: "O2",
      item_ids: ["I2"],
      answer_kinds: ["concept_rubric"],
    }]
    const rubricSubmission = structuredClone(submission)
    rubricSubmission.answers = [{
      item_id: "I2",
      text_response: "列表保持顺序",
      hint_level_used: 0,
    }]
    const rubricGrade = await gradeSubmission(
      rubricSubmission,
      rubricArtifact,
      { rubric_judge: new (class {
        readonly grader_version = "fixture-rubric-v1"
        async judge() {
          return {
            criteria: [{
              criterion_id: "PRIVATE_ANSWER_IS_85",
              status: "met" as const,
              confidence: 1,
              evidence_excerpt: "顺序",
            }],
          }
        }
      })() },
    )
    expect(JSON.stringify(rubricGrade))
      .not.toContain("PRIVATE_ANSWER_IS_85")
    expect(rubricGrade.item_results[0]!.rubric_results)
      .toEqual([{
        criterion_id: "criterion_1",
        status: "met",
        awarded_score: 1,
        confidence: 1,
        evidence_excerpt: "顺序",
      }])
  })

  test("blocks an incomplete submission instead of freezing omitted items as zero", async () => {
    const incomplete = structuredClone(submission)
    incomplete.answers = incomplete.answers.slice(0, 2)
    const grade = await gradeSubmission(incomplete, secureArtifact)
    expect(grade.status).toBe("blocked")
    expect(grade.validation_issues?.join(" ")).toContain("缺少本次路由要求")
  })

  test("parses and enforces the declared numeric unit deterministically", async () => {
    const artifact = structuredClone(secureArtifact)
    artifact.payload!.items = [artifact.payload!.items[1]!]
    artifact.payload!.items[0]!.answer_spec = { kind: "numeric", target: 85, abs_tolerance: 0.01, rel_tolerance: 0, unit: "kg" }
    artifact.payload!.objective_coverage = [{ objective_id: "O2", item_ids: ["I2"], answer_kinds: ["numeric"] }]
    const withUnit = structuredClone(submission)
    withUnit.answers = [{ item_id: "I2", text_response: "85.005 kg", hint_level_used: 0 }]
    expect((await gradeSubmission(withUnit, artifact)).item_results[0]).toMatchObject({ raw_score: 1, feedback_code: "correct" })
    withUnit.answers[0]!.text_response = "85.005 lb"
    expect((await gradeSubmission(withUnit, artifact)).item_results[0]).toMatchObject({ raw_score: 0, feedback_code: "invalid_unit" })
  })

  test("passes the secure suite and its own resource contract to the isolated code runner", async () => {
    const artifact = structuredClone(secureArtifact)
    artifact.payload!.items = [artifact.payload!.items[2]!]
    artifact.payload!.objective_coverage = [{ objective_id: "O3", item_ids: ["I3"], answer_kinds: ["code"] }]
    artifact.payload!.code_test_suites = [{
      test_suite_id: "TS-01",
      execution_contract: {
        language: "python", execution_mode: "function", entry_point: "solve", allowed_imports: [],
        input_contract: { type: "number", constraints: [] }, output_contract: { type: "number" },
        resource_limits: { timeout_ms: 777, memory_mb: 96, max_output_bytes: 4321 },
      },
      reference_solution: "def solve(value):\n    return value",
      hidden_tests: [
        { test_id: "T1", input: 1, expected: 1, objective_id: "O3", weight: 0.5, comparison: { kind: "exact" } },
        { test_id: "T2", input: 2, expected: 2, objective_id: "O3", weight: 0.5, comparison: { kind: "exact" } },
      ],
    }]
    const codeSubmission = structuredClone(submission)
    codeSubmission.answers = [{ item_id: "I3", code_response: "def solve(value):\n    return value", hint_level_used: 0 }]
    let received: CodeExecutionRequest | undefined
    const runner: CodeRunner = {
      runner_image_digest: `sha256:${"c".repeat(64)}`,
      async execute(request) {
        received = request
        return { status: "passed", passed_tests: 2, total_tests: 2, score_ratio: 1, failure_codes: [], runner_image_digest: this.runner_image_digest }
      },
    }
    const grade = await gradeSubmission(codeSubmission, artifact, { code_runner: runner })
    expect(grade.status).toBe("graded")
    expect(received?.test_suite?.tests).toHaveLength(2)
    expect(received).toMatchObject({ timeout_ms: 777, memory_mb: 96, max_output_bytes: 4321, network_allowed: false })
    runner.execute = async () => ({
      status: "failed", passed_tests: 0, total_tests: 2, score_ratio: 1,
      failure_codes: ["T1:assertion_failed"], runner_image_digest: runner.runner_image_digest,
    })
    const inconsistent = await gradeSubmission(codeSubmission, artifact, { code_runner: runner })
    expect(inconsistent).toMatchObject({ status: "blocked", item_results: [{ feedback_code: "invalid_code_runner_result" }] })
  })

  test("uses explicit MVP next-action thresholds", () => {
    expect(decideNextAction({ mastery: 0.5, sufficient_modalities: true }).action).toBe("remediate")
    expect(decideNextAction({ mastery: 0.7, sufficient_modalities: true }).action).toBe("reinforce")
    expect(decideNextAction({ mastery: 0.9, sufficient_modalities: true }).action).toBe("advance")
    expect(decideNextAction({ mastery: 0.9, sufficient_modalities: true, profile_conflict_count: 2 }).action).toBe("reprofile")
  })

  test("keeps a partially satisfied rubric item on the review path", () => {
    const feedback = buildGradeFeedback({
      submission_id: "SUB-RUBRIC",
      form_id: "FORM-RUBRIC",
      raw_score: 0.5,
      max_score: 1,
      evidence_score: 0.5,
      item_results: [{
        item_id: "I-RUBRIC",
        objective_id: "O-RUBRIC",
        raw_score: 0.5,
        max_score: 1,
        evidence_score: 0.5,
        grader_confidence: 0.9,
        hint_factor: 1,
        repeat_factor: 1,
        misconception_tags: [],
        feedback_code: "rubric_graded",
      }],
    }, "formative")
    expect(feedback.item_feedback[0]!.message).toContain("仍有标准未完全满足")
    expect(feedback.item_feedback[0]!.next_step).toContain("回到目标 O-RUBRIC")
  })
})
