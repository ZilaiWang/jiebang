import { describe, expect, test } from "bun:test"
import { ORCHESTRATOR_PROMPT } from "../src/prompts/orchestration"

const evidenceWorkers = [
  "background-collector",
  "self-assessor",
  "objective-diagnostician",
]

const sequentialWorkers = ["profile-builder", "path-planner", "concept-tutor", "code-lab", "tiered-evaluator"]

const sequentialCallMarkers = [
  "call profile-builder once",
  "Call path-planner once",
  "- concept-tutor with",
  "- code-lab with",
  "- tiered-evaluator with",
]

describe("orchestration prompt contract", () => {
  test("names every worker and the native task routing field", () => {
    for (const worker of [...evidenceWorkers, ...sequentialWorkers]) {
      expect(ORCHESTRATOR_PROMPT).toContain(worker)
    }
    expect(ORCHESTRATOR_PROMPT).toContain("subagent_type")
  })

  test("places synthesis, planning, instruction, lab, and assessment in order", () => {
    const positions = sequentialCallMarkers.map((marker) => ORCHESTRATOR_PROMPT.indexOf(marker))

    for (let index = 1; index < positions.length; index += 1) {
      expect(positions[index]).toBeGreaterThanOrEqual(0)
      expect(positions[index]).toBeGreaterThan(positions[index - 1])
    }
  })

  test("requires ordered evidence gathering and forbids domain execution", () => {
    expect(ORCHESTRATOR_PROMPT).toContain("one at a time in the listed order")
    expect(ORCHESTRATOR_PROMPT).toContain("Never perform learner analysis")
    expect(ORCHESTRATOR_PROMPT).toContain("Never replace a failed worker")
    expect(ORCHESTRATOR_PROMPT).toContain("Never write, synthesize, or guess")
  })
})
