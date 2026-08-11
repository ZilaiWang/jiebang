import { randomUUID } from "node:crypto"
import { spawn as spawnChildProcess } from "node:child_process"
import { isDeepStrictEqual } from "node:util"
import type { ExecutionContract, HiddenTest } from "../contracts/artifacts"
import { analyzePythonSource, PLATFORM_PYTHON_IMPORT_ALLOWLIST } from "./python-static-analyzer"

export const DEFAULT_ROLE_C_DOCKER_IMAGE = "knowbalance-role-c-python-runner:1.0.0"
export const ROLE_C_DOCKER_RUNNER_LABEL = "io.knowbalance.role-c.runner"

const IMAGE_ID_PATTERN = /^sha256:[a-f0-9]{64}$/
const MAX_RUNNER_PAYLOAD_BYTES = 512_000
const MAX_HIDDEN_TESTS = 64
const DOCKER_CLEANUP_RETRY_DELAYS_MS = [0, 50, 100, 200, 400] as const

export interface RunnerTestSuite {
  test_suite_id: string
  execution_contract: ExecutionContract
  tests: HiddenTest[]
}

export interface CodeExecutionRequest {
  language: "python"
  code: string
  test_suite_id: string
  test_suite?: RunnerTestSuite
  timeout_ms: number
  memory_mb: number
  max_output_bytes: number
  network_allowed: false
}

export interface CodeExecutionResult {
  status: "passed" | "failed" | "timeout" | "runner_error"
  passed_tests: number
  total_tests: number
  score_ratio: number
  failure_codes: string[]
  runner_image_digest: string
}

export interface CodeTestSuiteResolver {
  resolve(testSuiteId: string): Promise<RunnerTestSuite | undefined>
}

/** Production implementations must execute untrusted code in an isolated Docker container. */
export interface CodeRunner {
  readonly runner_image_digest: string
  execute(request: CodeExecutionRequest): Promise<CodeExecutionResult>
}

/** Retries infrastructure-only runner errors; learner failures/timeouts are never retried as success. */
export async function executeWithRunnerRetry(
  runner: CodeRunner,
  request: CodeExecutionRequest,
  maxToolRetries: number,
): Promise<CodeExecutionResult & { tool_attempts: number }> {
  const retries = Number.isFinite(maxToolRetries)
    ? Math.max(0, Math.min(2, Math.trunc(maxToolRetries)))
    : 0
  let last: CodeExecutionResult | undefined
  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    last = await runner.execute(request)
    if (last.status !== "runner_error") return { ...last, tool_attempts: attempt }
  }
  return { ...last!, tool_attempts: retries + 1 }
}

/**
 * Trusted reference programs are generated backend fixtures, so a container
 * startup timeout is ambiguous infrastructure failure. Retry timeout/runner
 * errors only on this trust-plane path; learner timeouts remain final.
 */
export async function executeTrustedReferenceWithRetry(
  runner: CodeRunner,
  request: CodeExecutionRequest,
  maxToolRetries: number,
): Promise<CodeExecutionResult & { tool_attempts: number }> {
  const retries = Number.isFinite(maxToolRetries)
    ? Math.max(0, Math.min(2, Math.trunc(maxToolRetries)))
    : 0
  let last: CodeExecutionResult | undefined
  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    last = await runner.execute(request)
    if (last.status !== "runner_error" && last.status !== "timeout") {
      return { ...last, tool_attempts: attempt }
    }
  }
  return { ...last!, tool_attempts: retries + 1 }
}

export class CodeRunnerUnavailableError extends Error {
  constructor(message = "Docker CodeRunner 不可用，暂时无法对学习者代码给出可信判分") {
    super(message)
    this.name = "CodeRunnerUnavailableError"
  }
}

export interface DockerCleanupCommand {
  command: string
  args: string[]
}

export interface DockerCommandRequest {
  command: string
  args: string[]
  stdin: string
  timeout_ms: number
  max_output_bytes: number
  cleanup?: DockerCleanupCommand
}

