import { describe, expect, test } from "bun:test"
import { loadKnowledgeBase } from "../src/knowledge/loader"
import { rankKnowledgeHybrid } from "../src/rag/hybrid-retriever"
import { buildLearningDesignSpecV2 } from "../src/role-c-content/planning/learning-design-spec-v2"
import { runPublicCandidateTournament, PublicQualityGateError } from "../src/role-c-content/quality/candidate-tournament"
import { ModelGatewayError } from "../src/role-c-content/contracts/model-gateway"
import { evaluatePublicAuthorCandidate } from "../src/role-c-content/quality/public-candidate-quality"
import {
  validateAssessmentAuthorEvidenceDiscipline,
  validateAssessmentPairValidity,
  validateAssessmentPublicValidity,
} from "../src/role-c-content/quality/assessment-validity"
import { betaPosteriorInterval, decideNextActionV2, evidenceReliability } from "../src/role-c-content/mastery/posterior-policy"
import { evaluateQualityBenchmark } from "../src/evaluation/quality-benchmark"
import { buildCodeLabSecurePlan, materializeCodeLabSecureAuthorPayload } from "../src/role-c-content/providers/staged-generation"
import { reviewPublicCandidatesWithModel } from "../src/role-c-content/quality/model-candidate-critic"
import { publicQualityBlockedReason } from "../src/role-c-content/orchestrator/content-pipeline"
import { normalizeEvidenceBoundedAssessmentChoices } from "../src/role-c-content/providers/model-backed-provider"

