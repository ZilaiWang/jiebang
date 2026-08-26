import { describe, expect, test } from "bun:test"
import { loadKnowledgeBase } from "../src/knowledge/loader"
import { rankKnowledgeHybrid } from "../src/rag/hybrid-retriever"
import { buildLearningDesignSpecV2 } from "../src/role-c-content/planning/learning-design-spec-v2"
import { runPublicCandidateTournament, PublicQualityGateError } from "../src/role-c-content/quality/candidate-tournament"
import { evaluatePublicAuthorCandidate } from "../src/role-c-content/quality/public-candidate-quality"
import { validateAssessmentPairValidity, validateAssessmentPublicValidity } from "../src/role-c-content/quality/assessment-validity"
import { betaPosteriorInterval, decideNextActionV2, evidenceReliability } from "../src/role-c-content/mastery/posterior-policy"
import { evaluateQualityBenchmark } from "../src/evaluation/quality-benchmark"
import { buildCodeLabSecurePlan, materializeCodeLabSecureAuthorPayload } from "../src/role-c-content/providers/staged-generation"
import { reviewPublicCandidatesWithModel } from "../src/role-c-content/quality/model-candidate-critic"

describe("quality kernel v2", () => {
  test("hydrates the canonical knowledge source with teachable, fact-bound metadata", async () => {
    const knowledge = await loadKnowledgeBase()
    const item = knowledge.items.find((entry) => entry.quizItems.some((quiz) => quiz.options?.length))!
    expect(item.facts.every((fact) => fact.authority === "curriculum" && fact.confidence === 1)).toBe(true)
    expect(item.misconceptions?.length).toBeGreaterThan(0)
    expect(item.misconceptions?.every((entry) => entry.factRefs.every((reference) =>
      reference.sourceId === item.sourceId && item.facts.some((fact) => fact.factId === reference.factId)))).toBe(true)
    expect(item.observableObjectives?.length).toBeGreaterThan(0)
    expect(item.assessmentConstraints).toContain("错误选项必须能定位到具体误解，不得使用明显荒谬或工程元信息选项")
    const intro = knowledge.items.find((entry) => entry.sourceId === "K001")!
    expect(intro.workedExamples?.flatMap((example) => example.steps)
      .every((step) => !/source\s*:\s*K\d+/iu.test(step.action))).toBe(true)
  })

  test("candidate quality rejects learner-visible source labels, not only source_id keys", () => {
    const design = buildLearningDesignSpecV2({
      spec: {
        spec_id: "S-META", profile_ref: { profile_id: "P", profile_version: "1" },
        learner_adaptation: { level: "beginner", known_concepts: [], weak_concepts: [], scaffold_level: 3 },
        targets: [{ objective_id: "O", source_id: "K001", required_fact_ids: ["F001"], observable_behavior: "recognize" }],
      } as any,
      evidence: { results: [{ source_id: "K001", title: "Python 是什么" }] } as any,
      assessment_plan: [],
    })
    const result = evaluatePublicAuthorCandidate({
      candidate_id: "C-META", artifact_kind: "concept_lesson", learning_design: design,
      payload: { objectives: [{ sections: [{ kind: "example", text: "print('source: K001')" }] }] },
    })
    expect(result.release_eligible).toBe(false)
    expect(result.critical_findings).toContain("PUBLIC_INTERNAL_METADATA")
  })

  test("assessment misconception quality only applies when the cited item has an available misconception", () => {
    const design = {
      learner: { misconceptions: ["MIS-OTHER-SOURCE"] },
      objectives: [],
    } as any
    const basePlan = {
      item_id: "I1",
      family_id: "F1",
      variant_id: "V1",
      display_no: 1,
      objective_id: "O1",
      observation_key: "OBS1",
      tier: 1,
      modality: "mcq",
      max_score: 1,
      citations: [{ source_id: "K018", fact_id: "F001", relation: "derived_from" }],
      cognitive_operation: "recognize_fact",
      construct: "recognize:recognize_fact",
      evidence_of_mastery: "select",
      context_strategy: { kind: "neutral_context" },
    } as const
    const payload = { items: [{ prompt: "哪项正确？", options: ["A", "B", "C"] }] }
    const notApplicable = evaluatePublicAuthorCandidate({
      candidate_id: "C-NO-MIS",
      artifact_kind: "assessment",
      payload,
      learning_design: design,
      assessment_plan: [{ ...basePlan, misconception_available: false }] as any,
    })
    const dimension = notApplicable.dimensions.find((entry) =>
      entry.dimension === "misconception_alignment")!
    expect(dimension.applicable).toBe(false)
    expect(dimension.score).toBe(1)

    const missingBinding = evaluatePublicAuthorCandidate({
      candidate_id: "C-MISSING-MIS",
      artifact_kind: "assessment",
      payload,
      learning_design: design,
      assessment_plan: [{ ...basePlan, misconception_available: true }] as any,
    })
    expect(missingBinding.dimensions.find((entry) =>
      entry.dimension === "misconception_alignment")).toMatchObject({ applicable: true, score: 0 })
  })

  test("hybrid retrieval consumes arbitrary metadata intent without source-specific rules", async () => {
    const knowledge = await loadKnowledgeBase()
    const target = knowledge.items.at(-1)!
    const ranked = await rankKnowledgeHybrid({
      query: "一个完全泛化的学习目标",
      items: knowledge.items,
      intent: { target_source_ids: [target.sourceId], resource_needs: ["example"] },
    })
    const targetSignal = ranked.find((entry) => entry.source_id === target.sourceId)!
    expect(targetSignal.metadata_score).toBeGreaterThanOrEqual(1)
    expect(ranked.filter((entry) => entry.metadata_score > 0).map((entry) => entry.source_id)).toContain(target.sourceId)
  })

  test("learning design turns profile evidence into explicit shared teaching decisions", () => {
    const spec = {
      spec_id: "SPEC-QUALITY",
      profile_ref: { profile_id: "P1", profile_version: "1" },
      learner_adaptation: {
        level: "beginner",
        known_concepts: [],
        weak_concepts: ["列表"],
        preferred_contexts: [],
        scaffold_level: 3,
      },
      targets: [{ objective_id: "O1", source_id: "K009", required_fact_ids: ["F001"], observable_behavior: "apply" }],
    } as any
    const evidence = {
      results: [{
        source_id: "K009",
        title: "列表",
        misconceptions: [{
          misconceptionId: "MIS-1",
          incorrectBelief: "列表没有顺序",
          diagnosticSignals: ["忽略元素顺序"],
          counterexample: "与事实不一致",
          correctionStrategy: "比较事实",
          distractorTemplates: ["列表没有顺序"],
          factRefs: [{ sourceId: "K009", factId: "F001" }],
        }],
      }],
    } as any
    const design = buildLearningDesignSpecV2({ spec, evidence, assessment_plan: [] })
    expect(design.learner.skills[0]?.evidence_basis).toBe("weak")
    expect(design.objectives[0]?.adaptation_decisions.map((entry) => entry.action)).toEqual([
      "reteach", "contrast", "guided_practice",
    ])
    expect(design.lesson_sequence.map((entry) => entry.kind)).toContain("contrast")
    expect(design.candidate_policy.public_candidate_count).toBe(3)
  })

  test("candidate tournament rejects hard failures and selects the strongest eligible public candidate", async () => {
    const design = buildLearningDesignSpecV2({
      spec: {
        spec_id: "S",
        profile_ref: { profile_id: "P", profile_version: "1" },
        learner_adaptation: { level: "basic", known_concepts: [], weak_concepts: [], scaffold_level: 2 },
        targets: [{ objective_id: "O", source_id: "K", required_fact_ids: ["F"], observable_behavior: "explain" }],
      } as any,
      evidence: { results: [{ source_id: "K", title: "主题" }] } as any,
      assessment_plan: [],
    })
    const payloads = [
      { title: "弱", objectives: [{ sections: [{ kind: "explanation", text: "事实。事实。" }] }] },
      { title: "好", objectives: [{ sections: [
        { kind: "explanation", text: "先建立判断框架，再解释关键含义。" },
        { kind: "worked_example", text: "例如观察一个直接实例，并逐步说明理由。" },
        { kind: "micro_check", text: "想一想：这个判断为什么成立？" },
      ] }] },
    ]
    const selected = await runPublicCandidateTournament({
      candidate_count: 2,
      generate: async (index) => payloads[index]!,
      evaluate: (payload, index) => evaluatePublicAuthorCandidate({
        candidate_id: `C${index}`,
        artifact_kind: "concept_lesson",
        payload,
        learning_design: design,
        minimum_score: 0.5,
      }),
    })
    expect(selected.winner).toEqual(payloads[1])
    expect(selected.winner_evaluation.release_eligible).toBe(true)
  })

  test("independent candidate critic blocks unsupported public semantics before winner selection", async () => {
    const base = {
      candidate_id: "C0",
      artifact_kind: "concept_lesson",
      hard_gates: [],
      dimensions: [{
        dimension: "objective_alignment", score: 0.9, weight: 1, confidence: 0.8,
        evidence_refs: ["O1"], rationale: "covered", core: true,
      }],
      overall_score: 0.9,
      release_eligible: true,
      critical_findings: [],
    } as any
    const reviewed = await reviewPublicCandidatesWithModel({
      gateway: {
        model_id: "glm-5.2",
        model_config_hash: "sha256:test",
        generateStructured: async () => ({
          results: [{
            candidate_index: 0,
            groundedness: 0.2,
            correctness: 0.8,
            instructional_value: 0.7,
            critical_issues: [{ code: "UNSUPPORTED_CLAIM", message: "新增了证据未提供的运行规则" }],
          }],
        }),
      } as any,
      task: "test.candidate",
      artifact_kind: "concept_lesson",
      candidates: [{ candidate: { text: "额外规则" }, variant_index: 0, evaluation: base }],
      evidence: [{ fact_id: "F1", content: "已知事实" }],
      contract: { objective_id: "O1" },
    })
    expect(reviewed[0]?.release_eligible).toBe(false)
    expect(reviewed[0]?.hard_gates.at(-1)?.gate).toBe("independent_model_critic")
    expect(reviewed[0]?.critical_findings[0]).toContain("UNSUPPORTED_CLAIM")
  })

  test("assessment validity rejects engineering distractors and enforces planned misconception binding", () => {
    const plan = [{
      item_id: "I1",
      modality: "mcq",
      cognitive_demand: "understand",
      forbidden_clues: ["RAG"],
      target_misconception_id: "MIS-1",
    }] as any
    const publicPayload = {
      items: [{
        item_id: "I1", modality: "mcq", prompt: "根据 RAG 选择答案", options: [
          { option_id: "A", label: "A", text: "正确陈述" },
          { option_id: "B", label: "B", text: "不需要任何事实依据" },
        ],
      }],
    } as any
    expect(validateAssessmentPublicValidity(publicPayload, plan).map((entry) => entry.code)).toEqual(expect.arrayContaining([
      "ASSESSMENT_INTERNAL_META_CLUE", "ASSESSMENT_VACUOUS_DISTRACTOR", "ASSESSMENT_FORBIDDEN_CLUE",
    ]))
    const securePayload = {
      items: [{ correct_option_id: "A", misconception_by_option: { B: "其他错误" } }],
    } as any
    expect(validateAssessmentPairValidity(publicPayload, securePayload, plan).map((entry) => entry.code)).toEqual(expect.arrayContaining([
      "ASSESSMENT_DISTRACTOR_WITHOUT_MISCONCEPTION", "ASSESSMENT_TARGET_MISCONCEPTION_MISSING",
    ]))
  })

  test("assessment scorecard excludes distractor dimensions for non-choice items", () => {
    const design = buildLearningDesignSpecV2({
      spec: {
        spec_id: "S-CODE-ITEM",
        profile_ref: { profile_id: "P", profile_version: "1" },
        learner_adaptation: { level: "basic", known_concepts: [], weak_concepts: [], scaffold_level: 2 },
        targets: [{ objective_id: "O", source_id: "K", required_fact_ids: ["F"], observable_behavior: "apply" }],
      } as any,
      evidence: { results: [{ source_id: "K", title: "主题" }] } as any,
      assessment_plan: [],
    })
    const evaluation = evaluatePublicAuthorCandidate({
      candidate_id: "CODE-ITEM",
      artifact_kind: "assessment",
      payload: { title: "代码题", items: [{ prompt: "完成函数并返回结果", options: null, starter_code: "def solve():\n    pass" }] },
      learning_design: design,
      assessment_plan: [{
        modality: "code", tier: 2, construct: "apply", evidence_of_mastery: "hidden tests", cognitive_demand: "apply",
      }] as any,
      minimum_score: 0.5,
    })
    expect(evaluation.dimensions.find((entry) => entry.dimension === "distractor_quality")?.applicable).toBe(false)
    expect(evaluation.critical_findings).not.toContain("CORE_QUALITY_DIMENSION_LOW")
  })

  test("posterior policy requests diagnosis under uncertainty and weights stronger evidence more", () => {
    const broad = betaPosteriorInterval(2, 1)
    expect(decideNextActionV2({ posterior: broad, sufficient_modalities: false }).action).toBe("diagnose")
    const base = {
      evidence: { modality: "mcq", raw_score: 1, evidence_score: 1, grader_confidence: 1, hint_level: 0, attempt_no: 1 },
    } as any
    expect(evidenceReliability({ ...base, evidence: { ...base.evidence, modality: "code" } })).toBeGreaterThan(
      evidenceReliability(base),
    )
  })

  test("benchmark reports human correlation and non-self-referential quality metrics", () => {
    const cases = [1, 2, 3].map((index) => ({
      case_id: `C${index}`,
      learner_profile_id: "P",
      artifact_kind: "assessment" as const,
      topic_ids: ["K"],
      required_fact_keys: [`K:F${index}`],
      allowed_claims: [], forbidden_claims: [],
      expected_adaptation_decisions: ["guided_practice"],
      forbidden_adaptation_decisions: [],
      target_misconception_ids: ["M"],
      expected_difficulty: 0.5,
    }))
    const report = evaluateQualityBenchmark(cases, cases.map((entry, index) => ({
      case_id: entry.case_id,
      automatic_score: index + 1,
      human_scores: [index + 1, index + 1],
      checked_claims: 2,
      conflicting_claims: 0,
      required_fact_keys_covered: entry.required_fact_keys,
      expected_adaptation_decisions_observed: ["guided_practice"],
      target_misconception_ids_observed: ["M"],
      transfer_passed: true,
    })))
    expect(report.claim_hallucination_rate).toBe(0)
    expect(report.core_fact_coverage).toBe(1)
    expect(report.automatic_human_spearman).toBe(1)
  })

  test("candidate tournament blocks when no candidate reaches release quality", async () => {
    const evaluation = {
      candidate_id: "C1", artifact_kind: "assessment" as const, hard_gates: [], dimensions: [],
      overall_score: 0.2, release_eligible: false, critical_findings: ["LOW"],
    }
    expect(runPublicCandidateTournament({
      candidate_count: 1,
      generate: async () => ({ value: 1 }),
      evaluate: () => evaluation,
    })).rejects.toBeInstanceOf(PublicQualityGateError)
  })

  test("code lab mutation plan binds every objective to a misconception and a killing test", () => {
    const spec = {
      spec_id: "S-MUTATION",
      targets: [{ objective_id: "O1" }, { objective_id: "O2" }],
    } as any
    const plan = buildCodeLabSecurePlan(spec, "SUITE-1", {
      O1: "MIS-RANGE-STOP",
      O2: "MIS-WRONG-ACCUMULATOR",
    })
    expect(plan.mutation_variants).toHaveLength(2)
    expect(plan.mutation_variants.map((entry) => entry.misconception_id)).toEqual([
      "MIS-RANGE-STOP", "MIS-WRONG-ACCUMULATOR",
    ])
    expect(plan.mutation_variants.every((entry, index) =>
      entry.must_fail_test_ids[0] === plan.hidden_tests[index]?.test_id)).toBe(true)

    const secure = materializeCodeLabSecureAuthorPayload(
      spec,
      {
        reference_solution: "def solve(values):\n    return sum(values)",
        hidden_tests: plan.hidden_tests.map(() => ({
          input: { args: [[1, 2, 3]], kwargs: {} },
          expected: 6,
          comparison: { kind: "exact" as const },
          misconception_tag: "model-free-text-is-not-authoritative",
        })),
        mutation_variants: [
          { code: "def solve(values):\n    return sum(values[:-1])", misconception_tag: "wrong" },
          { code: "def solve(values):\n    return values[-1]", misconception_tag: "wrong" },
        ],
      },
      {
        lab_id: "LAB-1",
        execution_contract: { execution_mode: "function", entry_point: "solve", input_contract: { kind: "json_args" }, output_contract: { kind: "json_value" }, allowed_imports: [] },
        starter_code: "def solve(values):\n    pass",
        instruction_blocks: [], public_tests: [], hint_ladder: [], reflection_questions: [], objective_coverage: [], used_evidence: [],
      } as any,
      "SUITE-1",
      plan,
    )
    expect(secure.mutation_variants.map((entry) => entry.misconception_tag)).toEqual([
      "MIS-RANGE-STOP", "MIS-WRONG-ACCUMULATOR",
    ])
  })
})
