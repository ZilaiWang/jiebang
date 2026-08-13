import { describe, expect, test } from "bun:test"

const REQUIRED_ACCEPTANCE_PHRASES = [
  "角色 A Week 2 验收报告",
  "事实审核",
  "引用门禁 MVP",
  "知识溯源",
  "blockId",
  "text",
  "citations",
  "pass",
  "revise",
  "reject",
  "scripts/week2-role-a-demo.ts",
  "scripts/audit-role-c-json.ts",
  "role_c_artifact_missing_citation.json",
  "role_c_artifact_fake_citation.json",
  "MISSING_BLOCKS",
  "当前限制",
]

describe("Role A week-two fact-audit assets", () => {
  test("documents Role A week-two acceptance evidence and C handoff contract", async () => {
    const report = await Bun.file("docs/week2_role_a_acceptance.md").text()

    for (const phrase of REQUIRED_ACCEPTANCE_PHRASES) {
      expect(report).toContain(phrase)
    }
  })

  test("ships a CLI that audits a Role C JSON file", async () => {
    const script = await Bun.file("scripts/audit-role-c-json.ts").text()

    expect(script).toContain("adaptRoleCBlocksToFactAuditInput")
    expect(script).toContain("auditGeneratedContent")
    expect(script).toContain("retrieveKnowledge")
  })

  test("audits the example Role C artifact JSON from disk", async () => {
    const proc = Bun.spawn(["bun", "scripts/audit-role-c-json.ts", "examples/role_c_artifact_example.json"], { stdout: "pipe", stderr: "pipe" })
    const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])

    expect(stderr).toBe("")
    expect(exitCode).toBe(0)

    const output = JSON.parse(stdout)
    expect(output.workflow).toBe("Audit_RoleC_JSON_File")
    expect(output.input_file).toBe("examples/role_c_artifact_example.json")
    expect(output.audit.status).toBe("pass")
    expect(output.audit.checkedClaims[0]).toMatchObject({ verdict: "supported" })
  })

  test("audits revise and reject Role C example artifacts from disk", async () => {
    const cases = [
      ["examples/role_c_artifact_missing_citation.json", "revise"],
      ["examples/role_c_artifact_fake_citation.json", "reject"],
    ] as const

    for (const [file, expectedStatus] of cases) {
      const proc = Bun.spawn(["bun", "scripts/audit-role-c-json.ts", file], { stdout: "pipe", stderr: "pipe" })
      const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])

      expect(stderr).toBe("")
      expect(exitCode).toBe(0)

      const output = JSON.parse(stdout)
      expect(output.workflow).toBe("Audit_RoleC_JSON_File")
      expect(output.input_file).toBe(file)
      expect(output.audit.status).toBe(expectedStatus)
    }
  })

  test("returns stable validation errors for malformed Role C JSON", async () => {
    const proc = Bun.spawn(["bun", "scripts/audit-role-c-json.ts", "examples/role_c_artifact_invalid_missing_blocks.json"], { stdout: "pipe", stderr: "pipe" })
    const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])

    expect(stderr).toBe("")
    expect(exitCode).toBe(2)

    const output = JSON.parse(stdout)
    expect(output.workflow).toBe("Audit_RoleC_JSON_File")
    expect(output.ok).toBe(false)
    expect(output.error.code).toBe("MISSING_BLOCKS")
  })
})
