import { describe, expect, test } from "bun:test"
import { validateResumeDiagnosisAnswers } from "../src/orchestration/path-api-schema"

describe("resume diagnosis answer schema", () => {
  test("accepts a bounded answer map", () => {
    expect(validateResumeDiagnosisAnswers({ path_id: "PATH-OLD", answers: { "R-1": "A" } })).toEqual({
      ok: true,
      value: { path_id: "PATH-OLD", answers: { "R-1": "A" } },
    })
  })

  test("rejects missing, oversized, or unsafe answers", () => {
    expect(validateResumeDiagnosisAnswers({ path_id: "PATH-OLD" }).ok).toBe(false)
    expect(validateResumeDiagnosisAnswers({ path_id: "PATH-OLD", answers: { "../bad": "A" } }).ok).toBe(false)
    expect(validateResumeDiagnosisAnswers({ path_id: "PATH-OLD", answers: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`R-${i}`, "A"])) }).ok).toBe(false)
  })
})