export interface DockerCommandResult {
  exit_code: number | null
  stdout: string
  stderr: string
  timed_out: boolean
  output_truncated: boolean
}

/** Injectable Docker CLI process boundary; unit tests inspect it without executing learner code. */
export interface DockerCommandExecutor {
  run(request: DockerCommandRequest): Promise<DockerCommandResult>
}

export interface DockerPythonCodeRunnerOptions {
  docker_binary?: string
  image_id: string
  executor?: DockerCommandExecutor
  test_suite_resolver?: CodeTestSuiteResolver
  cpu_limit?: number
  pids_limit?: number
  tmpfs_mb?: number
}

export async function createDockerPythonCodeRunnerFromEnv(
  env: Record<string, string | undefined> = process.env,
  overrides: Pick<DockerPythonCodeRunnerOptions, "executor" | "test_suite_resolver"> = {},
): Promise<DockerPythonCodeRunner> {
  const dockerBinary = env.ROLE_C_DOCKER_BINARY?.trim() || "docker"
  validateDockerBinary(dockerBinary)
  const configuredImage = env.ROLE_C_DOCKER_IMAGE?.trim() || DEFAULT_ROLE_C_DOCKER_IMAGE
  const executor = overrides.executor ?? new BunDockerCommandExecutor()
  const inspection = await executor.run({
    command: dockerBinary,
    args: ["image", "inspect", configuredImage],
    stdin: "",
    timeout_ms: 10_000,
    max_output_bytes: 256_000,
  })
  if (inspection.timed_out || inspection.exit_code !== 0 || inspection.output_truncated) {
    const detail = compactDiagnostic(inspection.stderr)
    throw new CodeRunnerUnavailableError(
      `Docker runner 镜像不可用：${configuredImage}。请先运行 bun run docker:role-c:build${detail ? `（${detail}）` : ""}`,
    )
  }
  const image = parseRunnerImageInspection(inspection.stdout)
  if (image.label !== "1") {
    throw new CodeRunnerUnavailableError(
      `Docker 镜像 ${configuredImage} 缺少 ${ROLE_C_DOCKER_RUNNER_LABEL}=1 标签`,
    )
  }
  return new DockerPythonCodeRunner({
    docker_binary: dockerBinary,
    image_id: image.id,
    executor,
    test_suite_resolver: overrides.test_suite_resolver,
    cpu_limit: optionalBoundedNumber(env.ROLE_C_DOCKER_CPUS, 0.5, 0.1, 4, "ROLE_C_DOCKER_CPUS"),
    pids_limit: optionalBoundedInteger(env.ROLE_C_DOCKER_PIDS, 32, 8, 128, "ROLE_C_DOCKER_PIDS"),
    tmpfs_mb: optionalBoundedInteger(env.ROLE_C_DOCKER_TMPFS_MB, 16, 4, 256, "ROLE_C_DOCKER_TMPFS_MB"),
  })
}

/**
 * Executes Python only in the dedicated Role C Docker image, addressed by immutable image ID.
 * Every run is networkless, read-only, non-root, capability-free and resource bounded.
 */
export class DockerPythonCodeRunner implements CodeRunner {
  readonly runner_image_digest: string
  private readonly executor: DockerCommandExecutor
  private readonly dockerBinary: string
  private readonly cpuLimit: number
  private readonly pidsLimit: number
  private readonly tmpfsMb: number

  constructor(private readonly options: DockerPythonCodeRunnerOptions) {
    this.dockerBinary = options.docker_binary?.trim() || "docker"
    validateDockerBinary(this.dockerBinary)
    if (!IMAGE_ID_PATTERN.test(options.image_id)) {
      throw new CodeRunnerUnavailableError("Docker runner image_id 必须为不可变的 sha256:<64 hex>")
    }
    this.runner_image_digest = options.image_id
    this.cpuLimit = boundedNumber(options.cpu_limit ?? 0.5, 0.1, 4, "cpu_limit")
    this.pidsLimit = boundedInteger(options.pids_limit ?? 32, 8, 128, "pids_limit")
    this.tmpfsMb = boundedInteger(options.tmpfs_mb ?? 16, 4, 256, "tmpfs_mb")
    this.executor = options.executor ?? new BunDockerCommandExecutor()
  }

