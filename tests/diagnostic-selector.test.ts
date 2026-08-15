import { describe, expect, test } from "bun:test"
import { selectDiagnosticEvidenceTargets } from "../src/knowledge/diagnostic-selector"
import { loadKnowledgeBase } from "../src/knowledge/loader"

describe("diagnostic item selector", () => {
  test("selects evidence targets without copying pre-authored quiz text", async () => {
    const knowledgeBase = await loadKnowledgeBase()
    const targets = selectDiagnosticEvidenceTargets({
      knowledgeBase,
      target_source_ids: ["K007"],
      prerequisite_source_ids: ["K002", "K003"],
      max_items: 5,
    })
    expect(targets.map((target) => target.source_id)).toEqual(["K007", "K002", "K003"])
    expect(targets.every((target) => target.facts.length > 0)).toBe(true)
    expect(targets[0]).not.toHaveProperty("question")
    expect(targets[0]).not.toHaveProperty("answer")
  })

  test("selects target, prerequisite, and weak historical evidence for AI authoring", async () => {
    const knowledgeBase = await loadKnowledgeBase()
    const learnerMemory = {
      schema_version: "1.0",
      learner_id: "learner-diagnostic",
      mastery_by_source_id: { K006: 0.25 },
      mastered_source_ids: [],
      weak_source_ids: ["K006"],
      completed_sessions: [],
      recent_errors: [{ source_id: "K006", pattern: "branch_condition", count: 1 }],
      updated_at: "2026-08-04T00:00:00.000Z",
    }
    const selection = selectDiagnosticEvidenceTargets({
      knowledgeBase,
      target_source_ids: ["K018"],
      prerequisite_source_ids: ["K007", "K009"],
      learner_memory: learnerMemory,
      max_items: 5,
    })

    expect(selection.length).toBeGreaterThanOrEqual(3)
    expect(selection.length).toBeLessThanOrEqual(5)
    expect(selection.map((item) => item.source_id)).toEqual(expect.arrayContaining(["K018", "K007", "K009", "K006"]))
    expect(selection.every((item) => item.facts.length > 0 && item.selection_reason.length > 0)).toBe(true)
  })

  test("does not fill a focused target to five with unrelated knowledge", async () => {
    const knowledgeBase = await loadKnowledgeBase()
    const selection = selectDiagnosticEvidenceTargets({
      knowledgeBase,
      target_source_ids: ["K007"],
      prerequisite_source_ids: ["K002", "K003"],
      max_items: 5,
    })

    expect(selection.map((item) => item.source_id)).toEqual(["K007", "K002", "K003"])
    expect(selection.every((item) => ["K007", "K002", "K003"].includes(item.source_id))).toBe(true)
  })

  test("returns no authoring target when a custom goal has no A fact coverage", async () => {
    const knowledgeBase = await loadKnowledgeBase()
    const selection = selectDiagnosticEvidenceTargets({
      knowledgeBase,
      target_source_ids: [],
      prerequisite_source_ids: [],
      max_items: 5,
    })

    expect(selection).toHaveLength(0)
  })

  test("prioritizes weak historical concepts over prerequisites for personalized diagnosis", async () => {
    const knowledgeBase = await loadKnowledgeBase()
    const selection = selectDiagnosticEvidenceTargets({
      knowledgeBase,
      target_source_ids: ["K018"],
      prerequisite_source_ids: ["K007", "K009"],
      learner_memory: { weak_source_ids: ["K006"] },
      max_items: 3,
    })

    // target(K018) → weak_history(K006) → prerequisite(K007)，薄弱点优先于先修
    expect(selection.map((item) => item.source_id)).toEqual(["K018", "K006", "K007"])
    expect(selection[1]).toMatchObject({ selection_reason: "weak_history" })
  })
})
