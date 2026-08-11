// 输入: 学习者的自由概念短语（如 "for循环写不来"）+ 知识库
// 输出: 规范概念（知识库里真实存在的关键词或标题）+ 支撑映射的 source_id 列表
// 为什么存在: A 的检索器 (src/rag/retriever.ts) 按知识库 keywords 子串匹配打分，
// 画像里的概念如果不在知识库词表内，检索得 0 分。规范化把学习者语言翻译成检索器能命中的词。
// 零硬编码: 词表完全来自 loadKnowledgeBase()，知识库扩充后本模块自动跟进。
import type { KnowledgeBase } from "../knowledge/types"

export interface CanonicalConcept {
  raw: string
  canonical: string
  matched: boolean
  sourceIds: string[]
}

// 与 A 的检索器同款归一化：小写 + 去空白（保持两侧对词的判定一致）
function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "")
}

// 中日韩字符按 2 计权：中文词每字信息量高于单个拉丁字母，
// 避免 "for循环写不来" 因 "for"(3字母) 比 "循环"(2字) 长而错选拉丁词做规范名
function termWeight(term: string): number {
  let weight = 0
  for (const char of term) {
    weight += /[\u4e00-\u9fff]/.test(char) ? 2 : 1
  }
  return weight
}

interface TermHit {
  term: string
  weight: number
  // exact: 短语与词完全相等；phrase_has_term: 短语包含词（词是短语内的具体概念）；
  // term_has_phrase: 词包含短语（有过度特化风险，如 "循环"→"while 循环"，仅作兜底）
  direction: "exact" | "phrase_has_term" | "term_has_phrase"
  sourceIds: Set<string>
}

const DIRECTION_RANK = { exact: 0, phrase_has_term: 1, term_has_phrase: 2 } as const

// 把一个自由短语映射到知识库词表。匹配优先级（被 demo 实跑暴露的 bug 逼出的规则）:
//   1. exact —— 短语就是词表里的词（"循环" = K007/K008 keyword "循环"）
//   2. phrase_has_term —— 短语包含词，取权重最大者（"for循环写不来" → "循环"，更长≈更具体）
//   3. term_has_phrase —— 词包含短语，取权重最小者（最少过度特化；
//      若无此规则 "循环" 会被 "while 循环" 抢走，学习者答错的却是 for 循环题）
// 无命中则原样保留并标记 matched=false
export function canonicalizeConcept(raw: string, knowledgeBase: KnowledgeBase): CanonicalConcept {
  const phrase = normalize(raw)
  if (phrase.length === 0) {
    return { raw, canonical: raw, matched: false, sourceIds: [] }
  }

  const hits = new Map<string, TermHit>()

  for (const item of knowledgeBase.items) {
    for (const term of [item.title, ...item.keywords]) {
      const normalizedTerm = normalize(term)
      if (normalizedTerm.length < 2) continue

      let direction: TermHit["direction"]
      if (normalizedTerm === phrase) {
        direction = "exact"
      } else if (phrase.includes(normalizedTerm)) {
        direction = "phrase_has_term"
      } else if (normalizedTerm.includes(phrase)) {
        direction = "term_has_phrase"
      } else {
        continue
      }

      const existing = hits.get(normalizedTerm)
      if (existing) {
        existing.sourceIds.add(item.sourceId)
        if (DIRECTION_RANK[direction] < DIRECTION_RANK[existing.direction]) {
          existing.direction = direction
        }
      } else {
        hits.set(normalizedTerm, {
          term,
          weight: termWeight(term),
          direction,
          sourceIds: new Set([item.sourceId]),
        })
      }
    }
  }

  if (hits.size === 0) {
    return { raw, canonical: raw, matched: false, sourceIds: [] }
  }

  const best = [...hits.values()].sort((left, right) => {
    const byDirection = DIRECTION_RANK[left.direction] - DIRECTION_RANK[right.direction]
    if (byDirection !== 0) return byDirection
    // phrase_has_term 取最长（更具体）；term_has_phrase 取最短（最少过度特化）
    const byWeight =
      left.direction === "term_has_phrase" ? left.weight - right.weight : right.weight - left.weight
    if (byWeight !== 0) return byWeight
    return left.term.localeCompare(right.term)
  })[0]

  return {
    raw,
    canonical: best.term,
    matched: true,
    sourceIds: [...best.sourceIds].sort(),
  }
}

// 批量规范化并按规范名去重（同一概念的多种说法合并，保留最先出现的原始说法）。
// 边界: 去重只认"规范名相同"。同一知识点的不同 keyword（如 K009 的"列表"与"一组数据"）
// 不会互相合并——跨词聚类需要额外规则且易误伤（K018 同时含"列表""循环"keyword），
// V1 保持简单；两个词检索时都命中同一知识点，端到端无损。
export function canonicalizeMany(raws: string[], knowledgeBase: KnowledgeBase): CanonicalConcept[] {
  const seen = new Map<string, CanonicalConcept>()
  for (const raw of raws) {
    const result = canonicalizeConcept(raw, knowledgeBase)
    if (!seen.has(result.canonical)) {
      seen.set(result.canonical, result)
    }
  }
  return [...seen.values()]
}