  async execute(request: CodeExecutionRequest): Promise<CodeExecutionResult> {
    const requestedTestCount = request.test_suite?.tests.length ?? 0
    if (request.language !== "python" || request.network_allowed !== false) {
      return runnerError(this.runner_image_digest, "invalid_runner_policy", requestedTestCount)
    }
    const suite = request.test_suite ?? await this.options.test_suite_resolver?.resolve(request.test_suite_id)
    if (!suite || suite.test_suite_id !== request.test_suite_id) {
      return runnerError(this.runner_image_digest, "test_suite_unavailable", requestedTestCount)
    }
    const totalTests = suite.tests.length
    if (suite.execution_contract.language !== "python") {
      return runnerError(this.runner_image_digest, "unsupported_language", totalTests)
    }
    if (suite.tests.length < 1 || suite.tests.length > MAX_HIDDEN_TESTS) {
      return runnerError(this.runner_image_digest, "invalid_test_count", totalTests)
    }

    const staticIssues = analyzePythonSource(request.code, suite.execution_contract)
    if (staticIssues.length > 0) {
      return {
        status: "failed",
        passed_tests: 0,
        total_tests: suite.tests.length,
        score_ratio: 0,
        failure_codes: staticIssues.map((entry) => `static:${entry.code}`),
        runner_image_digest: this.runner_image_digest,
      }
    }

    const timeoutMs = Math.min(request.timeout_ms, suite.execution_contract.resource_limits.timeout_ms)
    const memoryMb = Math.min(request.memory_mb, suite.execution_contract.resource_limits.memory_mb)
    const maxOutputBytes = Math.min(request.max_output_bytes, suite.execution_contract.resource_limits.max_output_bytes)
    if (!boundedResourceLimits(timeoutMs, memoryMb, maxOutputBytes)) {
      return runnerError(this.runner_image_digest, "invalid_resource_limits", totalTests)
    }

    const payload = JSON.stringify({
      code: request.code,
      execution_contract: suite.execution_contract,
      test_inputs: suite.tests.map((test) => test.input),
      max_output_bytes: maxOutputBytes,
      platform_allowed_imports: PLATFORM_PYTHON_IMPORT_ALLOWLIST,
    })
    if (Buffer.byteLength(payload, "utf8") > MAX_RUNNER_PAYLOAD_BYTES) {
      return runnerError(this.runner_image_digest, "runner_payload_too_large", totalTests)
    }

    const cpuSeconds = Math.max(1, Math.ceil(timeoutMs / 1000))
    const containerName = `role-c-python-${randomUUID()}`
    const args = [
      "run",
      "--rm",
      "--interactive",
      "--name", containerName,
      "--pull=never",
      "--network", "none",
      "--read-only",
      "--cap-drop", "ALL",
      "--security-opt", "no-new-privileges",
      "--pids-limit", String(this.pidsLimit),
      "--memory", `${memoryMb}m`,
      "--memory-swap", `${memoryMb}m`,
      "--cpus", String(this.cpuLimit),
      "--ulimit", `cpu=${cpuSeconds}:${cpuSeconds}`,
      "--ulimit", "nofile=64:64",
      "--tmpfs", `/tmp:rw,noexec,nosuid,nodev,size=${this.tmpfsMb}m`,
      "--user", "65534:65534",
      "--workdir", "/tmp",
      this.options.image_id,
    ]
    const result = await this.executor.run({
      command: this.dockerBinary,
      args,
      stdin: payload,
      timeout_ms: timeoutMs + 1_000,
      max_output_bytes: Math.min(
        MAX_RUNNER_PAYLOAD_BYTES,
        Math.max(64_000, maxOutputBytes + 16_000),
      ),
      cleanup: {
        command: this.dockerBinary,
        args: ["rm", "--force", containerName],
      },
    })
    if (result.timed_out) {
      return {
        status: "timeout",
        passed_tests: 0,
        total_tests: suite.tests.length,
        score_ratio: 0,
        failure_codes: ["execution_timeout"],
        runner_image_digest: this.runner_image_digest,
      }
    }
    if (result.exit_code !== 0 || result.output_truncated) {
      if ([124, 137, 143].includes(result.exit_code ?? -1)) {
        return {
          status: result.exit_code === 137 ? "failed" : "timeout",
          passed_tests: 0,
          total_tests: suite.tests.length,
          score_ratio: 0,
          failure_codes: [result.exit_code === 137 ? "resource_limit_exceeded" : "execution_timeout"],
          runner_image_digest: this.runner_image_digest,
        }
      }
      return runnerError(
        this.runner_image_digest,
        result.output_truncated ? "runner_output_truncated" : "docker_container_failed",
        totalTests,
      )
    }
    try {
      const parsed = JSON.parse(result.stdout.trim()) as unknown
      if (!isDockerHarnessResponse(parsed, suite.tests.length)) {
        return runnerError(this.runner_image_digest, "invalid_runner_response", totalTests)
      }
      return evaluateHarnessResults(parsed.results, suite.tests, this.runner_image_digest)
    } catch {
      return runnerError(this.runner_image_digest, "invalid_runner_json", totalTests)
    }
  }
}

