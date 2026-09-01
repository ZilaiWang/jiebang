import { contentHash, stableId } from "../contracts/common"
import type { ModelGateway } from "../contracts/model-gateway"

export type DebateAgentName = "fact" | "teaching"
export type DebateDecision = "pass" | "revise" | "reject" | "blocked"
export type DebateStance = "agree" | "disagree" | "partially_agree"

export interface DebateReviewInput {
  run_id: string
  artifact_id: string
  artifact_kind: "concept" | "code_lab" | "assessment"
  evidence_hash: string
  artifact_hash: string
  facts: Array<{ source_id: string; fact_id: string; content: string }>
}

export interface DebateFinding {
  finding_id: string
  agent: DebateAgentName
  code: string
  severity: "warning" | "critical"
  message: string
  evidence_refs: string[]
  proposed_action: string
}

export interface DebateResponse {
  finding_id: string
  agent: DebateAgentName
  target_finding_id: string
  stance: DebateStance
  message: string
}

export interface DebateRound {
  round_no: number
  findings: DebateFinding[]
  responses: DebateResponse[]
  input_hash: string
}

export interface ReviewDebateAgent {
  review(input: DebateReviewInput & { prior_rounds?: DebateRound[] }): Promise<DebateFinding[]>
  respond(input: {
    review: DebateReviewInput
    own_findings: DebateFinding[]
    visible_findings: DebateFinding[]
  }): Promise<DebateResponse[]>
}

export interface DebateArbitration {
  arbiter_agent: "independent-arbiter"
  decision: Exclude<DebateDecision, "blocked">
  accepted_finding_ids: string[]
  reason: string
}

export interface ReviewDebateArbiter {
  arbitrate(input: {
    review: DebateReviewInput
    rounds: DebateRound[]
  }): Promise<Omit<DebateArbitration, "arbiter_agent">>
}

export interface ReviewDebateResult {
  decision: DebateDecision
  rounds: DebateRound[]
  arbitration: DebateArbitration
  trace: Array<{
    event: "independent_review" | "cross_response" | "independent_arbitration"
    agents: string[]
    round_no: number
  }>
}

export interface BoundedReviewDebateOptions {
  max_rounds?: 1 | 2
}

/** 将已有独立审核结论交给模型审核方，模型只能回应对方意见，不能改写原始 finding。 */
export function createModelBackedDebateAgent(
  gateway: ModelGateway,
  agent: DebateAgentName,
  findings: DebateFinding[],
): ReviewDebateAgent {
  return {
    async review() {
      return structuredClone(findings)
    },
    async respond(input) {
      const output = await gateway.generateStructured<{ responses: Array<{
        target_finding_id: string
        stance: DebateStance
        message: string
      }> }>({
        task: `role-c.review-debate.${agent}.response`,
        system_prompt: `你是${agent === "fact" ? "事实审核方" : "教学审核方"}。你已完成独立审核，现在只能回应对方审核意见。不得删除、修改或伪造 finding；每条回应必须指向 visible_findings 中的 target_finding_id。不得使用输入之外的事实。`,
        input: {
          review: input.review,
          own_findings: input.own_findings,
          visible_findings: input.visible_findings,
        },
        output_schema_id: "role_c_review_debate_response_v1",
        output_schema: {
          type: "object",
          additionalProperties: false,
          required: ["responses"],
          properties: {
            responses: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["target_finding_id", "stance", "message"],
                properties: {
                  target_finding_id: { type: "string", minLength: 1 },
                  stance: { enum: ["agree", "disagree", "partially_agree"] },
                  message: { type: "string", minLength: 1 },
                },
              },
            },
          },
        },
        temperature: 0,
        max_tokens: 1600,
        idempotency_key: `DEBATE-RESPONSE-${contentHash({ agent, input })}`,
      })
      const visible = new Set(input.visible_findings.map((finding) => finding.finding_id))
      return output.responses.map((response) => {
        if (!visible.has(response.target_finding_id)) throw new Error("DEBATE_RESPONSE_UNKNOWN_FINDING")
        return {
          finding_id: `${agent}-response-${response.target_finding_id}`,
          agent,
          target_finding_id: response.target_finding_id,
          stance: response.stance,
          message: response.message,
        }
      })
    },
  }
}

/** 独立仲裁模型只接收公开审核意见、回应和证据引用。 */
export class ModelBackedReviewDebateArbiter implements ReviewDebateArbiter {
  constructor(private readonly gateway: ModelGateway) {}

