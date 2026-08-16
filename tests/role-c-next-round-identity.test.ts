import { describe, expect, test } from "bun:test"
import { loadKnowledgeBase } from "../src/knowledge/loader"
import { retrieveKnowledge } from "../src/rag/retriever"
import {
  adaptLearnerProfile,
  adaptRagResult,
  buildGenerationSpec,
  contentHash,
  defineLearningPathNode,
  ROLE_C_PROMPT_MANIFEST_VERSION,
  type NextRoundExecutionDependencies,
  type ReviewedCPipelineResult,
} from "../src/role-c-content"
import type { CPipelineInput } from "../src/role-c-content/orchestrator/content-pipeline"
import type {
  GenerationReadyNextRound,
  PrepareNextRoundInput,
} from "../src/role-c-content/orchestrator/next-round"
import { executePreparedNextRound } from "../src/role-c-content/orchestrator/next-round"
import type { LearnerProfile } from "../src/role-b-profile/types"
import type { LearnerProfileSnapshot } from "../src/role-c-content/contracts/profile-adapter"

const runnerDigest = `sha256:${"e".repeat(64)}`

async function realSpec() {
  const profile: LearnerProfile = {
    learner_id: "learner-next-round",
    level: "basic",
    known_concepts: ["变量", "条件判断"],
    weak_concepts: ["循环", "列表", "成绩统计"],
    goal: "完成循环、列表和成绩统计练习",
  }
  const kb = await loadKnowledgeBase()
  const rag = await retrieveKnowledge({
    query: "循环 列表 成绩统计 变量 条件判断",
    learnerLevel: profile.level,
    topK: 5,
  })
  const evidence = adaptRagResult(rag, {
    kb_version: kb.version,
    rag_version: "rule-rag-next-round-test",
  })
  const rawPath = await Bun.file(
    "examples/role-c-content/learning_path_node_score_project.json",
  ).json()
  const path = defineLearningPathNode({
    node_id: rawPath.node_id,
    target_source_ids: [...rawPath.target_source_ids],
    prerequisite_source_ids: [...rawPath.prerequisite_source_ids],
    goal: rawPath.goal,
    objectives: structuredClone(rawPath.objectives),
    assessment_blueprint: structuredClone(rawPath.assessment_blueprint),
  })
  const snapshot = adaptLearnerProfile(profile, { profile_version: "profile-next-round-v1" })
  const built = buildGenerationSpec({
    run_id: "RUN-NEXT-ROUND-IDENTITY",
    profile_snapshot: snapshot,
    path_node: path,
    evidence_pack: evidence,
    versions: {
      prompt_version: ROLE_C_PROMPT_MANIFEST_VERSION,
      model_config_hash: "test-next-round-hash",
      runner_image_digest: runnerDigest,
    },
  })
  if (!built.ok) throw new Error(`buildGenerationSpec 失败: ${built.errors.join("；")}`)
  return { built: built.spec, evidence, snapshot, path }
}

function historyItems(): NonNullable<CPipelineInput["prior_assessment_items"]> {
  return [{
    form_id: "FORM-PREV-1",
    item_id: "ITEM-PREV-1",
    objective_id: "O1",
    modality: "mcq" as const,
    prompt: "下面哪个 for 循环会遍历列表 scores 的每个元素？",
    options: ["for i in range(len(scores))", "for score in scores", "for i in range(scores)"],
    structure_meta: {
      operation: "遍历求和",
      reasoning_pattern: "单步映射",
      representation: "列表",
      context_family: "成绩统计",
      answer_form: "单选",
    },
  }]
}

/** 按 buildReadyNextRound 的方式从完整 pipeline_input 计算幂等键。 */
function preparedIdempotencyKey(input: CPipelineInput, decision: unknown, profileHash: string, feedbackId: string): string {
  return contentHash({
    contract: "role-c-next-round-prepared-execution-v2",
    input,
    feedback_id: feedbackId,
    decision,
    profile_content_hash: profileHash,
    evidence_content_hash: contentHash(input.evidence_pack),
  })
}

