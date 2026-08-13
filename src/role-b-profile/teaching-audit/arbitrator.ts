// 输入: ArbitrationInput（A 事实审核状态 + B 教学审核状态 + 修订轮次）
// 输出: ArbitrationResult（统一裁决 pass/revise/reject + 能否继续修订）
// 作用: B 角色 Week2 仲裁机制——合并双审核结果，给出统一裁决
// 规则: 双审核任一 reject → reject；任一 revise → revise；全 pass → pass
// 最多 2 轮修订（组长文档要求）；超过则不再 revise，转为 reject
import type { ArbitrationInput, ArbitrationResult, ArbitrationDecision } from "./types"

const MAX_REVISION_ROUNDS = 2

export function arbitrate(input: ArbitrationInput): ArbitrationResult {
  const { artifactId, factAuditStatus, teachingAuditStatus, revisionRound } = input

  const factAuditNotes: string[] = []
  const teachingAuditNotes: string[] = []

  if (factAuditStatus !== "pass") {
    factAuditNotes.push(`事实审核状态: ${factAuditStatus} — 内容引用存在问题`)
  }
  if (teachingAuditStatus !== "pass") {
    teachingAuditNotes.push(`教学审核状态: ${teachingAuditStatus} — 教学规范性存在问题`)
  }

  // 任一 reject → reject
  if (factAuditStatus === "reject" || teachingAuditStatus === "reject") {
    return {
      artifactId,
      decision: "reject",
      revisionRound,
      maxRevisionRounds: MAX_REVISION_ROUNDS,
      canRevise: false,
      reason: buildRejectReason(factAuditStatus, teachingAuditStatus),
      factAuditNotes,
      teachingAuditNotes,
    }
  }

  // 任一 revise → 判断能否继续修订
  if (factAuditStatus === "revise" || teachingAuditStatus === "revise") {
    const canRevise = revisionRound < MAX_REVISION_ROUNDS
    const decision: ArbitrationDecision = canRevise ? "revise" : "reject"

    return {
      artifactId,
      decision,
      revisionRound,
      maxRevisionRounds: MAX_REVISION_ROUNDS,
      canRevise,
      reason: canRevise
        ? `第 ${revisionRound + 1} 轮修订后仍存在问题，允许再进行一轮修订（剩余 ${MAX_REVISION_ROUNDS - revisionRound - 1} 轮）。`
        : `已进行 ${revisionRound + 1} 轮修订（超出上限 ${MAX_REVISION_ROUNDS} 轮），转为驳回。`,
      factAuditNotes,
      teachingAuditNotes,
    }
  }

  // 双 pass → pass
  return {
    artifactId,
    decision: "pass",
    revisionRound,
    maxRevisionRounds: MAX_REVISION_ROUNDS,
    canRevise: false,
    reason: "事实审核与教学审核均通过，内容可发布。",
    factAuditNotes: [],
    teachingAuditNotes: [],
  }
}

function buildRejectReason(
  factStatus: string,
  teachingStatus: string,
): string {
  const parts: string[] = []
  if (factStatus === "reject") parts.push("事实审核驳回（引用不存在、错位或使用知识库外内容）")
  if (teachingStatus === "reject") parts.push("教学审核驳回（难度/前置知识严重不匹配）")
  return parts.join("；") + "。内容需重新生成。"
}