  async arbitrate(input: { review: DebateReviewInput; rounds: DebateRound[] }): Promise<Omit<DebateArbitration, "arbiter_agent">> {
    const output = await this.gateway.generateStructured<Omit<DebateArbitration, "arbiter_agent">>({
      task: "role-c.review-debate.independent-arbiter",
      system_prompt: "你是独立审核仲裁 Agent。只能依据公开审核意见、回应和证据引用裁决，不得改写产物，不得使用常识补证据。关键问题未被有效驳回时不得放行。",
      input: { review: input.review, rounds: input.rounds },
      output_schema_id: "role_c_review_debate_arbitration_v1",
      output_schema: {
        type: "object",
        additionalProperties: false,
        required: ["decision", "accepted_finding_ids", "reason"],
        properties: {
          decision: { enum: ["pass", "revise", "reject"] },
          accepted_finding_ids: { type: "array", items: { type: "string" } },
          reason: { type: "string", minLength: 1 },
        },
      },
      temperature: 0,
      max_tokens: 1200,
      idempotency_key: `DEBATE-ARBITER-${contentHash(input)}`,
    })
    return output
  }
}

/** 有界串行辩论：A/B 独立审核，互看意见并回应，独立仲裁，必要时进入下一轮。 */
export async function runBoundedReviewDebate(
  review: DebateReviewInput,
  agents: { factAgent: ReviewDebateAgent; teachingAgent: ReviewDebateAgent },
  arbiter: ReviewDebateArbiter,
  options: BoundedReviewDebateOptions = {},
): Promise<ReviewDebateResult> {
  const maxRounds = options.max_rounds ?? 2
  const rounds: DebateRound[] = []
  const trace: ReviewDebateResult["trace"] = []
  let arbitration: DebateArbitration | undefined

  for (let roundNo = 1; roundNo <= maxRounds; roundNo += 1) {
    const priorRounds = structuredClone(rounds)
    const [factFindings, teachingFindings] = await Promise.all([
      agents.factAgent.review({ ...structuredClone(review), prior_rounds: priorRounds }),
      agents.teachingAgent.review({ ...structuredClone(review), prior_rounds: priorRounds }),
    ])
    const findings = [...factFindings, ...teachingFindings]
    trace.push({ event: "independent_review", agents: ["fact", "teaching"], round_no: roundNo })
    const [factResponses, teachingResponses] = await Promise.all([
      agents.factAgent.respond({ review: structuredClone(review), own_findings: structuredClone(factFindings), visible_findings: structuredClone(teachingFindings) }),
      agents.teachingAgent.respond({ review: structuredClone(review), own_findings: structuredClone(teachingFindings), visible_findings: structuredClone(factFindings) }),
    ])
    const round: DebateRound = {
      round_no: roundNo,
      findings,
      responses: [...factResponses, ...teachingResponses],
      input_hash: contentHash({ review, priorRounds, findings }),
    }
    rounds.push(round)
    trace.push({ event: "cross_response", agents: ["fact", "teaching"], round_no: roundNo })
    try {
      const decision = await arbiter.arbitrate({ review: structuredClone(review), rounds: structuredClone(rounds) })
      validateArbitration(decision, rounds.flatMap((entry) => entry.findings))
      arbitration = { arbiter_agent: "independent-arbiter", ...decision }
      trace.push({ event: "independent_arbitration", agents: ["independent-arbiter"], round_no: roundNo })
    } catch (error) {
      return blockedDebate(rounds, trace, error)
    }
    if (arbitration.decision !== "revise" || roundNo === maxRounds) break
  }
  if (!arbitration) return blockedDebate(rounds, trace, new Error("no arbitration result"))
  return { decision: arbitration.decision, rounds, arbitration, trace }
}

function blockedDebate(rounds: DebateRound[], trace: ReviewDebateResult["trace"], error: unknown): ReviewDebateResult {
  const findings = rounds.flatMap((round) => round.findings)
  return {
    decision: "blocked",
    rounds,
    arbitration: {
      arbiter_agent: "independent-arbiter",
      decision: "reject",
      accepted_finding_ids: findings.map((finding) => finding.finding_id),
      reason: `独立仲裁 Agent 不可用：${error instanceof Error ? error.message : String(error)}`,
    },
    trace,
  }
}

function validateArbitration(arbitration: Omit<DebateArbitration, "arbiter_agent">, findings: DebateFinding[]): void {
  if (!["pass", "revise", "reject"].includes(arbitration.decision)) throw new Error("DEBATE_ARBITRATION_DECISION_INVALID")
  const findingIds = new Set(findings.map((finding) => finding.finding_id))
  if (arbitration.accepted_finding_ids.some((id) => !findingIds.has(id))) throw new Error("DEBATE_ARBITRATION_UNKNOWN_FINDING")
  if (!arbitration.reason.trim()) throw new Error("DEBATE_ARBITRATION_REASON_EMPTY")
}

export function debateFindingId(agent: DebateAgentName, code: string, evidenceRefs: string[]): string {
  return stableId("DEBATE-FINDING", { agent, code, evidenceRefs })
}
