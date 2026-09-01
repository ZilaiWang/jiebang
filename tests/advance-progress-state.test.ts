import { describe, expect, test } from "bun:test"
import { progressStateForGenerationAction } from "../src/role-c-content/orchestrator/next-round"
import { progressStateForRoundAction } from "../src/role-d-integration/role-c-service"

describe("advance progress state semantics", () => {
  test("advance uses mastered for the next generated round", () => {
    expect(progressStateForGenerationAction("advance")).toBe("mastered")
    expect(progressStateForRoundAction("advance")).toBe("mastered")
  })

  test("remediate and reinforce retain their distinct progress states", () => {
    expect(progressStateForGenerationAction("remediate")).toBe("struggling")
    expect(progressStateForGenerationAction("reinforce")).toBe("stable")
    expect(progressStateForRoundAction("remediate")).toBe("struggling")
    expect(progressStateForRoundAction("reinforce")).toBe("stable")
  })
})