export class BunDockerCommandExecutor implements DockerCommandExecutor {
  async run(request: DockerCommandRequest): Promise<DockerCommandResult> {
    let processHandle: ReturnType<typeof Bun.spawn>
    try {
      processHandle = Bun.spawn([request.command, ...request.args], {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        env: dockerCliEnvironment(),
      })
    } catch (error) {
      return {
        exit_code: null,
        stdout: "",
        stderr: error instanceof Error ? error.message : "docker command unavailable",
        timed_out: false,
        output_truncated: false,
      }
    }

    const stdin = processHandle.stdin
    const stdoutStream = processHandle.stdout
    const stderrStream = processHandle.stderr
    if (!stdin || typeof stdin === "number" || !stdoutStream || typeof stdoutStream === "number" || !stderrStream || typeof stderrStream === "number") {
      processHandle.kill()
      await this.cleanup(request.cleanup)
      return {
        exit_code: null,
        stdout: "",
        stderr: "docker command pipes unavailable",
        timed_out: false,
        output_truncated: false,
      }
    }

    stdin.write(request.stdin)
    stdin.end()
    let timedOut = false
    let outputTruncated = false
    let termination: Promise<void> | undefined
    const terminate = (): Promise<void> => {
      if (termination) return termination
      try {
        processHandle.kill()
      } catch {
        // Process already exited.
      }
      termination = this.cleanup(request.cleanup)
      return termination
    }
    const timer = setTimeout(() => {
      timedOut = true
      void terminate()
    }, request.timeout_ms)
    const budget = { remaining: request.max_output_bytes }
    const onLimit = () => {
      outputTruncated = true
      void terminate()
    }
    const [stdout, stderr, exitCode] = await Promise.all([
      readStreamWithSharedLimit(stdoutStream, budget, onLimit),
      readStreamWithSharedLimit(stderrStream, budget, onLimit),
      processHandle.exited,
    ])
    clearTimeout(timer)
    if (termination) await termination
    return {
      exit_code: exitCode,
      stdout,
      stderr,
      timed_out: timedOut,
      output_truncated: outputTruncated,
    }
  }

  private async cleanup(command: DockerCleanupCommand | undefined): Promise<void> {
    if (!command) return
    for (const delayMs of DOCKER_CLEANUP_RETRY_DELAYS_MS) {
      if (delayMs > 0) await wait(delayMs)
      if (await this.cleanupOnce(command) === 0) return
    }
  }

