import { describe, expect, test } from "bun:test"
import {
  continueRoleCAfterSubmission,
} from "../src/role-d-integration/role-c-service"
import {
  InMemoryLearningCycleStore,
  InMemoryMasteryStateStore,
  InMemorySecureArtifactStore,
  type RoleDAdaptiveLearningLoopPort,
} from "../src/role-c-content"
import { interactiveSessionProductionBoundary } from "../src/orchestration/interactive-session"

const durableRoleDPort: RoleDAdaptiveLearningLoopPort = {
  async publishReviewedRelease(delivery) {
    return { schema_version: "1.0", delivery_kind: delivery.delivery_kind, delivery_id: delivery.delivery_id, status: "accepted" }
  },
  async publishLearningSession(delivery) {
    return { schema_version: "1.0", delivery_kind: delivery.delivery_kind, delivery_id: delivery.delivery_id, status: "accepted" }
  },
  async publishReviewRecoveryStatus(delivery) {
    return { schema_version: "1.0", delivery_kind: delivery.delivery_kind, delivery_id: delivery.delivery_id, status: "accepted" }
  },
}

describe("Role C production continuation wiring", () => {
  test("fails closed before continuation work when no durable Role D receiver is configured", async () => {
    const result = await continueRoleCAfterSubmission({
      sessionId: "SESSION-NOT-USED",
      submissionId: "SUB-NOT-USED",
      learnerId: "learner-not-used",
    }, {
      provider: {} as any,
      runner: {
        runner_image_digest: `sha256:${"d".repeat(64)}`,
        async execute() {
          throw new Error("runner must not be called")
        },
      },
      learningPersistence: {
        cycleStore: new InMemoryLearningCycleStore(),
        secureStore: new InMemorySecureArtifactStore(),
        masteryStore: new InMemoryMasteryStateStore(),
      },
    })

    expect(result).toEqual({
      status: "blocked",
      stage: "configuration",
      reason: "Role D durable delivery port is not configured",
    })
  })

  test("continues to the durable C session lookup after a real Role D receiver is configured", async () => {
    const result = await continueRoleCAfterSubmission({
      sessionId: "SESSION-MISSING",
      submissionId: "SUB-MISSING",
      learnerId: "learner-missing",
    }, {
      provider: {} as any,
      runner: {
        runner_image_digest: `sha256:${"d".repeat(64)}`,
        async execute() {
          throw new Error("runner must not be called")
        },
      },
      learningPersistence: {
        cycleStore: new InMemoryLearningCycleStore(),
        secureStore: new InMemorySecureArtifactStore(),
        masteryStore: new InMemoryMasteryStateStore(),
      },
      roleDPort: durableRoleDPort,
    })

    expect(result).toEqual({
      status: "blocked",
      stage: "preparation",
      reason: "学习会话不存在或学习者身份不一致",
    })
  })

  test("declares the interactive production boundary as durable C-B-A-C continuation", () => {
    expect(interactiveSessionProductionBoundary()).toEqual({
      adapter_workers: ["profile-builder", "path-planner"],
      reviewed_role_c_workers: ["concept-tutor", "code-lab", "tiered-evaluator"],
      review_port: "local-ab-content-review",
      learning_progress_port: "role-b-learning-progress-adapter",
      continuation: "continue-role-c-after-submission",
      delivery_port: "durable-interactive-role-d",
      adaptive_journal: "atomic-file",
    })
  })
})
