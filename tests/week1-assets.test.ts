import { describe, expect, test } from "bun:test"

describe("week-one RAG demo assets", () => {
  test("provides three learner profile examples for B/C/D integration", async () => {
    const profiles = await Promise.all([
      Bun.file("examples/learner_beginner.json").json(),
      Bun.file("examples/learner_loop_weak.json").json(),
      Bun.file("examples/learner_project_goal.json").json(),
    ])

    expect(profiles).toHaveLength(3)
    for (const profile of profiles) {
      expect(profile.learner_id).toMatch(/^demo_/)
      expect(profile.goal.length).toBeGreaterThan(0)
      expect(Array.isArray(profile.weak_concepts)).toBe(true)
    }
  })

  test("ships a runnable RAG demo script", async () => {
    const script = await Bun.file("scripts/rag-demo.ts").text()

    expect(script).toContain("retrieveKnowledge")
    expect(script).toContain("初学者，不会循环，需要完成成绩统计程序")
  })

  test("documents the role A week-one acceptance evidence", async () => {
    const report = await Bun.file("docs/week1_role_a_acceptance.md").text()

    expect(report).toContain("角色 A")
    expect(report).toContain("npm exec -- bun run check")
    expect(report).toContain("knowledge_base/python_basic/index.json")
    expect(report).toContain("scripts/rag-demo.ts")
    expect(report).toContain("当前限制")
  })
})
