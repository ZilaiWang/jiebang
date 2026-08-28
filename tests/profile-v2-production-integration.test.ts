import { describe, expect, test } from "bun:test"
import {
  buildRoleCProfileSnapshotOptions,
  createLearnerProfileV2,
  type LearnerProfileIntakeV2,
} from "../src/role-b-profile"
import { adaptLearnerProfile, defineLearningPathNode } from "../src/role-c-content/contracts/profile-adapter"
import { buildGenerationSpec } from "../src/role-c-content/contracts/generation-spec"
import type { RagEvidencePack } from "../src/role-c-content/contracts/evidence-pack"
import { buildConceptSectionPlansForSegment } from "../src/role-c-content/planning/concept-section-plan"
import type { ConceptTutorRequest } from "../src/role-c-content/agents/types"
import { validateOrchestratorApiBody } from "../src/orchestration/orchestrator-api-schema"
import { InteractiveSessionStore } from "../src/orchestration/interactive-session"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"

function intake(): LearnerProfileIntakeV2 {
  return {
    learner_id: "learner-v2",
    goal: "用 Python 完成竞赛中的循环题",
    background_summary: "学过变量与数据类型的本科生",
    prior_languages: ["Python"],
    self_rating: "basic",
    goal_use_case: "competition",
    desired_outcome: "独立完成并调试循环程序",
    weekly_time_budget_minutes: 240,
    session_time_budget_minutes: 40,
    explanation_preference: "step_by_step",
    practice_preference: "coding",
    pace_preference: "steady",
    preferred_contexts: ["算法竞赛"],
    privacy: { personalization_enabled: true, retention: "cross_session", allow_profile_display: true },
  }
}

function evidencePack(): RagEvidencePack {
  return {
    schema_version: "1.0",
    retrieval_id: "RAG-V2",
    query: "for 循环",
    learner_level: "basic",
    top_k: 1,
    match_status: "strong",
    kb_version: "kb-test",
    rag_version: "rag-test",
    results: [{
      source_id: "K007",
      title: "for 循环",
      difficulty: "beginner",
      rank_score: 1,
      match_reason: "identity",
      snippet: "for 循环用于遍历序列",
      facts: [
        { source_id: "K007", fact_id: "F001", content: "for 循环用于遍历序列。", capabilities: ["rule", "procedure"] },
        { source_id: "K007", fact_id: "F002", content: "循环变量会依次取得序列中的元素。", capabilities: ["procedure", "state_transition", "example"] },
      ],
      examples: [{
        title: "遍历列表",
        code: "for value in [1, 2]:\n    print(value)",
        explanation: "循环变量依次取得列表元素并输出。",
        fact_refs: [{ source_id: "K007", fact_id: "F001" }, { source_id: "K007", fact_id: "F002" }],
      }],
      practice_tasks: ["编写程序遍历列表并输出每个元素。"],
      quiz_seeds: [],
      source_file: "test",
      retrieval_trace: {
        matched_keywords: ["for"], matched_fields: ["title"], difficulty_match: true,
        score_breakdown: { keyword: 1, title: 1, facts: 1, practice_tasks: 1, difficulty: 1, bonus: 0 },
      },
    }],
  }
}

function buildV2Spec() {
  const profile = createLearnerProfileV2({
    core_profile: {
      learner_id: "learner-v2",
      level: "basic",
      known_concepts: ["变量", "数据类型"],
      weak_concepts: ["for 循环"],
      goal: "用 Python 完成竞赛中的循环题",
    },
    intake: intake(),
    profile_version: "PROFILE-V2-R1",
    observed_at: "2026-08-29T00:00:00.000Z",
  })
  const snapshot = adaptLearnerProfile(profile, buildRoleCProfileSnapshotOptions(profile))
  const result = buildGenerationSpec({
    run_id: "RUN-V2",
    profile_snapshot: snapshot,
    path_node: defineLearningPathNode({
      node_id: "NODE-K007",
      target_source_ids: ["K007"],
      prerequisite_source_ids: [],
      goal: profile.goal,
      objectives: [{
        objective_id: "OBJ-K007",
        source_id: "K007",
        required_fact_ids: ["F001", "F002"],
        observable_behavior: "apply",
        importance: "core",
      }],
      assessment_blueprint: {
        tier_1_count: 1,
        tier_2_count: 1,
        tier_3_count: 1,
        required_modalities: ["mcq", "trace", "code"],
      },
    }),
    evidence_pack: evidencePack(),
    versions: { prompt_version: "test", model_config_hash: "model-test" },
  })
  if (!result.ok) throw new Error(result.errors.join(";"))
  return { profile, snapshot, spec: result.spec }
}

