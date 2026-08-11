// 输入: WorkerDefinition（来自 src/agents/workers.ts）
// 输出: B 角色 4 个画像链 worker 的真实 prompt（替换 wiring stub）
// 设计原则:
//   1. 保留 [executed:<name>] 标记与 stage/status/next 信封 —— orchestrator 协议与
//      tests/agent-registry.test.ts 依赖它们
//   2. 引文接地: 每个非空字段必须有学习者原话 quote 支撑，无证据置 null，禁止编造。
//      这是 A 在内容层 source_id/fact_id 红线在画像层的对称设计
//   3. profile-builder 的合成规则与 src/role-b-profile/profile-synthesizer.ts 同源；
//      LLM 轨是软约束，确定性轨是唯一可验证实现（联调阶段将封装为工具层）
import type { WorkerDefinition } from "../agents/types"

export const ROLE_B_WORKER_NAMES = [
  "background-collector",
  "self-assessor",
  "objective-diagnostician",
  "profile-builder",
] as const

export type RoleBWorkerName = (typeof ROLE_B_WORKER_NAMES)[number]

export function isRoleBWorker(name: string): name is RoleBWorkerName {
  return (ROLE_B_WORKER_NAMES as readonly string[]).includes(name)
}

// 四个 worker 共用的接地纪律：与 A 的知识引用红线对称
const GROUNDING_RULES = `Grounding rules (anti-hallucination, same discipline as the knowledge-base source_id/fact_id rule):
- Extract only what the learner actually said. Every non-null extracted field must be backed by an entry in "quotes" with the learner's words copied verbatim.
- If the learner did not provide the information, output null (or an empty array). Never guess, never fill defaults, never invent.
- Do not call tools, ask questions, or delegate. Work only with the supplied input.`

const ENVELOPE_RULES = (definition: WorkerDefinition, artifactsShape: string): string => `Return exactly one JSON object with this shape:
{
  "stage": "${definition.stage}",
  "status": "completed",
  "summary": "[executed:${definition.name}]",
  "artifacts": ${artifactsShape},
  "next": "${definition.next}"
}

Do not wrap the JSON in Markdown and do not add text before or after it.`

export function buildRoleBWorkerPrompt(definition: WorkerDefinition): string {
  switch (definition.name) {
    case "background-collector":
      return buildBackgroundCollectorPrompt(definition)
    case "self-assessor":
      return buildSelfAssessorPrompt(definition)
    case "objective-diagnostician":
      return buildObjectiveDiagnosticianPrompt(definition)
    case "profile-builder":
      return buildProfileBuilderPrompt(definition)
    default:
      throw new Error(`Not a role-B worker: ${definition.name}`)
  }
}

function buildBackgroundCollectorPrompt(definition: WorkerDefinition): string {
  return `You are the ${definition.name} worker in the KnowBalance personalized learning workflow.

Responsibility: extract the learner's background evidence from the learner's own request text.

${GROUNDING_RULES}

Field guide:
- learner_id: an explicit identifier if the learner gave one, else null.
- education_context: grade / major / occupation context, else null.
- prior_languages: programming languages the learner says they used before.
- prior_topics: concept phrases the learner says they were exposed to (keep the learner's wording; downstream code maps them to knowledge-base vocabulary).
- goal_raw: the learning goal in the learner's words. If the goal is missing, set it to null so the orchestrator can ask via its question tool — never fabricate a goal.
- time_budget: available study time if stated, else null.

${ENVELOPE_RULES(
    definition,
    `{
    "evidence_type": "background",
    "learner_id": "string or null",
    "education_context": "string or null",
    "prior_languages": ["string"],
    "prior_topics": ["string"],
    "goal_raw": "string or null",
    "time_budget": "string or null",
    "quotes": [{ "field": "goal_raw", "text": "learner's verbatim words" }]
  }`,
  )}`
}

function buildSelfAssessorPrompt(definition: WorkerDefinition): string {
  return `You are the ${definition.name} worker in the KnowBalance personalized learning workflow.

Responsibility: extract the learner's self-assessment evidence (how the learner rates their own level and which concepts they claim to know or find hard).

${GROUNDING_RULES}

Field guide:
- self_rating: one of "beginner" | "basic" | "intermediate" | "integrated" | null. Map the learner's self-description onto this enum only when the learner clearly rated themselves; otherwise null. Do not convert vague mood words into a rating without a quote.
- claimed_known: concepts the learner claims to handle (learner's wording).
- claimed_weak: concepts the learner claims to struggle with (learner's wording).
- Self-assessment is subjective evidence. Do not verify or grade here — the objective-diagnostician does that.

${ENVELOPE_RULES(
    definition,
    `{
    "evidence_type": "self_assessment",
    "self_rating": "beginner | basic | intermediate | integrated | null",
    "claimed_known": ["string"],
    "claimed_weak": ["string"],
    "quotes": [{ "field": "claimed_weak", "text": "learner's verbatim words" }]
  }`,
  )}`
}

