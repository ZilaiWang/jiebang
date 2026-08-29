import { describe, expect, test } from "bun:test"
import { redactDirectIdentifiers, sanitizeLearnerRequestForStorage } from "../src/privacy/privacy-boundary"

describe("privacy redaction", () => {
  test("redacts direct identifiers from stored free text", () => {
    const value = sanitizeLearnerRequestForStorage({
      learner_id: "learner-1",
      goal: "学习数据结构，联系邮箱 test@example.com",
      background: "我在某大学学习，电话 13800138000，学号 202012345678901X",
    })
    expect(value.goal).toContain("[REDACTED_EMAIL]")
    expect(value.background).toContain("[REDACTED_PHONE]")
    expect(value.background).toContain("[REDACTED_ID]")
    expect(value.goal).not.toContain("test@example.com")
    expect(value.background).not.toContain("13800138000")
  })

  test("preserves teaching meaning while removing direct identifiers", () => {
    expect(redactDirectIdentifiers("课程作业，邮箱 a@b.com，手机号 13912345678")).toBe(
      "课程作业，邮箱 [REDACTED_EMAIL]，手机号 [REDACTED_PHONE]",
    )
  })

  test("removes identity fields from nested profile intake", () => {
    const value = sanitizeLearnerRequestForStorage({
      learner_id: "learner-1",
      goal: "数据结构",
      profile_intake: {
        name: "张三",
        school: "某大学",
        phone: "13800138000",
        desired_outcome: "掌握数据结构",
      },
    })
    expect((value as { profile_intake?: unknown }).profile_intake).toEqual({ desired_outcome: "掌握数据结构" })
  })
})