describe("quality kernel v2", () => {
  test("直接识别题保留 AI 编写的有区分度选项，不再覆盖成事实原句和直接否定", () => {
    const authored = normalizeEvidenceBoundedAssessmentChoices({
      title: "变量",
      items: [{
        prompt: "执行赋值后，以下哪项符合事实？",
        options: ["= 用来建立变量与数据的对应关系", "变量名本身就是它引用的数据"],
        starter_code: null,
        structure_meta: {
          operation: "recognize_fact", reasoning_pattern: "identify_supported_relation",
          representation: "minimal_context_sentence", context_family: "direct", answer_form: "single_choice",
        },
      }],
    } as any, [{
      item_id: "ITEM-2", modality: "mcq", cognitive_operation: "recognize_fact",
      citations: [{ source_id: "K002", fact_id: "F001", relation: "derived_from" }],
    }] as any, [{ source_id: "K002", fact_id: "F001", content: "Python 使用 = 进行变量赋值。" }])
    expect(authored.items[0]!.prompt).toBe("执行赋值后，以下哪项符合事实？")
    expect(authored.items[0]!.options).toEqual([
      "= 用来建立变量与数据的对应关系",
      "变量名本身就是它引用的数据",
    ])
  })

  test("解释型选择题保留与题干相配的模型选项", () => {
    const authored = normalizeEvidenceBoundedAssessmentChoices({
      title: "变量",
      items: [{
        prompt: "为什么第二次赋值后应关注新的绑定？",
        options: ["旧内容仍保留", "变量换到了别的硬件"],
        starter_code: null,
        structure_meta: {
          operation: "explain", reasoning_pattern: "explain_relation",
          representation: "short_scenario", context_family: "direct", answer_form: "single_choice",
        },
      }],
    } as any, [{
      item_id: "ITEM-4", modality: "mcq", cognitive_operation: "explain_reasoning",
      citations: [{ source_id: "K002", fact_id: "F003", relation: "derived_from" }],
    }] as any, [{ source_id: "K002", fact_id: "F003", content: "变量可以被重新赋值，新值会覆盖旧绑定。" }])
    expect(authored.items[0]!.prompt).toContain("第二次赋值")
    expect(authored.items[0]!.options).toEqual(["旧内容仍保留", "变量换到了别的硬件"])
  })

  test("追踪和应用型选择题不被事实文本覆盖", () => {
    const authored = normalizeEvidenceBoundedAssessmentChoices({
      title: "变量状态追踪",
      items: [{
        prompt: "依次执行两次赋值后，哪一项准确描述变量状态？",
        options: ["程序会保留两套输出", "编译器自动选择结果"],
        starter_code: null,
        structure_meta: {
          operation: "trace", reasoning_pattern: "trace_state",
          representation: "code_trace", context_family: "direct", answer_form: "single_choice",
        },
      }],
    } as any, [{
      item_id: "ITEM-A", modality: "mcq", cognitive_operation: "trace_execution",
      citations: [{ source_id: "K002", fact_id: "F003", relation: "derived_from" }],
    }] as any, [{ source_id: "K002", fact_id: "F003", content: "变量可以被重新赋值，新值会覆盖旧绑定。" }])
    expect(authored.items[0]!.prompt).toContain("两次赋值")
    expect(authored.items[0]!.options).toEqual(["程序会保留两套输出", "编译器自动选择结果"])
  })

  test("多事实选择题保留模型基于全部引用关系设计的选项", () => {
    const authored = normalizeEvidenceBoundedAssessmentChoices({
      title: "顺序追踪",
      items: [{
        prompt: "从上到下执行两次赋值后，哪项描述正确？",
        options: ["模型原始选项一", "模型原始选项二"],
        starter_code: null,
        structure_meta: {
          operation: "trace", reasoning_pattern: "trace_state",
          representation: "code_trace", context_family: "direct", answer_form: "single_choice",
        },
      }],
    } as any, [{
      item_id: "ITEM-C", modality: "mcq", cognitive_operation: "trace_execution",
      citations: [
        { source_id: "K002", fact_id: "F003", relation: "derived_from" },
        { source_id: "K002", fact_id: "F013", relation: "derived_from" },
      ],
    }] as any, [
      { source_id: "K002", fact_id: "F003", content: "变量可以被重新赋值，新值会覆盖旧绑定。" },
      { source_id: "K002", fact_id: "F013", content: "顺序结构中的语句按书写顺序依次执行。" },
    ])
    expect(authored.items[0]!.options).toEqual(["模型原始选项一", "模型原始选项二"])
  })

  test("公开候选质量拒绝属于内容 blocked，不伪装成 provider 故障", () => {
    const error = new PublicQualityGateError([{
      candidate_id: "C-BLOCK", artifact_kind: "assessment", hard_gates: [], dimensions: [],
      overall_score: 0, release_eligible: false,
      critical_findings: ["MODEL_CRITIC:answer_ambiguity:答案边界不明确"],
    }], 0)
    expect(publicQualityBlockedReason(error)).toEqual({
      code: "BLOCKED_INVALID_OUTPUT",
      message: error.message,
      details: ["MODEL_CRITIC:answer_ambiguity:答案边界不明确"],
    })
    expect(publicQualityBlockedReason(new Error("network"))).toBeUndefined()
  })

  test("全部候选因模型额度失败时保留 provider 终局，不伪装成质量门禁", async () => {
    const quotaError = new ModelGatewayError(
      "HTTP_ERROR",
      "模型服务返回 HTTP 429：余额不足或无可用资源包",
      { provider_code: "1113", http_status: 429 },
    )
    await expect(runPublicCandidateTournament({
      candidate_count: 3,
      generate: async () => { throw quotaError },
      evaluate: () => { throw new Error("没有候选时不应进入质量评估") },
    })).rejects.toBe(quotaError)
  })
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

  test("candidate critic cannot reject a fact that the frozen slot explicitly contains", async () => {
    const base = {
      candidate_id: "C-SLOT",
      artifact_kind: "concept_lesson",
      hard_gates: [],
      dimensions: [{
        dimension: "objective_alignment", score: 0.95, weight: 1, confidence: 0.8,
        evidence_refs: ["O1"], rationale: "covered", core: true,
      }],
      overall_score: 0.95,
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
            groundedness: 40,
            correctness: 80,
            instructional_value: 70,
            critical_issues: [{
              code: "slot_fact_misplacement",
              message: "CONCEPT-SLOT-abc 使用 F004，但该 slot.fact_ids 含 F004/F005/F006，F004 属于另一 slot。",
            }],
          }],
        }),
      } as any,
      task: "test.candidate",
      artifact_kind: "concept_lesson",
      candidates: [{ candidate: { text: "列表用方括号创建" }, variant_index: 0, evaluation: base }],
      evidence: [{ fact_id: "F004", content: "列表用方括号创建" }],
      contract: {
        section_plan: [{ slots: [{ slot_id: "CONCEPT-SLOT-abc", fact_ids: ["F004", "F005", "F006"] }] }],
      },
    })
    expect(reviewed[0]?.hard_gates.at(-1)).toMatchObject({
      gate: "independent_model_critic",
      passed: true,
    })
    expect(reviewed[0]?.critical_findings).toEqual([])
  })

  test("candidate critic 对数量不完整的结构化输出做一次精确重试", async () => {
    let calls = 0
    const base = {
      candidate_id: "C-RETRY", artifact_kind: "code_lab", hard_gates: [],
      dimensions: [], overall_score: 1, release_eligible: true, critical_findings: [],
    } as any
    const reviewed = await reviewPublicCandidatesWithModel({
      gateway: {
        model_id: "glm-5.2", model_config_hash: "sha256:test",
        generateStructured: async () => {
          calls += 1
          return calls === 1 ? { results: [] } : { results: [{
            candidate_index: 0, groundedness: 1, correctness: 1,
            instructional_value: 1, critical_issues: [],
          }] }
        },
      } as any,
      task: "test.candidate-retry",
      artifact_kind: "code_lab",
      candidates: [{ candidate: { text: "任务" }, variant_index: 0, evaluation: base }],
      evidence: [], contract: {},
    })
    expect(calls).toBe(2)
    expect(reviewed[0]?.release_eligible).toBe(true)
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

  test("tier-1 choice author cannot invent absolute scope absent from its cited fact", () => {
    const payload = {
      title: "for 循环识别",
      items: [{
        prompt: "for 循环常用于什么？",
        options: ["遍历序列中的元素", "仅用于生成整数序列", "仅用于终止循环"],
        starter_code: null,
        structure_meta: { operation: "recognize" },
      }],
    } as any
    const plan = [{
      tier: 1,
      modality: "mcq",
      citations: [{ source_id: "K007", fact_id: "F001", relation: "derived_from" }],
    }] as any
    const facts = [{
      source_id: "K007",
      fact_id: "F001",
      content: "for 循环常用于遍历序列中的元素。",
    }]
    const issues = validateAssessmentAuthorEvidenceDiscipline(payload, plan, facts)
    expect(issues.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      "ASSESSMENT_UNSUPPORTED_ABSOLUTE_DISTRACTOR",
    ]))
    payload.items[0].options = ["遍历序列中的元素", "不常用于遍历序列中的元素"]
    expect(validateAssessmentAuthorEvidenceDiscipline(payload, plan, facts)).toEqual([])
  })

  test("高阶选择题的题干也不能用证据外绝对范围伪造误区", () => {
    const issues = validateAssessmentAuthorEvidenceDiscipline({
      title: "Python 定位",
      items: [{
        prompt: "如何判断‘Python 只能用于教学’？",
        options: ["成立", "不成立"],
        starter_code: null,
        structure_meta: { operation: "analyze" },
      }],
    } as any, [{
      tier: 2,
      modality: "mcq",
      citations: [{ source_id: "K001", fact_id: "F003", relation: "derived_from" }],
    }] as any, [{
      source_id: "K001",
      fact_id: "F003",
      content: "Python 适合编写脚本、数据处理和教学示例。",
    }])
    expect(issues.map((entry) => entry.code)).toContain("ASSESSMENT_UNSUPPORTED_ABSOLUTE_PROMPT")
  })

  test("‘仅限某领域’属于证据外绝对范围，不能绕过选择题作者校验", () => {
    const issues = validateAssessmentAuthorEvidenceDiscipline({
      title: "Python 定位",
      items: [{
        prompt: "以下哪项正确？",
        options: ["Python 是一种通用编程语言", "Python 仅限网页设计"],
        starter_code: null,
        structure_meta: { operation: "recognize" },
      }],
    } as any, [{
      tier: 1,
      modality: "mcq",
      citations: [{ source_id: "K001", fact_id: "F001", relation: "derived_from" }],
    }] as any, [{
      source_id: "K001",
      fact_id: "F001",
      content: "Python 是一种通用编程语言。",
    }])
    expect(issues.map((entry) => entry.code)).toContain("ASSESSMENT_UNSUPPORTED_ABSOLUTE_DISTRACTOR")
  })

  test("选择题不能引入未被本题引用支持的编译器或代码块机制", () => {
    const issues = validateAssessmentAuthorEvidenceDiscipline({
      title: "Python 基础事实",
      items: [{
        prompt: "以下哪项正确？",
        options: ["Python 程序通常由解释器执行", "Python 程序通常由编译器执行", "Python 用大括号表示代码块"],
        starter_code: null,
        structure_meta: { operation: "recognize" },
      }],
    } as any, [{
      tier: 1,
      modality: "mcq",
      citations: [{ source_id: "K001", fact_id: "F002", relation: "derived_from" }],
    }] as any, [{
      source_id: "K001",
      fact_id: "F002",
      content: "Python 程序通常由解释器执行。",
    }])
    expect(issues.map((entry) => entry.code)).toContain("ASSESSMENT_OUT_OF_EVIDENCE_MECHANISM")
  })

  test("两条引用事实允许设计对象与类别的有效匹配题", () => {
    const issues = validateAssessmentAuthorEvidenceDiscipline({
      title: "基本数据类型",
      items: [{
        prompt: "哪组数据类型与含义的对应关系正确？",
        options: ["int—整数；str—字符串文本", "int—字符串文本；str—整数"],
        starter_code: null,
        structure_meta: { operation: "recognize" },
      }],
    } as any, [{
      tier: 1,
      modality: "mcq",
      citations: [
        { source_id: "K003", fact_id: "F001", relation: "derived_from" },
        { source_id: "K003", fact_id: "F002", relation: "derived_from" },
      ],
    }] as any, [
      { source_id: "K003", fact_id: "F001", content: "int 表示整数。" },
      { source_id: "K003", fact_id: "F002", content: "str 表示字符串文本。" },
    ])
    expect(issues).toEqual([])
  })

  test("事实原句加否定词的伪选择题会被质量门禁拒绝", () => {
    const issues = validateAssessmentAuthorEvidenceDiscipline({
      title: "基本数据类型",
      items: [{
        prompt: "以下哪项符合事实？",
        options: ["int 表示整数。", "int 不表示整数。"],
        starter_code: null,
        structure_meta: { operation: "recognize" },
      }],
    } as any, [{
      tier: 1,
      modality: "mcq",
      citations: [{ source_id: "K003", fact_id: "F001", relation: "derived_from" }],
    }] as any, [{ source_id: "K003", fact_id: "F001", content: "int 表示整数。" }])
    expect(issues.map((entry) => entry.code)).toContain("ASSESSMENT_DEGENERATE_FACT_NEGATION_PAIR")
  })

  test("整卷修订不能把同知识点未引用的重新赋值机制偷渡进单事实题", () => {
    const issues = validateAssessmentAuthorEvidenceDiscipline({
      title: "变量与赋值",
      items: [{
        prompt: "对变量名 m 连续两次赋值后，它与数据的绑定关系是什么？",
        options: ["引用第二个数据", "引用第一个数据"],
        starter_code: null,
        structure_meta: { operation: "recognize" },
      }],
    } as any, [{
      tier: 2,
      modality: "mcq",
      citations: [{ source_id: "K002", fact_id: "F002", relation: "derived_from" }],
    }] as any, [
      { source_id: "K002", fact_id: "F002", content: "变量名用于引用程序中的数据。" },
      { source_id: "K002", fact_id: "F003", content: "变量可以被重新赋值，新值会覆盖旧绑定。" },
    ])
    expect(issues.map((entry) => entry.code)).toContain("ASSESSMENT_UNCITED_MECHANISM")
  })

  test("选择题拒绝选否定项的双重反转题干", () => {
    const issues = validateAssessmentAuthorEvidenceDiscipline({
      title: "Python 语法",
      items: [{
        prompt: "哪一项是对缩进事实的直接否定？",
        options: ["Python 用缩进表示代码块", "Python 不用缩进表示代码块"],
        starter_code: null,
        structure_meta: { operation: "recognize" },
      }],
    } as any, [{
      tier: 1,
      modality: "mcq",
      citations: [{ source_id: "K001", fact_id: "F004", relation: "derived_from" }],
    }] as any, [{
      source_id: "K001", fact_id: "F004",
      content: "Python 语法简洁，用缩进表示代码块，强调代码可读性。",
    }])
    expect(issues.map((entry) => entry.code)).toContain("ASSESSMENT_AMBIGUOUS_NEGATIVE_STEM")
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

  test("debugging starter is scored as a runnable faulty program rather than an incomplete implementation", () => {
    const design = buildLearningDesignSpecV2({
      spec: {
        spec_id: "S-DEBUG-STARTER",
        profile_ref: { profile_id: "P", profile_version: "1" },
        learner_adaptation: { level: "basic", known_concepts: [], weak_concepts: [], scaffold_level: 2 },
        targets: [{ objective_id: "O", source_id: "K", required_fact_ids: ["F"], observable_behavior: "debug" }],
      } as any,
      evidence: { results: [{ source_id: "K", title: "循环边界" }] } as any,
      assessment_plan: [],
    })
    const evaluation = evaluatePublicAuthorCandidate({
      candidate_id: "DEBUG-STARTER",
      artifact_kind: "code_lab",
      payload: {
        starter_code: "for index in range(3):\n    print(index + 1)",
        programming_task: { task_kind: "debugging_repair" },
        objectives: [{
          instruction_text: "运行程序并定位编号边界错误",
          public_test: { input: "", expected_behavior: "输出 0、1、2" },
          hints: ["观察首项", "追踪 index", "核对边界"],
          reflection_question: "哪一个公开输出暴露了边界问题？",
        }],
      },
      learning_design: design,
      code_lab_task_kind: "debugging_repair",
      minimum_score: 0.5,
    })
    expect(evaluation.dimensions.find((entry) => entry.dimension === "starter_scaffolding"))
      .toMatchObject({ score: 1, core: true })
    expect(evaluation.critical_findings).not.toContain("CORE_QUALITY_DIMENSION_LOW")
  })

  test("Tier 3 的 recognize 题未冻结迁移构念时不被质量核反向逼成高阶题", () => {
    const design = buildLearningDesignSpecV2({
      spec: {
        spec_id: "S-RECOGNIZE-T3",
        profile_ref: { profile_id: "P", profile_version: "1" },
        learner_adaptation: { level: "beginner", known_concepts: [], weak_concepts: [], scaffold_level: 3 },
        targets: [{ objective_id: "O", source_id: "K001", required_fact_ids: ["F001"], observable_behavior: "recognize" }],
      } as any,
      evidence: { results: [{ source_id: "K001", title: "Python 是什么" }] } as any,
      assessment_plan: [],
    })
    const evaluation = evaluatePublicAuthorCandidate({
      candidate_id: "RECOGNIZE-T3",
      artifact_kind: "assessment",
      payload: { title: "识别题", items: [{ prompt: "Python 是哪一类事物？", options: ["一种通用编程语言", "不是一种通用编程语言"], starter_code: null }] },
      learning_design: design,
      assessment_plan: [{
        modality: "mcq", tier: 3, construct: "recognize:recognize_fact",
        evidence_of_mastery: "直接识别", cognitive_demand: "understand",
      }] as any,
      minimum_score: 0.5,
    })
    expect(evaluation.dimensions.find((entry) => entry.dimension === "transfer_validity")?.applicable).toBe(false)
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
