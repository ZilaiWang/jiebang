import { describe, expect, test } from "bun:test"
import { sanitizeLearnerProfileForModel, type LearnerPrivacyInput } from "../src/privacy/privacy-boundary"

describe("privacy boundary", () => {
  test("projects only the minimum structured learning fields to the model", () => {
    const input: LearnerPrivacyInput = {
      learner_id: "learner-anon-001",
      name: "张三",
      background: "某某大学计算机专业大一，邮箱 zhangsan@example.com",
      school: "某某大学",
      phone: "13800000000",
      level: "basic",
      goal: "学习数据结构",
      goal_profile: "coursework",
      known_concepts: ["变量"],
      weak_concepts: ["循环"],
    }

    const projection = sanitizeLearnerProfileForModel(input)
    expect(projection).toEqual({
      learner_id: "learner-anon-001",
      level: "basic",
      goal: "学习数据结构",
      goal_profile: "coursework",
      known_concepts: ["变量"],
      weak_concepts: ["循环"],
    })
    expect(JSON.stringify(projection)).not.toContain("张三")
    expect(JSON.stringify(projection)).not.toContain("大学")
    expect(JSON.stringify(projection)).not.toContain("13800000000")
    expect(JSON.stringify(projection)).not.toContain("@example.com")
  })
})
