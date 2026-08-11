import { describe, expect, test } from "bun:test"
import { ROLE_C_PROMPT_MANIFEST_VERSION } from "../src/role-c-content/prompts/common-policy"

describe("role c prompt manifest version", () => {
  test("bumped to invalidate staged repair cache", () => {
    expect(ROLE_C_PROMPT_MANIFEST_VERSION).toBe("c-prompts-1.16.9")
  })
})
