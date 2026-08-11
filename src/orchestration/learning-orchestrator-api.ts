import { readFileSync } from "node:fs"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

async function checkDockerImage(): Promise<{ ready: boolean; digest?: string; error?: string }> {
  if (!Bun.which("docker")) {
    return { ready: false, error: "未找到 Docker。请安装 Docker Desktop：https://www.docker.com/products/docker-desktop/" }
  }
  // 真实连通性测试：检查 Docker 引擎是否在运行
  const proc = Bun.spawn(["docker", "info"], { stdout: "pipe", stderr: "pipe" })
  const timer = setTimeout(() => proc.kill(), 8000)
  const exitCode = await proc.exited
  clearTimeout(timer)
  const stderr = await new Response(proc.stderr).text()
  if (exitCode !== 0 || stderr.includes("daemon is not running")) {
    return { ready: false, error: "Docker 引擎未运行。请从开始菜单启动 Docker Desktop 并等待鲸鱼图标变绿。" }
  }
  // 检查镜像是否存在
  const image = process.env.ROLE_C_DOCKER_IMAGE?.trim() || "knowbalance-role-c-python-runner:1.0.0"
  try {
    const inspect = Bun.spawn(["docker", "image", "inspect", image], { stdout: "pipe", stderr: "pipe" })
    const timer2 = setTimeout(() => inspect.kill(), 10000)
    const ec = await inspect.exited
    clearTimeout(timer2)
    if (ec !== 0) {
      // 自动构建镜像
      const build = Bun.spawn(["docker", "build", "-t", image, "-f", "docker/role-c-python-runner/Dockerfile", "docker/role-c-python-runner/"], {
        stdout: "pipe", stderr: "pipe", cwd: process.cwd(),
      })
      const timer3 = setTimeout(() => build.kill(), 120000)
      const buildEc = await build.exited
      clearTimeout(timer3)
      if (buildEc !== 0) {
        const buildErr = await new Response(build.stderr).text()
        return { ready: false, error: `Docker 镜像构建失败。请在终端运行 bun run docker:role-c:build：${buildErr.slice(0, 200)}` }
      }
    }
    return { ready: true, digest: "docker-ready" }
  } catch {
    return { ready: false, error: "Docker 镜像检查失败，请确认 Docker Desktop 已启动" }
  }
}

let cachedDockerStatus: { ready: boolean; digest?: string; error?: string } | null = null

async function getDockerStatus(): Promise<{ ready: boolean; digest?: string; error?: string }> {
  if (cachedDockerStatus) return cachedDockerStatus
  cachedDockerStatus = await checkDockerImage()
  return cachedDockerStatus
}
import { protectSensitivePath } from "../security/windows-secure-acl"
import { runLearningOrchestrator } from "./learning-orchestrator-runner"
import {
  InteractiveSessionError,
  InteractiveSessionStore,
  publicSessionView,
  type InteractiveSessionRecord,
} from "./interactive-session"
import { validateOrchestratorApiBody, type RunRequestBody, type SessionRequestBody } from "./orchestrator-api-schema"

interface ErrorBody {
  error: {
    code: string
    message: string
    details?: string[]
  }
}

interface LocalProviderConfiguration {
  provider_mode: "model"
  endpoint: string
  model_id: string
  api_key: string
}

export interface LearningOrchestratorApiOptions {
  data_root?: string
  provider_config_path?: string
  provider_environment?: Record<string, string | undefined>
  server_hostname?: string
}

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
}

