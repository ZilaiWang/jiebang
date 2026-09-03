import { describe, expect, test } from "bun:test"
import { contentHash } from "../src/role-c-content/contracts/common"
import { buildResourceBlueprint } from "../src/role-c-content/planning/resource-blueprint"
import { buildAssessmentTaxonomyPlan } from "../src/role-c-content/planning/assessment-taxonomy"
import { buildPracticalGuidePlan } from "../src/role-c-content/planning/practical-guide-plan"
import { materializeCodeLabPublicAuthorPayload } from "../src/role-c-content/providers/staged-generation"
import { validateRoleCSchemaFragment } from "../src/role-c-content/validators/runtime-schema-validator"
import {
  validatePracticalGuideAgainstLearnerSurface,
  validatePracticalGuideForRelease,
} from "../src/role-c-content/validators/section-six-resource-validator"
import { extractCodeLabBlocks } from "../src/role-c-content/review/extract-review-blocks"

function fixture() {
  const evidence: any = {
    schema_version: "1.0", retrieval_id: "RAG-SECTION6", query: "列表", learner_level: "basic",
    top_k: 1, match_status: "strong", kb_version: "kb", rag_version: "rag",
    results: [{
      source_id: "K009", title: "列表", difficulty: "basic", rank_score: 1,
      match_reason: "目标匹配", snippet: "列表可保存多个值", source_file: "k.json",
      retrieval_trace: { matched_keywords: [], matched_fields: [], difficulty_match: true, score_breakdown: { keyword: 1, title: 1, facts: 1, practice_tasks: 0, difficulty: 1, bonus: 0 } },
      facts: [{ source_id: "K009", fact_id: "F001", content: "列表可以按顺序保存多个值。" }],
      examples: [], practice_tasks: [], quiz_seeds: [], misconceptions: [], worked_examples: [], counterexamples: [], assessment_constraints: [],
    }],
  }
  const pedagogy: any = {
    schema_version: "1.0", source_profile: { profile_id: "P", profile_version: "P-v2", revision: 2 },
    locked_core: { preserve_facts: true, preserve_objectives: true, preserve_answers: true, preserve_scoring: true, preserve_safety: true },
    learner_state: { level: "basic", known_concepts: [], weak_concepts: [], mastery_by_source_id: { K009: 0.9 } },
    lesson: { opening: "balanced", scaffold_strength: 3, terminology_density: "medium", worked_example_count: 2, require_step_trace: true, require_prerequisite_checkpoint: true, require_debugging_clinic: false, visible_contexts: [] },
    practice: { shape: "guided_coding", guided_to_independent_sequence: true, hint_levels: 3, transfer_distance: "medium", require_acceptance_criteria: true, require_expected_output: true, require_troubleshooting: true },
    assessment: { emphasis: { recall: 0.1, understanding: 0.2, application: 0.35, analysis: 0.25, creation: 0.1 }, preferred_modalities: ["mcq", "trace", "code"], require_direct_core_measurement: true },
    pacing: { weekly_minutes: 180, session_minutes: 35, recommended_chunks: 5, checkpoint_interval_minutes: 15 },
    constraints: { tool_constraints: ["仅使用 Python 标准库"], accommodations: [] }, rationale: [],
  }
  const spec: any = {
    schema_version: "1.0", spec_id: "SPEC-SECTION6", run_id: "RUN-SECTION6",
    evidence_ref: evidence.retrieval_id, evidence_content_hash: contentHash(evidence),
    profile_ref: { profile_id: "P", profile_version: "P-v2" },
    path_node: { node_id: "N1", goal: "用列表完成数据整理练习", target_source_ids: ["K009"], prerequisite_source_ids: [] },
    targets: [{ objective_id: "O-K009", source_id: "K009", required_fact_ids: ["F001"], observable_behavior: "apply", importance: "core", is_primary: true }],
    learner_adaptation: { level: "basic", known_concepts: [], weak_concepts: [], preferred_contexts: [], scaffold_level: 3, pedagogy_contract: pedagogy },
    assessment_blueprint: { tier_1_count: 1, tier_2_count: 1, tier_3_count: 1, required_modalities: ["mcq", "trace", "code"] },
    policies: { seed: 17 },
    difficulty: { domain_complexity: 2, cognitive_demand: 2, reasoning_steps: 2, code_complexity: 2, prerequisite_load: 1, scaffold_strength: 3 },
  }
  return { evidence, spec }
}

