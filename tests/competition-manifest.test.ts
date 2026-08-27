import { describe, expect, test } from "bun:test"
import { loadKnowledgeBase } from "../src/knowledge/loader"
import {
  buildCompetitionExpectations,
  renderManifestReviewTemplate,
} from "../src/evaluation/competition-manifest"

describe("competition manifest（改进方案8 第四节2）", () => {
  test("从现有案例构建 60 例期望，required_fact_ids 覆盖冻结核心事实而非单条或全部扩展事实", async () => {
    const knowledgeBase = await loadKnowledgeBase()
    const expectations = buildCompetitionExpectations(knowledgeBase)
    expect(expectations.length).toBe(60)

    const byId = new Map(knowledgeBase.items.map((item) => [item.sourceId, item]))

    for (const expectation of expectations) {
      expect(expectation.expected_difficulty_basis).toBeDefined()

      // required_fact_ids 使用完整 source:fact 格式。
      for (const factId of expectation.required_fact_ids) {
        expect(factId).toMatch(/^K\d{3}:F\d{3}$/)
      }
      // 校验：required_fact_ids 精确覆盖各目标的课程核心事实。
      const sourceIds = new Set(
        expectation.required_fact_ids.map((id) => id.split(":")[0]!),
      )
      for (const sourceId of sourceIds) {
        const item = byId.get(sourceId)
        expect(item).toBeDefined()
        const expected = item!.coreFactIds!.map((factId) => `${sourceId}:${factId}`).sort()
        const actual = expectation.required_fact_ids
          .filter((id) => id.startsWith(`${sourceId}:`))
          .sort()
        expect(actual).toEqual(expected)
        expect(actual.length).toBeGreaterThan(1)
        expect(actual.length).toBeLessThan(item!.facts.length)
      }
    }
  })

  test("case_id 全局唯一", async () => {
    const expectations = buildCompetitionExpectations(await loadKnowledgeBase())
    const ids = new Set(expectations.map((expectation) => expectation.case_id))
    expect(ids.size).toBe(expectations.length)
  })

  test("生成 180 行双人期望难度复核模板且不预填复核结论", async () => {
    const csv = renderManifestReviewTemplate(buildCompetitionExpectations(await loadKnowledgeBase()))
    const lines = csv.trimEnd().split("\n")
    expect(lines.length).toBe(181)
    expect(lines[0]).toContain("reviewer_1_decision")
    expect(lines[0]).toContain("reviewer_2_decision")
    expect(lines[1]?.endsWith(",,,,,,")).toBe(true)
  })

  test("期望难度按生成前认知任务冻结，不机械复制画像档位", async () => {
    const expectations = buildCompetitionExpectations(await loadKnowledgeBase())
    const byId = new Map(expectations.map((item) => [item.case_id, item]))
    expect(byId.get("golden-cs-basic-01")!.expected_difficulty).toEqual({
      lesson: "beginner",
      lab: "beginner",
      assessment: "beginner",
    })
    expect(byId.get("golden-cs-basic-07")!.expected_difficulty).toEqual({
      lesson: "beginner",
      lab: "beginner",
      assessment: "beginner",
    })
    expect(byId.get("golden-zero-beginner-18")!.expected_difficulty).toEqual({
      lesson: "beginner",
      lab: "beginner",
      assessment: "beginner",
    })
    expect(byId.get("golden-cs-basic-04")!.expected_difficulty).toEqual({
      lesson: "basic",
      lab: "basic",
      assessment: "basic",
    })
  })
})
