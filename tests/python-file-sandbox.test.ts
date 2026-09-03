import { expect, test } from "bun:test"
import { invocationFileFixtures } from "../src/role-c-content/security/file-fixtures"
import { normalizeCustomDebugInput } from "../src/role-c-content/programming/submission-contract"
import { analyzePythonSource } from "../src/role-c-content/security/python-static-analyzer"
import { coerceFunctionInvocation } from "../src/role-c-content/providers/staged-generation"

const contract = { language: "python" as const, execution_mode: "function" as const, entry_point: "solve", allowed_imports: ["io", "math"], input_contract: { type: "args", constraints: [] }, output_contract: { type: "string" }, resource_limits: { timeout_ms: 1000, memory_mb: 64, max_output_bytes: 8192 } }
const python = Bun.which("python3")
async function run(code: string, inputs: unknown[]) {
  const child = Bun.spawn([python!, "docker/role-c-python-runner/runner.py"], {
    stdin: new Blob([JSON.stringify({ code, execution_contract: contract, test_inputs: inputs, max_output_bytes: 8192, platform_allowed_imports: ["io", "math"] })]), stdout: "pipe", stderr: "pipe",
  })
  const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  expect(exit, stderr).toBe(0)
  return JSON.parse(stdout).results as Array<{ outcome: string; actual?: unknown; error_type?: string }>
}

test("public debug and author normalization preserve the same fixture envelope", () => {
  const input = { args: ["data.txt"], kwargs: {}, files: { "data.txt": "样例\n" } }
  expect(invocationFileFixtures(input)).toEqual(input.files)
  expect(coerceFunctionInvocation(input)).toEqual(input)
  expect(normalizeCustomDebugInput({ task_id: "T", submission_mode: "full_code", execution_contract: contract }, input)).toEqual(input)
  expect(() => normalizeCustomDebugInput({ task_id: "T", submission_mode: "full_code", execution_contract: contract, max_custom_input_bytes: 5 }, input)).toThrow("字节")
  expect(analyzePythonSource('def solve(path):\n    with open(path, encoding="utf-8") as f:\n        return f.read()', contract)).toEqual([])
})

test("invalid fixture paths, values and budgets are rejected", () => {
  for (const name of ["../x", "/tmp/x", "C:\\x", "a/b", ".", "..", ""]) {
    expect(() => invocationFileFixtures({ args: [], files: { [name]: "x" } })).toThrow()
  }
  expect(() => invocationFileFixtures({ args: [], files: { "x": 1 } })).toThrow()
  expect(() => invocationFileFixtures({ args: [], files: { "x": "a".repeat(65537) } })).toThrow()
  expect(() => invocationFileFixtures({ args: [], files: Object.fromEntries(Array.from({length:17},(_,i)=>[String(i), ""])) })).toThrow()
})

test.skipIf(!python)("real files support UTF-8 read/write/append, and each test starts with only its own fixtures", async () => {
  const rows = await run('def solve(path, text):\n    with open(path, "a", encoding="utf-8") as f:\n        f.write(text)\n    with open(path, "r", encoding="utf-8") as f:\n        return f.read()', [
    { args: ["data.txt", "甲"], kwargs: {}, files: { "data.txt": "已有：" } },
    { args: ["data.txt", "乙"], kwargs: {}, files: {} },
  ])
  expect(rows.map(r => r.actual)).toEqual(["已有：甲", "乙"])
  expect(rows.every(r => r.outcome === "returned")).toBe(true)
})

test.skipIf(!python)("missing file is a real catchable FileNotFoundError", async () => {
  const rows = await run('def solve(path):\n    try:\n        with open(path) as f:\n            return f.read()\n    except FileNotFoundError:\n        return "missing"', [{ args: ["absent.txt"], kwargs: {} }])
  expect(rows[0]!.actual).toBe("missing")
})

test.skipIf(!python)("direct and indirect file access cannot escape the test directory or read file descriptors", async () => {
  for (const call of ['open(path)', 'io.open(path)', 'io.FileIO(path)']) {
    const rows = await run(`import io\ndef solve(path):\n    return ${call}.read()`, ["/etc/passwd", "../runner.py", 0].map(path => ({ args: [path], kwargs: {} })))
    expect(rows.every(r => r.outcome === "runtime_error" && r.error_type === "PermissionError")).toBe(true)
  }
})

test.skipIf(!python)("ordinary allowed imports still work inside file isolation", async () => {
  const rows = await run('import math\ndef solve(x):\n    return math.sqrt(x)', [{ args: [9], kwargs: {} }])
  expect(rows[0]!.actual).toBe(3)
})

test.skipIf(!python)("module state cannot carry a previous test's file contents into the next test", async () => {
  const rows = await run('import io\ndef solve(x):\n    try:\n        return io.saved\n    except AttributeError:\n        io.saved = x\n        return x', [{ args: ["first"], kwargs: {} }, { args: ["second"], kwargs: {} }])
  expect(rows.map(r => r.actual)).toEqual(["first", "second"])
})

test.skipIf(!python)("result serialization remains inside the restricted process", async () => {
  const rows = await run('class Evil(dict):\n    def items(self):\n        return [("data", open("/etc/passwd").read())]\ndef solve(x):\n    return Evil(x=1)', [{ args: [1], kwargs: {} }])
  expect(rows[0]).toEqual({ outcome: "runtime_error", error_type: "PermissionError" })
})
