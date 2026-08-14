/**
 * 深挖 hidden_test_input_leak：拦截 gateway，记录 code-lab secure 阶段的
 * 首次生成与修复生成，看 public 用了哪些输入、hidden 撞了哪个、修复到底改没改。
 * 只读探针，不改任何源码。
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
import type { ModelGateway } from "../src/role-c-content/contracts/model-gateway"

async function readEnv(path: string): Promise<Record<string, string>> {
  const parsed: Record<string, string> = {}
  for (const line of (await Bun.file(path).text()).split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith("#")) continue
    const m = t.match(/^([A-Z][A-Z0-9_]*)=(.*)$/)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    parsed[m[1]] = v
  }
  return parsed
}

function collectInputs(value: unknown): unknown[] {
  const rec = value as Record<string, unknown>
  const publicTests = rec.public_payload && (rec.public_payload as Record<string, unknown>).public_tests
  return Array.isArray(publicTests) ? publicTests.map((t) => (t as Record<string, unknown>).input) : []
}

function collectHiddenTests(output: unknown): Array<{ input: unknown; expected: unknown }> {
  const ht = (output as Record<string, unknown>)?.hidden_tests
  return Array.isArray(ht) ? ht.map((t) => ({ input: (t as Record<string, unknown>).input, expected: (t as Record<string, unknown>).expected })) : []
}

async function main() {
  const env = { ...(await readEnv(resolve(process.cwd(), ".env.role-c.local"))), ...process.env }
  const real = createRoleCModelGatewayFromEnv(env)
  const calls: Array<Record<string, unknown>> = []

  const gateway: ModelGateway = {
    model_id: real.model_id,
    model_config_hash: real.model_config_hash,
    async generateStructured<T>(req): Promise<T> {
      const out = await real.generateStructured<T>(req)
      if (req.task.includes("code-lab.secure")) {
        calls.push({
          task: req.task,
          public_inputs: collectInputs(req.input),
          repair_forbidden: (req.input as Record<string, unknown>)?.repair_context ?? null,
          hidden_tests: collectHiddenTests(out),
        })
      }
      return out
    },
  }

  const provider = new ModelBackedRoleCContentProvider(gateway, modelBackedProviderOptionsFromEnv(env))
  const kb = await loadKnowledgeBase()
  const item = kb.items.find((i) => i.sourceId === "K004")!
  const rag = await retrieveKnowledge({ query: item.title, learnerLevel: "beginner", topK: 5 })
  const matched = rag.results.find((r) => r.sourceId === "K004") ?? rag.results[0]!
  const evidence = adaptRagResult(
    { query: rag.query, learnerLevel: "beginner", topK: 5, results: [matched], match_status: "strong" },
    { kb_version: kb.version, rag_version: "dig-0.1" },
  )
  const firstFactId = matched.facts[0]?.factId ?? matched.facts[0]?.fact_id ?? "F001"
  const path = defineLearningPathNode({
    node_id: "NODE-K004",
    target_source_ids: ["K004"],
    prerequisite_source_ids: [],
    goal: `学习 ${item.title}`,
    objectives: [{ objective_id: "OBJ-K004", source_id: "K004", required_fact_ids: [firstFactId], observable_behavior: "apply", importance: "core" }],
    assessment_blueprint: { tier_1_count: 2, tier_2_count: 1, tier_3_count: 1, required_modalities: ["mcq", "code"] },
  })
  const profile: LearnerProfile = { learner_id: "learner-K004", level: "beginner", known_concepts: [], weak_concepts: [], goal: `学习 ${item.title}` }
  const built = buildGenerationSpec({
    run_id: `RUN-DIG-K004-${Date.now()}`,
    profile_snapshot: adaptLearnerProfile(profile, { profile_version: "dig-v1" }),
    path_node: path,
    evidence_pack: evidence,
    versions: { prompt_version: ROLE_C_PROMPT_MANIFEST_VERSION, model_config_hash: gateway.model_config_hash },
    seed: 42,
  })
  if (!built.ok) throw new Error(`SPEC:${built.code}`)

  const concept = await generateConceptLesson({ generation_spec: built.spec, evidence_pack: evidence }, provider)

  try {
    await provider.generateCodeLab({ generation_spec: built.spec, evidence_pack: evidence, concept_artifact: concept })
    console.log("STATUS: ok")
  } catch (error) {
    console.log("STATUS: blocked:", error instanceof Error ? error.message : error)
  }

  console.log(`\n=== code-lab.secure 阶段共 ${calls.length} 次生成 ===`)
  calls.forEach((c, i) => {
    console.log(`\n--- 第 ${i + 1} 次（task=${c.task}）---`)
    console.log("  public_inputs:", JSON.stringify(c.public_inputs))
    if (c.repair_forbidden && JSON.stringify(c.repair_forbidden) !== "{}") {
      console.log("  repair_forbidden_public_inputs:", JSON.stringify((c.repair_forbidden as Record<string, unknown>).forbidden_public_inputs))
    }
    console.log("  hidden_tests:", JSON.stringify(c.hidden_tests))
  })
}

main().catch((e) => { console.error("FATAL", e); process.exitCode = 1 })
