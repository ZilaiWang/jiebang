/**
 * 多场景真实模型压测：针对不同知识点类型跑 code-lab 真实生成，
 * 重点观察 stdin_stdout 门禁（STDIN_FUNCTION_CONTRACT_MISMATCH）是否被误触发、
 * 推导的 execution_mode 与真实生成内容是否一致、多遍是否稳定。
 *
 * 用法：bun scripts/role-c-stdin-gate-matrix.ts [--rounds=N] [--sourceIds=K004,K007]
 */
import { resolve } from "node:path"
import { loadKnowledgeBase } from "../src/knowledge/loader"
import { retrieveKnowledge } from "../src/rag/retriever"
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
  ROLE_C_PROMPT_MANIFEST_VERSION,
} from "../src/role-c-content"
import { deriveCodeLabExecutionMode } from "../src/role-c-content/providers/staged-generation"

type Scenario = {
  sourceId: string
  level: LearnerProfile["level"]
  behavior: "apply" | "trace"
  label: string
  expect: "stdin_stdout" | "function" | "neutral"
}

const SCENARIOS: Scenario[] = [
  { sourceId: "K004", level: "beginner", behavior: "apply", label: "输入输出", expect: "stdin_stdout" },
  { sourceId: "K013", level: "basic", behavior: "apply", label: "函数定义", expect: "function" },
  { sourceId: "K014", level: "basic", behavior: "apply", label: "参数返回值", expect: "function" },
  { sourceId: "K007", level: "beginner", behavior: "apply", label: "for循环/beginner", expect: "neutral" },
  { sourceId: "K007", level: "intermediate", behavior: "apply", label: "for循环/intermediate", expect: "neutral" },
  { sourceId: "K009", level: "beginner", behavior: "apply", label: "列表/beginner", expect: "neutral" },
]

function argFlag(args: string[], name: string): string | undefined {
  return args.find((a) => a.startsWith(`--${name}=`))?.slice(`--${name}=`.length)
}

async function readEnvFile(path: string): Promise<Record<string, string>> {
  const file = Bun.file(path)
  if (!(await file.exists())) throw new Error(`MODEL_CONFIG_NOT_FOUND:${path}`)
  const parsed: Record<string, string> = {}
  for (const line of (await file.text()).split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const m = trimmed.match(/^([A-Z][A-Z0-9_]*)=(.*)$/)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    parsed[m[1]] = v
  }
  return parsed
}

async function main() {
  const args = process.argv.slice(2)
  const rounds = Number(argFlag(args, "rounds") ?? "3")
  const onlySources = argFlag(args, "sourceIds")?.split(",").filter(Boolean)
  const scenarios = onlySources ? SCENARIOS.filter((s) => onlySources.includes(s.sourceId)) : SCENARIOS

  const env = { ...(await readEnvFile(resolve(process.cwd(), ".env.role-c.local"))), ...process.env }
  const gateway = createRoleCModelGatewayFromEnv(env)
  const provider = new ModelBackedRoleCContentProvider(gateway, modelBackedProviderOptionsFromEnv(env))
  const kb = await loadKnowledgeBase()

  console.error(`模型 ${gateway.model_id} | 场景 ${scenarios.length} 个 × ${rounds} 遍`)
  const report: unknown[] = []

  for (const scenario of scenarios) {
    const item = kb.items.find((i) => i.sourceId === scenario.sourceId)
    if (!item) {
      console.error(`跳过 ${scenario.sourceId}：知识库无此条目`)
      continue
    }
    const rag = await retrieveKnowledge({ query: item.title, learnerLevel: scenario.level, topK: 5 })
    const matched = rag.results.find((r) => r.sourceId === scenario.sourceId) ?? rag.results[0]
    if (!matched) {
      console.error(`跳过 ${scenario.sourceId}：RAG 无结果`)
      continue
    }
    const evidence = adaptRagResult(
      { query: rag.query, learnerLevel: scenario.level, topK: 5, results: [matched], match_status: "strong" },
      { kb_version: kb.version, rag_version: "stdin-gate-matrix-0.1" },
    )
    const firstFactId = matched.facts[0]?.factId ?? matched.facts[0]?.fact_id ?? "F001"
    const path = defineLearningPathNode({
      node_id: `NODE-${scenario.sourceId}`,
      target_source_ids: [scenario.sourceId],
      prerequisite_source_ids: [],
      goal: `学习 ${item.title}`,
      objectives: [{
        objective_id: `OBJ-${scenario.sourceId}`,
        source_id: scenario.sourceId,
        required_fact_ids: [firstFactId],
        observable_behavior: scenario.behavior,
        importance: "core",
      }],
      assessment_blueprint: { tier_1_count: 2, tier_2_count: 1, tier_3_count: 1, required_modalities: ["mcq", "code"] },
    })
    const profile: LearnerProfile = {
      learner_id: `learner-${scenario.sourceId}`,
      level: scenario.level,
      known_concepts: [],
      weak_concepts: [],
      goal: `学习 ${item.title}`,
    }
    const built = buildGenerationSpec({
      run_id: `RUN-MATRIX-${scenario.sourceId}-${Date.now()}`,
      profile_snapshot: adaptLearnerProfile(profile, { profile_version: "matrix-v1" }),
      path_node: path,
      evidence_pack: evidence,
      versions: { prompt_version: ROLE_C_PROMPT_MANIFEST_VERSION, model_config_hash: gateway.model_config_hash },
      seed: 42,
    })
    if (!built.ok) {
      console.error(`跳过 ${scenario.sourceId}：buildGenerationSpec 失败 ${built.code}`)
      continue
    }

    const derived = deriveCodeLabExecutionMode({ generation_spec: built.spec, evidence_pack: evidence } as never)
    const row: Record<string, unknown> = {
      sourceId: scenario.sourceId,
      label: scenario.label,
      level: scenario.level,
      expect: scenario.expect,
      derived_mode: derived,
      derive_match: scenario.expect === "neutral" ? "neutral" : derived === scenario.expect ? "ok" : "MISMATCH",
      rounds: [],
    }

    const concept = await generateConceptLesson({ generation_spec: built.spec, evidence_pack: evidence }, provider)
    if (concept.status !== "ready" || !concept.payload) {
      row.concept = "failed"
      report.push(row)
      console.error(`  ${scenario.label}: concept 失败`)
      continue
    }

    for (let r = 1; r <= rounds; r += 1) {
      const started = Date.now()
      let outcome: Record<string, unknown>
      try {
        const draft = await provider.generateCodeLab({ generation_spec: built.spec, evidence_pack: evidence, concept_artifact: concept })
        const publicPayload = draft.public_draft.payload
        outcome = {
          status: "ok",
          mode: publicPayload.execution_contract.execution_mode,
          entry_point: publicPayload.execution_contract.entry_point ?? null,
          starter_head: publicPayload.starter_code.split("\n")[0]?.slice(0, 60),
        }
      } catch (error) {
        const issues = (error as { issues?: string[] }).issues ?? []
        outcome = {
          status: "blocked",
          message: error instanceof Error ? error.message : String(error),
          stdin_gate_hit: issues.some((i) => i.includes("STDIN_FUNCTION_CONTRACT_MISMATCH")),
          issues: issues.slice(0, 6),
        }
      }
      outcome.ms = Date.now() - started
      ;(row.rounds as unknown[]).push(outcome)
      console.error(`  ${scenario.label} #${r}: ${JSON.stringify(outcome)}`)
    }
    report.push(row)
  }

  console.log(JSON.stringify(report, null, 2))
}

main().catch((error) => {
  console.error("FATAL", error)
  process.exitCode = 1
})
