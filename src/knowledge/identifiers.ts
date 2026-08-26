/**
 * Knowledge identities are opaque registry keys. Prefixes such as K, PY and AI
 * are catalog namespaces, not protocol semantics, so contracts must not
 * special-case one namespace.
 */
/**
 * Stable knowledge-source identifier: namespace prefix + numeric serial.
 * Examples: K001, PY004, AI020. Requiring the numeric suffix prevents
 * recovery code names such as BLOCKED_INVALID_OUTPUT from being mistaken
 * for a knowledge source when parsing diagnostic text.
 */
export const SOURCE_ID_PATTERN = /^[A-Z][A-Z0-9_-]{0,27}[0-9]{3,6}$/
export const FACT_ID_PATTERN = /^F[0-9]{3,6}$/

export interface FactIdentity {
  source_id: string
  fact_id: string
}

export function factKey(ref: FactIdentity): string {
  return `${ref.source_id}:${ref.fact_id}`
}

export function isValidSourceId(value: string): boolean {
  return SOURCE_ID_PATTERN.test(value)
}

export function isValidFactId(value: string): boolean {
  return FACT_ID_PATTERN.test(value)
}
