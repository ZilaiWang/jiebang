import { describe, expect, test } from "bun:test"
import { normalizePythonLiterals } from "../src/role-c-content/contracts/model-gateway"

describe("normalizePythonLiterals", () => {
  test("把值位置的 Python 布尔字面量替换为 JSON 小写形式", () => {
    expect(normalizePythonLiterals('{"input": {"args": [False], "kwargs": {}}}'))
      .toBe('{"input": {"args": [false], "kwargs": {}}}')
    expect(normalizePythonLiterals('{"ok": True}')).toBe('{"ok": true}')
    expect(normalizePythonLiterals('{"v": None}')).toBe('{"v": null}')
    expect(normalizePythonLiterals('{"a": {"b": [1, False, True]}}'))
      .toBe('{"a": {"b": [1, false, true]}}')
  })

  test("字符串字面量内部的 Python 字样不受影响", () => {
    expect(normalizePythonLiterals('{"tag": "confuses_True_with_x", "ok": False}'))
      .toBe('{"tag": "confuses_True_with_x", "ok": false}')
    expect(normalizePythonLiterals('{"s": "a\\"True\\"b", "ok": True}'))
      .toBe('{"s": "a\\"True\\"b", "ok": true}')
  })

  test("已符合 JSON 标准的输入保持不变", () => {
    const input = '{"ok": false, "n": null, "t": true}'
    expect(normalizePythonLiterals(input)).toBe(input)
  })

  test("规范化后的输出可通过 JSON.parse（复现真实失败样本）", () => {
    const raw = '{"reference_solution": "def identify_type(value):\\n    return type(value).__name__", "hidden_tests": [{"input": {"args": [3.14], "kwargs": {}}, "expected": "float", "comparison": {"kind": "exact"}, "misconception_tag": "float_type_misidentified"}, {"input": {"args": ["hello"], "kwargs": {}}, "expected": "str", "comparison": {"kind": "exact"}, "misconception_tag": "str_type_misidentified"}, {"input": {"args": [False], "kwargs": {}}, "expected": "bool", "comparison": {"kind": "exact"}, "misconception_tag": "bool_type_misidentified"}], "mutation_variants": []}'
    // 原始输出含 Python 风格 False，JSON.parse 必须失败
    expect(() => JSON.parse(raw)).toThrow()
    // 规范化后必须成功解析，且布尔值正确
    const parsed = JSON.parse(normalizePythonLiterals(raw)) as {
      hidden_tests: Array<{ input: { args: unknown[] } }>
    }
    expect(parsed.hidden_tests[2].input.args[0]).toBe(false)
  })

  test("mutation_variants 等空数组与嵌套结构保持完整", () => {
    const normalized = normalizePythonLiterals('{"mutation_variants": [], "items": [{"ok": True}]}')
    expect(JSON.parse(normalized)).toEqual({ mutation_variants: [], items: [{ ok: true }] })
  })
})
