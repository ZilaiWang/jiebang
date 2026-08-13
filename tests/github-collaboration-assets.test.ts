import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"

const text = (path: string) => readFileSync(path, "utf8")

describe("GitHub collaboration package", () => {
  test("documents the active main-Agent-only Role D workflow", () => {
    const guide = text("docs/github_collaboration_guide.md")
    expect(guide).toContain("src/role-d-ui-v2")
    expect(guide).toContain("learning-orchestrator")
    expect(guide).toContain("does not directly call A, B, C, or Workers")
    expect(guide).toContain("bun run role-d:v2:verify")
  })

  test("provides a pull request template with role and verification checklist", () => {
    expect(existsSync(".github/pull_request_template.md")).toBe(true)
    const template = text(".github/pull_request_template.md")
    expect(template).toContain("角色")
    expect(template).toContain("bun run check")
    expect(template).toContain("bun run role-d:v2:verify")
  })

  test("declares active Role D v2 ownership", () => {
    const codeowners = text(".github/CODEOWNERS")
    expect(codeowners).toContain("/src/role-d-ui-v2/")
    expect(codeowners).not.toContain("/src/role-d-ui/")
  })

  test("keeps the active Role D v2 frontend", () => {
    const roleDFiles = [
      "src/role-d-ui-v2/index.html",
      "src/role-d-ui-v2/vite.config.ts",
      "src/role-d-ui-v2/src/App.tsx",
      "src/role-d-ui-v2/src/main.tsx",
      "src/role-d-ui-v2/src/orchestrator-client.ts",
    ]
    for (const file of roleDFiles) {
      expect(existsSync(file)).toBe(true)
      expect(text(file).trim().length).toBeGreaterThan(0)
    }
  })
})
