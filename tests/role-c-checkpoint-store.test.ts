import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { contentHash } from "../src/role-c-content/contracts/common"
import { pipelineCheckpointHash } from "../src/role-c-content/orchestrator/content-pipeline"
import { pipelineInputHash } from "../src/role-c-content/reliability/content-cache"
import { AtomicFilePipelineCheckpointStore } from "../src/role-c-content/reliability/checkpoint-store"

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("private Role C generation checkpoints", () => {
  test("keeps the same successful-stage checkpoint while changing the failed-stage model request", () => {
    const base: any = {
      generation_spec: { spec_id: "SPEC-1", run_id: "RUN-1" },
      evidence_pack: { retrieval_id: "RAG-1" },
      prior_assessment_items: [],
    }
    const retry = {
      ...base,
      generation_recovery: {
        attempt: 1,
        failed_stage: "assessment",
        issue_codes: ["ASSESSMENT_SCHEMA_INVALID"],
        failure_fingerprint: "failure-1",
      },
    }

    expect(pipelineCheckpointHash(retry)).toBe(pipelineCheckpointHash(base))
    expect(pipelineInputHash(retry)).not.toBe(pipelineInputHash(base))
  })

  test("durably restores a verified code-lab stage and rejects tampering", async () => {
    const root = await mkdtemp(join(tmpdir(), "role-c-checkpoint-"))
    directories.push(root)
    const store = new AtomicFilePipelineCheckpointStore(root)
    const inputHash = contentHash({ spec: "S", evidence: "E" })
    const checkpoint: any = {
      input_hash: inputHash,
      stage: "code_lab_ready",
      concept: { artifact_id: "CONCEPT-1" },
      code_lab: {
        public_artifact: { artifact_id: "LAB-PUBLIC-1" },
        secure_artifact: { artifact_id: "LAB-SECURE-1", hidden: "private" },
      },
    }

    await store.save(checkpoint)
    expect(await store.load(inputHash)).toEqual(checkpoint)

    const file = join(root, `${inputHash.slice(7)}.json`)
    const envelope = JSON.parse(await readFile(file, "utf8"))
    envelope.checkpoint.code_lab.secure_artifact.hidden = "tampered"
    await writeFile(file, JSON.stringify(envelope), "utf8")
    expect(await store.load(inputHash)).toBeUndefined()
  })

  test("persists a semantic plan before concept generation starts", async () => {
    const root = await mkdtemp(join(tmpdir(), "role-c-semantic-checkpoint-"))
    directories.push(root)
    const store = new AtomicFilePipelineCheckpointStore(root)
    const inputHash = contentHash({ spec: "S2", evidence: "E2" })
    const checkpoint: any = {
      input_hash: inputHash,
      stage: "semantic_plan_ready",
      round_semantic_plan: {
        plan_id: "PLAN-1",
        spec_id: "SPEC-1",
        blueprint_id: "BLUEPRINT-1",
      },
    }
    await store.save(checkpoint)
    expect(await store.load(inputHash)).toEqual(checkpoint)
  })
})
