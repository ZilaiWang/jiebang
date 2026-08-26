import { createHash } from "node:crypto"
import type {
  KnowledgeFact,
  KnowledgeItem,
  KnowledgeMisconception,
  KnowledgeWorkedExample,
  ObservableObjective,
  PracticeTemplate,
} from "./types"
import {
  inferFactCapabilities,
  selectEvidenceBundle,
  type EvidenceBehavior,
} from "./capabilities"

/**
 * Hydrates legacy knowledge records into one teaching-oriented runtime shape.
 * The source facts remain authoritative; derived teaching metadata only points
 * back to those facts and never invents a new domain claim.
 */
export function hydrateKnowledgeItemV2(item: KnowledgeItem): KnowledgeItem {
  // Source registries are module-level constants and are shared by every load.
  // Hydration must never hand those mutable objects to downstream consumers.
  const source = structuredClone(item)
  const facts = source.facts.map((fact) => hydrateFact(fact, source.prerequisites))
  const factIds = facts.map((fact) => fact.factId)
  return {
    ...source,
    facts,
    // 旧知识切片的题目事实引用已经经过课程编写，是比数组位置更可靠的
    // “核心内容”信号；不足三条时再按事实顺序补齐。新切片可以显式声明
    // coreFactIds 覆盖这一兼容规则。
    coreFactIds: source.coreFactIds?.length
      ? [...new Set(source.coreFactIds)]
      : [...new Set([
          ...source.quizItems.map((item) => item.factId),
          ...factIds,
        ])].slice(0, 3),
    misconceptions: source.misconceptions?.length
      ? structuredClone(source.misconceptions)
      : deriveMisconceptions(source, facts),
    workedExamples: source.workedExamples?.length
      ? structuredClone(source.workedExamples)
      : deriveWorkedExamples(source, factIds),
    counterexamples: source.counterexamples?.length
      ? [...source.counterexamples]
      : deriveMisconceptions(source, facts).map((entry) => entry.counterexample),
    observableObjectives: source.observableObjectives?.length
      ? structuredClone(source.observableObjectives)
      : deriveObjectives(source),
    practiceTemplates: source.practiceTemplates?.length
      ? structuredClone(source.practiceTemplates)
      : derivePracticeTemplates(source, factIds),
    assessmentConstraints: source.assessmentConstraints?.length
      ? [...source.assessmentConstraints]
      : [
          "每个专业判断必须由绑定事实单独支持",
          "错误选项必须能定位到具体误解，不得使用明显荒谬或工程元信息选项",
          "迁移题应改变认知操作或任务结构，不能只替换数字、名称或背景词",
        ],
  }
}

function hydrateFact(fact: KnowledgeFact, prerequisites: string[]): KnowledgeFact {
  return {
    ...fact,
    source_id: fact.source_id ?? fact.sourceId,
    fact_id: fact.fact_id ?? fact.factId,
    scope: fact.scope?.length ? [...fact.scope] : [fact.sourceId],
    exceptions: fact.exceptions ? [...fact.exceptions] : [],
    prerequisites: fact.prerequisites?.length ? [...fact.prerequisites] : [...prerequisites],
    confidence: clamp01(fact.confidence ?? 1),
    authority: fact.authority ?? "curriculum",
    capabilities: fact.capabilities?.length
      ? [...new Set(fact.capabilities)]
      : inferFactCapabilities(fact.content),
  }
}

function deriveMisconceptions(item: KnowledgeItem, facts: KnowledgeFact[]): KnowledgeMisconception[] {
  // A legacy quiz option is not automatically an evidence-grounded
  // misconception: a fact about ordered lists cannot prove that unrelated
  // tokens such as "split" or "import" are false. Derive only direct,
  // source-local contradictions whose falsity is entailed by the cited fact.
  const prioritizedFactIds = [...new Set([
    ...item.quizItems.map((quiz) => quiz.factId),
    ...facts.map((fact) => fact.factId),
  ])]
  const factById = new Map(facts.map((fact) => [fact.factId, fact]))
  const derived = prioritizedFactIds.flatMap((factId, index) => {
    const fact = factById.get(factId)
    if (!fact) return []
    const incorrectBelief = directFactContradiction(fact.content)
    if (!incorrectBelief) return []
    return [{
      misconceptionId: stableLocalId("MIS", item.sourceId, factId, incorrectBelief),
      incorrectBelief,
      diagnosticSignals: [
        `把“${fact.content}”误解为“${incorrectBelief}”`,
      ],
      counterexample: `该说法直接违背已审核事实“${fact.content}”。`,
      correctionStrategy: `比较错误说法与事实 ${factId} 的肯定/否定方向、对象和范围。`,
      distractorTemplates: [incorrectBelief],
      factRefs: [{ sourceId: item.sourceId, factId }],
    } satisfies KnowledgeMisconception]
  })
  return uniqueBy(derived, (entry) => normalize(entry.incorrectBelief)).slice(0, 12)
}

