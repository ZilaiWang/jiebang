import { describe, expect, test } from "bun:test"
import { PublicQualityGateError, runPublicCandidateTournament } from "../src/role-c-content/quality/candidate-tournament"

const evaluation = {
  candidate_id: "candidate",
  artifact_kind: "assessment" as const,
  hard_gates: [],
  dimensions: [],
  overall_score: 0,
  release_eligible: false,
  critical_findings: [],
}

describe("candidate tournament shared-contract failures", () => {
  test("preflight failure starts zero candidate calls", async () => {
    let generated = 0
    const shared = new Error("generation_spec schema drift")
    await expect(runPublicCandidateTournament({
      candidate_count: 3,
      preflight: () => { throw shared },
      generate: async () => { generated += 1; return {} },
      evaluate: () => evaluation,
    })).rejects.toBe(shared)
    expect(generated).toBe(0)
  })

  test("identical deterministic failures preserve the original error", async () => {
    const shared = new Error("generation_spec shared validation failed")
    await expect(runPublicCandidateTournament({
      candidate_count: 3,
      generate: async () => { throw shared },
      evaluate: () => evaluation,
    })).rejects.toBe(shared)
  })

  test("different failures remain visible in the quality error", async () => {
    try {
      await runPublicCandidateTournament({
        candidate_count: 3,
        generate: async (index) => { throw new Error(`candidate-${index}-failure`) },
        evaluate: () => evaluation,
      })
      throw new Error("expected rejection")
    } catch (error) {
      expect(error).toBeInstanceOf(PublicQualityGateError)
      expect((error as Error).message).toContain("candidate-0-failure")
      expect((error as Error).message).toContain("candidate-1-failure")
    }
  })

  test("a critic-guided revision must pass the complete evaluation path before winning", async () => {
    const reviewed: string[] = []
    const selected = await runPublicCandidateTournament({
      candidate_count: 2,
      generate: async (index) => ({ version: `draft-${index}` }),
      evaluate: (candidate) => ({
        ...evaluation,
        candidate_id: candidate.version,
        overall_score: candidate.version === "revised" ? 0.9 : 0.7,
        release_eligible: candidate.version === "revised",
        critical_findings: candidate.version === "revised" ? [] : ["DEBUG_FIX_DISCLOSED"],
      }),
      review: async (entries) => entries.map((entry) => {
        reviewed.push(entry.candidate.version)
        return entry.evaluation
      }),
      revise_rejected: async ({ candidate, evaluation: rejected }) => {
        expect(candidate.version).toBe("draft-0")
        expect(rejected.critical_findings).toContain("DEBUG_FIX_DISCLOSED")
        return { version: "revised" }
      },
    })

    expect(selected.winner).toEqual({ version: "revised" })
    expect(reviewed).toEqual(["draft-0", "draft-1", "revised"])
    expect(selected.evaluations).toHaveLength(3)
  })
})
