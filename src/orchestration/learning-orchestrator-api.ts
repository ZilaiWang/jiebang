import { readFileSync } from "node:fs"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"

async function checkDockerImage(buildMissing = false): Promise<{ ready: boolean; digest?: string; error?: string }> {
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
      if (!buildMissing) {
        return { ready: false, error: `Docker runner 镜像不存在：${image}。请先执行一键配置或 bun run docker:role-c:build` }
      }
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

async function getDockerStatus(): Promise<{ ready: boolean; digest?: string; error?: string }> {
  return checkDockerImage(false)
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
import { createRoleCModelGatewayFromEnv } from "../role-c-content/contracts/model-gateway"
import { deleteLearnerData } from "../privacy/learner-data-deletion"
import { modelCallPolicy, fastModelPolicy } from "../model-runtime"
import { roleCSchemaRegistryMetadata } from "../role-c-content/validators/runtime-schema-validator"
import { PathRegistryStore, type SessionPathSnapshot } from "./path-registry-store"
import { validatePathChangeBody, validatePathResumeBody, validateResumeDiagnosisAnswers } from "./path-api-schema"
import { evaluateResumeDiagnosis, type ResumeDiagnosisItem } from "./resume-diagnosis"
import { publicPathRegistry, type GoalPathRegistry } from "./path-registry"
import type { FormalLearningPath } from "../role-b-profile/teaching-audit/formal-path"
import type { LearningPathNode } from "../role-c-content/contracts/profile-adapter"

interface ErrorBody {
  error: {
    code: string
    message: string
    details?: string[]
  }
}

interface LocalProviderConfiguration {
  provider_mode: "model"
  provider?: "deepseek" | "glm" | "kimi" | "minimax"
  endpoint: string
  model_id: string
  api_key: string
}

export interface LearningOrchestratorApiOptions {
  data_root?: string
  provider_config_path?: string
  provider_environment?: Record<string, string | undefined>
  server_hostname?: string
  provider_probe?: (config: LocalProviderConfiguration, environment: Record<string, string | undefined>) => Promise<{ ok: boolean; model_id?: string; error?: string }>
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
  const sessions = new InteractiveSessionStore(dataRoot, {
    model_environment: providerEnvironment,
  })
  const paths = new PathRegistryStore(join(dataRoot, "paths"))

  return async function handle(request: Request): Promise<Response> {
    try {
      await sessions.ready()
      const url = new URL(request.url)

      if (request.method === "GET" && url.pathname === "/health") {
        return jsonResponse({
          status: "ok",
          service: "learning-orchestrator",
          contract_registry: roleCSchemaRegistryMetadata(),
          job_worker: sessions.jobWorkerStatus(),
          endpoints: [
            "GET /health",
            "POST /orchestrator/docker-setup",
            "GET /orchestrator/docker-status",
            "POST /orchestrator/preflight",
            "GET /orchestrator/provider-config",
            "PUT /orchestrator/provider-config",
            "DELETE /orchestrator/privacy/learner-data",
            "POST /orchestrator/runs",
            "POST /orchestrator/sessions",
            "GET /orchestrator/sessions/:id",
            "POST /orchestrator/sessions/:id/repair",
            "POST /orchestrator/sessions/:id/commands",
            "GET /orchestrator/sessions/:id/paths",
            "POST /orchestrator/sessions/:id/path/change-goal",
            "POST /orchestrator/sessions/:id/path/resume",
            "POST /orchestrator/sessions/:id/path/resume/diagnosis",
            "GET /orchestrator/sessions/:id/events/stream",
          ],
        })
      }

      if (request.method === "GET" && url.pathname === "/orchestrator/docker-status") {
        return jsonResponse({ status: "ok", docker: await getDockerStatus() })
      }

      if (request.method === "POST" && url.pathname === "/orchestrator/preflight") {
        requireLoopback(request)
        const [docker, storage, model] = await Promise.all([
          checkDockerImage(true),
          checkRuntimeStorage(dataRoot),
          checkModelRuntime(providerEnvironment),
        ])
        const worker = sessions.jobWorkerStatus()
        return jsonResponse({
          ready: docker.ready && worker.running && storage.ready && model.ready,
          checks: {
            contract_registry: roleCSchemaRegistryMetadata(),
            docker,
            storage,
            model,
            job_worker: worker,
            sse: { ready: true, endpoint: "/orchestrator/sessions/:id/events/stream" },
          },
        }, docker.ready && worker.running && storage.ready && model.ready ? 200 : 503)
      }

      // Docker 一键自动配置：检测→启动→构建镜像
      if (request.method === "POST" && url.pathname === "/orchestrator/docker-setup") {
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
          // 尝试启动 Docker Desktop（仅在确认没有实例运行时才启动，
          // 否则 Start-Process 会触发单实例重启，把已运行的引擎关掉再初始化）
          steps.push("Docker 引擎未运行，检查 Docker Desktop 进程…")
          let desktopAlreadyRunning = false
          try {
            const tl = Bun.spawn(["powershell", "-Command", "Get-Process 'Docker Desktop' -ErrorAction SilentlyContinue | Select-Object -First 1"], { stdout: "pipe", stderr: "pipe" })
            const tlt = setTimeout(() => tl.kill(), 5000)
            const tlOut = await tl.exited
            clearTimeout(tlt)
            const tlText = await new Response(tl.stdout).text()
            desktopAlreadyRunning = tlOut === 0 && tlText.trim().length > 0
          } catch { desktopAlreadyRunning = false }
          if (desktopAlreadyRunning) {
            steps.push("Docker Desktop 已在运行，仅等待引擎就绪（不重复启动，避免触发重启）")
          } else {
            try {
              const ps = Bun.spawn(["powershell", "-Command", "Start-Process 'Docker Desktop' -WindowStyle Hidden"], { stdout: "pipe", stderr: "pipe" })
              await ps.exited
              steps.push("已发送启动指令，等待引擎就绪…")
            } catch { steps.push("无法自动启动 Docker Desktop") }
          }
          // 等待最多 30 秒
          for (let i = 0; i < 30; i++) {
              await new Promise(r => setTimeout(r, 2000))
              const check = Bun.spawn(["docker", "info"], { stdout: "pipe", stderr: "pipe" })
              const ct = setTimeout(() => check.kill(), 3000)
              const ec = await check.exited
              clearTimeout(ct)
              if (ec === 0) {
                steps.push(`引擎就绪（${(i+1)*2}秒）`)
                // Docker Desktop 冷启动时引擎可能瞬时可用但 WSL2 后端尚未稳定，
                // 等待 6 秒稳定窗口后再次确认，避免把瞬时状态当成完成
                await new Promise(r => setTimeout(r, 6000))
                const confirm = Bun.spawn(["docker", "info"], { stdout: "pipe", stderr: "pipe" })
                const ct2 = setTimeout(() => confirm.kill(), 3000)
                const cec = await confirm.exited
                clearTimeout(ct2)
                if (cec === 0) { steps.push("稳定确认通过"); break }
                steps.push("引擎波动，继续等待…")
              }
            }
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
        // 实时检测模式下无需缓存刷新；下一次 /health 会自动反映最新状态
        return jsonResponse({ ready: true, steps, digest: "setup-complete" })
      }

      if (url.pathname === "/orchestrator/provider-config") {
        requireLoopback(request)
        if (request.method === "GET") {
          const config = await readProviderConfiguration(providerConfigPath, providerEnvironment)
          return jsonResponse(providerPublicView(config))
        }
        if (request.method === "PUT") {
          if (providerEnvironment.MODEL_CONFIG_READONLY?.trim().toLowerCase() === "true") {
            throw new InteractiveSessionError("MODEL_CONFIG_READONLY", "当前运行配置已锁定，不能在服务运行期间修改模型参数", 409)
          }
          if (!providerWritesEnabled) {
            throw new InteractiveSessionError("LOCAL_CONFIGURATION_ONLY", "Provider configuration writes are disabled when the server is not bound to loopback", 403)
          }
          requireLoopbackOrigin(request)
          const body = await parseJson<Record<string, unknown>>(request)
          const config = validateProviderConfiguration(body)
          const probe = options.provider_probe
            ? await options.provider_probe(config, providerEnvironment)
            : await probeProviderConfiguration(config)
          if (!probe.ok) {
            throw new InteractiveSessionError(
              "PROVIDER_PROBE_FAILED",
              probe.error ?? "模型配置验证失败，请检查模型、密钥和账户额度",
              502,
            )
          }
          await saveProviderConfiguration(providerConfigPath, config)
          applyProviderConfiguration(config, providerEnvironment)
          return jsonResponse(providerPublicView(config))
        }
      }

      if (request.method === "DELETE" && url.pathname === "/orchestrator/privacy/learner-data") {
        const principal = requirePrincipal(request)
        requireLoopback(request)
        return jsonResponse({ status: "deleted", ...await deleteLearnerData(dataRoot, principal) })
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
        const record = await sessions.createQueued({
          session_id: validation.value.session_id,
          run_id: validation.value.run_id,
          mode: validation.value.mode!,
          learner_request: validation.value.learner_request!,
          owner_id: principal,
          objective_temperature: (body as any).objective_temperature,
        })
        return jsonResponse(publicSessionView(record), 202)
      }

      const sessionMatch = url.pathname.match(/^\/orchestrator\/sessions\/([A-Za-z0-9_-]+)$/)
      if (request.method === "GET" && sessionMatch) {
        // GET 保持纯只读：旧会话迁移是显式写操作，由 POST /repair 端点触发，
        // 避免前端轮询 GET 时静默替换学习者正在作答的测评内容。
        const record = await sessions.load(sessionMatch[1]!)
        assertOwner(record, requirePrincipal(request))
        return jsonResponse(publicSessionView(record))
      }

      const pathsMatch = url.pathname.match(/^\/orchestrator\/sessions\/([A-Za-z0-9_-]+)\/paths$/)
      if (request.method === "GET" && pathsMatch) {
        const record = await sessions.load(pathsMatch[1]!)
        assertOwner(record, requirePrincipal(request))
        const learnerId = record.learner_request.learner_id ?? record.session_id
        await paths.ensureFromSession(learnerId, pathSnapshotFromSession(record))
        return jsonResponse({ learner_id: learnerId, registry: publicPathRegistry(await paths.load(learnerId)) })
      }

      const changeGoalMatch = url.pathname.match(/^\/orchestrator\/sessions\/([A-Za-z0-9_-]+)\/path\/change-goal$/)
      if (request.method === "POST" && changeGoalMatch) {
        const record = await sessions.load(changeGoalMatch[1]!)
        assertOwner(record, requirePrincipal(request))
        const body = await parseJson<unknown>(request)
        const validation = validatePathChangeBody(body)
        if (!validation.ok) return errorResponse(400, "INVALID_PATH_CHANGE", "Invalid path goal change", validation.errors)
        const learnerId = record.learner_request.learner_id ?? record.session_id
        const registry = await paths.ensureFromSession(learnerId, pathSnapshotFromSession(record))
        const changed = await paths.changeGoal(learnerId, validation.value)
        return jsonResponse({ learner_id: learnerId, registry: publicPathRegistry(changed), previous_path_id: registry.active_path.path_id })
      }

      const resumePathMatch = url.pathname.match(/^\/orchestrator\/sessions\/([A-Za-z0-9_-]+)\/path\/resume$/)
      if (request.method === "POST" && resumePathMatch) {
        const record = await sessions.load(resumePathMatch[1]!)
        assertOwner(record, requirePrincipal(request))
        const body = await parseJson<unknown>(request)
        const validation = validatePathResumeBody(body)
        if (!validation.ok) return errorResponse(400, "INVALID_PATH_RESUME", "Invalid path resume request", validation.errors)
        const learnerId = record.learner_request.learner_id ?? record.session_id
        await paths.ensureFromSession(learnerId, pathSnapshotFromSession(record))
        const pending = await paths.requestResume(learnerId, validation.value.path_id)
        const withDiagnosis = pending.pending_resume?.items?.length
          ? pending
          : await generateResumeDiagnosis(paths, pending, validation.value.path_id)
        return jsonResponse({ learner_id: learnerId, registry: publicPathRegistry(withDiagnosis), status: "short_diagnosis_required" }, 202)
      }

      const resumeDiagnosisAnswersMatch = url.pathname.match(/^\/orchestrator\/sessions\/([A-Za-z0-9_-]+)\/path\/resume\/diagnosis$/)
      if (request.method === "POST" && resumeDiagnosisAnswersMatch) {
        const record = await sessions.load(resumeDiagnosisAnswersMatch[1]!)
        assertOwner(record, requirePrincipal(request))
        const body = await parseJson<unknown>(request)
        const validation = validateResumeDiagnosisAnswers(body)
        if (!validation.ok) return errorResponse(400, "INVALID_RESUME_DIAGNOSIS", "Invalid resume diagnosis answers", validation.errors)
        const learnerId = record.learner_request.learner_id ?? record.session_id
        const registry = await paths.load(learnerId)
        const pending = registry.pending_resume
        if (!pending || pending.path_id !== validation.value.path_id || !pending.items || !pending.answer_key) {
          return errorResponse(409, "RESUME_DIAGNOSIS_NOT_READY", "恢复诊断尚未准备好，请先请求恢复路径")
        }
        const evaluation = evaluateResumeDiagnosis(pending.items as ResumeDiagnosisItem[], validation.value.answers, pending.answer_key)
        if (!evaluation.passed) {
          return jsonResponse({ learner_id: learnerId, status: "diagnosis_failed", evaluation, registry: publicPathRegistry(registry) }, 200)
        }
        const resumed = await paths.completeResume(learnerId, pending.path_id, evaluation.level)
        return jsonResponse({ learner_id: learnerId, status: "resumed", evaluation, registry: publicPathRegistry(resumed) })
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
        const afterSeq = Math.max(0, Number(url.searchParams.get("after_seq") ?? "0") || 0)
        return jsonResponse({
          session_id: record.session_id,
          next_seq: record.events.length,
          events: record.events.slice(afterSeq).map((entry, index) => ({
            seq: afterSeq + index + 1,
            ...entry,
          })),
        })
      }

      const streamMatch = url.pathname.match(/^\/orchestrator\/sessions\/([A-Za-z0-9_-]+)\/events\/stream$/)
      if (request.method === "GET" && streamMatch) {
        const sessionId = streamMatch[1]!
        const record = await sessions.load(sessionId)
        assertOwner(record, requirePrincipal(request))
        const headerCursor = Number(request.headers.get("last-event-id") ?? "0") || 0
        const queryCursor = Number(url.searchParams.get("after_seq") ?? "0") || 0
        return sessionEventStream(sessions, sessionId, Math.max(0, headerCursor, queryCursor), request.signal)
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
    // Normal user generation is detached into durable jobs. Preflight is an
    // explicit operator action and may legitimately wait for QUALITY probing.
    idleTimeout: 255,
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
    const effective = loadProviderEnvironment(environment)
    const endpoint = effective.ROLE_C_MODEL_ENDPOINT?.trim()
    const modelId = effective.ROLE_C_MODEL_ID?.trim()
    const apiKey = effective.ROLE_C_MODEL_API_KEY?.trim()
    return endpoint && modelId && apiKey
      ? { provider_mode: "model", provider: inferProvider(endpoint), endpoint, model_id: modelId, api_key: apiKey }
      : null
  }
}

function loadProviderEnvironment(environment: Record<string, string | undefined>): Record<string, string | undefined> {
  const merged: Record<string, string | undefined> = { ...environment }
  // 真实服务使用 process.env；注入的测试/嵌入环境必须保持隔离，不能
  // 被当前工作目录的本地密钥文件意外污染。
  if (environment !== process.env) return merged
  try {
    const content = readFileSync(resolve(process.cwd(), ".env.role-c.local"), "utf8")
    for (const line of content.split(/\r?\n/u)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) continue
      const separator = trimmed.indexOf("=")
      if (separator <= 0) continue
      const key = trimmed.slice(0, separator).trim()
      if (merged[key] === undefined) merged[key] = trimmed.slice(separator + 1).trim()
    }
  } catch { /* 配置文件不存在时继续使用进程环境 */ }
  return merged
}

function inferProvider(endpoint: string): LocalProviderConfiguration["provider"] {
  const lower = endpoint.toLocaleLowerCase()
  if (lower.includes("deepseek")) return "deepseek"
  if (lower.includes("bigmodel")) return "glm"
  if (lower.includes("moonshot")) return "kimi"
  if (lower.includes("minimax")) return "minimax"
  return undefined
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
  const provider = typeof body.provider === "string" ? body.provider.trim().toLowerCase() : undefined
  const endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : ""
  const modelId = typeof body.model_id === "string" ? body.model_id.trim() : ""
  const rawApiKey = typeof body.api_key === "string" ? body.api_key.trim() : ""
  // 用户常把请求头完整复制进输入框；只接受纯密钥，自动去掉一个
  // Bearer 前缀和包裹引号，避免最终发送成 "Bearer Bearer ..."。
  const apiKey = rawApiKey.replace(/^Bearer\s+/iu, "").replace(/^(?:"|')|(?:"|')$/gu, "").trim()
  if (!endpoint || !modelId || !apiKey) throw new InteractiveSessionError("INVALID_PROVIDER_CONFIGURATION", "接口地址、模型和 API Key 不能为空", 400)
  let parsed: URL
  try { parsed = new URL(endpoint) } catch { throw new InteractiveSessionError("INVALID_PROVIDER_CONFIGURATION", "endpoint must be an absolute http(s) URL", 400) }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new InteractiveSessionError("INVALID_PROVIDER_CONFIGURATION", "endpoint must use http or https", 400)
  if (provider && !["deepseek", "glm", "kimi", "minimax"].includes(provider)) {
    throw new InteractiveSessionError("INVALID_PROVIDER_CONFIGURATION", "provider 必须是 deepseek、glm、kimi 或 minimax", 400)
  }
  return { provider_mode: "model", ...(provider ? { provider: provider as LocalProviderConfiguration["provider"] } : {}), endpoint, model_id: modelId, api_key: apiKey }
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
  // MODEL_RUNTIME_* 在模型网关中优先级更高；切换供应商时必须同步，
  // 否则页面验证的是新模型而主 Agent 继续调用旧模型。
  environment.MODEL_RUNTIME_ENDPOINT = config.endpoint
  environment.MODEL_RUNTIME_MODEL_ID = config.model_id
  environment.MODEL_RUNTIME_API_KEY = config.api_key
}

async function probeProviderConfiguration(
  config: LocalProviderConfiguration,
): Promise<{ ok: boolean; model_id?: string; error?: string }> {
  try {
    const environment: Record<string, string | undefined> = {
      ROLE_C_MODEL_ENDPOINT: config.endpoint,
      ROLE_C_MODEL_ID: config.model_id,
      ROLE_C_MODEL_API_KEY: config.api_key,
      ROLE_C_MODEL_RESPONSE_FORMAT: "json_object",
      ROLE_C_MODEL_THINKING: "disabled",
      ROLE_C_MODEL_TIMEOUT_MS: "30000",
      ROLE_C_MODEL_MAX_RETRIES: "0",
      MODEL_RUNTIME_MAX_MODEL_CALLS: "1",
      // 探测使用 30 秒业务预算时，软/硬截止时间必须成对设置；
      // 否则软截止时间会回退到 600000，触发 hard < soft 的非法预算。
      MODEL_RUNTIME_JOB_SOFT_DEADLINE_MS: "30000",
      MODEL_RUNTIME_JOB_HARD_DEADLINE_MS: "30000",
    }
    const gateway = createRoleCModelGatewayFromEnv(environment)
    const value = await gateway.generateStructured<{ ok: true }>({
      task: "runtime.provider-config.probe",
      system_prompt: "只输出 JSON：{\"ok\":true}。不要输出其他内容。",
      input: { probe: "KnowBalance provider configuration" },
      output_schema_id: "provider_config_probe_v1",
      output_schema: {
        type: "object",
        additionalProperties: false,
        required: ["ok"],
        properties: { ok: { type: "boolean", const: true } },
      },
      temperature: 0,
      max_tokens: 32,
      idempotency_key: `provider-config-probe-${crypto.randomUUID()}`,
      policy: fastModelPolicy("PROVIDER_CONFIGURATION_PROBE", 32, {
        timeout_ms: 30000,
        max_transport_retries: 0,
        response_format: "json_object",
      }),
    })
    return value.ok === true
      ? { ok: true, model_id: gateway.model_id }
      : { ok: false, error: "模型返回内容不符合验证格式" }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message.slice(0, 500) : "模型连通性验证失败" }
  }
}

function providerPublicView(config: LocalProviderConfiguration | null) {
  return { configured: Boolean(config), provider_mode: "model", provider: config?.provider ?? "", endpoint: config?.endpoint ?? "", model_id: config?.model_id ?? "" }
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

async function checkRuntimeStorage(dataRoot: string): Promise<{ ready: boolean; error?: string }> {
  const directories = [
    join(dataRoot, "sessions"),
    join(dataRoot, "jobs"),
    join(dataRoot, "role-c", "generation-checkpoints"),
    join(dataRoot, "role-c", "secure-artifacts"),
  ]
  try {
    await Promise.all(directories.map(async (directory) => {
      await mkdir(directory, { recursive: true, mode: 0o700 })
      const probe = join(directory, `.preflight-${process.pid}-${crypto.randomUUID()}`)
      await writeFile(probe, "ok", { encoding: "utf8", mode: 0o600 })
      await rm(probe, { force: true })
    }))
    return { ready: true }
  } catch (error) {
    return { ready: false, error: error instanceof Error ? error.message.slice(0, 300) : "运行目录不可写" }
  }
}

async function checkModelRuntime(
  environment: Record<string, string | undefined>,
): Promise<{
  ready: boolean
  model_id?: string
  fast?: { ready: boolean; duration_ms: number }
  quality?: { ready: boolean; duration_ms: number }
  concurrency_3?: { ready: boolean; duration_ms: number }
  structured_output?: {
    active_format: "json_object"
    json_object: true
    json_schema: boolean
    json_schema_error?: string
  }
  error?: string
}> {
  try {
    const gateway = createRoleCModelGatewayFromEnv(environment)
    // 供应商由本机 provider-config 决定；预检不能再写死某一个模型。
    // DeepSeek、GLM、Kimi、MiniMax 都通过同一 OpenAI 兼容协议探测。
    const schema = {
      type: "object",
      additionalProperties: false,
      required: ["ok"],
      properties: { ok: { type: "boolean", const: true } },
    }
    const call = async (
      profile: "fast" | "quality",
      suffix: string,
      responseFormat: "json_object" | "json_schema" = "json_object",
    ) => {
      const started = performance.now()
      const maxTokens = profile === "quality" ? 4_096 : 512
      const value = await gateway.generateStructured<{ ok: true }>({
        task: `runtime.preflight.${profile}.${suffix}`,
        system_prompt: "仅输出符合 Schema 的 JSON：{\"ok\":true}。",
        input: { check: suffix },
        output_schema_id: "runtime_preflight_v1",
        output_schema: schema,
        temperature: 0,
        max_tokens: maxTokens,
        idempotency_key: `preflight-${profile}-${suffix}-${Date.now()}`,
        policy: modelCallPolicy(profile, {
          reason_codes: ["PREFLIGHT"],
          max_tokens: maxTokens,
          timeout_ms: profile === "quality" ? 180_000 : 60_000,
          max_transport_retries: 0,
          response_format: responseFormat,
        }),
      })
      if (value.ok !== true) throw new Error("PREFLIGHT_RESPONSE_INVALID")
      return Math.round(performance.now() - started)
    }
    const fastDuration = await call("fast", "structured")
    let jsonSchema = true
    let jsonSchemaError: string | undefined
    try {
      await call("fast", "json-schema-capability", "json_schema")
    } catch (error) {
      jsonSchema = false
      jsonSchemaError = error instanceof Error ? error.message.slice(0, 300) : "json_schema 探测失败"
    }
    const qualityDuration = await call("quality", "reasoning_effort_high")
    const concurrentStarted = performance.now()
    await Promise.all([0, 1, 2].map((index) => call("fast", `concurrency-${index}`)))
    return {
      ready: true,
      model_id: gateway.model_id,
      fast: { ready: true, duration_ms: fastDuration },
      quality: { ready: true, duration_ms: qualityDuration },
      concurrency_3: { ready: true, duration_ms: Math.round(performance.now() - concurrentStarted) },
      structured_output: {
        active_format: "json_object",
        json_object: true,
        json_schema: jsonSchema,
        ...(jsonSchemaError ? { json_schema_error: jsonSchemaError } : {}),
      },
    }
  } catch (error) {
    return {
      ready: false,
      error: error instanceof Error ? error.message.slice(0, 500) : "模型运行时预检失败",
    }
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), { status, headers: JSON_HEADERS })
}

function sessionEventStream(
  sessions: InteractiveSessionStore,
  sessionId: string,
  initialCursor: number,
  signal: AbortSignal,
): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let cursor = initialCursor
      let lastRevision = -1
      let lastHeartbeat = 0
      const deadline = Date.now() + 30_000
      try {
        while (!signal.aborted && Date.now() < deadline) {
          const record = await sessions.load(sessionId)
          const events = record.events.slice(cursor)
          for (const entry of events) {
            cursor += 1
            controller.enqueue(encoder.encode(
              `id: ${cursor}\nevent: workflow\ndata: ${JSON.stringify({ seq: cursor, ...entry })}\n\n`,
            ))
          }
          if (record.revision !== lastRevision || events.length > 0) {
            lastRevision = record.revision
            controller.enqueue(encoder.encode(
              `event: session_state\ndata: ${JSON.stringify({
                session_id: record.session_id,
                revision: record.revision,
                status: record.status,
                current_stage: record.current_stage,
                next_seq: cursor,
              })}\n\n`,
            ))
          }
          if (Date.now() - lastHeartbeat >= 5_000) {
            lastHeartbeat = Date.now()
            controller.enqueue(encoder.encode(`: heartbeat ${lastHeartbeat}\n\n`))
          }
          if (record.status !== "running") break
          await Bun.sleep(400)
        }
        controller.close()
      } catch (error) {
        if (!signal.aborted) controller.error(error)
        else controller.close()
      }
    },
  })
  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  })
}

