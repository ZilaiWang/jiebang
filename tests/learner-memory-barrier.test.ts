import { describe, expect, test } from "bun:test"
import {
  appendLearningBarrier,
  learnerMemoryProfileProjection,
  type LearnerMemorySnapshot,
} from "../src/orchestration/learner-memory"

test("learner memory stores structured barriers without raw answers", () => {
  const initial: LearnerMemorySnapshot = {
    schema_version: "1.0",
    learner_id: "learner-1",
    mastery_by_source_id: {},
    mastered_source_ids: [],
    weak_source_ids: ["DS-LINKED-LIST"],
    completed_sessions: [],
    recent_errors: [],
    recent_assessment_items: [],
    updated_at: "",
  }
  const updated = appendLearningBarrier(initial, {
    source_id: "DS-LINKED-LIST",
    barrier: "code_translation",
  })
  expect(updated.learning_barriers).toEqual([{ source_id: "DS-LINKED-LIST", barrier: "code_translation", count: 1 }])
  expect(JSON.stringify(updated)).not.toContain("我知道概念，但不会把题目写成代码")
  expect(learnerMemoryProfileProjection(updated).learning_barriers).toEqual(updated.learning_barriers)
})
