import { describe, expect, test } from "bun:test"
import type { ModelGateway, StructuredModelRequest } from "../src/role-c-content/contracts/model-gateway"
import type { AssessmentPublicArtifact } from "../src/role-c-content/contracts/artifacts"
import { extractAssessmentBlocks, extractCodeLabBlocks, extractConceptBlocks } from "../src/role-c-content/review/extract-review-blocks"
import {
  ModelContentSemanticAuditPort,
  ROLE_C_SEMANTIC_AUDIT_SYSTEM_PROMPT,
} from "../src/role-c-content/review/model-semantic-audit-port"
import { ROLE_C_COMMON_SYSTEM_POLICY, ROLE_C_SCENARIO_EVIDENCE_POLICY } from "../src/role-c-content/prompts/common-policy"
import { CONCEPT_SEGMENT_SYSTEM_PROMPT_V2 } from "../src/role-c-content/prompts/concept-tutor/staged.prompt"

class AuditGateway implements ModelGateway {
  readonly model_id = "semantic-audit-test-model"
  readonly model_config_hash = "MODEL-semantic-audit-test"
  readonly requests: any[] = []

  constructor(private readonly output: unknown) {}

  async generateStructured<T>(request: any): Promise<T> {
    this.requests.push(request)
    return structuredClone(this.output) as T
  }
}

function auditInput() {
  return {
    run_id: "RUN-SEMANTIC-1",
    artifact_kind: "assessment" as const,
    artifact_id: "ASSESSMENT-1",
    evidence_hash: "sha256:evidence",
    blocks: [{
      review_block_id: "assessment:assessment_item:ITEM-1",
      text: "for 循环会随机遍历列表吗？",
      citations: [{ source_id: "K007", fact_id: "F001", relation: "supports" as const }],
      fact_audit_mode: "citation_only" as const,
      locator: { field: "assessment_item" as const, ref_id: "ITEM-1", objective_id: "OBJ-K007" },
      cited_facts: [{
        source_id: "K007",
        fact_id: "F001",
        content: "for 循环常用于按顺序遍历序列中的元素。",
      }],
    }],
  }
}

