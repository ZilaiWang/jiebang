import { describe, expect, test } from "bun:test"
import {
  runBoundedReviewDebate,
  type DebateReviewInput,
  type ReviewDebateArbiter,
  type ReviewDebateAgent,
} from "../src/role-c-content/review/debate-orchestrator"

const input: DebateReviewInput = {
  run_id: "run-debate-1",
  artifact_id: "artifact-1",
  artifact_kind: "concept",
  evidence_hash: "sha256:evidence",
  artifact_hash: "sha256:artifact",
  facts: [{ source_id: "K001", fact_id: "F001", content: "变量可以保存数据。" }],
}

function finding(agent: "fact" | "teaching", code: string) {
  return {
    finding_id: `${agent}-${code}`,
    agent,
    code,
    severity: "critical" as const,
    message: `${agent}:${code}`,
    evidence_refs: ["K001:F001"],
    proposed_action: "修订产物",
  }
}

describe("bounded review debate", () => {
  test("runs independent review, cross-response, and mandatory arbitration", async () => {
    const calls: string[] = []
    const factAgent: ReviewDebateAgent = {
      review: async () => {
        calls.push("fact.review")
        return [finding("fact", "unsupported_claim")]
      },
      respond: async ({ visible_findings }) => {
        calls.push(`fact.respond:${visible_findings.map((item) => item.finding_id).join(",")}`)
        return [{ finding_id: "fact-response", agent: "fact", target_finding_id: "teaching-difficulty", stance: "agree" as const, message: "事实意见支持该教学问题。" }]
      },
    }
    const teachingAgent: ReviewDebateAgent = {
      review: async () => {
        calls.push("teaching.review")
        return [finding("teaching", "difficulty_mismatch")]
      },
      respond: async ({ visible_findings }) => {
        calls.push(`teaching.respond:${visible_findings.map((item) => item.finding_id).join(",")}`)
        return [{ finding_id: "teaching-response", agent: "teaching", target_finding_id: "fact-unsupported_claim", stance: "agree" as const, message: "教学意见支持该事实问题。" }]
      },
    }
    const arbiter: ReviewDebateArbiter = {
      arbitrate: async ({ rounds }) => {
        calls.push(`arbiter:${rounds.length}`)
        return { decision: "reject", accepted_finding_ids: ["fact-unsupported_claim", "teaching-difficulty_mismatch"], reason: "两项关键问题均成立。" }
      },
    }

    const result = await runBoundedReviewDebate(input, { factAgent, teachingAgent }, arbiter)

    expect(calls).toEqual([
      "fact.review",
      "teaching.review",
      "fact.respond:teaching-difficulty_mismatch",
      "teaching.respond:fact-unsupported_claim",
      "arbiter:1",
    ])
    expect(result.decision).toBe("reject")
    expect(result.rounds).toHaveLength(1)
    expect(result.rounds[0]?.responses).toHaveLength(2)
    expect(result.arbitration.arbiter_agent).toBe("independent-arbiter")
  })

  test("blocks when the mandatory independent arbiter fails instead of publishing", async () => {
    const agent: ReviewDebateAgent = {
      review: async () => [],
      respond: async () => [],
    }
    const arbiter: ReviewDebateArbiter = {
      arbitrate: async () => { throw new Error("arbiter unavailable") },
    }

    const result = await runBoundedReviewDebate(input, {
      factAgent: agent,
      teachingAgent: agent,
    }, arbiter)

    expect(result.decision).toBe("blocked")
    expect(result.arbitration.reason).toContain("arbiter unavailable")
  })
})
