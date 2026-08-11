import { describe, expect, test } from "bun:test"
import { canonicalizeFormalPathNodeTopics } from "../src/orchestration/interactive-session"

describe("all B path nodes use their own A titles", () => {
  test("canonicalizes every node in formal order instead of repeating the overall goal", () => {
    const path: any = {
      nodes: [
        { goal: "学习for 循环", target_source_ids: ["K003"], prerequisite_source_ids: [], objectives: [], assessment_blueprint: { required_modalities: [] } },
        { goal: "学习for 循环", target_source_ids: ["K007"], prerequisite_source_ids: ["K003"], objectives: [], assessment_blueprint: { required_modalities: [] } },
      ],
    }
    const result = canonicalizeFormalPathNodeTopics(path, { results: [
      { source_id: "K003", title: "基本数据类型", facts: [] },
      { source_id: "K007", title: "for 循环", facts: [] },
    ] } as any)
    expect(result.nodes.map((node: any) => node.goal)).toEqual(["基本数据类型", "for 循环"])
  })
})
