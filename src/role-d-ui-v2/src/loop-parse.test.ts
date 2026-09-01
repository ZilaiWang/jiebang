import { describe, expect, test } from "bun:test"
import { parseLoopVisualization, loopSteps, canVisualizeLoop } from "./loop-parse"

describe("loop-visualizer：循环遍历可视化解析", () => {
  test("识别数字列表字面量遍历", () => {
    const parsed = parseLoopVisualization("for score in [80, 90, 75]:\n    total += score")
    expect(parsed).toEqual({ variable: "score", elements: ["80", "90", "75"] })
  })

  test("识别字符串列表字面量遍历", () => {
    const parsed = parseLoopVisualization("for fruit in ['苹果', '香蕉']:\n    print(fruit)")
    expect(parsed).toEqual({ variable: "fruit", elements: ["苹果", "香蕉"] })
  })

  test("识别先定义列表变量再遍历的真实讲义写法", () => {
    const parsed = parseLoopVisualization("scores = [80, 90, 75]\nfor score in scores:\n    print(score)")
    expect(parsed).toEqual({ variable: "score", elements: ["80", "90", "75"] })
  })

  test("无法静态确定内容的 range/变量 → null，不渲染可视化", () => {
    expect(parseLoopVisualization("for i in range(5):")).toBeNull()
    expect(parseLoopVisualization("for item in items:")).toBeNull()
    expect(parseLoopVisualization("total = 0")).toBeNull()
    expect(parseLoopVisualization("")).toBeNull()
  })

  test("含嵌套/表达式元素的列表 → null（不冒险解析）", () => {
    expect(parseLoopVisualization("for x in [[1, 2], [3]]:")).toBeNull()
    expect(parseLoopVisualization("for x in [a + 1, b]:")).toBeNull()
    expect(parseLoopVisualization("for x in [1 + 2]:")).toBeNull()
    expect(parseLoopVisualization("for x in ['a' + 'b']:")).toBeNull()
  })

  test("字符串中的逗号不会被误拆成多个元素", () => {
    expect(parseLoopVisualization("for text in ['a,b', 'c']:\n    print(text)"))
      .toEqual({ variable: "text", elements: ["a,b", "c"] })
  })

  test("loopSteps 逐步视图：初始 + 每轮当前/已遍历/未遍历", () => {
    const steps = loopSteps({ variable: "score", elements: ["80", "90", "75"] })
    expect(steps).toHaveLength(4)
    expect(steps[0]).toEqual({ round: 0, variable: "score", current: null, visited: [], remaining: ["80", "90", "75"] })
    expect(steps[1]).toEqual({ round: 1, variable: "score", current: "80", visited: ["80"], remaining: ["90", "75"] })
    expect(steps[2]).toEqual({ round: 2, variable: "score", current: "90", visited: ["80", "90"], remaining: ["75"] })
    expect(steps[3]).toEqual({ round: 3, variable: "score", current: "75", visited: ["80", "90", "75"], remaining: [] })
  })

  test("canVisualizeLoop 判断入口是否显示", () => {
    expect(canVisualizeLoop("for x in [1, 2]:\n    pass")).toBe(true)
    expect(canVisualizeLoop("items = ['a', 'b']\nfor x in items:\n    pass")).toBe(true)
    expect(canVisualizeLoop("def f():\n    return 1")).toBe(false)
  })

  test("空列表 → null（无遍历步骤可展示）", () => {
    expect(parseLoopVisualization("for x in []:\n    pass")).toBeNull()
  })
})
