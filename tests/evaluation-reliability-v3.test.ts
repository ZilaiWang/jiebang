import { describe, expect, test } from "bun:test"
import {
  classifyEvaluationFailure,
  recoverStructuredJson,
  evaluateJudgeCompleteness,
  evaluateCaseReadiness,
  selectReliabilityCases,
  contractSatisfiability,
  resumeEvaluationAudits,
  validateArtifactContract,
  evaluateJudgeCalibration,
  evaluateReliabilityGate,
} from "../src/evaluation/reliability"
import { buildCompetitionManifestCandidateV2 } from "../src/evaluation/v2/competition-manifest.v2"
import { loadKnowledgeBase } from "../src/knowledge/loader"
import { buildAssessmentTaxonomyPlan } from "../src/role-c-content/planning/assessment-taxonomy"
import { summarizeCaseReliability } from "../src/evaluation/reliability/case-summary"
import { runJudgeCalibration, type CalibrationResource } from "../src/evaluation/reliability/calibration-runner"
import { writeEvaluationJson } from "../src/evaluation/reliability/atomic-json"
import { mkdtemp, rm, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

describe("Evaluation Reliability V3", () => {
  test("atomic evidence replacement preserves the previous file on serialization failure", async () => {
    const dir = await mkdtemp(join(tmpdir(), "eval-json-"))
    try {
      const path = join(dir, "record.json")
      await writeEvaluationJson(path, { ready: true })
      const circular: any = {}; circular.self = circular
      await expect(writeEvaluationJson(path, circular)).rejects.toThrow()
      expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ ready: true })
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  test("independent negative findings appear in the failure ledger even without runtime errors", () => {
    const result = summarizeCaseReliability({ record: { case_id: "C", status: "ready", errors: [], code_execution: "passed",
      difficulty: [], claims: [{ case_id: "C", claim_id: "claim-1", artifact_kind: "lesson", factual: true, audited: true,
        verdict: "unsupported", supported_fact_ids: [], reason: "missing rule" }] },
      artifact_tasks: {} as any, required_facts: [] })
    expect(result.failures.map((f) => f.category)).toContain("grounding")
    expect(result.failures[0]?.summary).toContain("claim-1")
  })

  test("calibration invokes the judge without frozen labels and preserves completed predictions", async () => {
    const resources: CalibrationResource[] = (["beginner", "basic", "intermediate", "integrated"] as const).flatMap((level) =>
      (["lesson", "lab", "assessment"] as const).flatMap((kind) => [1, 2].map((n) => ({
        resource_id: `${level}-${kind}-${n}`, title: `${kind}-${n}`, content: `unique ${level} ${kind} ${n}`,
        artifact_kind: kind, expected_difficulty: level, reviewer: "test reviewer", holdout: true,
      }))))
    const inputs: unknown[] = []
    const judge: any = { classify: async (input: any) => {
      inputs.push(input)
      return { predicted_difficulty: "basic", reasons: ["observed task"], confidence: 0.8 }
    } }
    const first = await runJudgeCalibration({ resources, judge, checkpoint: async () => {} })
    expect(inputs).toHaveLength(24)
    expect(inputs.every((input: any) => !("expected_difficulty" in input) && !("reviewer" in input))).toBe(true)
    expect(first.passed).toBe(false)
    inputs.length = 0
    const resumed = await runJudgeCalibration({ resources, judge, prior: first.rows, checkpoint: async () => {} })
    expect(inputs).toHaveLength(0)
    expect(resumed.rows).toEqual(first.rows)
  })

  test("a later failed claim batch does not discard earlier paid judgments", async () => {
    const candidates = Array.from({ length: 13 }, (_, i) => ({ claim_id: `C${i}`, artifact_kind: "lesson" as const, text: `claim ${i}`, citations: [], surface: "text" }))
    const record: any = { case_id: "R", repeat_index: 1, claims: [], difficulty: [], errors: [] }
    let calls = 0
    const input: any = { record, candidates, evidence: [], views: [], difficultyJudge: {}, checkpoint: async () => {},
      claimAuditor: { audit: async ({ candidates }: any) => {
        if (++calls === 2) throw new Error("socket closed")
        return candidates.map((c: any) => ({ ...c, case_id: "R", factual: true, audited: true, verdict: "supported", supported_fact_ids: [] }))
      } } }
    await resumeEvaluationAudits(input)
    expect(record.claims.filter((c: any) => c.audited)).toHaveLength(12)
    await resumeEvaluationAudits(input)
    expect(calls).toBe(3)
    expect(record.claims.filter((c: any) => c.audited)).toHaveLength(13)
    expect(record.errors).toEqual([])
  })
  test("taxonomy labels describe a uniform foundation plan without inventing difficulty", () => {
    const plan = buildAssessmentTaxonomyPlan({
      items: Array.from({ length: 3 }, (_, i) => ({ item_id: `I${i}`, objective_id: "O", tier: 1 as const, modality: "mcq" as const, cognitive_operation: "recognize_fact" as const })),
      emphasis: { recall: 1, understanding: 0, application: 0, analysis: 0, creation: 0 },
    })
    expect(plan.distribution.difficulty_bands.foundation).toBe(3)
  })
  test("transport failure is not hallucination", () => {
    const value = classifyEvaluationFailure({ message: "429 rate limit exceeded" })
    expect(value.category).toBe("model_transport")
    expect(value.status).toBe("retryable_error")
    expect(classifyEvaluationFailure({ message: "HTTP 503 service unavailable" }).category).toBe("model_transport")
    expect(classifyEvaluationFailure({ message: "schema invalid: expected length 512" }).category).toBe("structured_output")
  })

  test("recovers fenced JSON", () => {
    const value = recoverStructuredJson<{ok:boolean}>("before```json\n{\"ok\":true,}\n```after")
    expect(value.ok).toBe(true)
    expect(value.value?.ok).toBe(true)
  })

  test("trailing-comma recovery never edits commas inside strings", () => {
    const value = recoverStructuredJson<{ text: string }>('```json\n{"text":"x,} y",}\n```')
    expect(value.value?.text).toBe("x,} y")
  })

  test("judge incomplete remains metric-ineligible", () => {
    const judge = evaluateJudgeCompleteness({claim_audits:[],difficulty_audits:[]})
    const result = evaluateCaseReadiness({artifacts:[1,2,3],judge,docker_passed:true,coverage_rate:1,grounding_passed:true})
    expect(result.metric_eligible).toBe(false)
  })

  test("complete negative quality evidence remains in metrics", () => {
    const judge = { complete: true, claim_audit_complete: true, difficulty_audit_complete: true, missing: [] }
    const result = evaluateCaseReadiness({ artifacts: [1, 2, 3], judge, docker_passed: true, coverage_rate: 1, grounding_passed: false })
    expect(result.metric_eligible).toBe(true)
    expect(result.publication_ready).toBe(false)
    expect(result.operational_status).toBe("quality_fail")
  })

  test("duplicate judge identities cannot fill missing evidence", () => {
    const result = evaluateJudgeCompleteness({
      claim_audits: [{ claim_id: "A", audited: true, verdict: "supported" }], expected_claim_ids: ["B"],
      difficulty_audits: Array.from({ length: 3 }, () => ({ artifact_kind: "lesson", audited: true, predicted_difficulty: "basic" })),
    })
    expect(result.complete).toBe(false)
    expect(result.missing).toEqual(["claim_audit", "difficulty_audit"])
  })

  test("public programming examples count toward the lab contract", () => {
    const result = validateArtifactContract({ artifact_kind: "lab", contract: { lab: { public_test_minimum: 2, hidden_test_minimum: 2 } },
      artifact: { payload: { public_tests: [{}], programming_task: { public_examples: [{}, {}] } }, quality: { execution_verified: true, verified_test_count: 4 } } })
    expect(result.hard_pass).toBe(true)
  })

  test("verified_test_count counts the hidden suite, not public plus hidden tests", () => {
    const input = { artifact_kind: "lab" as const, contract: { lab: { public_test_minimum: 1, hidden_test_minimum: 1 } },
      artifact: { payload: { public_tests: [{}] }, quality: { execution_verified: true, verified_test_count: 1 } } }
    expect(validateArtifactContract(input).hard_pass).toBe(true)
    input.artifact.quality.verified_test_count = 0
    expect(validateArtifactContract(input).hard_pass).toBe(false)
    input.artifact.quality.verified_test_count = Number.NaN
    expect(validateArtifactContract(input).hard_pass).toBe(false)
  })

  test("calibration never treats empty or unreviewed evidence as success", () => {
    expect(evaluateJudgeCalibration([]).passed).toBe(false)
    expect(evaluateJudgeCalibration([]).accuracy).toBe(null)
  })

  test("missing artifacts and omitted frozen objectives are not valid", () => {
    expect(validateArtifactContract({ artifact_kind: "lesson", contract: { lesson: {} }, artifact: undefined }).hard_pass).toBe(false)
    const result = validateArtifactContract({ artifact_kind: "assessment", contract: { assessment: { tier_1_count: 1 } },
      artifact: { payload: { objective_ids: ["O1"], items: [{ objective_id: "O1", tier: 1 }] } }, required_objective_ids: ["O1", "O2"] })
    expect(result.issues.map((issue) => issue.code)).toContain("ASSESSMENT_OBJECTIVE_NOT_MEASURED")
  })

  test("balanced quality metrics retain complete negative evidence", () => {
    const records = Array.from({ length: 12 }, () => ({ status: "ready", code_execution: "passed", reliability: {
      metric_eligible: true, publication_ready: false, artifact_validations: Array.from({ length: 3 }, () => ({ hard_pass: true })),
    } as any }))
    const metrics: any = [{ gates: { hallucination_passed: true, adaptation_passed: true, coverage_passed: true },
      metrics: { claim_audit_coverage: { value: 1 }, difficulty_audit_completeness: { value: 1 } } }]
    expect(evaluateReliabilityGate({ gate: "balanced12", expected: 12, records, metrics }).passed).toBe(true)
    expect(evaluateReliabilityGate({ gate: "balanced12", expected: 24, records, metrics }).checks.expected_size).toBe(false)
    expect(evaluateReliabilityGate({ gate: "canary", expected: 3, records: records.slice(0, 3), metrics }).passed).toBe(true)
    expect(evaluateReliabilityGate({ gate: "canary", expected: 3, records: [{ ...records[0]!, status: "blocked" }, ...records.slice(1, 3)], metrics }).passed).toBe(false)
  })

  test("audit recovery keeps completed verdicts and only calls missing stages", async () => {
    const record: any = {
      case_id: "C1", repeat_index: 1, errors: ["difficulty:lab:timeout"],
      claims: [{ case_id: "C1", artifact_kind: "lesson", claim_id: "A", factual: true, audited: true, verdict: "contradicted", supported_fact_ids: [] }],
      difficulty: [{ case_id: "C1", artifact_kind: "lesson", audited: true, predicted_difficulty: "basic", reasons: [] }],
    }
    const claimCalls: string[][] = [], difficultyCalls: string[] = [], checkpoints: string[] = []
    await resumeEvaluationAudits({
      record,
      candidates: [
        { claim_id: "A", artifact_kind: "lesson", text: "a", citations: [], surface: "a" },
        { claim_id: "B", artifact_kind: "lab", text: "b", citations: [], surface: "b" },
      ],
      evidence: [],
      views: [
        { artifact_kind: "lesson", artifact_id: "L", title: "l", content: "l" },
        { artifact_kind: "lab", artifact_id: "P", title: "p", content: "p" },
        { artifact_kind: "assessment", artifact_id: "Q", title: "q", content: "q" },
      ],
      claimAuditor: { audit: async ({ candidates }) => {
        claimCalls.push(candidates.map((entry) => entry.claim_id))
        return candidates.map((entry) => ({ case_id: "C1", artifact_kind: entry.artifact_kind, claim_id: entry.claim_id, factual: true, audited: true, verdict: "supported", supported_fact_ids: [] }))
      } },
      difficultyJudge: { classify: async ({ artifact_kind }) => {
        difficultyCalls.push(artifact_kind)
        return { predicted_difficulty: "basic", reasons: [], confidence: 1 }
      } },
      checkpoint: async () => { checkpoints.push("saved") },
    })
    expect(claimCalls).toEqual([["B"]])
    expect(record.claims.find((entry: any) => entry.claim_id === "A").verdict).toBe("contradicted")
    expect(difficultyCalls).toEqual(["lab", "assessment"])
    expect(record.errors).toEqual([])
    expect(checkpoints.length).toBe(3)
  })

  test("frozen 60-case contracts are satisfiable and gates are balanced", async () => {
    const manifest = buildCompetitionManifestCandidateV2(await loadKnowledgeBase())
    expect(contractSatisfiability(manifest).passed).toBe(true)
    expect(selectReliabilityCases(manifest, "canary")).toHaveLength(3)
    const balanced = selectReliabilityCases(manifest, "balanced12")
    expect(balanced).toHaveLength(12)
    const selected = manifest.cases.filter((entry) => balanced.includes(entry.case_id))
    expect(new Set(selected.map((entry) => entry.profile_fixture_id)).size).toBe(6)
    expect(new Set(selected.map((entry) => entry.objectives[0]!.observable_behavior)).size).toBe(5)
    expect(new Set(selected.flatMap((entry) => Object.values(entry.expected_difficulty))).size).toBe(4)
  })
})
