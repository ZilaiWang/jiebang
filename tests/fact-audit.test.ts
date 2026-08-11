import { describe, expect, test } from "bun:test"
import Ajv from "ajv"
import { retrieveKnowledge } from "../src/rag/retriever"
import { auditGeneratedContent, auditGeneratedContentWithSemantic, buildEvidenceIndex } from "../src/fact-audit/auditor"
import { adaptRagResult } from "../src/role-c-content/contracts/evidence-pack"

describe("RAG result schema", () => {
  test("accepts the real retrieveKnowledge output including object examples, quiz items and retrieval trace", async () => {
    const schema = await Bun.file("schemas/rag_result.schema.json").json()
    const ajv = new Ajv()
    const validate = ajv.compile(schema)
    const result = await retrieveKnowledge({
      query: "初学者，不会循环，需要完成成绩统计程序",
      learnerLevel: "beginner",
      topK: 3,
    })

    expect(validate(result)).toBe(true)
    expect(validate.errors ?? []).toEqual([])
  })
})

describe("fact audit MVP", () => {
  test("indexes RAG facts by source_id and fact_id", async () => {
    const ragResult = await retrieveKnowledge({ query: "怎么让代码重复执行", learnerLevel: "beginner", topK: 3 })
    const index = buildEvidenceIndex(ragResult)

    expect(index.get("K007:F001")?.content).toBe("for 循环常用于遍历序列中的元素。")
  })

  test("passes a generated block supported by a real citation", async () => {
    const ragResult = await retrieveKnowledge({ query: "怎么让代码重复执行", learnerLevel: "beginner", topK: 3 })
    const result = auditGeneratedContent({
      artifactId: "artifact-supported",
      ragResult,
      generatedContent: {
        blocks: [
          {
            blockId: "block-1",
            text: "for 循环常用于遍历序列中的元素。",
            citations: [{ source_id: "K007", fact_id: "F001" }],
          },
        ],
      },
    })

    expect(result.status).toBe("pass")
    expect(result.checkedClaims[0]).toMatchObject({ verdict: "supported", blockId: "block-1" })
    expect(result.conflicts).toEqual([])
  })

  test("asks for revision when a knowledge block has no citation", async () => {
    const ragResult = await retrieveKnowledge({ query: "怎么让代码重复执行", learnerLevel: "beginner", topK: 3 })
    const result = auditGeneratedContent({
      artifactId: "artifact-missing-citation",
      ragResult,
      generatedContent: {
        blocks: [
          {
            blockId: "block-1",
            text: "for 循环可以帮助学习者处理重复任务。",
            citations: [],
          },
        ],
      },
    })

    expect(result.status).toBe("revise")
    expect(result.checkedClaims[0]).toMatchObject({ verdict: "missing_citation", blockId: "block-1" })
  })

  test("rejects a citation that is not present in the current RAG result", async () => {
    const ragResult = await retrieveKnowledge({ query: "怎么让代码重复执行", learnerLevel: "beginner", topK: 3 })
    const result = auditGeneratedContent({
      artifactId: "artifact-fake-citation",
      ragResult,
      generatedContent: {
        blocks: [
          {
            blockId: "block-1",
            text: "for 循环常用于遍历序列中的元素。",
            citations: [{ source_id: "K999", fact_id: "F001" }],
          },
        ],
      },
    })

    expect(result.status).toBe("reject")
    expect(result.checkedClaims[0]).toMatchObject({ verdict: "unsupported", reason: expect.stringContaining("引用不存在") })
  })

  test("rejects a block whose claim is not supported by the cited fact", async () => {
    const ragResult = await retrieveKnowledge({ query: "怎么让代码重复执行", learnerLevel: "beginner", topK: 3 })
    const result = auditGeneratedContent({
      artifactId: "artifact-wrong-citation",
      ragResult,
      generatedContent: {
        blocks: [
          {
            blockId: "block-1",
            text: "字典使用键值对保存数据。",
            citations: [{ source_id: "K007", fact_id: "F001" }],
          },
        ],
      },
    })

    expect(result.status).toBe("reject")
    expect(result.checkedClaims[0]).toMatchObject({ verdict: "unsupported", blockId: "block-1" })
    expect(result.conflicts[0]?.issue).toContain("未被引用事实支持")
  })

  test("rejects external knowledge that is outside the RAG evidence", async () => {
    const ragResult = await retrieveKnowledge({ query: "怎么让代码重复执行", learnerLevel: "beginner", topK: 3 })
    const result = auditGeneratedContent({
      artifactId: "artifact-external-knowledge",
      ragResult,
      generatedContent: {
        blocks: [
          {
            blockId: "block-1",
            text: "Transformer 通过自注意力机制学习上下文关系。",
            citations: [{ source_id: "K007", fact_id: "F001" }],
          },
        ],
      },
    })

    expect(result.status).toBe("reject")
    expect(result.checkedClaims[0]).toMatchObject({ verdict: "external_knowledge", blockId: "block-1" })
  })

  test("audits against a frozen evidence pack without depending on a fresh RAG result", async () => {
    const ragResult = await retrieveKnowledge({ query: "怎么让代码重复执行", learnerLevel: "beginner", topK: 3 })
    const evidencePack = adaptRagResult(ragResult, {
      kb_version: "python-basic@0.2.0",
      rag_version: "rule-rag@0.1",
      retrieval_id: "RAG-FROZEN-TEST",
    })

    const result = auditGeneratedContent({
      artifactId: "artifact-frozen-evidence",
      evidencePack,
      generatedContent: {
        blocks: [
          {
            blockId: "block-1",
            text: "for 循环常用于遍历序列中的元素。",
            citations: [{ source_id: "K007", fact_id: "F001" }],
          },
        ],
      },
    })

    expect(result.status).toBe("pass")
    expect(result.evidence).toMatchObject({
      kind: "frozen_evidence_pack",
      retrieval_id: "RAG-FROZEN-TEST",
      content_hash: expect.stringMatching(/^sha256:/),
    })
  })

  test("reports a frozen evidence mismatch when a caller provides the wrong expected hash", async () => {
    const ragResult = await retrieveKnowledge({ query: "怎么让代码重复执行", learnerLevel: "beginner", topK: 3 })
    const evidencePack = adaptRagResult(ragResult, {
      kb_version: "python-basic@0.2.0",
      rag_version: "rule-rag@0.1",
      retrieval_id: "RAG-FROZEN-TEST",
    })

    const result = auditGeneratedContent({
      artifactId: "artifact-frozen-mismatch",
      evidencePack,
      expectedEvidenceContentHash: "sha256:not-the-pack-hash",
      generatedContent: {
        blocks: [
          {
            blockId: "block-1",
            text: "for 循环常用于遍历序列中的元素。",
            citations: [{ source_id: "K007", fact_id: "F001" }],
          },
        ],
      },
    })

    expect(result.status).toBe("reject")
    expect(result.checkedClaims).toEqual([])
    expect(result.conflicts[0]).toMatchObject({
      blockId: "__evidence_pack__",
      issue: "冻结证据包哈希不匹配",
    })
  })

  test("lets a semantic audit port reject a claim that passes lexical overlap", async () => {
    const ragResult = await retrieveKnowledge({ query: "怎么让代码重复执行", learnerLevel: "beginner", topK: 3 })
    const result = await auditGeneratedContentWithSemantic({
      input: {
        artifactId: "artifact-semantic-reject",
        ragResult,
        generatedContent: {
          blocks: [
            {
              blockId: "block-1",
              text: "for 循环常用于遍历序列中的元素。",
              citations: [{ source_id: "K007", fact_id: "F001" }],
            },
          ],
        },
      },
      semanticAuditPort: {
        async auditClaim() {
          return { verdict: "unsupported", confidence: 0.95, reason: "claim negates the cited fact" }
        },
      },
    })

    expect(result.status).toBe("reject")
    expect(result.checkedClaims[0]).toMatchObject({
      blockId: "block-1",
      verdict: "semantic_unsupported",
      reason: expect.stringContaining("claim negates"),
    })
  })

  test("keeps a lexically supported claim passing when the semantic audit port agrees", async () => {
    const ragResult = await retrieveKnowledge({ query: "怎么让代码重复执行", learnerLevel: "beginner", topK: 3 })
    const result = await auditGeneratedContentWithSemantic({
      input: {
        artifactId: "artifact-semantic-pass",
        ragResult,
        generatedContent: {
          blocks: [
            {
              blockId: "block-1",
              text: "for 循环常用于遍历序列中的元素。",
              citations: [{ source_id: "K007", fact_id: "F001" }],
            },
          ],
        },
      },
      semanticAuditPort: {
        async auditClaim() {
          return { verdict: "supported", confidence: 0.99, reason: "same meaning" }
        },
      },
    })

    expect(result.status).toBe("pass")
    expect(result.checkedClaims[0]).toMatchObject({ verdict: "supported", semantic: { confidence: 0.99 } })
  })

  test("deterministic semantic rules reject a negated claim that would pass lexical overlap", async () => {
    const ragResult = await retrieveKnowledge({ query: "怎么让代码重复执行", learnerLevel: "beginner", topK: 3 })
    const result = await auditGeneratedContentWithSemantic({
      input: {
        artifactId: "artifact-semantic-negation",
        ragResult,
        generatedContent: {
          blocks: [{
            blockId: "block-1",
            text: "for 循环不常用于遍历序列中的元素。",
            citations: [{ source_id: "K007", fact_id: "F001" }],
          }],
        },
      },
    })

    expect(result.status).toBe("reject")
    expect(result.checkedClaims[0]).toMatchObject({
      verdict: "semantic_unsupported",
      semantic: { verdict: "unsupported", reason: expect.stringContaining("否定") },
    })
  })

  test("deterministic semantic rules reject numeric drift against cited evidence", async () => {
    const ragResult = await retrieveKnowledge({ query: "怎么让代码重复执行", learnerLevel: "beginner", topK: 3 })
    const result = await auditGeneratedContentWithSemantic({
      input: {
        artifactId: "artifact-semantic-numeric-drift",
        ragResult,
        generatedContent: {
          blocks: [{
            blockId: "block-1",
            text: "range 可生成 5 个整数序列配合 for 重复执行固定次数。",
            citations: [{ source_id: "K007", fact_id: "F003" }],
          }],
        },
      },
    })

    expect(result.status).toBe("reject")
    expect(result.checkedClaims[0]).toMatchObject({
      verdict: "semantic_unsupported",
      semantic: { verdict: "unsupported", reason: expect.stringContaining("数字") },
    })
  })
})