export function createLearningOrchestratorApiHandler(
  options: LearningOrchestratorApiOptions = {},
): (request: Request) => Promise<Response> {
  const dataRoot = options.data_root ?? join(process.cwd(), ".tmp", "orchestrator")
  const providerConfigPath = options.provider_config_path ?? join(dataRoot, "provider-config.json")
  const providerEnvironment = options.provider_environment ?? process.env
  const providerWritesEnabled = isLoopbackHostname(options.server_hostname ?? "127.0.0.1")
    || isPrivateNetworkHostname(options.server_hostname ?? "127.0.0.1")
  hydrateProviderEnvironmentFromDisk(providerConfigPath, providerEnvironment)
  const sessions = new InteractiveSessionStore(dataRoot)

  return async function handle(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url)

      if (request.method === "GET" && url.pathname === "/health") {
        const docker = await getDockerStatus()
        return jsonResponse({
          status: "ok",
          service: "learning-orchestrator",
          docker,
          endpoints: [
            "GET /health",
            "GET /orchestrator/docker-setup",
            "GET /orchestrator/provider-config",
            "PUT /orchestrator/provider-config",
            "POST /orchestrator/runs",
            "POST /orchestrator/sessions",
            "GET /orchestrator/sessions/:id",
            "POST /orchestrator/sessions/:id/repair",
            "POST /orchestrator/sessions/:id/commands",
            "GET /orchestrator/sessions/:id/events",
          ],
        })
      }

      // Docker 一键自动配置：检测→启动→构建镜像
      if (request.method === "GET" && url.pathname === "/orchestrator/docker-setup") {
        const steps: string[] = []
        if (!Bun.which("docker")) {
          return jsonResponse({ ready: false, steps: ["Docker 未安装"], error: "请安装 Docker Desktop：https://www.docker.com/products/docker-desktop/" })
        }
        steps.push("找到 Docker 二进制")
        // 尝试启动 Docker Desktop
        const proc = Bun.spawn(["docker", "info"], { stdout: "pipe", stderr: "pipe" })
        const timer = setTimeout(() => proc.kill(), 5000)
        const exitCode = await proc.exited
        clearTimeout(timer)
        if (exitCode !== 0) {
          // 尝试启动 Docker Desktop
          steps.push("Docker 引擎未运行，尝试启动…")
          try {
            const ps = Bun.spawn(["powershell", "-Command", "Start-Process 'Docker Desktop' -WindowStyle Hidden"], { stdout: "pipe", stderr: "pipe" })
            await ps.exited
            steps.push("已发送启动指令，等待引擎就绪…")
            // 等待最多 30 秒
            for (let i = 0; i < 30; i++) {
              await new Promise(r => setTimeout(r, 2000))
              const check = Bun.spawn(["docker", "info"], { stdout: "pipe", stderr: "pipe" })
              const ct = setTimeout(() => check.kill(), 3000)
              const ec = await check.exited
              clearTimeout(ct)
              if (ec === 0) { steps.push(`引擎就绪（${(i+1)*2}秒）`); break }
            }
          } catch { steps.push("无法自动启动 Docker Desktop") }
        }
        // 重新检查状态
        const finalCheck = Bun.spawn(["docker", "info"], { stdout: "pipe", stderr: "pipe" })
        const ft = setTimeout(() => finalCheck.kill(), 5000)
        const fec = await finalCheck.exited
        clearTimeout(ft)
        if (fec !== 0) {
          return jsonResponse({ ready: false, steps, error: "Docker 引擎未能启动。请手动从开始菜单打开 Docker Desktop，等待鲸鱼图标变绿后重试。" })
        }
        steps.push("Docker 引擎已运行")
        // 构建镜像
        const image = process.env.ROLE_C_DOCKER_IMAGE?.trim() || "knowbalance-role-c-python-runner:1.0.0"
        const inspect = Bun.spawn(["docker", "image", "inspect", image], { stdout: "pipe", stderr: "pipe" })
        const it = setTimeout(() => inspect.kill(), 8000)
        const iec = await inspect.exited
        clearTimeout(it)
        if (iec !== 0) {
          steps.push("正在构建代码沙箱镜像…")
          const build = Bun.spawn(["docker", "build", "-t", image, "-f", "docker/role-c-python-runner/Dockerfile", "docker/role-c-python-runner/"], {
            stdout: "pipe", stderr: "pipe", cwd: process.cwd(),
          })
          const bt = setTimeout(() => build.kill(), 120000)
          const bec = await build.exited
          clearTimeout(bt)
          if (bec !== 0) {
            const buildErr = await new Response(build.stderr).text()
            return jsonResponse({ ready: false, steps, error: `镜像构建失败：${buildErr.slice(0, 200)}` })
          }
          steps.push("镜像构建完成")
        }
        // 刷新缓存
        cachedDockerStatus = { ready: true, digest: "docker-setup-ok" }
        return jsonResponse({ ready: true, steps, digest: "setup-complete" })
      }

      if (url.pathname === "/orchestrator/provider-config") {
        requireLoopback(request)
        if (request.method === "GET") {
          const config = await readProviderConfiguration(providerConfigPath, providerEnvironment)
          return jsonResponse(providerPublicView(config))
        }
        if (request.method === "PUT") {
          if (!providerWritesEnabled) {
            throw new InteractiveSessionError("LOCAL_CONFIGURATION_ONLY", "Provider configuration writes are disabled when the server is not bound to loopback", 403)
          }
          requireLoopbackOrigin(request)
          const body = await parseJson<Record<string, unknown>>(request)
          const config = validateProviderConfiguration(body)
          await saveProviderConfiguration(providerConfigPath, config)
          applyProviderConfiguration(config, providerEnvironment)
          return jsonResponse(providerPublicView(config))
        }
      }

      if (request.method === "POST" && url.pathname === "/orchestrator/runs") {
        const principal = requirePrincipal(request)
        const body = await parseJson<RunRequestBody>(request)
        const validation = validateOrchestratorApiBody("run", body)
        if (!validation.ok) {
          return errorResponse(400, "INVALID_ORCHESTRATOR_REQUEST", "Invalid learning orchestrator request", validation.errors)
        }

        if (validation.value.learner_request!.learner_id !== principal) {
          throw new InteractiveSessionError("LEARNER_IDENTITY_MISMATCH", "Authenticated learner does not match learner_request", 403)
        }

        const result = await runLearningOrchestrator({
          root_dir: dataRoot,
          run_id: validation.value.run_id,
          session_id: validation.value.session_id,
          mode: validation.value.mode!,
          learner_request: validation.value.learner_request!,
        })

        return jsonResponse({
          run_id: result.summary.run_id,
          session_id: result.summary.session_id,
          mode: result.summary.mode,
          status: result.summary.status,
          completed_steps: result.summary.completed_steps,
          total_steps: result.summary.total_steps,
          blocked_stage: result.summary.blocked_stage,
          failed_stage: result.summary.failed_stage,
          summary_json: result.ledger.summary_json_path,
          summary_md: result.ledger.summary_md_path,
          latest_json: result.ledger.latest_json_path,
          latest_md: result.ledger.latest_md_path,
        })
      }

      if (request.method === "POST" && url.pathname === "/orchestrator/sessions") {
        const principal = requirePrincipal(request)
        const body = await parseJson<SessionRequestBody>(request)
        const validation = validateOrchestratorApiBody("session", body)
        if (!validation.ok) {
          return errorResponse(400, "INVALID_SESSION_REQUEST", "Invalid learning orchestrator session request", validation.errors)
        }
        if (validation.value.learner_request!.learner_id !== principal) {
          throw new InteractiveSessionError("LEARNER_IDENTITY_MISMATCH", "Authenticated learner does not match learner_request", 403)
        }
        const record = await sessions.create({
          session_id: validation.value.session_id,
          run_id: validation.value.run_id,
          mode: validation.value.mode!,
          learner_request: validation.value.learner_request!,
          owner_id: principal,
        })
        return jsonResponse(publicSessionView(record), 201)
      }

      const sessionMatch = url.pathname.match(/^\/orchestrator\/sessions\/([A-Za-z0-9_-]+)$/)
      if (request.method === "GET" && sessionMatch) {
        // GET 保持纯只读：旧会话迁移是显式写操作，由 POST /repair 端点触发，
        // 避免前端轮询 GET 时静默替换学习者正在作答的测评内容。
        const record = await sessions.load(sessionMatch[1]!)
        assertOwner(record, requirePrincipal(request))
        return jsonResponse(publicSessionView(record))
      }

      const repairMatch = url.pathname.match(/^\/orchestrator\/sessions\/([A-Za-z0-9_-]+)\/repair$/)
      if (request.method === "POST" && repairMatch) {
        // 显式旧会话迁移入口：检测到 short_answer 或学习资源目标漂移时，
        // 按当前节点后台重新生成整套内容（幂等：无迁移需要时原样返回）。
        const record = await sessions.load(repairMatch[1]!)
        assertOwner(record, requirePrincipal(request))
        return jsonResponse(await sessions.repairLegacyAssessment(repairMatch[1]!))
      }

      const eventsMatch = url.pathname.match(/^\/orchestrator\/sessions\/([A-Za-z0-9_-]+)\/events$/)
      if (request.method === "GET" && eventsMatch) {
        const record = await sessions.load(eventsMatch[1]!)
        assertOwner(record, requirePrincipal(request))
        return jsonResponse({ session_id: record.session_id, events: record.events })
      }

      const commandMatch = url.pathname.match(/^\/orchestrator\/sessions\/([A-Za-z0-9_-]+)\/commands$/)
      if (request.method === "POST" && commandMatch) {
        const record = await sessions.load(commandMatch[1]!)
        assertOwner(record, requirePrincipal(request))
        const body = await parseJson<import("./interactive-session").InteractiveSessionCommand>(request)
        const validation = validateOrchestratorApiBody("command", body)
        if (!validation.ok) {
          return errorResponse(400, "INVALID_COMMAND", "Invalid learning orchestrator command", validation.errors)
        }
        return jsonResponse(await sessions.command(commandMatch[1]!, validation.value))
      }

      return errorResponse(404, "NOT_FOUND", `No learning-orchestrator route for ${request.method} ${url.pathname}`)
    } catch (error) {
      if (error instanceof InteractiveSessionError) {
        return errorResponse(error.http_status, error.code, error.message, error.details)
      }
      if (error instanceof SyntaxError) {
        return errorResponse(400, "INVALID_JSON", "Request body must be valid JSON")
      }
      return errorResponse(500, "ORCHESTRATOR_INTERNAL_ERROR", error instanceof Error ? error.message : "Unexpected orchestrator error")
    }
  }
}

