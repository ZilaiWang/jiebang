import { describe, expect, test } from "bun:test"
import {
  buildConceptSectionPlansForSegment,
  materializeConceptSegmentV2,
  validateConceptSectionStructure,
} from "../src/role-c-content/planning/concept-section-plan"
import { normalizeConceptSegment } from "../src/role-c-content/providers/staged-generation"
import { ModelBackedRoleCContentProvider } from "../src/role-c-content/providers/model-backed-provider"
import { validateConceptLesson } from "../src/role-c-content/validators/concept-validator"
import type { ConceptTutorRequest } from "../src/role-c-content/agents/types"
import type { ModelGateway, StructuredModelRequest } from "../src/role-c-content/contracts/model-gateway"
import { ROLE_C_PROMPT_MANIFEST_VERSION } from "../src/role-c-content/prompts"

function segmentRequest(targets: Array<{ objective_id: string; source_id: string; fact_ids: string[]; behavior: string }>, facts: Array<{ source_id: string; fact_id: string; content: string }>): ConceptTutorRequest {
  return {
    generation_spec: {
      spec_id: "SPEC-1",
      run_id: "RUN-1",
      targets: targets.map((t) => ({
        objective_id: t.objective_id,
        source_id: t.source_id,
        required_fact_ids: t.fact_ids,
        observable_behavior: t.behavior,
        importance: "core",
      })),
      path_node: { goal: "x", target_source_ids: [...new Set(targets.map((t) => t.source_id))], prerequisite_source_ids: [] },
      learner_adaptation: { level: "basic" },
      difficulty: { domain_complexity: 1, cognitive_demand: 1, reasoning_steps: 1, code_complexity: 0, prerequisite_load: 0, scaffold_strength: 2 },
      policies: { seed: 1, max_semantic_revision: 1, max_tool_retry: 1 },
      evidence_ref: "ev-1",
    },
    evidence_pack: {
      retrieval_id: "ev-1",
      results: [...new Set(targets.map((t) => t.source_id))].map((sourceId) => ({
        source_id: sourceId,
        title: "x",
        facts: facts.filter((f) => f.source_id === sourceId),
      })),
    },
  } as unknown as ConceptTutorRequest
}

const payloadV2 = {
  title: "Python 变量",
  objectives: [{
    objective_id: "O1",
    sections: [],
    micro_check: { prompt: "哪项正确？", options: ["整数", "小数"], answer: "整数", explanation: "int 表示整数" },
    hints: ["看事实", "找关键词", "代入判断"],
  }],
}

