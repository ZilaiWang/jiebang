import { resolve } from "node:path"
import { loadKnowledgeBase } from "../src/knowledge/loader"
import { retrieveKnowledge } from "../src/rag/retriever"
import { buildRagRequest } from "../src/role-b-profile/rag-bridge"
import type { LearnerProfile } from "../src/role-b-profile/types"
import {
  adaptLearnerProfile,
  adaptRagResult,
  buildGenerationSpec,
  createRoleCModelGatewayFromEnv,
  defineLearningPathNode,
  generateConceptLesson,
  modelBackedProviderOptionsFromEnv,
  ModelBackedRoleCContentProvider,
  ModelOutputValidationError,
  ROLE_C_PROMPT_MANIFEST_VERSION,
  validateAssessmentDraftStructure,
  validateCodeLabDraftStructure,
} from "../src/role-c-content"

const configPath = resolve(process.cwd(), ".env.role-c.local")
const usage: Array<Record<string, unknown>> = []
const selectedAgents = parseAgentSelection(process.argv.slice(2))

const profile: LearnerProfile = {
  learner_id: "role-c-real-model-smoke",
  level: "beginner",
  known_concepts: ["变量", "数据类型", "条件判断"],
  weak_concepts: ["循环", "列表"],
  goal: "完成一个成绩统计小程序，能遍历成绩并计算平均分",
}

try {
  const localEnv = await readEnvFile(configPath)
  // Explicit process variables may override the ignored local file for one diagnostic run.
  const env = { ...localEnv, ...process.env }
  const gateway = createRoleCModelGatewayFromEnv(env, {
    on_usage(event) {
      const safeUsage = {
        task: event.task,
        model_id: event.model_id,
        prompt_tokens: event.prompt_tokens,
        completion_tokens: event.completion_tokens,
        total_tokens: event.total_tokens,
      }
      usage.push(safeUsage)
      console.error(JSON.stringify({ event: "role_c_model_usage", ...safeUsage }))
    },
  })
  const ragRequest = buildRagRequest(profile)
  const rag = await retrieveKnowledge({ query: ragRequest.query, learnerLevel: profile.level, topK: 5 })
  const kb = await loadKnowledgeBase()
  const evidence = adaptRagResult(rag, { kb_version: kb.version, rag_version: "rule-rag-0.1" })
  const rawPath = await Bun.file("examples/role-c-content/learning_path_node_score_project.json").json()
  const path = defineLearningPathNode({
    node_id: rawPath.node_id,
    target_source_ids: rawPath.target_source_ids,
    prerequisite_source_ids: rawPath.prerequisite_source_ids,
    goal: rawPath.goal,
    objectives: rawPath.objectives,
    assessment_blueprint: rawPath.assessment_blueprint,
  })
  const built = buildGenerationSpec({
    run_id: `RUN-C-REAL-MODEL-${Date.now()}`,
    profile_snapshot: adaptLearnerProfile(profile, { profile_version: "profile-real-model-smoke-v1" }),
    path_node: path,
    evidence_pack: evidence,
    versions: {
      prompt_version: ROLE_C_PROMPT_MANIFEST_VERSION,
      model_config_hash: gateway.model_config_hash,
    },
    seed: 42,
  })
  if (!built.ok) throw new Error(`SPEC_BLOCKED:${built.code}:${built.errors.join(";")}`)

  const providerOptions = modelBackedProviderOptionsFromEnv(env)
  if (process.argv.includes("--no-repair")) providerOptions.max_repair_attempts = 0
  const provider = new ModelBackedRoleCContentProvider(gateway, providerOptions)
  const conceptRequest = {
    generation_spec: built.spec,
    evidence_pack: evidence,
  }
  const authorResults: Record<string, unknown> = {}
  let allValid = true

  let modelConcept: Awaited<ReturnType<typeof generateConceptLesson>> | undefined
  if (selectedAgents.has("concept")) {
    const attempt = await capture(() => generateConceptLesson(conceptRequest, provider))
    if (!attempt.ok) {
      allValid = false
      authorResults.concept = failedAttempt(attempt.error)
    } else {
      modelConcept = attempt.value
      const valid = modelConcept.status === "ready" && Boolean(modelConcept.payload)
      allValid &&= valid
      authorResults.concept = {
        schema_and_semantic_validation: valid ? "passed" : "failed",
        status: modelConcept.status,
        artifact_id: modelConcept.artifact_id,
        objective_coverage: modelConcept.quality.objective_coverage,
        citation_coverage: modelConcept.quality.citation_coverage,
        issues: modelConcept.blocked_reason?.details?.slice(0, 30) ?? [],
      }
    }
  }

  if (!modelConcept || modelConcept.status !== "ready" || !modelConcept.payload) {
    const detail = authorResults.concept
    throw new Error(
      `模型概念生成失败：无法获取 upstream concept artifact。请确认模型已正确配置且能正常生成内容。\n${JSON.stringify(detail, null, 2)}`,
    )
  }
  const upstreamConcept = modelConcept

  const labRequest = {
    generation_spec: built.spec,
    evidence_pack: evidence,
    concept_artifact: upstreamConcept,
  }
  if (selectedAgents.has("code-lab")) {
    const attempt = await capture(() => provider.generateCodeLab(labRequest))
    if (!attempt.ok) {
      allValid = false
      authorResults.code_lab = failedAttempt(attempt.error)
    } else {
      const validation = validateCodeLabDraftStructure(labRequest, attempt.value)
      allValid &&= validation.ok
      authorResults.code_lab = summarizeValidation(validation)
    }
  }

  const assessmentRequest = {
    generation_spec: built.spec,
    evidence_pack: evidence,
    concept_artifact: upstreamConcept,
  }
  if (selectedAgents.has("assessment")) {
    const attempt = await capture(() => provider.generateAssessment(assessmentRequest))
    if (!attempt.ok) {
      allValid = false
      authorResults.assessment = failedAttempt(attempt.error)
    } else {
      const validation = validateAssessmentDraftStructure(assessmentRequest, attempt.value)
      allValid &&= validation.ok
      authorResults.assessment = summarizeValidation(validation)
    }
  }

  const result = {
    status: allValid ? "model_authors_valid" : "model_authors_invalid",
    selected_agents: [...selectedAgents],
    config: {
      model_id: gateway.model_id,
      model_config_hash: gateway.model_config_hash,
      endpoint_configured: true,
      api_key_present: Boolean(env.ROLE_C_MODEL_API_KEY),
      response_format: env.ROLE_C_MODEL_RESPONSE_FORMAT || "json_schema",
      schema_strict: env.ROLE_C_MODEL_SCHEMA_STRICT || "true",
      provider_options: providerOptions,
    },
    author_results: authorResults,
    upstream_fixture: modelConcept?.status === "ready" ? "validated_model_concept" : "validated_deterministic_concept",
    publication_boundary: "Drafts were not marked execution/answer verified; ready publication still requires the isolated Docker runner.",
    usage,
  }
  console.log(JSON.stringify(result, null, 2))
  if (!allValid) process.exitCode = 1
} catch (error) {
  console.error(JSON.stringify({
    status: "failed",
    config_file: configPath,
    error: error instanceof Error ? `${error.name}: ${error.message}` : "unknown error",
    usage,
  }, null, 2))
  process.exitCode = 1
}

