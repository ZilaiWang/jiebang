import { resolve } from "node:path"
import { loadKnowledgeBase } from "../src/knowledge/loader"
import { retrieveKnowledge } from "../src/rag/retriever"
import {
  buildRoleCProfileSnapshotOptions,
  createLearnerProfileV2,
  type LearnerProfileIntakeV2,
} from "../src/role-b-profile"
import {
  adaptLearnerProfile,
  adaptRagResult,
  buildGenerationSpec,
  buildResourceBlueprint,
  createRoleCModelGatewayFromEnv,
  defineLearningPathNode,
  generateConceptLesson,
  modelBackedProviderOptionsFromEnv,
  ModelBackedRoleCContentProvider,
  ROLE_C_PROMPT_MANIFEST_VERSION,
} from "../src/role-c-content"
import type { ConceptLessonPayload, RenderBlock } from "../src/role-c-content/contracts/artifacts"
import { bindObjectiveEvidence } from "../src/role-c-content/planning/objective-evidence-bundle"
import { evaluateExpressionAdaptation } from "../src/role-c-content/quality/expression-adaptation"

const env = { ...await readEnvFile(resolve(process.cwd(), ".env.role-c.local")), ...process.env }
const gateway = createRoleCModelGatewayFromEnv(env)
const provider = new ModelBackedRoleCContentProvider(gateway, {
  ...modelBackedProviderOptionsFromEnv(env),
  public_candidate_count: 1,
  max_repair_attempts: 1,
})
const knowledgeBase = await loadKnowledgeBase()
const source = knowledgeBase.items.find((item) => item.sourceId === "K007")
if (!source?.coreFactIds?.length) throw new Error("EXPRESSION_SMOKE_CORE_FACTS_MISSING:K007")

const cases = [
  { id: "humanities", discipline: ["人文社科"], education: "本科", expected: "humanities_social_sciences" },
  { id: "engineering", discipline: ["计算机与工程"], education: "本科", expected: "science_engineering" },
  { id: "unspecified", discipline: [], education: "本科", expected: "unspecified" },
] as const