  private async cleanupOnce(
    command: DockerCleanupCommand,
  ): Promise<number | null> {
    let cleanupHandle: ReturnType<typeof Bun.spawn>
    try {
      cleanupHandle = Bun.spawn([command.command, ...command.args], {
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
        env: dockerCliEnvironment(),
      })
    } catch {
      return null
    }
    const timer = setTimeout(() => {
      try {
        cleanupHandle.kill()
      } catch {
        // Cleanup already exited.
      }
    }, 3_000)
    const exitCode = await cleanupHandle.exited
    clearTimeout(timer)
    return exitCode
  }
}

/**
 * Node-compatible Docker CLI boundary for server frameworks whose config
 * process does not expose Bun globals. It applies the same shared output
 * budget, timeout, environment allowlist, and forced container cleanup.
 */
export class NodeDockerCommandExecutor implements DockerCommandExecutor {
  async run(request: DockerCommandRequest): Promise<DockerCommandResult> {
    return new Promise((resolve) => {
      let processHandle: ReturnType<typeof spawnChildProcess>
      try {
        processHandle = spawnChildProcess(
          request.command,
          request.args,
          {
            stdio: ["pipe", "pipe", "pipe"],
            env: dockerCliEnvironment(),
          },
        )
      } catch (error) {
        resolve({
          exit_code: null,
          stdout: "",
          stderr: error instanceof Error
            ? error.message
            : "docker command unavailable",
          timed_out: false,
          output_truncated: false,
        })
        return
      }

      const stdoutChunks: Buffer[] = []
      const stderrChunks: Buffer[] = []
      let remaining = request.max_output_bytes
      let timedOut = false
      let outputTruncated = false
      let settled = false
      let termination: Promise<void> | undefined
      let timer: ReturnType<typeof setTimeout> | undefined

      const terminate = (): Promise<void> => {
        if (termination) return termination
        try {
          processHandle.kill("SIGKILL")
        } catch {
          // Process already exited.
        }
        termination = this.cleanup(request.cleanup)
        return termination
      }
      const append = (
        value: Buffer | string,
        destination: Buffer[],
      ): void => {
        const chunk = Buffer.isBuffer(value)
          ? value
          : Buffer.from(value)
        const accepted = Math.min(chunk.byteLength, Math.max(0, remaining))
        if (accepted > 0) {
          destination.push(Buffer.from(chunk.subarray(0, accepted)))
          remaining -= accepted
        }
        if (accepted < chunk.byteLength && !outputTruncated) {
          outputTruncated = true
          void terminate()
        }
      }
      const finish = async (
        exitCode: number | null,
        error?: Error,
      ): Promise<void> => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        if (termination) await termination
        const stderr = Buffer.concat(stderrChunks).toString("utf8")
        resolve({
          exit_code: exitCode,
          stdout: Buffer.concat(stdoutChunks).toString("utf8"),
          stderr: stderr || error?.message || "",
          timed_out: timedOut,
          output_truncated: outputTruncated,
        })
      }

      processHandle.stdout?.on("data", (chunk: Buffer | string) => {
        append(chunk, stdoutChunks)
      })
      processHandle.stderr?.on("data", (chunk: Buffer | string) => {
        append(chunk, stderrChunks)
      })
      processHandle.once("error", (error) => {
        void finish(null, error)
      })
      processHandle.once("close", (code) => {
        void finish(code)
      })
      processHandle.stdin?.on("error", () => {
        // A process may exit before consuming all input.
      })
      processHandle.stdin?.end(request.stdin)

      timer = setTimeout(() => {
        timedOut = true
        void terminate()
      }, request.timeout_ms)
    })
  }

  private async cleanup(
    command: DockerCleanupCommand | undefined,
  ): Promise<void> {
    if (!command) return
    for (const delayMs of DOCKER_CLEANUP_RETRY_DELAYS_MS) {
      if (delayMs > 0) await wait(delayMs)
      if (await this.cleanupOnce(command) === 0) return
    }
  }

  private cleanupOnce(
    command: DockerCleanupCommand,
  ): Promise<number | null> {
    return new Promise<number | null>((resolve) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const finish = (exitCode: number | null): void => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        resolve(exitCode)
      }
      let cleanupHandle: ReturnType<typeof spawnChildProcess>
      try {
        cleanupHandle = spawnChildProcess(
          command.command,
          command.args,
          {
            stdio: "ignore",
            env: dockerCliEnvironment(),
          },
        )
      } catch {
        resolve(null)
        return
      }
      cleanupHandle.once("error", () => finish(null))
      cleanupHandle.once("close", (code) => finish(code))
      timer = setTimeout(() => {
        try {
          cleanupHandle.kill("SIGKILL")
        } catch {
          // Cleanup already exited.
        }
        finish(null)
      }, 3_000)
    })
  }
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function readStreamWithSharedLimit(
  stream: ReadableStream<Uint8Array>,
  budget: { remaining: number },
  onLimit: () => void,
): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let text = ""
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    if (!value) continue
    const accepted = Math.min(value.byteLength, Math.max(0, budget.remaining))
    if (accepted > 0) {
      budget.remaining -= accepted
      text += decoder.decode(value.subarray(0, accepted), { stream: true })
    }
    if (accepted < value.byteLength) {
      onLimit()
      break
    }
  }
  text += decoder.decode()
  return text
}