function summarizeValidation(report: { ok: boolean; issues: Array<{ code: string; path: string; message: string }>; objective_coverage: number }) {
  return {
    schema_and_semantic_validation: report.ok ? "passed" : "failed",
    objective_coverage: report.objective_coverage,
    issue_count: report.issues.length,
    issues: report.issues.slice(0, 30).map((issue) => ({
      code: issue.code,
      path: issue.path,
      message: issue.message,
    })),
  }
}

async function readEnvFile(path: string): Promise<Record<string, string>> {
  const file = Bun.file(path)
  if (!await file.exists()) throw new Error(`MODEL_CONFIG_NOT_FOUND:${path}`)
  const parsed: Record<string, string> = {}
  for (const [lineNumber, sourceLine] of (await file.text()).split(/\r?\n/).entries()) {
    const line = sourceLine.trim()
    if (!line || line.startsWith("#")) continue
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/)
    if (!match) throw new Error(`INVALID_ENV_LINE:${lineNumber + 1}`)
    let value = match[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    parsed[match[1]] = value
  }
  return parsed
}

type SmokeAgent = "concept" | "code-lab" | "assessment"

function parseAgentSelection(args: string[]): Set<SmokeAgent> {
  const value = args.find((arg) => arg.startsWith("--agents="))?.slice("--agents=".length)
  const requested = value ? value.split(",").filter(Boolean) : ["concept", "code-lab", "assessment"]
  const allowed = new Set<SmokeAgent>(["concept", "code-lab", "assessment"])
  if (requested.length === 0 || requested.some((agent) => !allowed.has(agent as SmokeAgent))) {
    throw new Error("--agents 只允许 concept、code-lab、assessment")
  }
  return new Set(requested as SmokeAgent[])
}

async function capture<T>(operation: () => Promise<T>): Promise<
  { ok: true; value: T } | { ok: false; error: unknown }
> {
  try {
    return { ok: true, value: await operation() }
  } catch (error) {
    return { ok: false, error }
  }
}

function failedAttempt(error: unknown) {
  return {
    schema_and_semantic_validation: "not_reached",
    error: error instanceof Error ? `${error.name}: ${error.message}` : "unknown error",
    ...(error instanceof ModelOutputValidationError ? { issues: error.issues.slice(0, 30) } : {}),
  }
}
