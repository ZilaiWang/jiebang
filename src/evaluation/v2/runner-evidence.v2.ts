import { mkdir, appendFile } from "node:fs/promises"
import { join } from "node:path"
import { contentHash } from "../../role-c-content/contracts/common"
import {
  createDockerPythonCodeRunnerFromEnv,
  type CodeRunner,
} from "../../role-c-content/security/code-runner"

/** Private evidence of actual executions. Never copied into published reports. */
export async function createEvaluationRunnerV2(
  directory: string,
  env?: Record<string, string | undefined>,
): Promise<CodeRunner> {
  const runner = await createDockerPythonCodeRunnerFromEnv(env)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  return {
    runner_image_digest: runner.runner_image_digest,
    async execute(request) {
      const started = performance.now()
      const result = await runner.execute(request)
      await appendFile(
        join(directory, "docker-executions.jsonl"),
        JSON.stringify({
          recorded_at: new Date().toISOString(),
          duration_ms: performance.now() - started,
          request_hash: contentHash(request),
          test_suite_id: request.test_suite_id,
          code: request.code,
          test_suite: request.test_suite,
          derive_expected: request.derive_expected === true,
          result,
        }) + "\n",
        { mode: 0o600 },
      )
      return result
    },
  }
}
