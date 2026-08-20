import { startLearningOrchestratorApiServer } from "../src/orchestration/learning-orchestrator-api"

const portArg = Bun.argv.find((arg) => arg.startsWith("--port="))
const hostArg = Bun.argv.find((arg) => arg.startsWith("--host="))
const dataRootArg = Bun.argv.find((arg) => arg.startsWith("--data-root="))
const port = portArg ? Number(portArg.split("=", 2)[1]) : 8787
const hostname = hostArg ? hostArg.split("=", 2)[1] : "127.0.0.1"
const dataRoot = dataRootArg ? dataRootArg.slice("--data-root=".length) : undefined

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error(`Invalid --port=${portArg?.split("=", 2)[1]}`)
}

const server = startLearningOrchestratorApiServer({ port, hostname, data_root: dataRoot })
console.log(JSON.stringify({
  service: "learning-orchestrator",
  status: "listening",
  url: `http://${server.hostname}:${server.port}`,
  endpoints: [
    "GET /health",
    "GET /orchestrator/docker-status",
    "POST /orchestrator/preflight",
    "GET/PUT /orchestrator/provider-config",
    "POST /orchestrator/runs",
    "POST /orchestrator/sessions",
    "GET /orchestrator/sessions/:id",
    "POST /orchestrator/sessions/:id/commands",
    "POST /orchestrator/sessions/:id/repair",
    "GET /orchestrator/sessions/:id/events",
    "GET /orchestrator/sessions/:id/events/stream",
  ],
}, null, 2))
