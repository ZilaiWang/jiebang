import { createDockerPythonCodeRunnerFromEnv } from "../src/role-c-content"

const runner = await createDockerPythonCodeRunnerFromEnv()

console.log(JSON.stringify({
  status: "ready",
  runner_mode: "docker",
  runner_image_digest: runner.runner_image_digest,
}, null, 2))
