import type { EvidenceCapability, KnowledgeFact } from "./types"

export type EvidenceBehavior = "recognize" | "explain" | "trace" | "apply" | "debug" | "create"

const CAPABILITY_PATTERNS: Array<[EvidenceCapability, RegExp]> = [
  ["definition", /(?:是指|是(?:一种|一个|用于|由)|表示|属于|定义|概念|用于)/u],
  ["rule", /(?:必须|应当|应该|不能|不允许|可用|可以|用于|使用|通过|如果|判断|计算|返回|等于|包含)/u],
  ["procedure", /(?:步骤|顺序|先.{0,12}后|然后|接着|逐项|逐行|遍历|迭代|执行|调用|读取|写入|导入|打开|关闭|创建|定义)/u],
  ["state_transition", /(?:变为|变成|更新|修改|新增|增加|删除|移除|执行|结束|终止|返回|产生|关闭|重新(?:赋值|绑定)|覆盖(?:旧值|原值|旧绑定|原绑定)|新值)/u],
  ["boundary", /(?:边界|不能|不允许|不可|异常|错误|报错|越界|不存在|为空|否则|限制|风险|避免|注意|只在|仅当)/u],
  ["contrast", /(?:区别|不同于|相比|相同|分别|而不是|但|然而|反之|两者|二者)/u],
  ["io_contract", /(?:输入|输出|返回|参数|实参|形参|读取|写入|对应|print|input|stdin|stdout)/iu],
  ["example", /(?:例如|比如|如[： ]|\b(?:def|for|while|if|return|print|input|import|open)\b|[()[\]{}.=:+*/-])/iu],
]

/** Capability requirements are conjunctions of alternative groups. */
export const BEHAVIOR_CAPABILITY_REQUIREMENTS: Record<EvidenceBehavior, EvidenceCapability[][]> = {
  recognize: [["definition", "rule"]],
  explain: [["definition", "rule"]],
  trace: [["procedure", "state_transition"]],
  apply: [["rule", "procedure"], ["io_contract", "state_transition", "example"]],
  debug: [["rule", "procedure"], ["boundary", "contrast"]],
  create: [["rule", "procedure"], ["io_contract", "state_transition"]],
}

export function inferFactCapabilities(content: string): EvidenceCapability[] {
  const capabilities = CAPABILITY_PATTERNS
    .filter(([, pattern]) => pattern.test(content))
    .map(([capability]) => capability)
  return capabilities.length > 0 ? capabilities : ["definition"]
}

export interface CapabilityFactLike {
  factId?: string
  fact_id?: string
  content: string
  capabilities?: EvidenceCapability[]
}

export interface EvidenceBundleSelection {
  fact_ids: string[]
  capabilities: EvidenceCapability[]
  missing_capabilities: EvidenceCapability[][]
  sufficient: boolean
}

/**
 * Selects the smallest source-local fact bundle that can support the requested
 * observable behavior. Existing preferred facts influence ordering but never
 * bypass capability requirements.
 */
export function selectEvidenceBundle(input: {
  behavior: EvidenceBehavior
  facts: CapabilityFactLike[]
  preferred_fact_ids?: string[]
  max_facts?: number
}): EvidenceBundleSelection {
  const preferred = new Set(input.preferred_fact_ids ?? [])
  const maxFacts = Math.max(1, Math.min(8, input.max_facts ?? 5))
  const facts = input.facts.flatMap((fact, index) => {
    const factId = fact.fact_id ?? fact.factId ?? `__CAPABILITY_FACT_${index}`
    const capabilities = fact.capabilities?.length
      ? [...new Set(fact.capabilities)]
      : inferFactCapabilities(fact.content)
    return [{ fact_id: factId, content: fact.content, capabilities, index }]
  }).sort((left, right) =>
    Number(preferred.has(right.fact_id)) - Number(preferred.has(left.fact_id))
      || left.index - right.index)

  const selected: typeof facts = []
  const add = (fact: typeof facts[number] | undefined) => {
    if (!fact || selected.some((entry) => entry.fact_id === fact.fact_id) || selected.length >= maxFacts) return
    selected.push(fact)
  }
  const requirements = BEHAVIOR_CAPABILITY_REQUIREMENTS[input.behavior]
  for (const alternatives of requirements) {
    add(facts.find((fact) => alternatives.some((capability) => fact.capabilities.includes(capability))))
  }
  // Keep one explanatory anchor when the operational facts do not state the
  // concept identity themselves.
  add(facts.find((fact) => fact.capabilities.includes("definition")))
  // Requirements plus one definition anchor are the complete minimal bundle.
  // A preferred fact only decides which candidate satisfies a capability; it
  // must never cause an old oversized objective to pull every historical fact
  // back into a newly planned objective.

  const selectedCapabilities = [...new Set(selected.flatMap((fact) => fact.capabilities))]
  const missing = requirements.filter((alternatives) =>
    !alternatives.some((capability) => selectedCapabilities.includes(capability)))
  return {
    fact_ids: selected
      .map((fact) => fact.fact_id)
      .filter((factId) => !factId.startsWith("__CAPABILITY_FACT_")),
    capabilities: selectedCapabilities,
    missing_capabilities: missing,
    sufficient: selected.length > 0 && missing.length === 0,
  }
}

export function selectKnowledgeFactIdsForBehavior(
  facts: KnowledgeFact[],
  behavior: EvidenceBehavior,
): string[] {
  return selectEvidenceBundle({ behavior, facts }).fact_ids
}