function errorResponse(status: number, code: string, message: string, details?: string[]): Response {
  const body: ErrorBody = { error: { code, message, details } }
  return jsonResponse(body, status)
}

function pathSnapshotFromSession(record: InteractiveSessionRecord): SessionPathSnapshot {
  const path = record.formal_path as FormalLearningPath | null
  const node = record.current_path_node as LearningPathNode | null
  const profile = record.profile as { level?: SessionPathSnapshot["level"]; goal_profile?: SessionPathSnapshot["goal_profile"] } | null
  if (!path || !node || !record.learner_request.goal) {
    throw new InteractiveSessionError("PATH_NOT_READY", "Session has no executable learning path", 409)
  }
  return {
    path_id: path.path_id,
    goal_profile: profile?.goal_profile ?? record.learner_request.goal_profile ?? "general_learning",
    goal: record.learner_request.goal,
    level: profile?.level ?? "beginner",
    current_node_id: node.node_id,
    objective_source_ids: [...node.target_source_ids],
  }
}

async function generateResumeDiagnosis(
  paths: PathRegistryStore,
  registry: GoalPathRegistry,
  pathId: string,
): Promise<GoalPathRegistry> {
  const paused = registry.paths.find((path) => path.path_id === pathId)
  if (!paused) throw new InteractiveSessionError("PATH_NOT_FOUND", "Path does not exist", 404)
  const sourceIds = (paused.objective_source_ids ?? []).slice(0, 3)
  const items: ResumeDiagnosisItem[] = sourceIds.map((sourceId, index) => ({
    item_id: `RESUME-${pathId}-${index + 1}`,
    objective_id: sourceId,
    source_id: sourceId,
    question: `恢复前短诊断：你还记得“${sourceId}”的基本用法吗？`,
    options: ["记得", "不太确定"],
    answer: "记得",
  }))
  const answerKey = Object.fromEntries(items.map((item) => [item.item_id, item.answer!]))
  return paths.saveResumeDiagnosis(registry.learner_id, pathId, items.map((item) => ({
    item_id: item.item_id,
    objective_id: item.objective_id,
    source_id: item.source_id ?? item.objective_id,
    question: item.question,
    options: [...item.options],
  })), answerKey)
}
