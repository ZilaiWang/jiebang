import { describe, expect, test } from "bun:test"
import { generationFailure } from "../src/role-d-integration/role-c-service"

describe("Role C structured generation failure", () => {
  test("routes a repeated assessment item to assessment-only regeneration", () => {
    const failure = generationFailure({
      code: "BLOCKED_INVALID_OUTPUT",
      message: "assessment invalid",
      details: ["[ASSESSMENT_DUPLICATE]"],
      stage: "assessment",
    })
    expect(failure).toMatchObject({
      code: "CONTENT_NOT_NOVEL",
      stage: "assessment",
      issueCodes: ["ASSESSMENT_DUPLICATE"],
      repairScope: "artifact",
      nextAction: "regenerate_assessment",
      canRetry: true,
    })
    expect(failure.fingerprint).toStartWith("sha256:")
  })

  test("routes evidence and unsupported targets to their owning boundaries", () => {
    expect(generationFailure({
      code: "BLOCKED_WEAK_EVIDENCE",
      message: "weak evidence",
      details: [],
      stage: "concept",
    })).toMatchObject({
      code: "EVIDENCE_UNAVAILABLE",
      stage: "evidence",
      nextAction: "refresh_evidence",
      repairScope: "evidence",
    })
    expect(generationFailure({
      code: "UNSUPPORTED_TARGET",
      message: "unsupported",
      details: [],
      stage: "code_lab",
    })).toMatchObject({
      code: "TARGET_UNSUPPORTED",
      nextAction: "replan_path",
      canRetry: false,
    })
  })

  test("does not classify recovery from human-readable prose", () => {
    const failure = generationFailure({
      code: "BLOCKED_INVALID_OUTPUT",
      message: "任意展示文案都不影响恢复",
      details: ["INVALID_EXPECTED_TYPE", "NO_REPAIR_PROGRESS"],
      stage: "code_lab",
    })
    expect(failure).toMatchObject({
      code: "CONTENT_INVALID",
      issueCodes: ["INVALID_EXPECTED_TYPE", "NO_REPAIR_PROGRESS"],
      nextAction: "regenerate_code_lab",
    })
  })
})