export const handleLearningOrchestratorApiRequest = createLearningOrchestratorApiHandler()

export function startLearningOrchestratorApiServer(
  options: { port?: number; hostname?: string; data_root?: string; provider_config_path?: string } = {},
): ReturnType<typeof Bun.serve> {
  return Bun.serve({
    port: options.port ?? 8787,
    hostname: options.hostname ?? "127.0.0.1",
    fetch: createLearningOrchestratorApiHandler({
      data_root: options.data_root,
      provider_config_path: options.provider_config_path,
      server_hostname: options.hostname ?? "127.0.0.1",
    }),
  })
}

function requireLoopback(request: Request): void {
  const hostname = new URL(request.url).hostname.toLowerCase()
  if (!isLoopbackHostname(hostname)) {
    throw new InteractiveSessionError("LOCAL_CONFIGURATION_ONLY", "Provider configuration is available only on this machine", 403)
  }
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase()
  return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1" || normalized === "[::1]"
}

function isPrivateNetworkHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase()
  return /^(?:10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}$/.test(normalized)
}

function requireLoopbackOrigin(request: Request): void {
  const origin = request.headers.get("origin")
  if (!origin) return
  let parsed: URL
  try { parsed = new URL(origin) } catch {
    throw new InteractiveSessionError("LOCAL_CONFIGURATION_ONLY", "Provider configuration origin must be a loopback or private HTTP origin", 403)
  }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || (!isLoopbackHostname(parsed.hostname) && !isPrivateNetworkHostname(parsed.hostname))) {
    throw new InteractiveSessionError("LOCAL_CONFIGURATION_ONLY", "Provider configuration origin must be a loopback or private HTTP origin", 403)
  }
}