describe("改进方案5 审查修复：Section Plan V2 真实链路", () => {
  test("buildConceptSectionPlansForSegment 为每个 objective 生成 section plan", () => {
    const request = segmentRequest(
      [{ objective_id: "O1", source_id: "K001", fact_ids: ["F001", "F002"], behavior: "apply" }],
      [
        { source_id: "K001", fact_id: "F001", content: "int 表示整数" },
        { source_id: "K001", fact_id: "F002", content: "float 表示小数" },
      ],
    )
    const plans = buildConceptSectionPlansForSegment(request)
    expect(plans).toHaveLength(1)
    expect(plans[0]!.slots.length).toBeGreaterThanOrEqual(5)
  })

  test("materializeConceptSegmentV2 物化出多个 RenderBlock（每个 section 独立）", () => {
    const request = segmentRequest(
      [{ objective_id: "O1", source_id: "K001", fact_ids: ["F001"], behavior: "recognize" }],
      [{ source_id: "K001", fact_id: "F001", content: "int 表示整数" }],
    )
    const plans = buildConceptSectionPlansForSegment(request)
    const authored = {
      title: "Python 变量",
      objectives: [{
        objective_id: "O1",
        sections: plans[0]!.slots.map((slot) => ({
          slot_id: slot.slot_id,
          heading: slot.kind,
          body: `${slot.kind} 的教学内容`,
          steps: [],
          code: null,
        })),
        micro_check: { prompt: "哪项正确？", options: ["整数", "小数"], answer: "整数", explanation: "int 表示整数" },
        hints: ["看事实", "找关键词", "代入判断"],
      }],
    }
    const lesson = materializeConceptSegmentV2(request, authored as never, plans)
    expect(lesson.explanation_blocks.length).toBeGreaterThanOrEqual(2)
    expect(lesson.explanation_blocks[0]).toEqual(expect.objectContaining({
      block_type: "heading",
      text: "x（O1）",
    }))
    expect(lesson.worked_examples.length).toBeGreaterThanOrEqual(1)
    expect(lesson.misconceptions.length).toBe(1)
    expect(lesson.micro_checks.length).toBe(1)
    expect(lesson.hint_ladders.length).toBe(1)
    expect(lesson.summary.length).toBeGreaterThanOrEqual(1)
    expect(lesson.objective_coverage).toHaveLength(1)

    const normalized = normalizeConceptSegment(request, lesson)
    const validation = validateConceptLesson({
      payload: normalized,
      spec: request.generation_spec,
      evidence: request.evidence_pack,
    })
    expect(validation.issues).toEqual([])
    expect(validation.ok).toBe(true)
  })

  test("required slot 缺失时抛错", () => {
    const request = segmentRequest(
      [{ objective_id: "O1", source_id: "K001", fact_ids: ["F001"], behavior: "recognize" }],
      [{ source_id: "K001", fact_id: "F001", content: "int 表示整数" }],
    )
    const plans = buildConceptSectionPlansForSegment(request)
    const authored = {
      title: "x",
      objectives: [{ objective_id: "O1", sections: [], micro_check: { prompt: "p", options: ["a", "b"], answer: "a", explanation: "e" }, hints: ["1", "2", "3"] }],
    }
    expect(() => materializeConceptSegmentV2(request, authored as never, plans)).toThrow("CONCEPT_REQUIRED_SLOT_MISSING")
  })

  test("validateConceptSectionStructure 拒绝计划外 section", () => {
    const request = segmentRequest(
      [{ objective_id: "O1", source_id: "K001", fact_ids: ["F001"], behavior: "recognize" }],
      [{ source_id: "K001", fact_id: "F001", content: "int 表示整数" }],
    )
    const plans = buildConceptSectionPlansForSegment(request)
    const issues = validateConceptSectionStructure({
      plan: plans[0]!,
      authored: { sections: [{ slot_id: "NOT-IN-PLAN", heading: "x", body: "y", steps: [], code: null }] },
    })
    expect(issues.some((issue) => issue.includes("计划外"))).toBe(true)
  })

  test("staged provider 在生产入口消费 V2 section contract 并生成可发布讲义", async () => {
    const request = segmentRequest(
      [{ objective_id: "O1", source_id: "K001", fact_ids: ["F001"], behavior: "recognize" }],
      [{ source_id: "K001", fact_id: "F001", content: "int 表示整数" }],
    )
    request.generation_spec.versions = {
      profile_version: "PROFILE-TEST",
      prompt_version: ROLE_C_PROMPT_MANIFEST_VERSION,
      model_config_hash: "MODEL-CONCEPT-V2-TEST",
      kb_version: "KB-TEST",
      rag_version: "RAG-TEST",
      schema_version: "1.0",
    }

    let captured: StructuredModelRequest | undefined
    const gateway: ModelGateway = {
      model_id: "concept-v2-test",
      model_config_hash: "MODEL-CONCEPT-V2-TEST",
      async generateStructured<T>(stage: StructuredModelRequest): Promise<T> {
        captured = stage
        const contract = (stage.input as {
          staged_contract: { section_plan: Array<{ objective_id: string; slots: Array<{ slot_id: string; kind: string }> }> }
        }).staged_contract.section_plan
        return {
          title: "Python 基本类型",
          objectives: contract.map((objective) => ({
            objective_id: objective.objective_id,
            sections: objective.slots.map((slot) => ({
              slot_id: slot.slot_id,
              heading: slot.kind,
              body: slot.kind === "misconception"
                ? "错误理解是 int 不表示整数；这与当前事实冲突。正确理解是 int 表示整数，可回看关键词自查。"
                : `${slot.kind}：int 表示整数。`,
              steps: [],
              code: null,
            })),
            micro_check: {
              prompt: "哪一项符合当前事实？",
              options: ["int 表示整数", "int 不表示整数"],
              answer: "int 表示整数",
              explanation: "当前事实明确说明 int 表示整数。",
            },
            hints: ["定位 int 对应的事实。", "关注‘表示’后面的对象。", "把 int 与整数对应起来。"],
          })),
        } as T
      },
    }

    const diagnostics: Array<{ issue_codes: string[]; issue_count: number }> = []
    const provider = new ModelBackedRoleCContentProvider(gateway, {
      generation_strategy: "staged",
      max_repair_attempts: 0,
      stage_failure_diagnostic_sink: (diagnostic) => {
        diagnostics.push(diagnostic)
      },
    })
    const result = await provider.generateConceptLesson(request).catch((error: unknown) => {
      throw new Error(`${error instanceof Error ? error.message : String(error)}:${JSON.stringify(diagnostics)}`)
    })
    expect(captured?.task).toBe("role-c.concept-tutor.segment-v2")
    expect((captured?.input as { staged_contract?: unknown }).staged_contract).toBeDefined()
    expect(result.payload.worked_examples.length).toBeGreaterThan(0)
    expect(result.payload.used_evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ source_id: "K001", fact_id: "F001" }),
    ]))
    const validation = validateConceptLesson({
      payload: result.payload,
      spec: request.generation_spec,
      evidence: request.evidence_pack,
    })
    expect(validation.issues).toEqual([])
    expect(validation.ok).toBe(true)
  })
})
