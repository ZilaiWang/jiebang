import { describe, expect, test } from "bun:test"
import {
  canResumeStage,
  recoveryInvalidatesStage,
  stageFingerprint,
} from "../src/role-c-content/orchestrator/content-pipeline"
import type { CPipelineCheckpoint } from "../src/role-c-content/reliability/checkpoint-store"
import type { ReviewRevisionContext } from "../src/role-c-content/review/types"

function revisionContext(overrides: Partial<ReviewRevisionContext> = {}): ReviewRevisionContext {
  return {
    revision_round: 1,
    review_policy_version: "v1",
    instruction_hash: "hash-1",
    instructions_by_agent: {
      concept_tutor: [],
      code_lab: [],
      tiered_evaluator: [{ instruction_id: "i1", target_agent: "tiered-evaluator", target_artifact_id: "a", objective_id: "o1" } as never],
    },
    affected_agents: ["tiered-evaluator"],
    parent_candidate_hashes: { concept: "", code_lab_public: "", code_lab_secure: "", assessment_public: "", assessment_secure: "" },
    ...overrides,
  }
}

function checkpoint(stage: CPipelineCheckpoint["stage"], fingerprints?: CPipelineCheckpoint["stage_fingerprints"]): CPipelineCheckpoint {
  return {
    input_hash: "sha256:test",
    stage,
    ...(stage !== "semantic_plan_ready" ? { concept: {} as never } : {}),
    ...(stage === "code_lab_ready" || stage === "branches_ready" ? { code_lab: {} as never } : {}),
    ...(stage === "assessment_ready" || stage === "branches_ready" ? { assessment: {} as never } : {}),
    ...(fingerprints ? { stage_fingerprints: fingerprints, revision_context: { revision_round: 1, instruction_hash: "hash-1" } } : {}),
  }
}

