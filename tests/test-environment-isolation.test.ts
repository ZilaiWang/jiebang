import { expect, test } from "bun:test"

test("real-model test modules can be imported without model configuration by default", async () => {
  const child = Bun.spawn(["bun", "test", "--isolate", "tests/role-c-learning-cycle.test.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ROLE_C_MODEL_ENDPOINT: "",
      ROLE_C_MODEL_ID: "",
      RUN_INTEGRATION_TESTS: "",
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  expect(exitCode).toBe(0)
  expect(`${stdout}\n${stderr}`).not.toContain("ModelProviderUnavailableError")
  expect(`${stdout}\n${stderr}`).toContain("0 pass")
})