function directFactContradiction(content: string): string | undefined {
  const replacements: Array<[RegExp, string]> = [
    [/不允许/u, "允许"],
    [/不包含/u, "包含"],
    [/不能/u, "可以"],
    [/不可/u, "可以"],
    [/不会/u, "会"],
    [/无需/u, "必须"],
    [/必须/u, "不必"],
    [/应当/u, "不应"],
    [/应该/u, "不应"],
    [/可以/u, "不可以"],
    [/可用于/u, "不可用于"],
    [/用于/u, "不用于"],
    [/返回/u, "不返回"],
    [/表示/u, "不表示"],
    [/属于/u, "不属于"],
    [/是/u, "不是"],
    [/会/u, "不会"],
  ]
  for (const [pattern, replacement] of replacements) {
    if (!pattern.test(content)) continue
    const contradicted = content.replace(pattern, replacement).trim()
    if (normalize(contradicted) !== normalize(content)) return contradicted
  }
  return undefined
}

function deriveWorkedExamples(item: KnowledgeItem, factIds: string[]): KnowledgeWorkedExample[] {
  const fallbackFactIds = factIds.slice(0, Math.max(1, Math.min(3, factIds.length)))
  return item.examples.map((example, index) => ({
    title: example.title,
    problem: example.explanation.trim() || `观察“${example.title}”如何体现当前知识点。`,
    steps: [
      {
        // 旧示例偶尔把 source/fact 身份打印到学习者代码中。这些身份用于引用，
        // 不是领域知识或示例输出；投影到教学 V2 时必须移除。
        action: sanitizeTeachingExampleCode(example.code),
        rationale: example.explanation,
        factIds: fallbackFactIds,
      },
    ],
    boundaryCases: [],
    fadingLevel: Math.min(3, index) as 0 | 1 | 2 | 3,
  }))
}

function sanitizeTeachingExampleCode(code: string): string {
  return code
    .split(/\r?\n/u)
    .filter((line) => !/(?:source|source_id|fact_id)\s*[:=]\s*["']?K?\d+/iu.test(line))
    .join("\n")
    .trim()
}

function deriveObjectives(item: KnowledgeItem): ObservableObjective[] {
  const behaviors: ObservableObjective["behavior"][] = [
    "recognize", "explain", "trace", "apply", "debug", "create",
  ]
  return behaviors.flatMap((behavior) => {
    const selection = selectEvidenceBundle({
      behavior: behavior as EvidenceBehavior,
      facts: item.facts,
      max_facts: 5,
    })
    if (!selection.sufficient) return []
    return [{
    objectiveId: stableLocalId("KOBJ", item.sourceId, behavior),
    behavior,
    description: behavior === "recognize"
      ? `识别并准确表述“${item.title}”的核心规则。`
      : behavior === "explain"
        ? `依据已审核事实解释“${item.title}”的关键含义。`
        : `在新任务中应用“${item.title}”的已审核规则。`,
    factIds: selection.fact_ids,
  }]
  }).filter((objective) => objective.factIds.length > 0)
}

function derivePracticeTemplates(item: KnowledgeItem, factIds: string[]): PracticeTemplate[] {
  return item.practiceTasks.map((prompt, index) => ({
    templateId: stableLocalId("PT", item.sourceId, index, prompt),
    prompt,
    cognitiveDemand: index === 0 ? "apply" : "transfer",
    factIds: factIds.length > 0 ? [factIds[index % factIds.length]!] : [],
  }))
}

function stableLocalId(prefix: string, ...parts: unknown[]): string {
  const digest = createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 16)
  return `${prefix}-${digest}`
}

function uniqueBy<T>(values: T[], key: (value: T) => string): T[] {
  const seen = new Set<string>()
  return values.filter((value) => {
    const identity = key(value)
    if (seen.has(identity)) return false
    seen.add(identity)
    return true
  })
}

function normalize(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase()
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}