describe("profile v2 production integration", () => {
  test("binds the B-owned pedagogy contract into the immutable C generation spec", () => {
    const { profile, snapshot, spec } = buildV2Spec()
    expect(snapshot.pedagogy_contract?.source_profile).toEqual({
      profile_id: profile.profile_id,
      profile_version: profile.profile_version,
      revision: 1,
    })
    expect(spec.learner_adaptation.pedagogy_contract?.locked_core).toMatchObject({
      preserve_facts: true,
      preserve_objectives: true,
      preserve_answers: true,
      preserve_scoring: true,
    })
    expect(spec.learner_adaptation.pedagogy_contract?.practice.shape).toBe("guided_coding")
    expect(spec.learner_adaptation.preferred_contexts).toContain("算法竞赛")
    expect(spec.profile_ref.profile_version).toBe("PROFILE-V2-R1")
  })

  test("turns the pedagogy contract into a complete, evidence-bound section plan before model generation", () => {
    const { spec } = buildV2Spec()
    const plans = buildConceptSectionPlansForSegment({
      generation_spec: spec,
      evidence_pack: evidencePack(),
    } as ConceptTutorRequest)
    const plan = plans[0]!
    const contract = spec.learner_adaptation.pedagogy_contract!
    expect(plan.teaching_unit_contract?.objective_id).toBe("OBJ-K007")
    expect(plan.slots.filter((slot) => slot.kind === "procedure_steps" || slot.kind === "guided_example").length)
      .toBeGreaterThanOrEqual(contract.lesson.worked_example_count)
    expect(plan.slots.some((slot) => slot.kind === "misconception")).toBe(true)
    expect(plan.micro_check.mode).toBe("guided_application")
  })

  test("validates structured D-to-main-agent intake identity and enums", () => {
    const valid = validateOrchestratorApiBody("session", {
      mode: "deterministic",
      learner_request: {
        learner_id: "learner-v2",
        goal: intake().goal,
        profile_intake: intake(),
      },
    })
    expect(valid.ok).toBe(true)

    const invalid = validateOrchestratorApiBody("session", {
      mode: "deterministic",
      learner_request: {
        learner_id: "other",
        goal: intake().goal,
        profile_intake: { ...intake(), practice_preference: "guess" },
      },
    })
    expect(invalid.ok).toBe(false)
    if (!invalid.ok) {
      expect(invalid.errors).toContain("profile_intake.learner_id must match learner_request.learner_id")
      expect(invalid.errors.some((error) => error.startsWith("profile_intake.practice_preference"))).toBe(true)
    }
  })

  test("pauses an incomplete v2 intake for bounded structured clarification before diagnosis", async () => {
    const root = await mkdtemp(join(tmpdir(), "profile-v2-clarification-"))
    const goal = "用 Python 完成竞赛中的循环题"
    try {
      const store = new InteractiveSessionStore(root, {
        diagnostic_question_author: { author: async () => [] },
      })
      const record = await store.create({
        session_id: "SESSION-V2-CLARIFY",
        run_id: "RUN-V2-CLARIFY",
        owner_id: "learner-v2",
        mode: "deterministic",
        learner_request: {
          learner_id: "learner-v2",
          goal,
          profile_intake: { learner_id: "learner-v2", goal },
        },
      })

      expect(record.status).toBe("waiting_for_user")
      expect(record.waiting_for?.type).toBe("profile_answers")
      expect(record.waiting_for?.items.length).toBeGreaterThan(0)
      expect(record.waiting_for?.items.length).toBeLessThanOrEqual(3)
      expect(record.private.diagnosis_items).toHaveLength(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
