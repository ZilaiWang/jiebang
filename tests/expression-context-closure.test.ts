import { describe, expect, test } from "bun:test"
import {
  buildRoleCExpressionContext,
  buildRoleCPedagogyContract,
  buildRoleCProfileSnapshotOptions,
  classifyDisciplineFamily,
  PROFILE_V2_CONSUMABLE_FIELDS,
  unownedProfileV2Fields,
} from "../src/role-b-profile"
import type { LearnerProfileV2 } from "../src/role-b-profile/learner-profile-v2"
import { adaptLearnerProfile, defineLearningPathNode } from "../src/role-c-content/contracts/profile-adapter"
import { buildGenerationSpec } from "../src/role-c-content/contracts/generation-spec"
import { evaluateExpressionAdaptation } from "../src/role-c-content/quality/expression-adaptation"
import { validateRoleCSchema } from "../src/role-c-content/validators/runtime-schema-validator"

function profile(overrides: Partial<LearnerProfileV2> = {}): LearnerProfileV2 {
  const base: LearnerProfileV2 = {
    schema_version: "2.0",
    profile_id: "PROFILE-EXPRESSION",
    profile_version: "PROFILE-EXPRESSION-v2-r1",
    revision: 1,
    learner_id: "learner-expression",
    level: "basic",
    known_concepts: ["变量"],
    weak_concepts: ["循环"],
    goal: "学习 Python 循环",
    background_context: {
      summary: "这段原始背景绝不跨到 C",
      education_stage: "本科",
      discipline_background: ["人文社科"],
      role_context: "校园调查 user@example.com",
      prior_languages: ["自然语言写作"],
      prior_topics: ["分类与关系"],
    },
    goal_context: { use_case: "coursework", desired_outcome: "完成课程练习", deadline: "2026-09-05" },
    self_assessment: { reported_level: "basic" },
    learning_preferences: { explanation: "balanced", practice: "mixed", pace: "steady", preferred_contexts: ["文本条目"] },
    learning_constraints: { weekly_time_budget_minutes: 180, session_time_budget_minutes: 30, tool_constraints: [], accommodations: [] },
    progress: {
      mastery_by_source_id: { K001: 0.8 },
      completed_session_ids: [],
      recent_error_patterns: ["循环边界容易漏掉"],
      last_observation_id: null,
      last_observed_at: null,
      last_assessment_accuracy: null,
    },
    learning_barriers: [{ source_id: "K007", barrier: "boundary_condition", count: 2 }],
    privacy: { personalization_enabled: true, retention: "session_only", allow_profile_display: true },
    provenance: { field_sources: [] },
    created_at: "2026-08-28T00:00:00.000Z",
    updated_at: "2026-08-31T00:00:00.000Z",
  }
  return { ...base, ...overrides }
}

