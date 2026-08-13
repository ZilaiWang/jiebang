import {
  createDockerPythonCodeRunnerFromEnv,
  executeWithRunnerRetry,
  type CodeExecutionRequest,
  type CodeExecutionResult,
  type ExecutionContract,
  type RunnerTestSuite,
} from "../src/role-c-content"

const runner = await createDockerPythonCodeRunnerFromEnv()
type SmokeExecutionResult = CodeExecutionResult & { tool_attempts: number }
const results: Record<string, SmokeExecutionResult> = {}

results.correct = await execute("def solve(value):\n    return value * 2")
assertResult(
  results.correct.status === "passed",
  `正确实现必须通过 Docker 隐藏测试：${JSON.stringify(results.correct)}`,
)

results.wrong = await execute("def solve(value):\n    return value")
assertResult(results.wrong.status === "failed", "错误实现必须被 Docker 隐藏测试识别")

results.forbidden_import = await execute("import os\ndef solve(value):\n    return value * 2")
assertResult(
  results.forbidden_import.status === "failed" &&
    results.forbidden_import.failure_codes.includes("static:forbidden_import"),
  "禁止导入必须在执行前被拒绝",
)

results.builtins_import_escape = await execute(
  'def solve(value):\n    return __builtins__["__import__"]("inspect").currentframe()',
)
assertResult(
  results.builtins_import_escape.status === "failed"
    && results.builtins_import_escape.failure_codes.some((code) => code.startsWith("static:")),
  "通过 __builtins__ 间接导入 inspect 必须被拒绝",
)

results.frame_introspection = await execute(
  "def solve(value):\n    return value.f_back.f_locals",
)
assertResult(
  results.frame_introspection.status === "failed"
    && results.frame_introspection.failure_codes.some((code) => code.startsWith("static:")),
  "frame 调用栈反射必须被拒绝",
)

results.syntax_error = await execute("def solve(value)\n    return value * 2")
assertResult(
  results.syntax_error.status === "failed" &&
    results.syntax_error.failure_codes.some((code) => code.endsWith(":syntax_error")),
  "语法错误必须由 Docker runner 返回为失败",
)

results.output_limit = await execute("def solve(value):\n    print('x' * 10000)\n    return value * 2", {
  max_output_bytes: 256,
})
assertResult(
  results.output_limit.status === "failed" &&
    results.output_limit.failure_codes.some((code) => code.endsWith(":output_limit")),
  "超量输出必须被限制",
)

results.timeout = await execute("def solve(value):\n    while True:\n        pass", {
  timeout_ms: 300,
})
assertResult(results.timeout.status === "timeout", "无限循环必须被 Docker 超时终止")

results.memory_limit = await execute(
  "def solve(value):\n    data = bytearray(256 * 1024 * 1024)\n    return value * 2",
  { memory_mb: 64 },
)
assertResult(results.memory_limit.status === "failed", "超量内存申请必须失败")

console.log(JSON.stringify({
  status: "passed",
  runner_mode: "docker",
  runner_image_digest: runner.runner_image_digest,
  checks: Object.fromEntries(
    Object.entries(results).map(([name, result]) => [name, {
      status: result.status,
      failure_codes: result.failure_codes,
      tool_attempts: result.tool_attempts,
    }]),
  ),
}, null, 2))

async function execute(
  code: string,
  limits: Partial<ExecutionContract["resource_limits"]> = {},
): Promise<SmokeExecutionResult> {
  const resourceLimits = {
    // Leave room for a cold local Docker start; the timeout case below sets its
    // own strict execution budget.
    timeout_ms: limits.timeout_ms ?? 3_000,
    memory_mb: limits.memory_mb ?? 64,
    max_output_bytes: limits.max_output_bytes ?? 2_000,
  }
  const suite: RunnerTestSuite = {
    test_suite_id: "ROLE-C-DOCKER-SMOKE",
    execution_contract: {
      language: "python",
      execution_mode: "function",
      entry_point: "solve",
      allowed_imports: [],
      input_contract: { type: "number", constraints: [] },
      output_contract: { type: "number" },
      resource_limits: resourceLimits,
    },
    tests: [{
      test_id: "DOUBLE-FOUR",
      input: 4,
      expected: 8,
      objective_id: "DOCKER-ISOLATION",
      weight: 1,
      comparison: { kind: "exact" },
    }],
  }
  const request: CodeExecutionRequest = {
    language: "python",
    code,
    test_suite_id: suite.test_suite_id,
    test_suite: suite,
    timeout_ms: resourceLimits.timeout_ms,
    memory_mb: resourceLimits.memory_mb,
    max_output_bytes: resourceLimits.max_output_bytes,
    network_allowed: false,
  }
  return executeWithRunnerRetry(runner, request, 1)
}

function assertResult(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message)
}
