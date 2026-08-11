import { describe, expect, test } from "bun:test"
import { gradeSubmission, type CodeRunner } from "../src/role-c-content"

// Regression fixture: a runner must not be able to inject an arbitrary aggregate ratio.
test("blocks a code runner whose score ratio disagrees with per-test outcomes", async () => {
  const artifact: any = {
    schema_version: "1.0", run_id: "RUN-SEC", artifact_id: "SEC", artifact_type: "assessment_secure",
    agent: "tiered-evaluator", status: "ready", versions: { profile_version: "p", kb_version: "k", rag_version: "r", prompt_version: "pr", model_config_hash: "m", schema_version: "1.0" },
    seed: 1, input_refs: [], citations: [], quality: { schema_ok: true, citation_coverage: 1, objective_coverage: 1, alignment_score: 1, answer_key_verified: true },
    payload: {
      form_id: "FORM", option_order_seed: 1, code_test_suites: [{
        test_suite_id: "TS", execution_contract: { language: "python", execution_mode: "function", entry_point: "solve", allowed_imports: [], input_contract: { type: "number", constraints: [] }, output_contract: { type: "number" }, resource_limits: { timeout_ms: 1000, memory_mb: 64, max_output_bytes: 4096 } },
        reference_solution: "def solve(x): return x", hidden_tests: [
          { test_id: "T1", objective_id: "O", weight: 1, input: 1, expected: 1, comparison: { kind: "exact" } },
          { test_id: "T2", objective_id: "O", weight: 1, input: 2, expected: 2, comparison: { kind: "exact" } },
        ],
      }],
      objective_coverage: [{ objective_id: "O", item_ids: ["I"], answer_kinds: ["code"] }],
      items: [{ item_id: "I", objective_id: "O", tier: 1, modality: "code", max_score: 2, answer_spec: { kind: "code", test_suite_id: "TS" }, misconception_by_option: {}, evidence_weight: 1 }],
    }, trace_ref: "TRACE",
  }
  const submission: any = { schema_version: "1.0", submission_id: "SUB", run_id: "RUN-SEC", learner_id_hash: "L", form_id: "FORM", attempt_no: 1, answers: [{ item_id: "I", code_response: "def solve(x): return x", hint_level_used: 0 }] }
  const runner: CodeRunner = {
    runner_image_digest: `sha256:${"d".repeat(64)}`,
    async execute() { return { status: "failed", passed_tests: 1, total_tests: 2, score_ratio: 0.75, failure_codes: ["T2:assertion_failed"], runner_image_digest: this.runner_image_digest } },
  }
  const grade = await gradeSubmission(submission, artifact, { code_runner: runner })
  expect(grade.status).toBe("blocked")
  expect(grade.item_results[0]?.feedback_code).toBe("invalid_code_runner_result")
})