describe("第 6 项统一资源链", () => {
  test("整个程序的排错和扩展同时绑定配套目标证据，非首目标知识不会失去引用", () => {
    const plan = buildPracticalGuidePlan({
      lab_id: "LAB-MULTI", objective_ids: ["LOOP", "LIST"], primary_objective_id: "LOOP",
      goal_context: "循环处理列表", scaffold_strength: 2, session_minutes: 30,
      require_troubleshooting: true, tool_constraints: [], prerequisite_fact_refs: [],
      objective_fact_refs: {
        LOOP: [{ source_id: "K007", fact_id: "F005", relation: "derived_from" }],
        LIST: [{ source_id: "K009", fact_id: "F015", relation: "derived_from" }],
      }, public_tests: [{ test_id: "T1", objective_id: "LOOP" }, { test_id: "T2", objective_id: "LIST" }],
    })
    for (const entry of [...plan.troubleshooting_slots, plan.extension_slot]) {
      expect(entry.citations.map(c => `${c.source_id}:${c.fact_id}`)).toEqual(["K007:F005", "K009:F015"])
    }
    expect(plan.step_slots[1]!.citations.map(c => c.source_id)).toEqual(["K009"])
  })
  test("实操前置检查同时绑定先修事实、当前任务事实与输入合同", () => {
    const plan = buildPracticalGuidePlan({
      lab_id: "LAB-R", objective_ids: ["O1"], primary_objective_id: "O1",
      goal_context: "变量练习", scaffold_strength: 3, session_minutes: 30,
      require_troubleshooting: true, tool_constraints: [],
      prerequisite_fact_refs: [{ source_id: "K001", fact_id: "F001", relation: "prerequisite" }],
      objective_fact_refs: { O1: [{ source_id: "K002", fact_id: "F013", relation: "derived_from" }] },
      public_tests: [{ test_id: "T1", objective_id: "O1" }],
    })
    expect(plan.readiness_slots[0]!.citations.map((entry) => `${entry.source_id}:${entry.fact_id}`))
      .toEqual(["K001:F001", "K002:F013"])
    expect(plan.readiness_slots[0]!.contract_refs).toContain("execution.input_contract")
  })

  test("真实 mastery 驱动 LearningDesignSpec，测评计划携带双重分阶", () => {
    const { evidence, spec } = fixture()
    const blueprint = buildResourceBlueprint(spec, evidence)
    expect(blueprint.learning_design.learner.skills[0]).toMatchObject({
      source_id: "K009", mean: 0.9, evidence_basis: "mastery_observation", progress_band: "mastered",
    })
    expect(blueprint.learning_design.objectives[0]!.adaptation_decisions.map((entry) => entry.action)).toEqual([
      "brief_activate", "transfer_challenge",
    ])
    expect(blueprint.learning_design.lesson_sequence.map((entry) => entry.kind)).toEqual([
      "activation", "micro_check", "transfer",
    ])
    expect(blueprint.code_lab.practical_guide_plan.step_slots).toHaveLength(3)
    expect(blueprint.assessment.item_plan.every((item) => item.difficulty_band && item.cognitive_level)).toBe(true)
    expect(new Set(blueprint.assessment.item_plan.map((item) => item.difficulty_band))).toEqual(new Set(["foundation", "improvement", "integration"]))
  })

  test("模型正文按冻结 PracticalGuidePlan 物化，公开测试确定性成为验收标准", () => {
    const { evidence, spec } = fixture()
    const blueprint = buildResourceBlueprint(spec, evidence)
    const guidePlan = blueprint.code_lab.practical_guide_plan
    const author: any = {
      title: "列表数据整理实验",
      execution_contract: {
        language: "python", execution_mode: "stdin_stdout", allowed_imports: [],
        input_contract: { type: "single_line_text", constraints: ["单行空格分隔"] },
        output_contract: { kind: "string", type: "stdout_lines", constraints: ["输出整理结果"] },
        resource_limits: { timeout_ms: 1000, memory_mb: 64, max_output_bytes: 1024 },
      },
      starter_code: "values = input().split()\n# TODO: 整理 values 并输出\n",
      objectives: [{
        instruction_text: "读取一行数据并用列表保存，完成整理后输出结果。",
        public_test: { description: "输入三个词并检查输出顺序", input: "甲 乙 丙\n", expected_behavior: "按任务要求输出整理后的三个词" },
        hints: ["先确认输入形成的列表。", "按目标顺序处理列表元素。", "完成处理后统一输出结果。"],
        reflection_question: "你的实现如何保持列表中的顺序？",
      }],
      practical_guide: {
        practice_goal: "完成一个可运行的列表数据整理程序。",
        deliverable: "提交能读取单行数据并输出整理结果的 Python 程序。",
        readiness_checks: guidePlan.readiness_slots.map(() => ({ title: "确认输入格式", check: "准备一行以空格分隔的数据", ready_when: "可以说明这一行如何形成列表" })),
        steps: guidePlan.step_slots.map((slot) => ({ title: `步骤 ${slot.sequence}`, action: "在起始代码中完成当前列表处理操作", input: "使用公开案例中的单行文本", expected_result: "程序得到与任务合同一致的列表处理结果", verification: "运行公开案例并核对输出" })),
        troubleshooting: guidePlan.troubleshooting_slots.map(() => ({ symptom: "输出顺序与预期不同", likely_cause: "处理列表时改变了元素顺序", recovery_steps: ["检查列表处理顺序", "重新运行公开案例"], verification: "输出顺序与公开验收标准一致" })),
        extension_task: { task: "增加输入元素数量后再次完成相同整理任务", changed_dimension: "输入规模", verification: "使用更长的单行输入运行并核对输出" },
      },
    }
    const payload = materializeCodeLabPublicAuthorPayload(
      { generation_spec: spec, evidence_pack: evidence } as any,
      author,
      blueprint.code_lab.lab_id,
      blueprint.code_lab.objective_plan,
      guidePlan,
    )
    expect(payload.practical_guide!.acceptance_criteria.map((entry) => entry.public_test_id)).toEqual(payload.public_tests.map((test) => test.test_id))
    expect(payload.practical_guide!.steps).toHaveLength(guidePlan.step_slots.length)
    expect(validatePracticalGuideForRelease(payload.practical_guide!)).toEqual([])
    const todoInstruction = structuredClone(payload.practical_guide!)
    todoInstruction.steps[0]!.action = "将题面可见的 TODO 替换为符合目标的列表处理语句"
    expect(validatePracticalGuideForRelease(todoInstruction)).toEqual([])
    const unfinished = structuredClone(payload.practical_guide!)
    unfinished.steps[0]!.action = "TODO"
    expect(validatePracticalGuideForRelease(unfinished)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "placeholder_visible_text", path: "$.steps[0].action" }),
    ]))
    const inconsistentGuide = structuredClone(payload.practical_guide!)
    inconsistentGuide.steps[0]!.action = "打开 starter_code，把 message 等号右边的 TODO_FILL_FACT 替换掉"
    expect(validatePracticalGuideAgainstLearnerSurface({
      guide: inconsistentGuide,
      starter_code: payload.starter_code,
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "internal_guide_vocabulary" }),
      expect.objectContaining({ code: "guide_identifier_mismatch" }),
    ]))
    const legitimateExtension = structuredClone(payload.practical_guide!)
    legitimateExtension.extension_task.task = "新增变量 extra_value = 5，再比较扩展前后的整理结果"
    legitimateExtension.extension_task.verification = "检查 extra_value 的值是否为 5，再核对扩展输出"
    expect(validatePracticalGuideAgainstLearnerSurface({
      guide: legitimateExtension,
      starter_code: payload.starter_code,
    }).filter((issue) => issue.code === "guide_identifier_mismatch")).toEqual([])
    const leakedExtension = structuredClone(legitimateExtension)
    leakedExtension.steps[0]!.action = "修改骨架中 extra_value 的值"
    expect(validatePracticalGuideAgainstLearnerSurface({ guide: leakedExtension, starter_code: payload.starter_code }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: "guide_identifier_mismatch", path: "$.steps[0].action" })]))
    const learnerLocal = structuredClone(payload.practical_guide!)
    learnerLocal.steps[0]!.action = "读取文件并将文本保存为 content，供后续处理"
    learnerLocal.steps[0]!.expected_result = "content 的值包含读到的文本"
    expect(validatePracticalGuideAgainstLearnerSurface({ guide: learnerLocal, starter_code: "def solve(path):\n    pass" })
      .filter(issue => issue.code === "guide_identifier_mismatch")).toEqual([])
    const misleadingExtension = structuredClone(payload.practical_guide!)
    misleadingExtension.extension_task.task = "把已有的 extra_value = 5 改成 6"
    expect(validatePracticalGuideAgainstLearnerSurface({
      guide: misleadingExtension,
      starter_code: payload.starter_code,
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "guide_identifier_mismatch" }),
    ]))
    const inventedDomainGuide = structuredClone(payload.practical_guide!)
    inventedDomainGuide.extension_task.task = "例如列表仅用于网页数据时，判断该说法是否正确"
    expect(validatePracticalGuideAgainstLearnerSurface({
      guide: inventedDomainGuide,
      starter_code: payload.starter_code,
      evidence_facts: ["列表可以按顺序保存多个值。"],
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "unsupported_guide_example" }),
    ]))
    expect(validateRoleCSchemaFragment("code_lab_draft.schema.json", "/$defs/public_payload", payload).ok).toBe(true)
    const guideGoal = extractCodeLabBlocks({
      status: "ready",
      artifact_id: "ART-LAB-SECTION6",
      payload,
    } as any).find((block) => block.locator.field === "practical_guide_goal")
    expect(guideGoal?.fact_audit_mode).toBe("citation_only")
    expect(guideGoal?.citations.every((citation) => citation.source_id === "K009")).toBe(true)
  })

  test("学习进度只改变支架与任务结构，不改写冻结事实和目标", () => {
    const { evidence, spec } = fixture()
    const mastered = buildResourceBlueprint(spec, evidence)
    const reteachSpec = structuredClone(spec)
    reteachSpec.learner_adaptation.pedagogy_contract.learner_state.mastery_by_source_id.K009 = 0.2
    const reteach = buildResourceBlueprint(reteachSpec, evidence)

    expect(reteach.learning_design.learner.skills[0]).toMatchObject({
      mean: 0.2,
      evidence_basis: "mastery_observation",
      progress_band: "needs_reteach",
    })
    expect(reteach.code_lab.practical_guide_plan.step_slots).toHaveLength(5)
    expect(mastered.code_lab.practical_guide_plan.step_slots).toHaveLength(3)
    expect(reteach.learning_design.lesson_sequence.map((entry) => entry.kind)).toEqual([
      "activation", "explanation", "worked_example", "micro_check", "guided_practice", "transfer",
    ])
    expect(mastered.learning_design.lesson_sequence.map((entry) => entry.kind)).toEqual([
      "activation", "micro_check", "transfer",
    ])
    expect(contentHash(reteachSpec.targets)).toBe(contentHash(spec.targets))
    expect(reteachSpec.evidence_content_hash).toBe(spec.evidence_content_hash)
  })

  test("测评双重分阶由题目操作、Tier 与真实进度共同确定", () => {
    const items: any[] = [
      { item_id: "I1", objective_id: "O1", tier: 1, modality: "mcq", cognitive_operation: "recognize_fact" },
      { item_id: "I2", objective_id: "O1", tier: 2, modality: "trace", cognitive_operation: "trace_execution" },
      { item_id: "I3", objective_id: "O1", tier: 3, modality: "short_answer", cognitive_operation: "diagnose_error" },
      { item_id: "I4", objective_id: "O1", tier: 3, modality: "code", cognitive_operation: "construct_solution", presentation_mode: "scenario_transfer" },
    ]
    const plan = buildAssessmentTaxonomyPlan({
      items,
      emphasis: { recall: 0.1, understanding: 0.15, application: 0.25, analysis: 0.25, creation: 0.25 },
      progress_by_objective: { O1: "mastered" },
    })
    expect(plan.entries.map((entry) => entry.difficulty_band)).toEqual([
      "foundation", "improvement", "integration", "extension",
    ])
    expect(plan.entries.map((entry) => entry.cognitive_level)).toEqual([
      "remember", "apply", "analyze", "create",
    ])

    const notTransferReady = buildAssessmentTaxonomyPlan({
      items,
      emphasis: { recall: 0.1, understanding: 0.15, application: 0.25, analysis: 0.25, creation: 0.25 },
      progress_by_objective: { O1: "developing" },
    })
    expect(notTransferReady.entries.at(-1)?.difficulty_band).toBe("integration")
  })
})
