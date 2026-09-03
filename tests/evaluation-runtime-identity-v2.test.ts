import { describe, expect, test } from "bun:test"
import { competitionRuntimeIdentityV2 } from "../src/evaluation/v2/runtime-identity.v2"
import { contentHash } from "../src/role-c-content/contracts/common"

describe("competition runtime identity v2", () => {
  test("changes when generation or sandbox behavior changes", () => {
    const baseline = competitionRuntimeIdentityV2({
      ROLE_C_MODEL_PUBLIC_CANDIDATE_COUNT: "3",
      ROLE_C_DOCKER_CPUS: "0.5",
    })
    const fewerCandidates = competitionRuntimeIdentityV2({
      ROLE_C_MODEL_PUBLIC_CANDIDATE_COUNT: "2",
      ROLE_C_DOCKER_CPUS: "0.5",
    })
    const differentSandbox = competitionRuntimeIdentityV2({
      ROLE_C_MODEL_PUBLIC_CANDIDATE_COUNT: "3",
      ROLE_C_DOCKER_CPUS: "1",
    })
    expect(contentHash(fewerCandidates)).not.toBe(contentHash(baseline))
    expect(contentHash(differentSandbox)).not.toBe(contentHash(baseline))
  })

  test("never includes API credentials or host Docker connection details", () => {
    const identity = competitionRuntimeIdentityV2({
      ROLE_C_MODEL_API_KEY: "do-not-record",
      EVALUATION_JUDGE_API_KEY: "do-not-record-either",
      DOCKER_HOST: "ssh://private-host",
      ROLE_C_MODEL_PUBLIC_CANDIDATE_COUNT: "3",
    })
    const text = JSON.stringify(identity)
    expect(text).not.toContain("do-not-record")
    expect(text).not.toContain("private-host")
  })

  test("normalizes explicit numeric values and validates invalid overrides", () => {
    expect(competitionRuntimeIdentityV2({ ROLE_C_DOCKER_CPUS: "0.50" }).docker_policy.cpu_limit).toBe(0.5)
    expect(() => competitionRuntimeIdentityV2({ MODEL_RUNTIME_MAX_MODEL_CALLS: "0" }))
      .toThrow("COMPETITION_RUNTIME_INTEGER_INVALID")
  })
})
