import { describe, expect, test } from "bun:test"
import { buildWeek3EvaluationCases } from "../src/evaluation/week3-evaluation"
import { prepareRoleCWeek3Input } from "../src/role-c-content/evaluation/week3-runner"

describe("Week3 正式评测规划", () => {
  test("basic 画像不会把纯概念目标硬规划成无证据的编程应用", async () => {
    const evaluationCase = buildWeek3EvaluationCases().find((item) =>
      item.case_id === "golden-cs-basic-01")!
    const prepared = await prepareRoleCWeek3Input(evaluationCase)
    expect(prepared.pathNode.objectives[0]?.observable_behavior).toBe("explain")
  })

  test("basic 画像对已掌握且具有可执行语法的目标规划简单应用", async () => {
    const evaluationCase = buildWeek3EvaluationCases().find((item) =>
      item.case_id === "golden-cs-basic-04")!
    const prepared = await prepareRoleCWeek3Input(evaluationCase)
    expect(prepared.pathNode.objectives[0]?.observable_behavior).toBe("apply")
  })

  test("目标级薄弱知识不会被总体 basic 等级误规划为迁移任务", async () => {
    const input = await prepareRoleCWeek3Input({
      ...buildWeek3EvaluationCases().find((item) => item.case_id === "golden-cs-basic-13")!,
    })
    expect(input.pathNode.objectives[0]?.observable_behavior).toBe("explain")
  })
})
