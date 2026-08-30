import { describe, expect, test } from "bun:test"
import {
  buildProfileGapQuestions,
  classifyLearningBarrier,
  shouldAskProfileQuestion,
  type ProfileGapContext,
} from "../src/role-b-profile/profile-gap-questions"

const base: ProfileGapContext = {
  goal: "学习数据结构",
  level: "basic",
  known_concepts: ["数组"],
  weak_concepts: ["链表"],
  recent_error_patterns: [],
  answered_dimensions: [],
}

describe("active profile gap questions", () => {
  test("asks for the learner's barrier after an unsuccessful assessment", () => {
    expect(shouldAskProfileQuestion({ ...base, recent_action: "remediate" })).toBe(true)
    expect(buildProfileGapQuestions({ ...base, recent_action: "remediate" })[0]).toMatchObject({
      dimension: "learning_barrier",
      answer_type: "single_choice",
    })
  })

  test("does not repeat a dimension already answered recently", () => {
    expect(shouldAskProfileQuestion({ ...base, recent_action: "remediate", answered_dimensions: ["learning_barrier"] })).toBe(false)
  })

  test("classifies the answer into a stable barrier for learner memory", () => {
    expect(classifyLearningBarrier("我知道概念，但不会把题目写成代码")).toBe("code_translation")
    expect(classifyLearningBarrier("概念忘记了")).toBe("concept_recall")
  })
})