describe("改进方案4 第一批：检查点与外审修订关系", () => {
  test("阶段恢复只失效失败分支；讲义变化才级联失效下游", () => {
    const codeRecovery = {
      attempt: 1,
      failed_stage: "code_lab",
      issue_codes: ["PUBLIC_OUTPUT_INVALID"],
      failure_fingerprint: "sha256:code",
    } as any
    expect(recoveryInvalidatesStage(codeRecovery, "concept")).toBe(false)
    expect(recoveryInvalidatesStage(codeRecovery, "code_lab")).toBe(true)
    expect(recoveryInvalidatesStage(codeRecovery, "assessment")).toBe(false)

    const conceptRecovery = { ...codeRecovery, failed_stage: "concept" }
    expect(recoveryInvalidatesStage(conceptRecovery, "concept")).toBe(true)
    expect(recoveryInvalidatesStage(conceptRecovery, "code_lab")).toBe(true)
    expect(recoveryInvalidatesStage(conceptRecovery, "assessment")).toBe(true)
  })

  test("普通轮（无修订上下文）可恢复检查点", () => {
    expect(canResumeStage(checkpoint("concept_ready"), "concept", "any-fingerprint", undefined)).toBe(true)
    expect(canResumeStage(checkpoint("concept_ready"), "concept", "fp", { ...revisionContext(), revision_round: 0 })).toBe(true)
  })

  test("只有语义规划的检查点不能冒充讲义检查点", () => {
    expect(canResumeStage(checkpoint("semantic_plan_ready"), "concept", "fp", {
      ...revisionContext(),
      revision_round: 0,
    })).toBe(false)
  })

  test("外审修订轮：旧检查点仅对目标阶段 fail-closed，未受影响阶段仍可复用", () => {
    const ctx = revisionContext()
    expect(canResumeStage(checkpoint("assessment_ready"), "assessment", "fp", ctx)).toBe(false)
    expect(canResumeStage(checkpoint("concept_ready"), "concept", "fp", ctx)).toBe(true)
  })

  test("第 0 轮检查点可在第 1 轮局部复用，assessment 指令只失效 assessment", () => {
    const round0 = revisionContext({
      revision_round: 0,
      instruction_hash: "sha256:round0",
      instructions_by_agent: { concept_tutor: [], code_lab: [], tiered_evaluator: [] },
      affected_agents: [],
    })
    const round1 = revisionContext()
    const base = { inputHash: "sha256:x", blueprintId: "bp-1", conceptArtifactId: "c1" }
    const stored: CPipelineCheckpoint = {
      ...checkpoint("branches_ready"),
      revision_context: { revision_round: 0, instruction_hash: round0.instruction_hash },
      stage_fingerprints: {
        concept: stageFingerprint({ ...base, stage: "concept", revisionContext: round0 }),
        code_lab: stageFingerprint({ ...base, stage: "code_lab", revisionContext: round0 }),
        assessment: stageFingerprint({ ...base, stage: "assessment", revisionContext: round0 }),
      },
    }
    expect(canResumeStage(stored, "concept", stageFingerprint({ ...base, stage: "concept", revisionContext: round1 }), round1)).toBe(true)
    expect(canResumeStage(stored, "code_lab", stageFingerprint({ ...base, stage: "code_lab", revisionContext: round1 }), round1)).toBe(true)
    expect(canResumeStage(stored, "assessment", stageFingerprint({ ...base, stage: "assessment", revisionContext: round1 }), round1)).toBe(false)
  })

  test("外审修订轮：stage fingerprint 匹配才可恢复", () => {
    const ctx = revisionContext()
    const ckpt = checkpoint("assessment_ready", { assessment: "fp-assessment" })
    expect(canResumeStage(ckpt, "assessment", "fp-assessment", ctx)).toBe(true)
    expect(canResumeStage(ckpt, "assessment", "different", ctx)).toBe(false)
  })

  test("stageFingerprint：assessment 修订指令只改变 assessment 指纹，concept/code_lab 不变", () => {
    const base = { inputHash: "sha256:x", blueprintId: "bp-1" }
    const ctxA = revisionContext()
    const ctxB = revisionContext({
      instructions_by_agent: {
        concept_tutor: [],
        code_lab: [],
        tiered_evaluator: [{ instruction_id: "i2", target_agent: "tiered-evaluator", target_artifact_id: "a", objective_id: "o1" } as never],
      },
      instruction_hash: "hash-2",
    })
    const conceptA = stageFingerprint({ ...base, stage: "concept", revisionContext: ctxA })
    const conceptB = stageFingerprint({ ...base, stage: "concept", revisionContext: ctxB })
    expect(conceptA).toBe(conceptB) // concept 未被质疑 → 指纹不变 → 可复用
    const assessA = stageFingerprint({ ...base, stage: "assessment", revisionContext: ctxA, conceptArtifactId: "c1" })
    const assessB = stageFingerprint({ ...base, stage: "assessment", revisionContext: ctxB, conceptArtifactId: "c1" })
    expect(assessA).not.toBe(assessB) // assessment 被质疑 → 指纹变 → 失效
  })

  test("Concept 依赖失效：concept 产物变化使下游 code_lab/assessment 指纹变化", () => {
    const base = { inputHash: "sha256:x", blueprintId: "bp-1" }
    const ctx = revisionContext()
    const lab1 = stageFingerprint({ ...base, stage: "code_lab", revisionContext: ctx, conceptArtifactId: "c1" })
    const lab2 = stageFingerprint({ ...base, stage: "code_lab", revisionContext: ctx, conceptArtifactId: "c2" })
    expect(lab1).not.toBe(lab2)
    const assess1 = stageFingerprint({ ...base, stage: "assessment", revisionContext: ctx, conceptArtifactId: "c1" })
    const assess2 = stageFingerprint({ ...base, stage: "assessment", revisionContext: ctx, conceptArtifactId: "c2" })
    expect(assess1).not.toBe(assess2)
  })

  test("concept 修订指令改变 concept 指纹（concept 被质疑 → concept 失效）", () => {
    const base = { inputHash: "sha256:x", blueprintId: "bp-1" }
    const ctxA = revisionContext({ affected_agents: ["concept-tutor"] })
    const ctxB = revisionContext({
      affected_agents: ["concept-tutor"],
      instructions_by_agent: {
        concept_tutor: [{ instruction_id: "c1", target_agent: "concept-tutor", target_artifact_id: "a", objective_id: "o1" } as never],
        code_lab: [],
        tiered_evaluator: [],
      },
      instruction_hash: "hash-3",
    })
    expect(stageFingerprint({ ...base, stage: "concept", revisionContext: ctxA }))
      .not.toBe(stageFingerprint({ ...base, stage: "concept", revisionContext: ctxB }))
  })
})