function fakeDependencies(
  onInput?: (input: CPipelineInput) => void,
): NextRoundExecutionDependencies {
  return {
    agents: undefined as never,
    secure_store: { namespace_id: "identity-test-ns" } as never,
    review_options: {
      review_port: { policy_version: "identity-test-review-v1" },
      max_external_revisions: 2,
      trace_seq_start: 1,
    } as never,
    review_execution_config_version: "next-round-identity-test-v1",
    reviewed_pipeline_runner: async (input: CPipelineInput): Promise<ReviewedCPipelineResult> => {
      onInput?.(input)
      // Blocked results are returned directly by executeReviewedPipelineInput,
      // which lets this test verify the complete input hand-off without
      // constructing unrelated secure artifacts.
      return {
        status: "blocked",
        state: "BLOCKED",
        pipeline_input_hash: contentHash(input),
        generation_spec_hash: contentHash(input.generation_spec),
        review_policy_version: "identity-test-review-v1",
        review_reports: [],
      } as unknown as ReviewedCPipelineResult
    },
  }
}

describe("正式续轮身份一致性（修复：pipeline_input 保存完整输入）", () => {
  test("带历史题目的续轮：prepared.pipeline_input 参与幂等键，执行不再 NEXT_ROUND_PREPARED_IDENTITY_MISMATCH", async () => {
    const { built, evidence, snapshot } = await realSpec()
    const history = historyItems()
    const triggerDecision = {
      action: "reinforce" as const,
      target_objective_ids: ["O1", "O2"],
      reason_codes: ["partially_correct"],
      profile_updated: false,
      basis: "grade",
      confidence: 0.8,
      policy_ref: "test-policy-v1",
    } as unknown as GenerationReadyNextRound["trigger_decision"]
    const profileHash = contentHash(snapshot)
    const feedbackId = "FEEDBACK-PREV-1"
    const pipelineInput: CPipelineInput = {
      generation_spec: built,
      evidence_pack: evidence,
      prior_assessment_items: history,
      next_round_context: {
        request_id: "REQ-NEXT-1",
        parent_spec_id: built.spec_id,
        prior_feedback_ref: feedbackId,
        trigger_grade_artifact_id: "GRADE-PREV-1",
        action: "reinforce",
        focus_objective_ids: ["O1", "O2"],
        reason_codes: ["partially_correct"],
      },
    }
    const idempotencyKey = preparedIdempotencyKey(pipelineInput, triggerDecision, profileHash, feedbackId)
    const prepared: GenerationReadyNextRound = {
      status: "generation_ready",
      action: "reinforce",
      generation_action: "reinforce",
      request_id: "REQ-NEXT-1",
      idempotency_key: idempotencyKey,
      parent_spec_id: built.spec_id,
      trigger_grade_artifact_id: "GRADE-PREV-1",
      prior_feedback_ref: feedbackId,
      trigger_objective_ids: ["O1", "O2"],
      focus_objective_ids: ["O1", "O2"],
      trigger_decision: triggerDecision as GenerationReadyNextRound["trigger_decision"],
      profile_content_hash: profileHash,
      profile_snapshot: snapshot,
      generation_spec: built,
      evidence_pack: evidence,
      pipeline_input: pipelineInput,
    }
    let receivedInput: CPipelineInput | undefined
    const result = await executePreparedNextRound(
      prepared,
      fakeDependencies((input) => { receivedInput = input }),
    )
    expect(result.status).toBe("blocked")
    expect(receivedInput).toEqual(pipelineInput)
    expect(receivedInput?.prior_assessment_items).toEqual(history)
  })

  test("负例：若像修复前那样从 generation_spec/evidence_pack 重新拼装（丢失历史），幂等键必然不一致", async () => {
    const { built, evidence, snapshot } = await realSpec()
    const history = historyItems()
    const triggerDecision = {
      action: "reinforce" as const,
      target_objective_ids: ["O1", "O2"],
      reason_codes: ["partially_correct"],
      profile_updated: false,
    }
    const profileHash = contentHash(snapshot)
    const feedbackId = "FEEDBACK-PREV-1"
    const fullInput: CPipelineInput = {
      generation_spec: built,
      evidence_pack: evidence,
      prior_assessment_items: history,
      next_round_context: {
        request_id: "REQ-NEXT-2",
        parent_spec_id: built.spec_id,
        prior_feedback_ref: feedbackId,
        trigger_grade_artifact_id: "GRADE-PREV-1",
        action: "reinforce",
        focus_objective_ids: ["O1", "O2"],
        reason_codes: ["partially_correct"],
      },
    }
    const fullKey = preparedIdempotencyKey(fullInput, triggerDecision, profileHash, feedbackId)
    // 修复前的重建方式：只从 generation_spec/evidence_pack 拼装，prior_assessment_items 丢失
    const reassembled: CPipelineInput = {
      generation_spec: built,
      evidence_pack: evidence,
      next_round_context: fullInput.next_round_context,
    }
    const reassembledKey = preparedIdempotencyKey(reassembled, triggerDecision, profileHash, feedbackId)
    expect(reassembledKey).not.toBe(fullKey)
    // 这正是 NEXT_ROUND_PREPARED_IDENTITY_MISMATCH 的来源；修复后 GenerationReadyNextRound
    // 保存完整 pipeline_input，执行侧不再重建
    expect(fullInput.prior_assessment_items).toBeDefined()
  })

  test("PrepareNextRoundInput 契约：prior_assessment_items 可携带 structure_meta（历史链路完整）", () => {
    const input: PrepareNextRoundInput = {
      authenticated_learner_id_hash: "h",
      learner_id_hash: "h",
      parent_spec: undefined as never,
      current_evidence_pack: undefined as never,
      profile_snapshot: undefined as never,
      feedback: undefined as never,
      prior_assessment_items: historyItems(),
    } as unknown as PrepareNextRoundInput
    expect(input.prior_assessment_items?.[0]?.structure_meta?.operation).toBe("遍历求和")
  })

  test("累计历史账本语义：第 3 轮的历史包含第 1、2 轮（由学习周期服务累计）", async () => {
    const { built, evidence, snapshot } = await realSpec()
    // 模拟三轮：每轮把上一轮 pipeline_input.prior_assessment_items 与新题合并
    const round1: NonNullable<CPipelineInput["prior_assessment_items"]> = [{
      form_id: "FORM-R1", item_id: "ITEM-R1-1", objective_id: "O1",
      modality: "mcq", prompt: "第一轮题目", options: [],
    }]
    const round2History = mergeLedger(round1, [{
      form_id: "FORM-R2", item_id: "ITEM-R2-1", objective_id: "O1",
      modality: "trace", prompt: "第二轮题目", options: [],
    }])
    const round3History = mergeLedger(round2History, [{
      form_id: "FORM-R3", item_id: "ITEM-R3-1", objective_id: "O2",
      modality: "mcq", prompt: "第三轮题目", options: [],
    }])
    // 第 3 轮历史同时含第 1、2 轮（修复点 8：只传上一轮会让第 1 轮重现）
    expect(round3History.some((i) => i.item_id === "ITEM-R1-1")).toBe(true)
    expect(round3History.some((i) => i.item_id === "ITEM-R2-1")).toBe(true)
    expect(round3History.some((i) => i.item_id === "ITEM-R3-1")).toBe(true)
    // 去重：同 form+item 只保留一条
    const dup = mergeLedger(round3History, [
      { form_id: "FORM-R3", item_id: "ITEM-R3-1", objective_id: "O2", modality: "mcq", prompt: "第三轮题目", options: [] },
    ])
    expect(dup.filter((i) => i.item_id === "ITEM-R3-1")).toHaveLength(1)
    void built; void evidence; void snapshot
  })
})

function mergeLedger(
  existing: NonNullable<CPipelineInput["prior_assessment_items"]>,
  incoming: NonNullable<CPipelineInput["prior_assessment_items"]>,
): NonNullable<CPipelineInput["prior_assessment_items"]> {
  return [...new Map([...existing, ...incoming].map((item) => [
    `${item.form_id}:${item.item_id}`,
    structuredClone(item),
  ])).values()]
}
