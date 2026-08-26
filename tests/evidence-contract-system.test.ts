import { describe, expect, test } from "bun:test"
import Ajv2020 from "ajv/dist/2020"
import { loadKnowledgeBase } from "../src/knowledge/loader"
import { factKey, isValidFactId, isValidSourceId } from "../src/knowledge/identifiers"
import { retrieveStructuredEvidenceFromKnowledgeBase } from "../src/rag/structured-evidence"
import type { RagResult } from "../src/rag/retriever"
import type { ConceptTutorRequest } from "../src/role-c-content/agents/types"
import { adaptRagResult } from "../src/role-c-content/contracts/evidence-pack"
import { bindObjectiveEvidence } from "../src/role-c-content/planning/objective-evidence-bundle"
import {
  buildConceptSectionPlansForSegment,
  materializeConceptSegmentV2,
} from "../src/role-c-content/planning/concept-section-plan"
import { materializeRecallFactSecureAuthorPayload } from "../src/role-c-content/providers/staged-generation"

describe("统一证据身份与能力合同", () => {
  test("61 个知识点都能通过 A→C canonical evidence schema", async () => {
    const knowledgeBase = await loadKnowledgeBase()
    const structured = retrieveStructuredEvidenceFromKnowledgeBase({
      source_ids: knowledgeBase.items.map((item) => item.sourceId),
    }, knowledgeBase)
    const ragResult: RagResult = {
      query: "按已规划知识点读取完整事实",
      learnerLevel: "integrated",
      topK: structured.results.length,
      results: structured.results,
    }
    const pack = adaptRagResult(ragResult, {
      kb_version: knowledgeBase.version,
      rag_version: "identity-hydration-v1",
    })
    const schema = await Bun.file("schemas/role-c-content/rag_evidence_pack.schema.json").json()
    const validate = new Ajv2020({ strict: false }).compile(schema)

    expect(structured.missing_source_ids).toEqual([])
    expect(structured.missing_fact_refs).toEqual([])
    expect(pack.results).toHaveLength(knowledgeBase.items.length)
    expect(validate(pack)).toBe(true)
    expect(validate.errors ?? []).toEqual([])
    expect(pack.results.every((source) => source.facts.every((fact) =>
      isValidSourceId(fact.source_id)
      && isValidFactId(fact.fact_id)
      && (fact.capabilities?.length ?? 0) > 0))).toBe(true)
  })

  test("知识库中全部派生目标都有真实、source-local 的最小充分事实束", async () => {
    const knowledgeBase = await loadKnowledgeBase()
    for (const item of knowledgeBase.items) {
      const factIds = new Set(item.facts.map((fact) => fact.factId))
      for (const objective of item.observableObjectives ?? []) {
        expect(objective.factIds.length).toBeGreaterThan(0)
        expect(objective.factIds.length).toBeLessThanOrEqual(3)
        expect(objective.factIds.every((factId) => factIds.has(factId))).toBe(true)
        const bound = bindObjectiveEvidence({
          source_id: item.sourceId,
          observable_behavior: objective.behavior,
          required_fact_ids: objective.factIds,
        }, [{ source_id: item.sourceId, facts: item.facts }])
        expect(bound.sufficient).toBe(true)
        expect(bound.required_fact_ids).toEqual(objective.factIds)
      }
    }
  })

  test("fact identity 使用 source_id + fact_id，不会混淆不同知识点的 F001", () => {
    expect(factKey({ source_id: "K001", fact_id: "F001" })).toBe("K001:F001")
    expect(factKey({ source_id: "K003", fact_id: "F001" })).toBe("K003:F001")
    expect(new Set([
      factKey({ source_id: "K001", fact_id: "F001" }),
      factKey({ source_id: "K003", fact_id: "F001" }),
    ]).size).toBe(2)
  })

  test("高阶创建目标不会被一条只列举知识名称的概述事实伪装成证据充分", async () => {
    const knowledgeBase = await loadKnowledgeBase()
    const project = knowledgeBase.items.find((item) => item.sourceId === "K018")!
    const bundle = bindObjectiveEvidence({
      source_id: "K018",
      observable_behavior: "create",
      required_fact_ids: ["F001"],
    }, [{ source_id: "K018", facts: project.facts }])

    expect(bundle.sufficient).toBe(true)
    expect(bundle.required_fact_ids).toEqual(["F002", "F007", "F001"])
    expect(bundle.required_fact_ids).not.toEqual(["F001"])
    expect(bundle.capabilities).toEqual(expect.arrayContaining(["procedure", "io_contract"]))
  })

  test("测评误区只能由同一 source 的事实直接反命题派生", async () => {
    const knowledgeBase = await loadKnowledgeBase()
    const list = knowledgeBase.items.find((item) => item.sourceId === "K009")!
    const factById = new Map(list.facts.map((fact) => [fact.factId, fact.content]))
    const beliefs = (list.misconceptions ?? []).map((entry) => entry.incorrectBelief)

    expect(beliefs).toContain("列表不可用于保存多个有序元素。")
    expect(beliefs.some((belief) => /\bsplit\b|\bimport\b|\breturn\b/u.test(belief))).toBe(false)
    for (const misconception of list.misconceptions ?? []) {
      expect(misconception.factRefs).toHaveLength(1)
      const [ref] = misconception.factRefs
      expect(ref?.sourceId).toBe(list.sourceId)
      expect(factById.has(ref?.factId ?? "")).toBe(true)
      expect(misconception.counterexample).toContain(factById.get(ref!.factId)!)
    }
  })

  test("按 fact 身份取证只返回与最小事实束绑定的教学元数据", async () => {
    const knowledgeBase = await loadKnowledgeBase()
    const structured = retrieveStructuredEvidenceFromKnowledgeBase({
      source_ids: ["K009"],
      fact_ids_by_source: { K009: ["F001"] },
    }, knowledgeBase)
    const [result] = structured.results

    expect(result?.facts.map((fact) => fact.factId)).toEqual(["F001"])
    expect(result?.examples).toEqual([{
      title: "列表 · F001 事实示例",
      code: "# 列表可用于保存多个有序元素。",
      explanation: "列表可用于保存多个有序元素。",
    }])
    expect(result?.practiceTasks).toEqual([
      "依据已审核事实“列表可用于保存多个有序元素。”完成一次识别、解释或应用，并说明判断依据。",
    ])
    expect(result?.misconceptions?.length ?? 0).toBeGreaterThan(0)
    expect(result?.misconceptions?.every((entry) => entry.factRefs.every((ref) =>
      ref.sourceId === "K009" && ref.factId === "F001"))).toBe(true)
    expect(result?.workedExamples?.every((entry) => entry.steps.every((step) =>
      step.factIds.every((factId) => factId === "F001")))).toBe(true)
  })

  test("recall_fact 的私有执行真值由事实合同确定性物化", () => {
    const secure = materializeRecallFactSecureAuthorPayload({
      generation_spec: {
        targets: [{
          objective_id: "OBJ-K007",
          source_id: "K007",
          required_fact_ids: ["F001"],
          is_primary: true,
        }],
      },
      evidence_pack: {
        results: [{
          source_id: "K007",
          facts: [{ source_id: "K007", fact_id: "F001", content: "for 循环常用于遍历序列中的元素。" }],
        }],
      },
    } as never, {
      hidden_tests: [{ test_id: "HT-1", objective_id: "OBJ-K007", case_kind: "normal", weight: 1 }],
      mutation_variants: [{
        mutation_id: "MUT-1",
        objective_ids: ["OBJ-K007"],
        must_fail_test_ids: ["HT-1"],
        misconception_id: "MIS-K007-F001",
      }],
    })

    expect(secure.reference_solution).toBe('fact_text = "for 循环常用于遍历序列中的元素。"\nprint(fact_text)')
    expect(secure.hidden_tests).toEqual([{
      input: "",
      expected: "for 循环常用于遍历序列中的元素。\n",
      comparison: { kind: "exact" },
      misconception_tag: "MIS-K007-F001",
    }])
    expect(secure.reference_solution).not.toContain("\nfor ")
    expect(secure.reference_solution).not.toMatch(/\b(?:while|input)\s*\(/u)
    expect(secure.mutation_variants[0]?.code).not.toBe(secure.reference_solution)
  })

  test("讲义 V2 在两个 source 都使用 F001 时仍生成正确 claim 和块级引用", () => {
    const request = twoSourceConceptRequest()
    const plans = buildConceptSectionPlansForSegment(request)
    const authored = {
      title: "两个知识点",
      objectives: plans.map((plan) => ({
        objective_id: plan.objective_id,
        sections: plan.slots.map((slot) => ({
          slot_id: slot.slot_id,
          heading: slot.kind,
          body: "第一句解释当前事实。第二句帮助理解当前事实。",
          steps: [],
          code: null,
        })),
        micro_check: {
          prompt: "哪项与本节事实一致？",
          options: ["正确表述", "错误表述"],
          answer: "正确表述",
          explanation: "正确表述与本节事实一致。",
        },
        hints: ["回看本节", "关注核心对象", "逐项比较"],
      })),
    }
    const lesson = materializeConceptSegmentV2(request, authored as never, plans)
    const claims = [...lesson.explanation_blocks, ...lesson.worked_examples, ...lesson.summary]
      .flatMap((block) => "claims" in block ? block.claims : [])
    const k001 = claims.find((claim) => claim.citations.some((citation) =>
      factKey(citation) === "K001:F001"))
    const k003 = claims.find((claim) => claim.citations.some((citation) =>
      factKey(citation) === "K003:F001"))

    expect(k001?.text).toBe("Python 是一种通用编程语言。")
    expect(k003?.text).toBe("int 表示整数，float 表示小数。")
    expect(k001?.citations).toEqual([{ source_id: "K001", fact_id: "F001", relation: "supports" }])
    expect(k003?.citations).toEqual([{ source_id: "K003", fact_id: "F001", relation: "supports" }])
  })
})

function twoSourceConceptRequest(): ConceptTutorRequest {
  const targets = [
    { objective_id: "O-K001", source_id: "K001", fact_id: "F001" },
    { objective_id: "O-K003", source_id: "K003", fact_id: "F001" },
  ]
  return {
    generation_spec: {
      spec_id: "SPEC-EVIDENCE-IDENTITY",
      run_id: "RUN-EVIDENCE-IDENTITY",
      targets: targets.map((target) => ({
        objective_id: target.objective_id,
        source_id: target.source_id,
        required_fact_ids: [target.fact_id],
        observable_behavior: "recognize",
        importance: "core",
      })),
      path_node: {
        goal: "理解 Python 与数据类型",
        target_source_ids: targets.map((target) => target.source_id),
        prerequisite_source_ids: [],
      },
      learner_adaptation: { level: "basic" },
      difficulty: {
        domain_complexity: 1,
        cognitive_demand: 1,
        reasoning_steps: 1,
        code_complexity: 0,
        prerequisite_load: 0,
        scaffold_strength: 2,
      },
      policies: { seed: 1, max_semantic_revision: 1, max_tool_retry: 1 },
      evidence_ref: "RAG-EVIDENCE-IDENTITY",
    },
    evidence_pack: {
      retrieval_id: "RAG-EVIDENCE-IDENTITY",
      results: [
        {
          source_id: "K001",
          title: "Python 是什么",
          facts: [{ source_id: "K001", fact_id: "F001", content: "Python 是一种通用编程语言。" }],
        },
        {
          source_id: "K003",
          title: "基本数据类型",
          facts: [{ source_id: "K003", fact_id: "F001", content: "int 表示整数，float 表示小数。" }],
        },
      ],
    },
  } as unknown as ConceptTutorRequest
}
