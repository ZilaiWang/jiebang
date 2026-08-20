import { expect, test } from "bun:test"

const python = Bun.which("python3")

test.skipIf(!python)("stdin/stdout runner executes a normal Python __main__ guard", async () => {
  const payload = JSON.stringify({
    code: [
      "def main():",
      "    values = list(map(int, input().split()))",
      "    print(sum(values))",
      "",
      "if __name__ == '__main__':",
      "    main()",
      "",
    ].join("\n"),
    execution_contract: {
      language: "python",
      execution_mode: "stdin_stdout",
      allowed_imports: [],
    },
    test_inputs: ["1 2 3\n"],
    max_output_bytes: 4096,
    platform_allowed_imports: [],
  })
  const process = Bun.spawn([
    python!,
    "docker/role-c-python-runner/runner.py",
  ], {
    stdin: new Blob([payload]),
    stdout: "pipe",
    stderr: "pipe",
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ])
  expect(exitCode, stderr).toBe(0)
  expect(JSON.parse(stdout)).toEqual({
    status: "completed",
    results: [{ outcome: "returned", actual: "6\n" }],
  })
})