function buildObjectiveDiagnosticianPrompt(definition: WorkerDefinition): string {
  return `You are the ${definition.name} worker in the KnowBalance personalized learning workflow.

Responsibility: record objective diagnostic evidence by grading the learner's actual answers against knowledge-base quiz items.

${GROUNDING_RULES}

Diagnosis rules:
- Every diagnosis item must reference a real knowledge-base quiz item with its source_id (K...) and fact_id (F...). Never invent questions, source_id, or fact_id values.
- Grade only answers that actually appear in the supplied input (for example a diagnostic seed answer inside the learner request). If a question has no learner answer, set learner_answer to null and verdict to "unanswered" — never grade an imagined answer.
- If the input contains no knowledge-base quiz items and no gradable answer, return an empty items array. An honest empty diagnosis is better than a fabricated one.
- verdict is one of "correct" | "incorrect" | "unanswered". concept is the knowledge point being probed; difficulty is that knowledge point's difficulty.

${ENVELOPE_RULES(
    definition,
    `{
    "evidence_type": "objective_diagnosis",
    "items": [
      {
        "source_id": "K007",
        "fact_id": "F001",
        "question": "the quiz question actually used",
        "learner_answer": "string or null",
        "verdict": "correct | incorrect | unanswered",
        "concept": "循环",
        "difficulty": "beginner"
      }
    ],
    "quotes": [{ "field": "items[0].learner_answer", "text": "learner's verbatim words" }]
  }`,
  )}`
}

function buildProfileBuilderPrompt(definition: WorkerDefinition): string {
  return `You are the ${definition.name} worker in the KnowBalance personalized learning workflow.

Responsibility: merge the three upstream evidence results (background, self_assessment, objective_diagnosis) into the standard learner profile plus a ready-to-send rag_request.

${GROUNDING_RULES}

Merge rules (same rules as the reference implementation in src/role-b-profile/profile-synthesizer.ts — follow them exactly):
1. Evidence strength: objective > self > background. A stronger source overrides a weaker one for the same concept.
2. A concept the objective diagnosis marks incorrect goes to weak_concepts even if the learner claimed it as known. Record every such contradiction in provenance.conflicts instead of resolving it silently.
3. Unverified self-claimed weak concepts stay weak (missing a gap costs more than extra remediation).
4. level is conservative but evidence-responsive: an incorrect answer at difficulty d caps level at the tier below d (floor "beginner"). If at least three answered objective items are all correct, level may rise by at most one tier above self_rating and never above the highest tested difficulty. Otherwise use self_rating; without both default to "beginner". level must be one of "beginner" | "basic" | "intermediate" | "integrated".
5. Prefer short knowledge-base style concept words (循环, 列表, 函数...) over long free-text phrases when both describe the same concept.
6. goal comes from the background evidence goal_raw. If goal_raw is null or empty, do NOT invent one: set status to "blocked", keep next as "await_evidence", and state in artifacts that the orchestrator must ask for the goal via its question tool.
7. rag_request.query must use exactly this four-part format (团队契约): 学习者水平：<level>；已掌握：<known joined by 、 or 无>；薄弱点：<weak joined by 、 or 无>；学习目标：<goal>
8. rag_request.top_k is 5.

${ENVELOPE_RULES(
    definition,
    `{
    "profile": {
      "learner_id": "string",
      "level": "beginner | basic | intermediate | integrated",
      "known_concepts": ["string"],
      "weak_concepts": ["string"],
      "goal": "string"
    },
    "provenance": {
      "level": { "value": "beginner", "source": "objective_cap | objective_promotion | self_rating | default", "rule": "string" },
      "conflicts": [{ "concept": "string", "selfClaim": "known | weak", "objectiveVerdict": "correct | incorrect", "resolution": "known | weak", "rule": "string" }],
      "unmapped_concepts": ["string"]
    },
    "rag_request": {
      "learner_profile": "the same profile object",
      "query": "学习者水平：…；已掌握：…；薄弱点：…；学习目标：…",
      "top_k": 5
    }
  }`,
  )}`
}
