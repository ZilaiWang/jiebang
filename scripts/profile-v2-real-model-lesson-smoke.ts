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

const configPath = resolve(process.cwd(), ".env.role-c.local")
const env = { ...await readEnvFile(configPath), ...process.env }
const gateway = createRoleCModelGatewayFromEnv(env)
const providerOptions = modelBackedProviderOptionsFromEnv(env)
const provider = new ModelBackedRoleCContentProvider(gateway, providerOptions)
const kb = await loadKnowledgeBase()
const targetSource = kb.items.find((item) => item.sourceId === "K007")
if (!targetSource?.coreFactIds?.length) throw new Error("SMOKE_CORE_FACTS_MISSING:K007")

const cases = [
  {
    case_id: "beginner-competition-step-by-step",
    core: {
      learner_id: "profile-v2-smoke-beginner",
      level: "beginner" as const,
      known_concepts: ["变量", "基本数据类型"],
      weak_concepts: ["for 循环"],
      goal: "掌握 for 循环并能独立完成竞赛中的遍历题",
    },
    intake: {
      learner_id: "profile-v2-smoke-beginner",
      goal: "掌握 for 循环并能独立完成竞赛中的遍历题",
      background_summary: "学过变量和基本数据类型，尚不能独立追踪循环",
      prior_languages: ["Python"],
      self_rating: "beginner" as const,
      goal_use_case: "competition" as const,
      desired_outcome: "独立编写、追踪和调试列表遍历程序",
      weekly_time_budget_minutes: 240,
      session_time_budget_minutes: 45,
      explanation_preference: "step_by_step" as const,
      practice_preference: "coding" as const,
      pace_preference: "slow" as const,
      preferred_contexts: ["算法竞赛"],
      privacy: { personalization_enabled: true, retention: "session_only" as const, allow_profile_display: true },
    } satisfies LearnerProfileIntakeV2,
  },
  {
    case_id: "integrated-coursework-principle-first",
    core: {
      learner_id: "profile-v2-smoke-integrated",
      level: "integrated" as const,
      known_concepts: ["变量", "基本数据类型", "条件判断", "列表"],
      weak_concepts: ["for 循环的边界与迁移"],
      goal: "掌握 for 循环并能独立完成竞赛中的遍历题",
    },
    intake: {
      learner_id: "profile-v2-smoke-integrated",
      goal: "掌握 for 循环并能独立完成竞赛中的遍历题",
      background_summary: "已完成课程基础练习，希望系统梳理循环规则",
      prior_languages: ["Python"],
      self_rating: "integrated" as const,
      goal_use_case: "coursework" as const,
      desired_outcome: "解释循环边界并完成课程中的迁移题",
      weekly_time_budget_minutes: 90,
      session_time_budget_minutes: 25,
      explanation_preference: "principle_first" as const,
      practice_preference: "quiz" as const,
      pace_preference: "fast" as const,
      preferred_contexts: ["课程作业"],
      privacy: { personalization_enabled: true, retention: "session_only" as const, allow_profile_display: true },
    } satisfies LearnerProfileIntakeV2,
  },
]

