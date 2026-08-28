import { describe, expect, test } from "bun:test"
import {
  executableExampleFactIds,
  isCommentOnlyPythonExample,
  isSubstantivePythonExample,
} from "../src/knowledge/example-code"

describe("讲义分步示例代码质量", () => {
  test("注释、pass 和省略号不是可学习的代码示例", () => {
    for (const code of [
      "# 使用 for 遍历列表",
      "pass",
      "...",
      "raise NotImplementedError()",
      "# 待实现\npass",
      "def solve():\n    pass",
      "这里使用 for 循环遍历列表",
    ]) {
      expect(isSubstantivePythonExample(code)).toBe(false)
      expect(isCommentOnlyPythonExample(code)).toBe(true)
    }
  })

  test("完整语句或可跟踪的程序结构才算代码示例", () => {
    for (const code of [
      "scores = [80, 90, 75]\nprint(sum(scores) / len(scores))",
      "for item in [1, 2, 3]:\n    print(item)",
      "def greet(name):\n    return f'Hello, {name}'",
    ]) {
      expect(isSubstantivePythonExample(code)).toBe(true)
      expect(isCommentOnlyPythonExample(code)).toBe(false)
    }
  })

  test("只有实际 Python 语法与操作性事实同时存在时才规划代码示例", () => {
    expect(executableExampleFactIds([
      { factId: "F001", content: "Python 是一种通用编程语言。", capabilities: ["rule"] },
    ])).toEqual([])

    expect(executableExampleFactIds([
      { factId: "F001", content: "for 语句可用于遍历一组元素。", capabilities: ["rule"] },
      { factId: "F002", content: "range() 可生成一系列整数。", capabilities: ["procedure"] },
      { factId: "F003", content: "循环会按顺序反复执行代码块。", capabilities: ["state_transition"] },
    ])).toEqual(["F001", "F002", "F003"])
  })
})
