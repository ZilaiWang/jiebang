// 统一 IO 契约适配器：B 角色 → D 公开会话投影
// 将 B 的内部输出（LearnerProfile, ProfileProvenance, TeachingAuditResult, ArbitrationResult）
// 转换为统一契约（src/contracts/unified/）定义的 LooseRecord，用于 normalizeUnifiedHandoff。
// C 生成仍使用保留 RAG 证据和学习路径的 GenerateRoleCForRoleDInput。
import type { LooseRecord } from "../contracts/unified/types"
import type {
  LearnerProfile,
  ProfileSynthesis,
  ProfileConflict,
  ProfileProvenance,
} from "./types"
import type { TeachingAuditResult, ArbitrationResult } from "./teaching-audit/types"
import { buildRagQuery } from "./rag-bridge"

// ── B 画像 → 统一契约 profile 段 ──
// 输出: { learnerId, level, knownConcepts, weakConcepts, goal }
export function buildUnifiedProfile(profile: LearnerProfile): LooseRecord {
  return {
    learnerId: profile.learner_id,
    level: profile.level,
    knownConcepts: profile.known_concepts,
    weakConcepts: profile.weak_concepts,
    goal: profile.goal,
  }
}

// ── B 冲突列表 → 统一契约 conflicts 段 ──
// 输出: Array<{ concept, selfClaim, objectiveVerdict, resolution, rule }>
export function buildUnifiedConflicts(conflicts: ProfileConflict[]): LooseRecord[] {
  return conflicts.map((c) => ({
    concept: c.concept,
    selfClaim: c.selfClaim,
    objectiveVerdict: c.objectiveVerdict,
    resolution: c.resolution,
    rule: c.rule,
  }))
}

// ── B 整体溯源 → 统一契约 provenance 段 ──
// 输出: { conflicts, level }
export function buildUnifiedProvenance(provenance: ProfileProvenance): LooseRecord {
  return {
    level: provenance.level,
    conflicts: buildUnifiedConflicts(provenance.conflicts),
    concepts: provenance.concepts,
    unmapped_concepts: provenance.unmapped_concepts,
  }
}

// ── ProfileSynthesis → 统一契约 B 部分（b_profile + b_provenance + rag_query） ──
export function buildUnifiedBSynthesis(synthesis: ProfileSynthesis): LooseRecord {
  return {
    b_profile: buildUnifiedProfile(synthesis.profile),
    b_provenance: buildUnifiedProvenance(synthesis.provenance),
    rag_query: buildRagQuery(synthesis.profile),
  }
}

// ── 教学审核 → 统一契约 audit.teachingAudit 段 ──
// 契约期望: { artifactId, status, summary, revisionHints }
// B 输出额外扩展字段（failedDimensions 等），契约会忽略它们，不影响兼容性
export function buildUnifiedTeachingAudit(result: TeachingAuditResult): LooseRecord {
  return {
    artifactId: result.artifactId,
    status: result.status,
    summary: result.summary,
    revisionHints: result.revisionHints,
    // 扩展字段一并携带，供内部使用（契约规范化器会忽略不认识的字段）
    failedDimensions: result.failedDimensions,
    missingPrerequisiteSourceIds: result.missingPrerequisiteSourceIds,
    unknownPrerequisiteRefs: result.unknownPrerequisiteRefs,
    requiredAction: result.requiredAction,
    fixScope: result.fixScope,
    recommendedLevel: result.recommendedLevel,
    canRecover: result.canRecover,
  }
}

// ── 仲裁 → 统一契约 audit.arbitration 段 ──
// 契约期望: { artifactId, decision, revisionRound, maxRevisionRounds, canRevise, reason }
export function buildUnifiedArbitration(result: ArbitrationResult): LooseRecord {
  return {
    artifactId: result.artifactId,
    decision: result.decision,
    revisionRound: result.revisionRound,
    maxRevisionRounds: result.maxRevisionRounds,
    canRevise: result.canRevise,
    reason: result.reason,
    // 扩展字段
    factAuditNotes: result.factAuditNotes,
    teachingAuditNotes: result.teachingAuditNotes,
  }
}

// ── B 公开会话 handoff payload ──
// 输出可直接作为 normalizeUnifiedHandoff 的输入 LooseRecord
// 包含: b_profile, b_provenance, audit(teachingAudit + arbitration)
export interface BuildBHandoffInput {
  synthesis?: ProfileSynthesis
  teachingAudit?: TeachingAuditResult
  arbitration?: ArbitrationResult
  /** 学习者原始请求文本（可选项，来自证据包） */
  learnerRequest?: string
  /** 会话标识 */
  sessionId?: string
}

export function buildBHandoffPayload(input: BuildBHandoffInput): LooseRecord {
  const payload: LooseRecord = {}

  if (input.synthesis) {
    payload.b_profile = buildUnifiedProfile(input.synthesis.profile)
    payload.b_provenance = buildUnifiedProvenance(input.synthesis.provenance)
    payload.rag_query = buildRagQuery(input.synthesis.profile)
  }

  if (input.teachingAudit || input.arbitration) {
    const audit: LooseRecord = {}
    if (input.teachingAudit) {
      audit.teachingAudit = buildUnifiedTeachingAudit(input.teachingAudit)
    }
    if (input.arbitration) {
      audit.arbitration = buildUnifiedArbitration(input.arbitration)
    }
    payload.audit = audit
  }

  if (input.sessionId) {
    payload.sessionId = input.sessionId
  } else if (input.synthesis) {
    payload.sessionId = `session-${input.synthesis.profile.learner_id}`
  }

  payload.updatedAt = new Date().toISOString()

  return payload
}