function parseRunnerImageInspection(raw: string): { id: string; label?: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new CodeRunnerUnavailableError("Docker image inspect 返回了无效 JSON")
  }
  const image = Array.isArray(parsed) ? parsed[0] : undefined
  if (!image || typeof image !== "object") {
    throw new CodeRunnerUnavailableError("Docker image inspect 未返回镜像信息")
  }
  const record = image as {
    Id?: unknown
    Config?: { Labels?: Record<string, unknown> | null }
  }
  if (typeof record.Id !== "string" || !IMAGE_ID_PATTERN.test(record.Id)) {
    throw new CodeRunnerUnavailableError("Docker image inspect 未返回有效的不可变 image ID")
  }
  const label = record.Config?.Labels?.[ROLE_C_DOCKER_RUNNER_LABEL]
  return { id: record.Id, label: typeof label === "string" ? label : undefined }
}

interface DockerHarnessResult {
  outcome: "returned" | "static_policy" | "syntax_error" | "output_limit" | "non_json_output" | "runtime_error"
  actual?: unknown
  error_type?: string
}

interface DockerHarnessResponse {
  status: "completed"
  results: DockerHarnessResult[]
}

function isDockerHarnessResponse(value: unknown, expectedTests: number): value is DockerHarnessResponse {
  if (!value || typeof value !== "object") return false
  const response = value as Partial<DockerHarnessResponse>
  if (response.status !== "completed" || !Array.isArray(response.results) || response.results.length !== expectedTests) {
    return false
  }
  const outcomes = new Set<DockerHarnessResult["outcome"]>([
    "returned",
    "static_policy",
    "syntax_error",
    "output_limit",
    "non_json_output",
    "runtime_error",
  ])
  return response.results.every((entry) => {
    if (!entry || typeof entry !== "object") return false
    const result = entry as Partial<DockerHarnessResult>
    if (!outcomes.has(result.outcome as DockerHarnessResult["outcome"])) return false
    if (result.outcome === "returned") return Object.hasOwn(result, "actual")
    if (result.outcome === "runtime_error") {
      return typeof result.error_type === "string" && /^[A-Za-z][A-Za-z0-9_]{0,80}$/.test(result.error_type)
    }
    return true
  })
}

