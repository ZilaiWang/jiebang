import { describe, expect, test } from "bun:test"
import { buildWorkerStubPrompt } from "../src/prompts/worker-stub"
import { WORKER_DEFINITIONS } from "../src/agents/workers"

describe("real content worker contract", () => {
  test("concept-tutor, code-lab, and tiered-evaluator prompts require RAG evidence instead of placeholders", () => {
    const realContentWorkers = new Set(["concept-tutor", "code-lab", "tiered-evaluator"])

    for (const definition of WORKER_DEFINITIONS.filter((worker) => realContentWorkers.has(worker.name))) {
      const prompt = buildWorkerStubPrompt(definition)

      expect(prompt).not.toContain("This is a wiring stub")
      expect(prompt).toContain("source_id")
      expect(prompt).toContain("fact_id")
      expect(prompt).toContain("rag_result")
    }
  })
})