const results: Array<Record<string, unknown>> = []
for (const [index, item] of cases.entries()) {
  const learnerId = `expression-smoke-${item.id}`
  const goal = "理解 Python for 循环并能解释循环变量的变化"
  const intake: LearnerProfileIntakeV2 = {
    learner_id: learnerId,
    goal,
    background_summary: "学习者希望系统理解循环",
    education_stage: item.education,
    discipline_background: [...item.discipline],
    self_rating: "basic",
    goal_use_case: "coursework",
    desired_outcome: "完成课程中的循环解释与追踪练习",
    weekly_time_budget_minutes: 180,
    session_time_budget_minutes: 30,
    explanation_preference: "balanced",
    practice_preference: "mixed",
    pace_preference: "steady",
    privacy: { personalization_enabled: true, retention: "session_only", allow_profile_display: true },
  }
  const profile = createLearnerProfileV2({
    core_profile: { learner_id: learnerId, level: "basic", known_concepts: ["变量"], weak_concepts: ["for 循环"], goal },
    intake,
    observed_at: "2026-08-31T00:00:00.000Z",
  })
  const snapshot = adaptLearnerProfile(profile, buildRoleCProfileSnapshotOptions(profile))
  const expressionContext = snapshot.expression_context
  if (expressionContext?.discipline_family !== item.expected) {
    throw new Error(`EXPRESSION_SMOKE_CLASSIFICATION:${item.id}:${expressionContext?.discipline_family}`)
  }
  const rag = await retrieveKnowledge({
    query: "Python for 循环 循环变量 依次取值",
    learnerLevel: "basic",
    topK: 4,
    intent: {
      target_source_ids: ["K007"],
      prerequisite_source_ids: [],
      focus_terms: ["for 循环", "循环变量"],
      resource_needs: ["fact", "example", "practice_task"],
    },
  })
  const evidence = adaptRagResult(rag, { kb_version: knowledgeBase.version, rag_version: "rule-rag-expression-smoke" })
  const bundle = bindObjectiveEvidence({ source_id: "K007", observable_behavior: "explain", required_fact_ids: source.coreFactIds }, evidence.results)
  if (!bundle.sufficient) throw new Error(`EXPRESSION_SMOKE_EVIDENCE:${item.id}`)
  const path = defineLearningPathNode({
    node_id: "NODE-K007-EXPRESSION-SMOKE",
    target_source_ids: ["K007"],
    prerequisite_source_ids: [],
    goal,
    objectives: [{ objective_id: "OBJ-K007-EXPRESSION-SMOKE", source_id: "K007", required_fact_ids: bundle.required_fact_ids, observable_behavior: "explain", importance: "core", is_primary: true }],
    assessment_blueprint: { tier_1_count: 1, tier_2_count: 1, tier_3_count: 0, required_modalities: ["mcq", "short_answer"] },
  })
  const built = buildGenerationSpec({
    run_id: `RUN-EXPRESSION-${item.id}-${Date.now()}`,
    profile_snapshot: snapshot,
    path_node: path,
    evidence_pack: evidence,
    versions: { prompt_version: ROLE_C_PROMPT_MANIFEST_VERSION, model_config_hash: gateway.model_config_hash },
    seed: 20260831 + index,
  })
  if (!built.ok) throw new Error(`EXPRESSION_SMOKE_SPEC:${item.id}:${built.errors.join(";")}`)
  const startedAt = Date.now()
  const artifact = await generateConceptLesson({
    generation_spec: built.spec,
    evidence_pack: evidence,
    resource_blueprint: buildResourceBlueprint(built.spec, evidence),
  }, provider)
  if (artifact.status !== "ready" || !artifact.payload) {
    throw new Error(`EXPRESSION_SMOKE_LESSON:${item.id}:${artifact.blocked_reason?.details?.join(";")}`)
  }
  const text = visibleText(artifact.payload)
  const audit = evaluateExpressionAdaptation(artifact.payload, expressionContext)
  if (audit.issue_codes.length > 0) throw new Error(`EXPRESSION_SMOKE_SAFETY:${item.id}:${audit.issue_codes.join(",")}`)
  if (expressionContext.discipline_family !== "unspecified" && audit.score < 0.55) {
    throw new Error(`EXPRESSION_SMOKE_ALIGNMENT:${item.id}:${audit.score}`)
  }
  results.push({
    case_id: item.id,
    duration_ms: Date.now() - startedAt,
    discipline_family: expressionContext.discipline_family,
    explanation_frame: expressionContext.explanation_frame,
    locked_core: {
      targets: built.spec.targets,
      difficulty: built.spec.difficulty,
      assessment_blueprint: built.spec.assessment_blueprint,
    },
    adaptation_score: audit.score,
    issue_codes: audit.issue_codes,
    preview: text.slice(0, 220),
  })
}

const locked = results.map((entry) => JSON.stringify(entry.locked_core))
if (!locked.every((value) => value === locked[0])) throw new Error("EXPRESSION_SMOKE_LOCKED_CORE_DRIFT")
console.log(JSON.stringify({
  status: "passed",
  model_id: gateway.model_id,
  prompt_version: ROLE_C_PROMPT_MANIFEST_VERSION,
  same_locked_core: true,
  results,
}, null, 2))

function visibleText(payload: ConceptLessonPayload): string {
  const blocks = [...payload.prerequisite_bridge, ...payload.explanation_blocks, ...payload.worked_examples, ...payload.micro_checks, ...payload.summary]
  return [
    payload.title,
    ...blocks.map(blockText),
    ...payload.misconceptions.map((entry) => entry.explanation),
    ...payload.hint_ladders.flatMap((entry) => entry.hints.map((hint) => hint.text)),
  ].join("\n")
}

function blockText(block: RenderBlock): string {
  return Object.entries(block)
    .filter(([key]) => !["block_id", "citations", "options"].includes(key))
    .flatMap(([, value]) => typeof value === "string" ? [value] : [])
    .join(" ")
}

async function readEnvFile(path: string): Promise<Record<string, string>> {
  const file = Bun.file(path)
  if (!await file.exists()) throw new Error(`MODEL_CONFIG_NOT_FOUND:${path}`)
  const parsed: Record<string, string> = {}
  for (const sourceLine of (await file.text()).split(/\r?\n/u)) {
    const line = sourceLine.trim()
    if (!line || line.startsWith("#")) continue
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/u)
    if (!match) continue
    let value = match[2]!.trim()
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    parsed[match[1]!] = value
  }
  return parsed
}
