import type {
  AssessmentPublicArtifact,
  AssessmentRoutingRule,
} from "../contracts/artifacts"
import { validateRoleCSchema } from "../validators/runtime-schema-validator"

export interface AssessmentAnchorScore {
  item_id: string
  raw_score: number
}

export type AssessmentRoutingDecision =
  | {
      ok: true
      anchor_score_ratio: number
      route_id: string
      action: AssessmentRoutingRule["action"]
      reveal_tiers: Array<1 | 2 | 3>
      required_item_ids: string[]
    }
  | { ok: false; issues: string[] }

/**
 * Applies the Author's validated anchor policy. Intervals are lower-inclusive and
 * upper-exclusive, except the final interval which includes 1.0.
 */
export function routeAssessmentFromAnchors(
  artifact: AssessmentPublicArtifact,
  scores: AssessmentAnchorScore[],
): AssessmentRoutingDecision {
  const schema = validateRoleCSchema("assessment_public.schema.json", artifact)
  if (!schema.ok || artifact.status !== "ready" || !artifact.payload) {
    return {
      ok: false,
      issues: [
        ...schema.issues.map((issue) => `${issue.path}: ${issue.message}`),
        ...(artifact.status !== "ready" || !artifact.payload ? ["assessment_public 未就绪"] : []),
      ],
    }
  }

  const payload = artifact.payload
  const itemById = new Map(payload.items.map((item) => [item.item_id, item]))
  const anchorIds = payload.routing.anchor_item_ids
  const scoreById = new Map<string, number>()
  const issues: string[] = []
  for (const score of scores) {
    if (scoreById.has(score.item_id)) issues.push(`锚点成绩重复：${score.item_id}`)
    if (!anchorIds.includes(score.item_id)) issues.push(`非锚点题不得进入路由：${score.item_id}`)
    const item = itemById.get(score.item_id)
    if (!item) issues.push(`锚点题不存在：${score.item_id}`)
    if (!Number.isFinite(score.raw_score) || score.raw_score < 0 || (item && score.raw_score > item.max_score)) {
      issues.push(`锚点成绩越界：${score.item_id}`)
    }
    scoreById.set(score.item_id, score.raw_score)
  }
  for (const itemId of anchorIds) {
    if (!scoreById.has(itemId)) issues.push(`缺少锚点成绩：${itemId}`)
  }
  if (issues.length > 0) return { ok: false, issues: [...new Set(issues)] }

  const maximum = anchorIds.reduce((sum, itemId) => sum + itemById.get(itemId)!.max_score, 0)
  if (maximum <= 0) return { ok: false, issues: ["锚点题总分必须大于 0"] }
  const achieved = anchorIds.reduce((sum, itemId) => sum + scoreById.get(itemId)!, 0)
  const ratio = round01(achieved / maximum)
  const rules = [...payload.routing.rules].sort((left, right) =>
    left.min_anchor_score_ratio - right.min_anchor_score_ratio,
  )
  const selected = rules.find((rule, index) =>
    ratio >= rule.min_anchor_score_ratio
      && (index === rules.length - 1
        ? ratio <= rule.max_anchor_score_ratio
        : ratio < rule.max_anchor_score_ratio),
  )
  if (!selected) return { ok: false, issues: [`锚点分数 ${ratio} 未命中任何路由区间`] }

  const required = payload.items
    .filter((item) => anchorIds.includes(item.item_id) || selected.reveal_tiers.includes(item.tier))
    .map((item) => item.item_id)
  return {
    ok: true,
    anchor_score_ratio: ratio,
    route_id: selected.route_id,
    action: selected.action,
    reveal_tiers: [...selected.reveal_tiers],
    required_item_ids: [...new Set(required)],
  }
}

function round01(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 1_000_000) / 1_000_000
}
