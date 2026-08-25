import { createHash } from "node:crypto"
import type {
  KnowledgeFact,
  KnowledgeItem,
  KnowledgeMisconception,
  KnowledgeWorkedExample,
  ObservableObjective,
  PracticeTemplate,
} from "./types"

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
      : deriveObjectives(source, factIds),
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
  }
}

function deriveMisconceptions(item: KnowledgeItem, facts: KnowledgeFact[]): KnowledgeMisconception[] {
  const factById = new Map(facts.map((fact) => [fact.factId, fact]))
  const derived = item.quizItems.flatMap((quiz, quizIndex) => {
    const fact = factById.get(quiz.factId)
    if (!fact || !quiz.options?.length) return []
    return quiz.options
      .filter((option) => normalize(option) !== normalize(quiz.answer))
      .slice(0, 3)
      .map((option, optionIndex): KnowledgeMisconception => ({
        misconceptionId: stableLocalId("MIS", item.sourceId, quizIndex, optionIndex, option),
        incorrectBelief: option,
        diagnosticSignals: [
          `在考查“${item.title}”时选择或表达“${option}”`,
        ],
        counterexample: `该说法与已审核事实“${fact.content}”不一致。`,
        correctionStrategy: `回到事实 ${quiz.factId}，要求学习者比较该说法与事实原意。`,
        distractorTemplates: [option],
        factRefs: [{ sourceId: item.sourceId, factId: quiz.factId }],
      }))
  })
  return uniqueBy(derived, (entry) => normalize(entry.incorrectBelief)).slice(0, 12)
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

function deriveObjectives(item: KnowledgeItem, factIds: string[]): ObservableObjective[] {
  const behaviors: ObservableObjective["behavior"][] = ["recognize", "explain", "apply"]
  return behaviors.map((behavior, index) => ({
    objectiveId: stableLocalId("KOBJ", item.sourceId, behavior),
    behavior,
    description: behavior === "recognize"
      ? `识别并准确表述“${item.title}”的核心规则。`
      : behavior === "explain"
        ? `依据已审核事实解释“${item.title}”的关键含义。`
        : `在新任务中应用“${item.title}”的已审核规则。`,
    factIds: factIds.filter((_, factIndex) => factIndex % behaviors.length === index)
      .slice(0, 4)
      .concat(index === 0 && factIds.length > 0 ? [factIds[0]!] : [])
      .filter((factId, factIndex, values) => values.indexOf(factId) === factIndex),
  })).filter((objective) => objective.factIds.length > 0)
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