describe("B to C expression context closure", () => {
  test("discipline changes expression policy but never locked teaching core", () => {
    const humanities = profile()
    const engineering = profile({
      background_context: { ...profile().background_context, discipline_background: ["计算机与工程"] },
    })
    const humanitiesPedagogy = buildRoleCPedagogyContract(humanities)
    const engineeringPedagogy = buildRoleCPedagogyContract(engineering)
    expect(humanitiesPedagogy.locked_core).toEqual(engineeringPedagogy.locked_core)
    expect(humanitiesPedagogy.lesson.scaffold_strength).toBe(engineeringPedagogy.lesson.scaffold_strength)
    expect(humanitiesPedagogy.lesson.terminology_density).toBe(engineeringPedagogy.lesson.terminology_density)
    expect(buildRoleCExpressionContext(humanities).explanation_frame).toBe("narrative_semantic")
    expect(buildRoleCExpressionContext(engineering).explanation_frame).toBe("formal_structural")
  })

  test("explicit explanation preference overrides discipline mapping", () => {
    const context = buildRoleCExpressionContext(profile({
      learning_preferences: { explanation: "principle_first", practice: "mixed", pace: "steady", preferred_contexts: [] },
    }))
    expect(context.explanation_frame).toBe("formal_structural")
    expect(context.terminology_bridge).toBe("formal_with_plain_gloss")
  })

  test("normalizes common Chinese and English discipline labels", () => {
    expect(classifyDisciplineFamily(["liberal arts student"])).toBe("humanities_social_sciences")
    expect(classifyDisciplineFamily(["software engineering"])).toBe("science_engineering")
    expect(classifyDisciplineFamily(["business management"])).toBe("business_management")
  })

  test("privacy opt-out returns a neutral, empty expression context", () => {
    const context = buildRoleCExpressionContext(profile({
      privacy: { personalization_enabled: false, retention: "session_only", allow_profile_display: false },
    }))
    expect(context).toMatchObject({ enabled: false, discipline_family: "unspecified", task_contexts: [], declared_prior_anchors: [] })
  })

  test("snapshot and GenerationSpec carry only the safe derived context", () => {
    const learner = profile()
    const snapshot = adaptLearnerProfile(learner, buildRoleCProfileSnapshotOptions(learner))
    expect(snapshot.expression_context?.discipline_family).toBe("humanities_social_sciences")
    expect(JSON.stringify(snapshot)).not.toContain("这段原始背景绝不跨到 C")
    expect(JSON.stringify(snapshot)).not.toContain("user@example.com")
    expect(validateRoleCSchema("learner_profile_snapshot.schema.json", snapshot)).toEqual({ ok: true, issues: [] })

    const path = defineLearningPathNode({
      node_id: "NODE-K007",
      target_source_ids: ["K007"],
      prerequisite_source_ids: [],
      goal: "理解循环",
      objectives: [{ objective_id: "OBJ-K007", source_id: "K007", required_fact_ids: ["F001"], observable_behavior: "explain", importance: "core" }],
      assessment_blueprint: { tier_1_count: 1, tier_2_count: 0, tier_3_count: 0, required_modalities: ["short_answer"] },
    })
    const result = buildGenerationSpec({
      run_id: "RUN-EXPRESSION",
      profile_snapshot: snapshot,
      path_node: path,
      evidence_pack: {
        retrieval_id: "RAG-EXPRESSION",
        kb_version: "KB-1",
        rag_version: "RAG-1",
        match_status: "strong",
        results: [{ source_id: "K007", title: "循环", facts: [{ source_id: "K007", fact_id: "F001", content: "循环用于重复执行一组操作。" }] }],
        evidence_sufficiency: { ok: true, missing_misconception_ids: [], worked_example_count: 1 },
      } as any,
      versions: { prompt_version: "P-1", model_config_hash: "M-1" },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.spec.learner_adaptation.expression_context).toEqual(snapshot.expression_context)
    expect(result.spec.targets).toEqual(path.objectives)
    expect(validateRoleCSchema("generation_spec.schema.json", result.spec)).toEqual({ ok: true, issues: [] })
  })

  test("public audit blocks labels, stereotypes and direct identifiers", () => {
    const audit = evaluateExpressionAdaptation({
      text: "因为你是文科生，所以降低难度。联系 13800138000 获取帮助。",
    }, buildRoleCExpressionContext(profile()))
    expect(audit.issue_codes).toContain("EXPRESSION_PROFILE_LABEL_LEAK")
    expect(audit.issue_codes).toContain("EXPRESSION_ABILITY_STEREOTYPE")
    expect(audit.issue_codes).toContain("EXPRESSION_DIRECT_IDENTIFIER_LEAK")
  })

  test("shared learning-goal words cannot substitute for discipline-specific expression", () => {
    const context = buildRoleCExpressionContext(profile())
    const generic = evaluateExpressionAdaptation({
      text: "学习 Python 循环。这里先看定义，也就是重复执行操作。",
    }, context)
    const adapted = evaluateExpressionAdaptation({
      text: "学习 Python 循环。这里先看定义，也就是把文本条目按事件顺序逐项处理。",
    }, context)
    expect(adapted.score).toBeGreaterThan(generic.score)
  })

  test("every registered V2 field has an explicit consumer or private disposition", () => {
    expect(PROFILE_V2_CONSUMABLE_FIELDS.length).toBeGreaterThan(20)
    expect(unownedProfileV2Fields()).toEqual([])
  })
})
