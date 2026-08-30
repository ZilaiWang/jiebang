import { describe, expect, test } from "bun:test"
import { ModelContentSemanticAuditPort } from "../src/role-c-content/review/model-semantic-audit-port"
import type { ModelGateway } from "../src/role-c-content/contracts/model-gateway"

function mockGateway(onGenerate: (blocks: unknown[]) => unknown[]): ModelGateway {
  let calls = 0
  const gateway = {
    model_config_hash: "MODEL-mock",
    async generateStructured<T>(_request: unknown): Promise<T> {
      calls += 1
      const input = (_request as { input?: { blocks?: unknown[] } }).input ?? {}
      const blocks = (input as { blocks?: unknown[] }).blocks ?? []
      return { results: onGenerate(blocks) } as T
    },
  }
  ;(gateway as unknown as { __calls: () => number }).__calls = () => calls
  return gateway as unknown as ModelGateway
}

function block(id: string, text: string) {
  return {
    review_block_id: id,
    text,
    citations: [{ source_id: "K001", fact_id: "F1", relation: "supports" as const }],
    fact_audit_mode: "claim" as const,
    surface_kind: "narrative_explanation" as const,
    locator: { field: "claim" as const, ref_id: id },
    cited_facts: [{ source_id: "K001", fact_id: "F1", content: "int 表示整数" }],
  }
}

describe("改进方案4 第八节：block-level 语义审核缓存", () => {
  test("相同 block 两次审核，第二次不重复调用模型（缓存命中）", async () => {
    const callLog: string[] = []
    const gateway = mockGateway((blocks) => {
      const list = blocks as Array<{ review_block_id: string }>
      callLog.push(list.map((b) => b.review_block_id).join(","))
      return list.map((_b, block_index) => ({ block_index, verdict: "supported" as const, reason: "", unsupported_text: [] }))
    })
    const port = new ModelContentSemanticAuditPort(gateway)
    const blocks = [block("b1", "int 是整数"), block("b2", "float 是小数")]
    await port.auditArtifact({ run_id: "r", artifact_kind: "concept", artifact_id: "a", evidence_hash: "e", blocks })
    // 第二次：完全相同的 blocks → 全部缓存命中，模型不再被调用
    await port.auditArtifact({ run_id: "r", artifact_kind: "concept", artifact_id: "a", evidence_hash: "e", blocks })
    expect(callLog).toHaveLength(1) // 只有第一次调用模型
  })

  test("只改一道题，其他题命中缓存（只审 miss）", async () => {
    const callLog: string[] = []
    const gateway = mockGateway((blocks) => {
      const list = blocks as Array<{ review_block_id: string }>
      callLog.push(list.map((b) => b.review_block_id).join(","))
      return list.map((_b, block_index) => ({ block_index, verdict: "supported" as const, reason: "", unsupported_text: [] }))
    })
    const port = new ModelContentSemanticAuditPort(gateway)
    const blocks = [block("b1", "int 是整数"), block("b2", "float 是小数"), block("b3", "str 是字符串")]
    await port.auditArtifact({ run_id: "r", artifact_kind: "concept", artifact_id: "a", evidence_hash: "e", blocks })
    // 第二次只改 b2，b1/b3 应命中缓存，只审 b2
    const changed = [block("b1", "int 是整数"), block("b2", "float 是小数，float 有精度"), block("b3", "str 是字符串")]
    await port.auditArtifact({ run_id: "r", artifact_kind: "concept", artifact_id: "a", evidence_hash: "e", blocks: changed })
    expect(callLog).toHaveLength(2)
    expect(callLog[1]).toBe("b2") // 只审改动的 block
  })

  test("cited facts 变化 → 缓存失效，重新审核", async () => {
    const callLog: number[] = []
    const gateway = mockGateway((blocks) => {
      const list = blocks as Array<{ review_block_id: string }>
      callLog.push(list.length)
      return list.map((_b, block_index) => ({ block_index, verdict: "supported" as const, reason: "", unsupported_text: [] }))
    })
    const port = new ModelContentSemanticAuditPort(gateway)
    const blocks = [block("b1", "int 是整数")]
    await port.auditArtifact({ run_id: "r", artifact_kind: "concept", artifact_id: "a", evidence_hash: "e", blocks })
    // cited facts 变化 → 缓存键变化 → 重新审核
    const changedFacts = [{
      ...block("b1", "int 是整数"),
      cited_facts: [{ source_id: "K001", fact_id: "F2", content: "int 表示 32 位整数" }],
    }]
    await port.auditArtifact({ run_id: "r", artifact_kind: "concept", artifact_id: "a", evidence_hash: "e", blocks: changedFacts })
    expect(callLog).toEqual([1, 1]) // 两次都调用模型
  })

  test("reviewed cited examples participate in the semantic cache identity", async () => {
    const callLog: number[] = []
    const gateway = mockGateway((blocks) => {
      const list = blocks as Array<{ review_block_id: string }>
      callLog.push(list.length)
      return list.map((_b, block_index) => ({ block_index, verdict: "supported" as const, reason: "", unsupported_text: [] }))
    })
    const port = new ModelContentSemanticAuditPort(gateway)
    const withExample = [{
      ...block("b1", "for item in values"),
      cited_examples: [{
        title: "遍历列表",
        code: "for item in values:\n    print(item)",
        explanation: "逐个处理列表元素",
        fact_refs: [{ source_id: "K001", fact_id: "F1" }],
      }],
    }]
    await port.auditArtifact({ run_id: "r", artifact_kind: "concept", artifact_id: "a", evidence_hash: "e", blocks: withExample })
    await port.auditArtifact({
      run_id: "r", artifact_kind: "concept", artifact_id: "a", evidence_hash: "e",
      blocks: [{ ...withExample[0]!, cited_examples: [{ ...withExample[0]!.cited_examples[0]!, code: "for item in values:\n    pass" }] }],
    })
    expect(callLog).toEqual([1, 1])
  })
})
