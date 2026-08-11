/**
 * Finite, auditable equivalence rules for evidence-backed Claim text.
 *
 * These rules intentionally do not permit added or removed propositions. They only
 * normalize Unicode/case/punctuation/spacing and a short allowlist of equivalent
 * Chinese function phrases. Free paraphrase still requires a future entailment
 * verifier and is rejected here.
 */
const EQUIVALENT_PHRASES: ReadonlyArray<readonly [RegExp, string]> = [
  [/可以用来/gu, "可用于"],
  [/可用来/gu, "可用于"],
  [/可以用于/gu, "可用于"],
  [/通常用于/gu, "常用于"],
  [/常常用于/gu, "常用于"],
  [/不可以/gu, "不能"],
  [/能够/gu, "能"],
  [/应当/gu, "应"],
]

export function normalizeGroundedClaimText(value: string): string {
  let normalized = value.normalize("NFKC").toLocaleLowerCase()
  for (const [pattern, replacement] of EQUIVALENT_PHRASES) {
    normalized = normalized.replace(pattern, replacement)
  }
  return normalized.replace(/[\s\p{P}\p{S}]+/gu, "")
}

export function claimTextMatchesFact(claimText: string, factText: string): boolean {
  const claim = normalizeGroundedClaimText(claimText)
  const fact = normalizeGroundedClaimText(factText)
  return claim.length > 0 && fact.length > 0 && claim === fact
}
