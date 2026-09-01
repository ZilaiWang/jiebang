import type { RoleCExpressionContext } from "../../role-b-profile/expression-context-contract"

export interface ExpressionAdaptationAudit {
  applicable: boolean
  score: number
  issue_codes: string[]
  evidence_refs: string[]
}

const PROFILE_LABEL = /(?:文科生|理科生|工科生|商科生|艺术生|humanities_social_sciences|science_engineering|business_management|arts_design|health_life_sciences|vocational_applied)/iu
const ABILITY_STEREOTYPE = /(?:因为|由于|考虑到).{0,18}(?:文科|理科|工科|商科|艺术|专业背景).{0,35}(?:能力|简单|困难|降低|提高|不擅长|更适合|学不会|理解力)/iu
const DIRECT_IDENTIFIER = /(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)|(?<!\d)\d{15,18}[0-9Xx](?!\d))/iu

/** Audits public payload only. Expression alignment ranks candidates; privacy and stereotype leaks block release. */
export function evaluateExpressionAdaptation(
  payload: unknown,
  context: RoleCExpressionContext | undefined,
): ExpressionAdaptationAudit {
  const text = collectText(payload)
  const issues = [
    ...(PROFILE_LABEL.test(text) ? ["EXPRESSION_PROFILE_LABEL_LEAK"] : []),
    ...(ABILITY_STEREOTYPE.test(text) ? ["EXPRESSION_ABILITY_STEREOTYPE"] : []),
    ...(DIRECT_IDENTIFIER.test(text) ? ["EXPRESSION_DIRECT_IDENTIFIER_LEAK"] : []),
  ]
  const applicable = Boolean(context?.enabled && (
    context.discipline_family !== "unspecified"
    || context.task_contexts.length > 0
    || context.hint_emphasis.length > 0
  ))
  if (!applicable || !context) {
    return { applicable: false, score: 1, issue_codes: issues, evidence_refs: [] }
  }

  const signals = [
    frameSignal(text, context.explanation_frame),
    terminologySignal(text, context.terminology_bridge),
    contextSignal(text, [...context.task_contexts, ...context.analogy_domains]),
    focusSignal(text, [...context.hint_emphasis, ...context.troubleshooting_focus]),
  ]
  const applicableSignals = signals.filter((value) => value !== null) as number[]
  const score = applicableSignals.length === 0
    ? 0.55
    : applicableSignals.reduce((sum, value) => sum + value, 0) / applicableSignals.length
  return {
    applicable: true,
    score: round(score),
    issue_codes: issues,
    evidence_refs: [
      `expression:${context.explanation_frame}`,
      `expression:${context.terminology_bridge}`,
      `expression:${context.discipline_family}`,
    ],
  }
}

export function expressionAdaptationBlockingIssues(
  payload: unknown,
  context: RoleCExpressionContext | undefined,
): string[] {
  return evaluateExpressionAdaptation(payload, context).issue_codes
}

function frameSignal(text: string, frame: RoleCExpressionContext["explanation_frame"]): number | null {
  if (!text.trim()) return 0
  if (frame === "narrative_semantic") return signal(text, /(?:例如|可以把|依次|场景|关系|先看)/u)
  if (frame === "formal_structural") return signal(text, /(?:结构|状态|输入|输出|关系|定义|条件)/u)
  if (frame === "workflow_applied") return signal(text, /(?:任务|步骤|先.{0,20}再|然后|最后|检查)/u)
  if (frame === "visual_structural") return signal(text, /(?:结构|分组|图层|层次|映射|对照)/u)
  return null
}

function terminologySignal(text: string, bridge: RoleCExpressionContext["terminology_bridge"]): number | null {
  if (bridge === "plain_then_formal") return signal(text, /(?:也就是|可以理解为|这里的.{0,12}(?:称为|叫作)|换句话说)/u)
  if (bridge === "formal_with_plain_gloss") return signal(text, /(?:即|表示|含义是|也就是)/u)
  if (bridge === "example_then_term") return signal(text, /(?:例如|示例|观察).{0,80}(?:称为|叫作|表示)/u)
  return null
}

function contextSignal(text: string, contexts: string[]): number | null {
  const tokens = contexts.flatMap(tokenize).filter((value) => value.length >= 2)
  if (tokens.length === 0) return null
  return tokens.some((token) => text.includes(token)) ? 1 : 0.35
}

function focusSignal(text: string, focuses: string[]): number | null {
  const tokens = focuses.flatMap(tokenize).filter((value) => value.length >= 2)
  if (tokens.length === 0) return null
  return tokens.some((token) => text.includes(token)) ? 1 : 0.45
}

function tokenize(value: string): string[] {
  return value.normalize("NFKC").split(/[\s、，。；：,:;()（）/]+/u).map((entry) => entry.trim())
}

function signal(text: string, pattern: RegExp): number {
  return pattern.test(text) ? 1 : 0.4
}

function collectText(value: unknown): string {
  if (typeof value === "string") return value
  if (Array.isArray(value)) return value.map(collectText).join("\n")
  if (!value || typeof value !== "object") return ""
  return Object.values(value as Record<string, unknown>).map(collectText).join("\n")
}

function round(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 10_000) / 10_000
}
