import { describe, expect, test } from "bun:test"
import { buildAssessmentAuthorModelInput } from "../src/role-c-content/context/assessment-context"
import { buildCodeLabModelInput } from "../src/role-c-content/context/code-lab-context"
import { buildConceptTutorModelInput } from "../src/role-c-content/context/concept-context"
import { buildLearningDesignSpecV2 } from "../src/role-c-content/planning/learning-design-spec-v2"

const spec = {
  spec_id: "SPEC-CITABLE",
  run_id: "RUN-CITABLE",
  path_node: {
    node_id: "NODE-K003",
    goal: "基本数据类型",
    target_source_ids: ["K003"],
    prerequisite_source_ids: [],
    objectives: [{
      objective_id: "OBJ-K003",
      source_id: "K003",
      required_fact_ids: ["F001"],
      observable_behavior: "recognize",
      importance: "core",
    }],
    assessment_blueprint: { tier_1_count: 1, tier_2_count: 0, tier_3_count: 0, required_modalities: ["mcq"] },
  },
  targets: [{
    objective_id: "OBJ-K003",
    source_id: "K003",
    required_fact_ids: ["F001"],
    observable_behavior: "recognize",
    importance: "core",
  }],
  learner_adaptation: { scaffold_level: 1, reading_density: "medium" },
  difficulty: { domain_complexity: 1, cognitive_demand: 1, reasoning_steps: 1, code_complexity: 1, prerequisite_load: 1, scaffold_strength: 1 },
  assessment_blueprint: { tier_1_count: 1, tier_2_count: 0, tier_3_count: 0, required_modalities: ["mcq"] },
  policies: { seed: 3, max_semantic_revision: 2, max_tool_retry: 1 },
}
const evidencePack = {
  retrieval_id: "RAG-CITABLE",
  results: [{
    source_id: "K003",
    title: "基本数据类型",
    difficulty: "beginner",
    facts: [
      { source_id: "K003", fact_id: "F001", content: "int 表示整数，float 表示小数。" },
      { source_id: "K003", fact_id: "F002", content: "本轮未冻结的附加事实。" },
    ],
    examples: [{ title: "未绑定示例", code: "type(7)", explanation: "type 可查看类型" }],
    practice_tasks: ["使用 type 判断类型"],
  }],
}
const conceptArtifact = {
  artifact_id: "ART-CONCEPT",
  payload: {
    objective_ids: ["OBJ-K003"],
    explanation_blocks: [],
    worked_examples: [],
    summary: [],
    misconceptions: [],
    objective_coverage: [],
  },
}

describe("Role C citable authoring context", () => {
  test("learning design only carries misconceptions with their full frozen evidence", () => {
    const evidence = structuredClone(evidencePack) as any
    const misconception = (id: string, facts: string[]) => ({ misconceptionId: id, diagnosticSignals: [id], factRefs: facts.map(factId => ({ sourceId: "K003", factId })) })
    evidence.results[0].misconceptions = [misconception("complete", ["F001"]), misconception("partial", ["F001", "F002"]), misconception("unbound", [])]
    const design = buildLearningDesignSpecV2({ spec: spec as any, evidence, assessment_plan: [] })
    expect(design.learner.misconceptions.map(x => x.misconception_id)).toEqual(["complete"])
  })
  test("keeps declared citation closure and never guesses references from matching words", () => {
    const evidence = structuredClone(evidencePack) as any
    const ref = (fact_id: string) => ({ source_id: "K003", fact_id })
    evidence.results[0].examples = [
      { title: "int 示例", code: "x=1", explanation: "int 表示整数", fact_refs: [ref("F001")] },
      { title: "int 示例", code: "type(1)", explanation: "int 表示整数", fact_refs: [ref("F001"), ref("F002")] },
      { title: "int 示例", code: "type(1)", explanation: "int 表示整数", fact_refs: [] },
    ]
    evidence.results[0].practice_tasks = ["int 表示整数，用 type() 检查它"]
    const input = buildConceptTutorModelInput({ generation_spec: spec, evidence_pack: evidence } as never)
    expect(input.evidence[0]!.examples).toHaveLength(1)
    expect(input.evidence[0]!.examples[0]!.fact_refs).toEqual([ref("F001")])
    expect(JSON.stringify(input)).not.toContain("type(")
  })
  test("does not expose unaddressable RAG examples or practice text as publishable evidence", () => {
    const concept = buildConceptTutorModelInput({ generation_spec: spec, evidence_pack: evidencePack } as never)
    const lab = buildCodeLabModelInput({ generation_spec: spec, evidence_pack: evidencePack, concept_artifact: conceptArtifact } as never)
    const assessment = buildAssessmentAuthorModelInput({ generation_spec: spec, evidence_pack: evidencePack, concept_artifact: conceptArtifact } as never)

    for (const input of [concept, lab, assessment]) {
      const evidence = input.evidence[0] as {
        facts: Array<{ fact_id: string }>
        examples?: unknown[]
        practice_tasks?: unknown[]
      }
      expect(evidence.facts.map((fact) => fact.fact_id)).toEqual(["F001"])
      // 不可寻址（未绑定 required fact）的 example / practice 不得进入可信生成：
      // concept 现在总是携带这两个字段，但绑定不上 required fact 时为空数组；
      // lab / assessment 暂不投影，字段不存在。
      if (evidence.examples !== undefined) expect(evidence.examples).toEqual([])
      if (evidence.practice_tasks !== undefined) expect(evidence.practice_tasks).toEqual([])
    }
  })

  test("places external review instructions at the common upstream contract path", () => {
    const revisionObjections = [{
      objection_id: "OBJ-REV-1",
      from_agent: "cross-artifact-gate" as const,
      review_instruction_id: "REV-1",
      review_source: "fact_audit" as const,
      review_code: "semantic_unsupported",
      review_message: "删除无证据支持的索引起始规则",
      target_agent: "tiered-evaluator" as const,
      target_artifact_id: "ART-ASSESSMENT",
      objective_id: "OBJ-K003",
      issue_type: "unsupported_claim" as const,
      locator: { field: "items[0].prompt", ref_id: "ITEM-1" },
      fix_scope: "artifact" as const,
      severity: "critical" as const,
      evidence: [],
      proposed_action: "仅依据 F001 重写题面",
    }]
    const request = {
      generation_spec: spec,
      evidence_pack: evidencePack,
      concept_artifact: conceptArtifact,
      revision_objections: revisionObjections,
      external_revision_round: 2,
    }
    const concept = buildConceptTutorModelInput(request as never)
    const lab = buildCodeLabModelInput(request as never)
    const assessment = buildAssessmentAuthorModelInput(request as never)

    for (const input of [concept, lab, assessment]) {
      expect(input.upstream.revision_objections).toEqual(revisionObjections)
      expect(input.upstream.external_revision_round).toBe(2)
      expect(input).not.toHaveProperty("revision_objections")
      expect(input).not.toHaveProperty("external_revision_round")
    }
  })
})
