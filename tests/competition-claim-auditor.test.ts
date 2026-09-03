import { describe, expect, test } from "bun:test"
import { ModelCompetitionClaimAuditor } from "../src/evaluation/competition-claim-auditor"
import type { ModelGateway, StructuredModelRequest } from "../src/role-c-content/contracts/model-gateway"

describe("competition claim auditor", () => {
  test("强制 supported_fact_ids 只能来自当前声明引用，且缺引用必为 missing_citation", async () => {
    const gateway: ModelGateway = {
      model_id: "judge",
      model_config_hash: "MODEL-judge",
      async generateStructured<T>(): Promise<T> {
        return { results: [
          { claim_index: 0, factual: true, verdict: "supported", supported_fact_ids: ["K001:F001", "K999:F999"], reason: "有支持" },
          { claim_index: 1, factual: true, verdict: "supported", supported_fact_ids: ["K001:F001"], reason: "有支持" },
        ] } as T
      },
    }
    const auditor = new ModelCompetitionClaimAuditor(gateway)
    const results = await auditor.audit({
      repeat_index: 1,
      case_id: "c1",
      candidates: [
        { claim_id: "a", artifact_kind: "lesson", text: "Python 是一种编程语言。", surface: "paragraph", citations: [{ source_id: "K001", fact_id: "F001" }] },
        { claim_id: "b", artifact_kind: "lesson", text: "Python 是一种编程语言。", surface: "paragraph", citations: [] },
      ],
      evidence: [{ fact_id: "K001:F001", content: "Python 是一种解释型、通用编程语言。" }],
    })
    expect(results[0]?.verdict).toBe("supported")
    expect(results[0]?.supported_fact_ids).toEqual(["K001:F001"])
    expect(results[1]?.verdict).toBe("missing_citation")
    expect(results[1]?.supported_fact_ids).toEqual([])
  })

  test("模型漏回或重复 claim_index 时失败关闭", async () => {
    const gateway: ModelGateway = {
      model_id: "judge",
      model_config_hash: "MODEL-judge",
      async generateStructured<T>(): Promise<T> { return { results: [] } as T },
    }
    const auditor = new ModelCompetitionClaimAuditor(gateway)
    await expect(auditor.audit({
      repeat_index: 1,
      case_id: "c1",
      candidates: [{ claim_id: "a", artifact_kind: "lab", text: "事实", surface: "paragraph", citations: [] }],
      evidence: [],
    })).rejects.toThrow(/RESULT_COUNT_MISMATCH/)
  })

  test("长批次漏回 claim_index 时缩小批次重审，不把整案误记为漏审", async () => {
    let calls = 0
    const gateway: ModelGateway = {
      model_id: "judge",
      model_config_hash: "MODEL-judge",
      async generateStructured<T>(request: StructuredModelRequest): Promise<T> {
        calls += 1
        const claims = (request.input as { claims: Array<{ claim_index: number }> }).claims
        if (claims.length > 1) return { results: [] } as T
        return { results: [{
          claim_index: 0,
          factual: true,
          verdict: "supported",
          support_basis: "citation_fact",
          supported_fact_ids: ["K001:F001"],
          reason: "逐条审核通过",
        }] } as T
      },
    }
    const results = await new ModelCompetitionClaimAuditor(gateway).audit({
      repeat_index: 1,
      case_id: "c1",
      candidates: ["a", "b", "c"].map((claim_id) => ({
        claim_id,
        artifact_kind: "lesson" as const,
        text: "Python 是一种编程语言。",
        surface: "paragraph",
        citations: [{ source_id: "K001", fact_id: "F001" }],
      })),
      evidence: [{ fact_id: "K001:F001", content: "Python 是一种解释型、通用编程语言。" }],
    })
    expect(results).toHaveLength(3)
    expect(results.every((item) => item.audited && item.verdict === "supported")).toBe(true)
    expect(calls).toBe(5)
  })

  test("公开代码自身可支持执行描述，但不能被计作核心事实覆盖", async () => {
    const gateway: ModelGateway = {
      model_id: "judge",
      model_config_hash: "MODEL-judge",
      async generateStructured<T>(): Promise<T> {
        return { results: [{
          claim_index: 0,
          factual: true,
          verdict: "supported",
          support_basis: "artifact_self",
          supported_fact_ids: [],
          reason: "公开 starter 含 print(fact_text)。",
        }] } as T
      },
    }
    const [result] = await new ModelCompetitionClaimAuditor(gateway).audit({
      repeat_index: 1,
      case_id: "c1",
      candidates: [{
        claim_id: "lab-output",
        artifact_kind: "lab",
        text: "运行后程序会输出填写的内容。",
        surface: "instruction",
        citations: [{ source_id: "K007", fact_id: "F001" }],
        local_context: 'fact_text = "TODO"\nprint(fact_text)',
      }],
      evidence: [{ fact_id: "K007:F001", content: "for 循环常用于遍历序列。" }],
    })
    expect(result?.verdict).toBe("supported")
    expect(result?.support_basis).toBe("artifact_self")
    expect(result?.supported_fact_ids).toEqual([])
  })

  test("非事实教学指令统一记录为 nonfactual supported，不制造伪失败", async () => {
    const gateway: ModelGateway = {
      model_id: "judge",
      model_config_hash: "MODEL-judge",
      async generateStructured<T>(): Promise<T> {
        return { results: [{
          claim_index: 0,
          factual: false,
          verdict: "unsupported",
          support_basis: "nonfactual",
          supported_fact_ids: [],
          reason: "这是学习操作指令，不表达专业事实。",
        }] } as T
      },
    }
    const [result] = await new ModelCompetitionClaimAuditor(gateway).audit({
      repeat_index: 1,
      case_id: "c1",
      candidates: [{
        claim_id: "instruction",
        artifact_kind: "lab",
        text: "运行公开样例并观察输出。",
        surface: "instruction",
        citations: [],
      }],
      evidence: [],
    })
    expect(result?.factual).toBe(false)
    expect(result?.verdict).toBe("supported")
    expect(result?.support_basis).toBe("nonfactual")
  })
})