async function readProviderConfiguration(path: string, environment: Record<string, string | undefined>): Promise<LocalProviderConfiguration | null> {
  try {
    return JSON.parse(stripJsonBom(await readFile(path, "utf8"))) as LocalProviderConfiguration
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    const endpoint = environment.ROLE_C_MODEL_ENDPOINT?.trim()
    const modelId = environment.ROLE_C_MODEL_ID?.trim()
    const apiKey = environment.ROLE_C_MODEL_API_KEY?.trim()
    return endpoint && modelId && apiKey ? { provider_mode: "model", endpoint, model_id: modelId, api_key: apiKey } : null
  }
}

function hydrateProviderEnvironmentFromDisk(
  path: string,
  environment: Record<string, string | undefined>,
): void {
  try {
    const config = JSON.parse(stripJsonBom(readFileSync(path, "utf8"))) as Partial<LocalProviderConfiguration>
    if (config.provider_mode === "model" && config.endpoint && config.model_id && config.api_key) {
      applyProviderConfiguration(config as LocalProviderConfiguration, environment)
    }
  } catch {
    // Missing or malformed local provider config is surfaced by the normal provider error path.
  }
}

function validateProviderConfiguration(body: Record<string, unknown>): LocalProviderConfiguration {
  const endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : ""
  const modelId = typeof body.model_id === "string" ? body.model_id.trim() : ""
  const apiKey = typeof body.api_key === "string" ? body.api_key.trim() : ""
  if (!endpoint || !modelId || !apiKey) throw new InteractiveSessionError("INVALID_PROVIDER_CONFIGURATION", "endpoint, model_id and api_key are required", 400)
  let parsed: URL
  try { parsed = new URL(endpoint) } catch { throw new InteractiveSessionError("INVALID_PROVIDER_CONFIGURATION", "endpoint must be an absolute http(s) URL", 400) }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new InteractiveSessionError("INVALID_PROVIDER_CONFIGURATION", "endpoint must use http or https", 400)
  return { provider_mode: "model", endpoint, model_id: modelId, api_key: apiKey }
}