function evaluateHarnessResults(
  results: DockerHarnessResult[],
  tests: HiddenTest[],
  imageDigest: string,
): CodeExecutionResult {
  let passedTests = 0
  let passedWeight = 0
  const totalWeight = tests.reduce((sum, test) => sum + test.weight, 0)
  const failureCodes: string[] = []
  for (const [index, test] of tests.entries()) {
    const result = results[index]!
    if (result.outcome === "returned" && matchesExpected(result.actual, test.expected, test.comparison)) {
      passedTests += 1
      passedWeight += test.weight
      continue
    }
    const reason = result.outcome === "returned"
      // 附带 expected/actual 差异，让执行修复轮能定位是预期值算错还是实现写错。
      ? `assertion_failed:expected=${JSON.stringify(test.expected)}:actual=${JSON.stringify(result.actual)}`
      : result.outcome === "runtime_error"
        ? `runtime_${result.error_type}`
        : result.outcome
    failureCodes.push(`${test.test_id}:${reason}`)
  }
  const scoreRatio = totalWeight <= 0 ? 0 : Math.max(0, Math.min(1, passedWeight / totalWeight))
  return {
    status: passedTests === tests.length ? "passed" : "failed",
    passed_tests: passedTests,
    total_tests: tests.length,
    score_ratio: scoreRatio,
    failure_codes: failureCodes,
    runner_image_digest: imageDigest,
  }
}

function matchesExpected(actual: unknown, expected: unknown, comparison: HiddenTest["comparison"]): boolean {
  if (comparison.kind === "numeric") {
    if (typeof actual !== "number" || typeof expected !== "number") return false
    if (!Number.isFinite(actual) || !Number.isFinite(expected)) return false
    const tolerance = Math.max(
      comparison.abs_tolerance,
      Math.abs(expected) * comparison.rel_tolerance,
    )
    return Math.abs(actual - expected) <= tolerance
  }
  return isDeepStrictEqual(actual, expected)
}

function runnerError(digest: string, code: string, totalTests = 0): CodeExecutionResult {
  return {
    status: "runner_error",
    passed_tests: 0,
    total_tests: totalTests,
    score_ratio: 0,
    failure_codes: [code],
    runner_image_digest: digest,
  }
}

function boundedResourceLimits(timeoutMs: number, memoryMb: number, maxOutputBytes: number): boolean {
  return Number.isSafeInteger(timeoutMs) && timeoutMs >= 100 && timeoutMs <= 5_000 &&
    Number.isSafeInteger(memoryMb) && memoryMb >= 32 && memoryMb <= 512 &&
    Number.isSafeInteger(maxOutputBytes) && maxOutputBytes >= 256 && maxOutputBytes <= 100_000
}

function optionalBoundedNumber(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  if (value === undefined || value.trim() === "") return fallback
  return boundedNumber(Number(value), minimum, maximum, name)
}

function optionalBoundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  if (value === undefined || value.trim() === "") return fallback
  return boundedInteger(Number(value), minimum, maximum, name)
}

function boundedNumber(value: number, minimum: number, maximum: number, name: string): number {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new CodeRunnerUnavailableError(`${name} 必须在 ${minimum} 到 ${maximum} 之间`)
  }
  return value
}

function boundedInteger(value: number, minimum: number, maximum: number, name: string): number {
  const parsed = boundedNumber(value, minimum, maximum, name)
  if (!Number.isSafeInteger(parsed)) throw new CodeRunnerUnavailableError(`${name} 必须为整数`)
  return parsed
}

function validateDockerBinary(value: string): void {
  const binary = value.split("/").at(-1)
  if (binary !== "docker") {
    throw new CodeRunnerUnavailableError("ROLE_C_DOCKER_BINARY 必须指向 docker 命令")
  }
}

function dockerCliEnvironment(): Record<string, string> {
  const env: Record<string, string> = { PATH: process.env.PATH ?? "" }
  for (const name of ["HOME", "DOCKER_CONFIG", "DOCKER_CONTEXT", "DOCKER_HOST", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"] as const) {
    const value = process.env[name]
    if (value !== undefined) env[name] = value
  }
  return env
}

function compactDiagnostic(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 240)
}
