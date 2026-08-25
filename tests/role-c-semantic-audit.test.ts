import { describe, expect, test } from "bun:test"
import type { ModelGateway } from "../src/role-c-content/contracts/model-gateway"
import type { AssessmentPublicArtifact } from "../src/role-c-content/contracts/artifacts"
import { extractAssessmentBlocks } from "../src/role-c-content/review/extract-review-blocks"
import {
  ModelContentSemanticAuditPort,
  ROLE_C_SEMANTIC_AUDIT_SYSTEM_PROMPT,
} from "../src/role-c-content/review/model-semantic-audit-port"

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