describe("Role C model semantic fact audit", () => {
  test("即时检查把指定答案和反馈解释一同交给语义审核", () => {
    const blocks = extractConceptBlocks({ payload: {
      objective_coverage: [], prerequisite_bridge: [], explanation_blocks: [], summary: [],
      worked_examples: [], misconceptions: [], hint_ladders: [],
      micro_checks: [{
        block_id: "CHECK", item_id: "ITEM", prompt: "哪项正确？",
        options: [
          { option_id: "A", label: "A", text: "程序通常由解释器执行" },
          { option_id: "B", label: "B", text: "程序不由解释器执行" },
        ],
        answer_option_id: "B", answer_explanation: "程序由编译器直接转换为硬件指令。",
        citations: [{ source_id: "K001", fact_id: "F002", relation: "supports" }],
      }],
    } } as any)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.surface_kind).toBe("choice_assessment")
    expect(blocks[0]!.text).toContain("即时反馈指定答案：B：程序不由解释器执行")
    expect(blocks[0]!.text).toContain("即时反馈解释：程序由编译器直接转换为硬件指令。")
    expect(ROLE_C_SEMANTIC_AUDIT_SYSTEM_PROMPT).toContain("指定答案就是该唯一正确项")
  })
  test("作者与审核共享虚构情境边界，段落允许显式引用同目标的支持事实", () => {
    expect(ROLE_C_COMMON_SYSTEM_POLICY).toContain(ROLE_C_SCENARIO_EVIDENCE_POLICY)
    expect(ROLE_C_SEMANTIC_AUDIT_SYSTEM_PROMPT).toContain(ROLE_C_SCENARIO_EVIDENCE_POLICY)
    expect(ROLE_C_SCENARIO_EVIDENCE_POLICY).toContain("虚构标签不能豁免这些专业规则")
    expect(CONCEPT_SEGMENT_SYSTEM_PROMPT_V2).toContain("slot.fact_ids 与 used_fact_ids 的并集")
    expect(CONCEPT_SEGMENT_SYSTEM_PROMPT_V2).not.toContain("也不得提前借用或挪到当前 slot")
  })
  test("reviews a choice question and its distractors as one semantic unit", () => {
    const blocks = extractAssessmentBlocks({
      payload: {
        items: [{
          item_id: "ITEM-1",
          objective_id: "OBJ-K002",
          prompt: "x = 5 表示什么？",
          options: [
            { option_id: "OPTION-A", label: "A", text: "把 5 赋给 x" },
            { option_id: "OPTION-B", label: "B", text: "x 和 5 是同一个变量" },
          ],
          citations: [{ source_id: "K002", fact_id: "F001", relation: "supports" }],
        }],
      },
    } as AssessmentPublicArtifact)

    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.locator.field).toBe("assessment_item")
    expect(blocks[0]?.text).toContain("A：把 5 赋给 x")
    expect(blocks[0]?.text).toContain("B：x 和 5 是同一个变量")
  })

  test("requires every atomic factual proposition to be supported by current citations", () => {
    expect(ROLE_C_SEMANTIC_AUDIT_SYSTEM_PROMPT).toContain("全部事实命题都能由 cited_facts 直接推出或是该事实的直接具体实例")
    expect(ROLE_C_SEMANTIC_AUDIT_SYSTEM_PROMPT).toContain("严禁使用你自己的常识")
    expect(ROLE_C_SEMANTIC_AUDIT_SYSTEM_PROMPT).toContain("同主题不等于支持")
    expect(ROLE_C_SEMANTIC_AUDIT_SYSTEM_PROMPT).toContain("不能自行推出未转换时的具体异常")
    expect(ROLE_C_SEMANTIC_AUDIT_SYSTEM_PROMPT).toContain("是学习任务的规范性要求")
    expect(ROLE_C_SEMANTIC_AUDIT_SYSTEM_PROMPT).toContain("不得仅因 cited_facts 未介绍输入输出 API")
    expect(ROLE_C_SEMANTIC_AUDIT_SYSTEM_PROMPT).toContain("不能自行增加 Web 开发")
    expect(ROLE_C_SEMANTIC_AUDIT_SYSTEM_PROMPT).toContain("确定唯一正确选项")
    expect(ROLE_C_SEMANTIC_AUDIT_SYSTEM_PROMPT).toContain("不得以“证据未列出具体序列”为由判为 unsupported")
    expect(ROLE_C_SEMANTIC_AUDIT_SYSTEM_PROMPT).toContain("cited_examples 可以支持该示例实际展示的代码形状")
    expect(ROLE_C_SEMANTIC_AUDIT_SYSTEM_PROMPT).toContain("task_context 是已发布的题内材料")
  })

  test("反思题携带同一公开实验的 starter 和公开样例作为题内上下文", () => {
    const [reflection] = extractCodeLabBlocks({
      status: "ready",
      artifact_id: "LAB-ART-1",
      payload: {
        lab_id: "LAB-1",
        title: "输出三条笔记",
        objective_ids: ["OBJ-1"],
        instructions: [],
        execution_contract: {
          language: "python", execution_mode: "stdin_stdout", allowed_imports: [],
          input_contract: { type: "none", constraints: [] },
          output_contract: { type: "stdout text", constraints: ["输出三行"] },
          resource_limits: { timeout_ms: 1000, memory_mb: 64, max_output_bytes: 4096 },
        },
        starter_code: "print(note_1)\nprint(note_2)\nprint(note_3)\n",
        public_tests: [{
          test_id: "P1", objective_id: "OBJ-1", description: "运行程序",
          input: "", expected_behavior: "依次输出三条笔记", citations: [],
        }],
        hint_ladders: [],
        reflection_questions: ["三条要点分别对应哪一行 print？"],
        objective_coverage: [],
        used_evidence: [{ source_id: "K001", fact_id: "F001", relation: "supports" }],
      },
    } as any).filter((block) => block.locator.field === "reflection")

    expect(reflection?.task_context).toContain("print(note_3)")
    expect(reflection?.task_context).toContain("依次输出三条笔记")
  })

  test("audits one complete artifact in a single structured model call", async () => {
    const gateway = new AuditGateway({
      results: [{
        block_index: 0,
        verdict: "supported",
        reason: "题目可仅根据引用事实判断。",
        unsupported_text: [],
      }],
    })
    const result = await new ModelContentSemanticAuditPort(gateway).auditArtifact(auditInput())

    expect(gateway.requests).toHaveLength(1)
    expect(gateway.requests[0]).toMatchObject({
      task: "role-c.fact-audit.semantic-artifact",
      temperature: 0,
      input: {
        artifact_id: "ASSESSMENT-1",
        blocks: [expect.objectContaining({ block_index: 0 })],
      },
    })
    expect(gateway.requests[0].output_schema.properties.results.items.required)
      .toContain("block_index")
    expect(gateway.requests[0].output_schema.properties.results.items.required)
      .not.toContain("review_block_id")
    expect(result).toEqual([expect.objectContaining({ verdict: "supported" })])
  })

  test("rejects incomplete model audit output instead of silently skipping blocks", async () => {
    const gateway = new AuditGateway({ results: [] })
    await expect(
      new ModelContentSemanticAuditPort(gateway).auditArtifact(auditInput()),
    ).rejects.toThrow("RESULT_COUNT_MISMATCH")
  })

  test("retries one malformed structured audit batch with a distinct format request", async () => {
    let calls = 0
    const requests: any[] = []
    const gateway: ModelGateway = {
      model_id: "semantic-audit-flaky",
      model_config_hash: "MODEL-semantic-audit-flaky",
      async generateStructured<T>(request: StructuredModelRequest): Promise<T> {
        requests.push(request)
        calls += 1
        if (calls === 1) return { results: [{ block_index: 0, verdict: "maybe" }] } as T
        return { results: [{
          block_index: 0,
          verdict: "supported",
          reason: "引用事实足以判断。",
          unsupported_text: [],
          support_gap: "none",
          suggested_scope: "artifact",
        }] } as T
      },
    }
    const result = await new ModelContentSemanticAuditPort(gateway).auditArtifact(auditInput())
    expect(result[0]?.verdict).toBe("supported")
    expect(requests).toHaveLength(2)
    expect(requests[1]?.input.format_retry).toContain("结构合同")
    expect(requests[0]?.idempotency_key).not.toBe(requests[1]?.idempotency_key)
  })

  test("keeps an unlocated unsupported verdict blocked without failing the pipeline contract", async () => {
    const gateway = new AuditGateway({
      results: [{
        block_index: 0,
        verdict: "unsupported",
        reason: "题目增加了引用事实没有的结论。",
        unsupported_text: [],
      }],
    })
    const result = await new ModelContentSemanticAuditPort(gateway).auditArtifact(auditInput())
    expect(result).toEqual([expect.objectContaining({
      verdict: "uncertain",
      reason: expect.stringContaining("缺少无支持文本定位"),
      unsupported_text: [],
    })])
  })

  test("normalizes a pass verdict that still lists unsupported text to a safe rejection", async () => {
    const gateway = new AuditGateway({
      results: [{
        block_index: 0,
        verdict: "supported",
        reason: "主体内容基本符合事实。",
        unsupported_text: ["随机遍历"],
      }],
    })
    const result = await new ModelContentSemanticAuditPort(gateway).auditArtifact(auditInput())
    expect(result).toEqual([expect.objectContaining({
      verdict: "unsupported",
      unsupported_text: ["随机遍历"],
    })])
  })

  test("canonicalizes harmless structured-output variations from the provider", async () => {
    const gateway = new AuditGateway({
      results: [{
        block_index: 0,
        verdict: "SUPPORTED",
        reason: "题目可仅根据引用事实判断。",
        unsupported_text: null,
      }],
    })
    const result = await new ModelContentSemanticAuditPort(gateway).auditArtifact(auditInput())
    expect(result).toEqual([expect.objectContaining({
      verdict: "supported",
      unsupported_text: [],
    })])
  })
})
