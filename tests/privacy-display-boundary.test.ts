import { describe, expect, test } from "bun:test"
import { redactDirectIdentifiers } from "../src/privacy/privacy-boundary"

test("learner display name is not included in the model background summary", () => {
  const summary = "学习背景：计算机专业；Python基础：basic；偏好：balanced"
  expect(summary).not.toContain("张三")
  expect(redactDirectIdentifiers("联系邮箱 test@example.com")).toContain("[REDACTED_EMAIL]")
})