const results: Array<Record<string, unknown>> = []
for (const [index, entry] of cases.entries()) {
  const profile = createLearnerProfileV2({
    core_profile: entry.core,
    intake: entry.intake,
    profile_version: `PROFILE-V2-SMOKE-${index + 1}`,
  })
  const rag = await retrieveKnowledge({
    query: "Python for 循环遍历列表 range 边界",
    learnerLevel: entry.core.level,
    topK: 4,
    intent: {
      target_source_ids: ["K007"],
      prerequisite_source_ids: [],
      focus_terms: ["for 循环", "列表遍历", "range"],
      resource_needs: ["fact", "example", "practice_task"],
    },
  })
  const evidence = adaptRagResult(rag, { kb_version: kb.version, rag_version: "rule-rag-profile-v2-smoke" })
  const bundle = bindObjectiveEvidence({
    source_id: "K007",
    observable_behavior: "apply",
    required_fact_ids: targetSource.coreFactIds,
  }, evidence.results)
  if (!bundle.sufficient) throw new Error(`SMOKE_EVIDENCE_INSUFFICIENT:${entry.case_id}`)
  const path = defineLearningPathNode({
    node_id: "NODE-K007-PROFILE-V2-SMOKE",
    target_source_ids: ["K007"],
    prerequisite_source_ids: [],
    goal: entry.core.goal,
    objectives: [{
      objective_id: "OBJ-K007-PROFILE-V2-SMOKE",
      source_id: "K007",
      required_fact_ids: bundle.required_fact_ids,
      observable_behavior: "apply",
      importance: "core",
      is_primary: true,
    }],
    assessment_blueprint: {
      tier_1_count: 1,
      tier_2_count: 1,
      tier_3_count: 1,
      required_modalities: ["mcq", "trace", "code"],
    },
  })
  const built = buildGenerationSpec({
    run_id: `RUN-${entry.case_id}-${Date.now()}`,
    profile_snapshot: adaptLearnerProfile(profile, buildRoleCProfileSnapshotOptions(profile)),
    path_node: path,
    evidence_pack: evidence,
    versions: { prompt_version: ROLE_C_PROMPT_MANIFEST_VERSION, model_config_hash: gateway.model_config_hash },
    seed: 20260829 + index,
  })
  if (!built.ok) throw new Error(`SMOKE_SPEC_BLOCKED:${entry.case_id}:${built.errors.join(";")}`)
  const blueprint = buildResourceBlueprint(built.spec, evidence)
  const startedAt = Date.now()
  const artifact = await generateConceptLesson({
    generation_spec: built.spec,
    evidence_pack: evidence,
    resource_blueprint: blueprint,
  }, provider)
  const durationMs = Date.now() - startedAt
  if (artifact.status !== "ready" || !artifact.payload) {
    throw new Error(`SMOKE_LESSON_BLOCKED:${entry.case_id}:${artifact.blocked_reason?.details?.join(";")}`)
  }
  const quality = inspectLesson(artifact.payload, evidence.results.flatMap((item) =>
    item.facts.map((fact) => `${item.source_id}:${fact.fact_id}`)))
  const contract = built.spec.learner_adaptation.pedagogy_contract!
  if (quality.visible_characters < 450) throw new Error(`SMOKE_LESSON_TOO_SHORT:${entry.case_id}:${quality.visible_characters}`)
  if (quality.invalid_citations.length > 0) throw new Error(`SMOKE_INVALID_CITATIONS:${entry.case_id}:${quality.invalid_citations.join(",")}`)
  if (quality.contains_generic_placeholder) throw new Error(`SMOKE_GENERIC_PLACEHOLDER:${entry.case_id}`)
  if (quality.worked_example_block_count < contract.lesson.worked_example_count) {
    throw new Error(`SMOKE_WORKED_EXAMPLE_COUNT:${entry.case_id}:${quality.worked_example_block_count}/${contract.lesson.worked_example_count}`)
  }
  if (!bundle.required_fact_ids.every((factId) => quality.used_fact_ids.includes(factId))) {
    throw new Error(`SMOKE_CORE_FACT_COVERAGE:${entry.case_id}:${quality.used_fact_ids.join(",")}`)
  }
  if (quality.micro_check_count === 0 || quality.misconception_count === 0) {
    throw new Error(`SMOKE_INCOMPLETE_LEARNING_UNIT:${entry.case_id}`)
  }
  results.push({
    case_id: entry.case_id,
    status: artifact.status,
    duration_ms: durationMs,
    profile_level: entry.core.level,
    pedagogy: {
      opening: contract.lesson.opening,
      scaffold_strength: contract.lesson.scaffold_strength,
      worked_example_count: contract.lesson.worked_example_count,
      practice_shape: contract.practice.shape,
      hint_levels: contract.practice.hint_levels,
      transfer_distance: contract.practice.transfer_distance,
      preferred_modalities: contract.assessment.preferred_modalities,
    },
    required_fact_ids: bundle.required_fact_ids,
    lesson: quality,
  })
}

const beginner = results[0]!.pedagogy as Record<string, unknown>
const integrated = results[1]!.pedagogy as Record<string, unknown>
if (JSON.stringify(beginner) === JSON.stringify(integrated)) {
  throw new Error("SMOKE_PERSONALIZATION_NOT_OBSERVABLE")
}
console.log(JSON.stringify({
  status: "passed",
  model_id: gateway.model_id,
  prompt_version: ROLE_C_PROMPT_MANIFEST_VERSION,
  comparison: {
    same_frozen_objective: true,
    same_required_facts: JSON.stringify(results[0]!.required_fact_ids) === JSON.stringify(results[1]!.required_fact_ids),
    different_pedagogy_contract: true,
  },
  results,
}, null, 2))

function inspectLesson(payload: ConceptLessonPayload, availableCitations: string[]) {
  const blocks = [
    ...payload.prerequisite_bridge,
    ...payload.explanation_blocks,
    ...payload.worked_examples,
    ...payload.micro_checks,
    ...payload.summary,
  ]
  const visibleText = [
    payload.title,
    ...blocks.map(blockText),
    ...payload.misconceptions.map((entry) => entry.explanation),
    ...payload.hint_ladders.flatMap((ladder) => ladder.hints.map((hint) => hint.text)),
  ].join("\n")
  const citationKeys = payload.used_evidence.map((ref) => `${ref.source_id}:${ref.fact_id}`)
  const available = new Set(availableCitations)
  return {
    title: payload.title,
    visible_characters: visibleText.replace(/\s/gu, "").length,
    prerequisite_block_count: payload.prerequisite_bridge.length,
    explanation_block_count: payload.explanation_blocks.length,
    worked_example_block_count: payload.worked_examples.length,
    misconception_count: payload.misconceptions.length,
    micro_check_count: payload.micro_checks.length,
    hint_count: payload.hint_ladders.reduce((total, ladder) => total + ladder.hints.length, 0),
    summary_block_count: payload.summary.length,
    objective_coverage_count: payload.objective_coverage.length,
    citation_count: new Set(citationKeys).size,
    used_fact_ids: [...new Set(payload.used_evidence.map((ref) => ref.source_id === "K007" ? ref.fact_id : ""))].filter(Boolean),
    invalid_citations: [...new Set(citationKeys.filter((key) => !available.has(key)))],
    contains_generic_placeholder: /请完成一个与|参考该知识点的\s*F\d+|能正确运用该知识点并解释关键步骤/u.test(visibleText),
    preview: visibleText.slice(0, 500),
  }
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
