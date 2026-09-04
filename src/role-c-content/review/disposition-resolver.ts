import { contentHash } from "../contracts/common"
import type { ObservableBehavior } from "../contracts/profile-adapter"
import type {
  ContentReviewFinding,
  ReviewBlockLocator,
  ReviewFixScope,
} from "./types"

/**
 * 失败责任归属与修复范围裁决（改进方案4 第九节）。
 *
 * 历史上 local-ab-review-port 把任何语义审核的 unsupported/uncertain 都固定归为
 * `fix_scope: "artifact"`，把三类本质不同的问题混为一谈：C 措辞越界、A 证据缺失、
 * B 路径不合理。本模块做确定性裁决——模型的 suggested_scope 只作建议，最终 scope
 * 由 locator + support_gap + objective behavior 决定。
 */

export type FailureOwner = "A" | "B" | "C" | "runtime"
export type DispositionScope = ReviewFixScope | "provider"

export interface ReviewDisposition {
  owner: FailureOwner
  fix_scope: DispositionScope
  /** 面向恢复阶梯的 action。 */
  action: string
}

export interface ResolveDispositionInput {
  code: string
  locator?: ReviewBlockLocator
  support_gap?: "none" | "optional_overreach" | "essential_fact_missing" | "objective_evidence_mismatch"
  objective_behavior?: ObservableBehavior
  suggested_scope?: "artifact" | "new_evidence" | "new_spec"
  /** The generated block already has a feasible cited-fact surface and can be rewritten without changing B/A contracts. */
  replaceable_generated_surface?: boolean
}

const PROVIDER_CODE = /provider|docker|runtime|transport|network|timeout|socket|ECONN|ENOENT/i
const PREREQUISITE_CODE = /prerequisite|missing_prereq|replan_path/i
const CAPACITY_CODE = /capacity|blueprint_tier_count|tier_count|fixed_quota/i

export function resolveFindingDisposition(input: ResolveDispositionInput): ReviewDisposition {
  // 运行环境失败 → runtime / provider（传输重试、环境恢复）
  if (PROVIDER_CODE.test(input.code)) {
    return { owner: "runtime", fix_scope: "provider", action: "provider_runtime_retry" }
  }
  // 前置知识缺失 / 需要重新规划路径 → B / new_spec
  if (PREREQUISITE_CODE.test(input.code)) {
    return { owner: "B", fix_scope: "new_spec", action: "replan_path" }
  }
  // 固定题量超过可行容量 → B / new_spec
  if (CAPACITY_CODE.test(input.code)) {
    return { owner: "B", fix_scope: "new_spec", action: "reduce_blueprint_or_replan" }
  }

  // 语义不支持：按 support_gap 分类路由
  if (input.support_gap === "essential_fact_missing") {
    if (input.replaceable_generated_surface) {
      return { owner: "C", fix_scope: "artifact", action: "rewrite_with_current_facts" }
    }
    // A generated teaching surface is normally replaceable.  A quiz, hint,
    // example, reflection or public task that chose an evidence-external angle
    // is C overreach, not proof that the frozen objective itself needs another
    // fact.  Only an assessment item (whose modality/operation is frozen by B)
    // turns an essential answerability gap into an A evidence request.
    if (input.locator?.field !== "assessment_item") {
      return { owner: "C", fix_scope: "artifact", action: "rewrite_with_current_facts" }
    }
    return { owner: "A", fix_scope: "new_evidence", action: "request_supporting_fact" }
  }
  if (input.support_gap === "objective_evidence_mismatch") {
    // 冻结 objective 要求的行为证据只能支撑更低级行为 → A 补证据 或 B 降低行为要求
    const downgradable = canDowngradeBehavior(input.objective_behavior)
    return downgradable
      ? { owner: "B", fix_scope: "new_spec", action: "downgrade_objective_behavior" }
      : { owner: "A", fix_scope: "new_evidence", action: "request_behavior_supporting_evidence" }
  }
  if (input.support_gap === "optional_overreach") {
    // 多写了一个无依据用途 / 额外 API → C 局部改写
    return { owner: "C", fix_scope: "artifact", action: "remove_or_rewrite_local_overreach" }
  }

  // 模型建议仅作参考，但确定性规则优先：默认 C / artifact
  if (input.suggested_scope === "new_evidence") {
    return { owner: "A", fix_scope: "new_evidence", action: "request_supporting_fact" }
  }
  if (input.suggested_scope === "new_spec") {
    return { owner: "B", fix_scope: "new_spec", action: "replan_or_adjust_blueprint" }
  }
  return { owner: "C", fix_scope: "artifact", action: "local_rewrite" }
}

/** 高等级行为是否可降级为低等级（如 trace → recognize）。create 不可降级。 */
function canDowngradeBehavior(behavior: ObservableBehavior | undefined): boolean {
  if (!behavior) return false
  return behavior !== "create"
}

/**
 * 稳定 finding 指纹（改进方案4 第六节）。
 * 不把模型生成的自然语言 reason 全文纳入身份，只纳入结构化定位信息与
 * source/code/artifact/locator/evidence，保证同一问题跨轮可被识别为"同一个 finding"。
 */
export function findingFingerprint(finding: ContentReviewFinding): string {
  const locator = finding.locator
  return contentHash({
    source: finding.source,
    code: finding.code,
    artifact_kind: finding.artifact_kind,
    locator: locator
      ? {
          field: locator.field,
          ref_id: locator.ref_id,
          parent_block_id: locator.parent_block_id,
          objective_id: locator.objective_id,
        }
      : undefined,
    // Artifact ids and unsupported prose are regenerated between candidates;
    // including either makes the same logical problem look new every round.
    evidence_refs: finding.evidence_refs
      .filter((reference) => !reference.startsWith("text:"))
      .map((reference) => reference.replace(/^.*?:((?:claim|misconception|quiz|hint|public_test|starter_code|render_content|reflection|option|assessment_item):)/u, "$1"))
      .sort(),
  })
}

/** 判断一组修订后 finding 是否"问题单调减少"：原目标 finding 消失且无新增同源 hard finding。 */
export function revisionStrictlyImproves(input: {
  beforeFingerprints: string[]
  afterFingerprints: string[]
}): boolean {
  const before = new Set(input.beforeFingerprints)
  const after = new Set(input.afterFingerprints)
  // 原 finding 至少一个消失
  const anyResolved = [...before].some((fingerprint) => !after.has(fingerprint))
  if (!anyResolved) return false
  // 不允许新增原集合外的 finding（回归）
  const introduced = [...after].filter((fingerprint) => !before.has(fingerprint))
  return introduced.length === 0
}
