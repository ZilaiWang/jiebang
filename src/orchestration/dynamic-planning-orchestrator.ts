/**
 * 动态规划循环（演示/参考路径）。
 *
 * 实现状态标注（2026-08-08）：本模块是独立于 `interactive-session` 的另一套
 * 跨轮规划循环（基于 `ContinueRoleCAfterSubmission`，依赖旧前端 role-d-ui 的
 * continuation 契约）。**生产主路径不调用它**——主 Agent 交互会话由
 * `src/orchestration/interactive-session.ts` 驱动（持久会话 + 后台生成 +
 * 四路决策 + 轮次上限）。本文件保留以覆盖跨轮控制流语义，并有独立测试
 * `tests/dynamic-planning-orchestrator.test.ts`；若旧前端 role-d-ui 下线，
 * 本模块连同其依赖应一并移除。
 */
import type {
  ContinueRoleCAfterSubmissionInput,
  ContinueRoleCForRoleDResult,
} from "../role-d-ui/src/domain/role-c-continuation"

export type DynamicPlanningLoopDecision =
  | "remediate"
  | "reinforce"
  | "advance"
  | "reprofile"
  | "awaiting_submission"
  | "awaiting_input"
  | "blocked"
  | "failed"
  | "completed"

export interface DynamicPlanningRound {
  round_no: number
  input: ContinueRoleCAfterSubmissionInput
  status: ContinueRoleCForRoleDResult["status"] | "awaiting_submission"
  decision: DynamicPlanningLoopDecision
  run_id?: string
  session_id?: string
  form_id?: string
  attempt_no?: number
  required_inputs?: Array<"nextPathNode" | "nextProfileSnapshot" | "nextGenerationAction">
  reason?: string
}

export interface DynamicPlanningLoopInput {
  initial_submission: ContinueRoleCAfterSubmissionInput
  max_rounds: number
  continue_after_submission: (
    input: ContinueRoleCAfterSubmissionInput,
  ) => Promise<ContinueRoleCForRoleDResult>
}

export interface DynamicPlanningLoopResult {
  status: "awaiting_submission" | "awaiting_input" | "blocked" | "failed" | "completed"
  rounds: DynamicPlanningRound[]
  final_decision: DynamicPlanningLoopDecision
  final_round?: DynamicPlanningRound
  latest_result?: ContinueRoleCForRoleDResult
}

/**
 * Top-level dynamic planner for completed learning cycles.
 *
 * This controller owns cross-round control flow. It does not fabricate learner
 * submissions: after C publishes a new round, the loop stops at
 * `awaiting_submission` and waits for the learner to complete the new form.
 */
export async function runDynamicPlanningLoop(
  input: DynamicPlanningLoopInput,
): Promise<DynamicPlanningLoopResult> {
  if (!Number.isSafeInteger(input.max_rounds) || input.max_rounds < 1) {
    throw new Error("DYNAMIC_PLANNING_MAX_ROUNDS_INVALID")
  }

  const rounds: DynamicPlanningRound[] = []
  let current = structuredClone(input.initial_submission)

  for (let index = 0; index < input.max_rounds; index += 1) {
    const roundNo = index + 1
    const result = await input.continue_after_submission(structuredClone(current))

    if (result.status === "published") {
      const nextSession = result.learningSession.session
      const round: DynamicPlanningRound = {
        round_no: roundNo,
        input: structuredClone(current),
        status: "awaiting_submission",
        decision: "awaiting_submission",
        run_id: nextSession.run_id,
        session_id: nextSession.session_id,
        form_id: nextSession.form_id,
        attempt_no: nextSession.attempt_no,
        reason: `C published next round and opened a new learning session.`,
      }
      rounds.push(round)
      return {
        status: "awaiting_submission",
        rounds,
        final_decision: "awaiting_submission",
        final_round: round,
        latest_result: result,
      }
    }

    if (result.status === "awaiting_input") {
      const round: DynamicPlanningRound = {
        round_no: roundNo,
        input: structuredClone(current),
        status: "awaiting_input",
        decision: "awaiting_input",
        required_inputs: [...result.requiredInputs],
        reason: `C requires ${result.requiredInputs.join(", ")} before the next dynamic-planning round.`,
      }
      rounds.push(round)
      return {
        status: "awaiting_input",
        rounds,
        final_decision: "awaiting_input",
        final_round: round,
        latest_result: result,
      }
    }

    const round: DynamicPlanningRound = {
      round_no: roundNo,
      input: structuredClone(current),
      status: result.status,
      decision: result.status,
      reason: result.reason,
    }
    rounds.push(round)
    return {
      status: result.status,
      rounds,
      final_decision: result.status,
      final_round: round,
      latest_result: result,
    }
  }

  const finalRound = rounds.at(-1)
  return {
    status: "completed",
    rounds,
    final_decision: "completed",
    ...(finalRound ? { final_round: finalRound } : {}),
  }
}
