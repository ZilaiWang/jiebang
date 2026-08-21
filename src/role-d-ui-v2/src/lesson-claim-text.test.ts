import { describe, expect, test } from "bun:test"
import { stripStandaloneClaimText } from "./lesson-claim-text"

const claims = [{ text: "Python 是一种通用编程语言。" }]

describe("lesson claim text", () => {
  test("preserves a fact embedded in natural teaching prose", () => {
    const prose = "判断以下表述是否符合事实：\"Python 是一种通用编程语言。\" 这与事实一致。"
    expect(stripStandaloneClaimText(prose, claims)).toBe(prose)
  })

  test("removes only a standalone duplicate fact line", () => {
    expect(stripStandaloneClaimText(
      "先理解这一概念。\n证据事实：Python 是一种通用编程语言。",
      claims,
    )).toBe("先理解这一概念。")
  })

  test("removes a labelled line composed only of several published claims", () => {
    expect(stripStandaloneClaimText(
      "本节小结。\n证据事实：Python 是一种通用编程语言。；Python 程序通常由解释器执行。",
      [...claims, { text: "Python 程序通常由解释器执行。" }],
    )).toBe("本节小结。")
  })

  test("keeps non-claim teaching content after an evidence label", () => {
    expect(stripStandaloneClaimText("证据事实：请逐条核对下面内容。", claims))
      .toBe("请逐条核对下面内容。")
  })
})
