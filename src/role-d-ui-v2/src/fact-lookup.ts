/**
 * 引用事实索引（Day6 方案 A：引用证据可查看事实原文）。
 *
 * publicSessionView 已暴露完整 rag_result（RagResult，含 results[].facts[].content
 * 与 results[].title 来源标题）。前端从 session.rag_result 建索引，按
 * `source_id:fact_id` 查事实原文，无需新增后端接口。
 *
 * 防御性设计：rag_result 可能是 null / 结构不符（types.ts 中是 unknown），
 * 一律返回空索引，不抛错；缺失引用如实返回 found:false，由展示层显示
 * "该事实不在当前会话证据中"（可追溯语义，不生成虚构来源）。
 */

export interface FactEntry {
  source_id: string
  fact_id: string
  content: string
  source_title: string
}

export type FactIndex = Map<string, FactEntry>

export interface FactHit {
  found: true
  entry: FactEntry
}

export interface FactMiss {
  found: false
}

export type FactLookupResult = FactHit | FactMiss

export interface CitationRefLike {
  source_id?: string
  fact_id?: string
}

function normId(value: unknown): string {
  return String(value ?? "").trim().toLocaleLowerCase()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function pickId(source: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return null
}

/** 从 session.rag_result 构建 source_id:fact_id → 事实条目 索引。结构不符时返回空索引。 */
export function buildFactIndex(ragResult: unknown): FactIndex {
  const index: FactIndex = new Map()
  if (!isRecord(ragResult)) return index
  const results = ragResult.results
  if (!Array.isArray(results)) return index
  for (const item of results) {
    if (!isRecord(item)) continue
    const sourceId = pickId(item, "source_id", "sourceId")
    const title = typeof item.title === "string" ? item.title : sourceId ?? "未命名来源"
    if (!sourceId) continue
    const facts = item.facts
    if (!Array.isArray(facts)) continue
    for (const fact of facts) {
      if (!isRecord(fact)) continue
      const factId = pickId(fact, "fact_id", "factId")
      const content = typeof fact.content === "string" ? fact.content.trim() : ""
      if (!factId || !content) continue
      const key = `${sourceId.toLocaleLowerCase()}:${factId.toLocaleLowerCase()}`
      index.set(key, { source_id: sourceId, fact_id: factId, content, source_title: title })
    }
  }
  return index
}

/** 按一条引用查事实；source_id/fact_id 缺失或不在索引中 → found:false。 */
export function lookupFact(index: FactIndex, citation: CitationRefLike | undefined | null): FactLookupResult {
  if (!citation) return { found: false }
  const sourceId = normId(citation.source_id)
  const factId = normId(citation.fact_id)
  if (!sourceId || !factId) return { found: false }
  const entry = index.get(`${sourceId}:${factId}`)
  return entry ? { found: true, entry } : { found: false }
}

/** 批量查询；保留引用顺序，供展示层逐条渲染。 */
export function lookupFacts(
  index: FactIndex,
  citations: readonly CitationRefLike[] | undefined | null,
): Array<{ citation: CitationRefLike; result: FactLookupResult }> {
  const list = Array.isArray(citations) ? citations : []
  return list.map((citation) => ({ citation, result: lookupFact(index, citation) }))
}

/** 去重后的引用列表（按 source_id:fact_id）；缺 source_id 或 fact_id 的引用无法查证，直接跳过。 */
export function uniqueCitations(citations: readonly CitationRefLike[] | undefined | null): CitationRefLike[] {
  const list = Array.isArray(citations) ? citations : []
  const seen = new Set<string>()
  const out: CitationRefLike[] = []
  for (const citation of list) {
    const sourceId = normId(citation.source_id)
    const factId = normId(citation.fact_id)
    if (!sourceId || !factId) continue
    const key = `${sourceId}:${factId}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(citation)
  }
  return out
}
