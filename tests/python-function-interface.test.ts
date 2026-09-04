import { describe, expect, test } from "bun:test"
import {
  describePythonEntryPoint,
  inferPythonEntryPoint,
  normalizeFunctionInvocationAgainstInterface,
  validateFunctionInvocationAgainstInterface,
} from "../src/role-c-content/programming/python-function-interface"

describe("Python function invocation contract", () => {
  test("infers the entry point frozen by the public starter", () => {
    expect(inferPythonEntryPoint("# starter\ndef classify(value, mode):\n    # TODO\n    pass\n"))
      .toBe("classify")
  })
  test("extracts a simple generated entry-point signature", () => {
    expect(describePythonEntryPoint("def solve(logs):\n    return logs\n", "solve")).toEqual({
      entry_point: "solve",
      positional_parameters: ["logs"],
      required_positional_count: 1,
      maximum_positional_count: 1,
      required_keyword_only: [],
      accepted_keyword_parameters: ["logs"],
      accepts_arbitrary_keywords: false,
    })
  })

  test("rejects the real failure shape where two log groups become two positional arguments", () => {
    const contract = describePythonEntryPoint("def solve(logs):\n    return logs\n", "solve")!
    const issues = validateFunctionInvocationAgainstInterface({
      args: [
        [["ERROR", "panic"], ["INFO", "ready"]],
        [["WARN", "slow"], ["DEBUG", "noop"]],
      ],
      kwargs: {},
    }, contract)
    expect(issues).toEqual(["solve 最多接收 1 个位置参数，当前为 2 个"])
    expect(validateFunctionInvocationAgainstInterface({
      args: [[
        [["ERROR", "panic"], ["INFO", "ready"]],
        [["WARN", "slow"], ["DEBUG", "noop"]],
      ]],
      kwargs: {},
    }, contract)).toEqual([])
  })

  test("supports defaults, keyword-only arguments and variadic signatures", () => {
    const contract = describePythonEntryPoint(
      "def run(value: int, scale=1, *items, mode, strict=False, **extra):\n    return value\n",
      "run",
    )!
    expect(contract).toMatchObject({
      required_positional_count: 1,
      maximum_positional_count: null,
      required_keyword_only: ["mode"],
      accepts_arbitrary_keywords: true,
    })
    expect(validateFunctionInvocationAgainstInterface({ args: [1], kwargs: {} }, contract))
      .toEqual(["run 缺少必填关键字参数 mode"])
    expect(validateFunctionInvocationAgainstInterface({ args: [1], kwargs: { mode: "fast" } }, contract)).toEqual([])
  })

  test("wraps raw data when a one-parameter signature makes the call unambiguous", () => {
    const contract = describePythonEntryPoint(
      "def classify(command):\n    return command\n",
      "classify",
    )!
    expect(normalizeFunctionInvocationAgainstInterface("ADD 2 3", contract)).toEqual({
      args: ["ADD 2 3"],
      kwargs: {},
    })
    expect(normalizeFunctionInvocationAgainstInterface([1, 2, 3], contract)).toEqual({
      args: [[1, 2, 3]],
      kwargs: {},
    })
  })

  test("maps an array to multiple arguments only when its arity matches", () => {
    const contract = describePythonEntryPoint(
      "def add(left, right):\n    return left + right\n",
      "add",
    )!
    expect(normalizeFunctionInvocationAgainstInterface([2, 3], contract)).toEqual({
      args: [2, 3],
      kwargs: {},
    })
    expect(normalizeFunctionInvocationAgainstInterface("2 3", contract)).toBe("2 3")
  })

  test("maps named model inputs to kwargs when they satisfy the public signature", () => {
    const contract = describePythonEntryPoint(
      "def classify(value, mode):\n    return value\n",
      "classify",
    )!
    expect(normalizeFunctionInvocationAgainstInterface(
      { value: 3, mode: "strict" },
      contract,
    )).toEqual({ args: [], kwargs: { value: 3, mode: "strict" } })
  })
})