async function saveProviderConfiguration(path: string, config: LocalProviderConfiguration): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await protectSensitivePath(dirname(path), "directory")
  const temporary = `${path}.${crypto.randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
  await protectSensitivePath(temporary, "file")
  await rename(temporary, path)
  await protectSensitivePath(path, "file")
}

function applyProviderConfiguration(config: LocalProviderConfiguration, environment: Record<string, string | undefined>): void {
  environment.ROLE_C_PROVIDER_MODE = "model"
  environment.ROLE_C_MODEL_ENDPOINT = config.endpoint
  environment.ROLE_C_MODEL_ID = config.model_id
  environment.ROLE_C_MODEL_API_KEY = config.api_key
}

function providerPublicView(config: LocalProviderConfiguration | null) {
  return { configured: Boolean(config), provider_mode: "model", endpoint: config?.endpoint ?? "", model_id: config?.model_id ?? "" }
}

function stripJsonBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

function requirePrincipal(request: Request): string {
  const authorization = request.headers.get("authorization")
  const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]{1,120})$/)
  if (!match) throw new InteractiveSessionError("UNAUTHENTICATED", "A bearer learner identity is required", 401)
  return match[1]!
}

function assertOwner(record: InteractiveSessionRecord, principal: string): void {
  if (record.owner_id !== principal) throw new InteractiveSessionError("SESSION_FORBIDDEN", "Session belongs to another learner", 403)
}

const MAX_JSON_BODY_BYTES = 1_000_000

async function parseJson<T>(request: Request): Promise<T> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase()
  if (contentType !== "application/json") {
    throw new InteractiveSessionError("UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json", 415)
  }
  const declaredLength = Number(request.headers.get("content-length") ?? "0")
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BODY_BYTES) {
    throw new InteractiveSessionError("PAYLOAD_TOO_LARGE", "JSON request body is too large", 413)
  }
  const text = await request.text()
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BODY_BYTES) {
    throw new InteractiveSessionError("PAYLOAD_TOO_LARGE", "JSON request body is too large", 413)
  }
  let value: unknown
  try { value = JSON.parse(text) } catch { throw new SyntaxError("invalid JSON") }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InteractiveSessionError("INVALID_SESSION_REQUEST", "JSON request body must be an object", 400)
  }
  return value as T
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), { status, headers: JSON_HEADERS })
}

function errorResponse(status: number, code: string, message: string, details?: string[]): Response {
  const body: ErrorBody = { error: { code, message, details } }
  return jsonResponse(body, status)
}
