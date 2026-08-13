import type { AssessmentArtifactPair, CodeLabArtifactPair, ConceptLessonArtifact } from "../contracts/artifacts"
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { contentHash } from "../contracts/common"
import { protectSensitivePath } from "../../security/windows-secure-acl"

export interface CPipelineCheckpoint {
  input_hash: string
  stage: "concept_ready" | "code_lab_ready" | "branches_ready"
  concept: ConceptLessonArtifact
  code_lab?: CodeLabArtifactPair
  assessment?: AssessmentArtifactPair
}

export interface CPipelineCheckpointStore {
  load(inputHash: string): Promise<CPipelineCheckpoint | undefined>
  save(checkpoint: CPipelineCheckpoint): Promise<void>
  delete(inputHash: string): Promise<void>
}

export class InMemoryPipelineCheckpointStore implements CPipelineCheckpointStore {
  private readonly values = new Map<string, CPipelineCheckpoint>()
  async load(inputHash: string): Promise<CPipelineCheckpoint | undefined> {
    const value = this.values.get(inputHash)
    return value ? structuredClone(value) : undefined
  }
  async save(checkpoint: CPipelineCheckpoint): Promise<void> {
    if (checkpoint.stage === "code_lab_ready" && !checkpoint.code_lab) {
      throw new Error("code_lab_ready checkpoint 缺少代码实验产物")
    }
    if (checkpoint.stage === "branches_ready" && (!checkpoint.code_lab || !checkpoint.assessment)) {
      throw new Error("branches_ready checkpoint 缺少分支产物")
    }
    this.values.set(checkpoint.input_hash, structuredClone(checkpoint))
  }
  async delete(inputHash: string): Promise<void> { this.values.delete(inputHash) }
}

interface StoredCheckpointEnvelope {
  storage_version: "1.0"
  input_hash: string
  checkpoint_hash: string
  checkpoint: CPipelineCheckpoint
}

/** Durable private checkpoint store. Secure drafts never enter public/session data. */
export class AtomicFilePipelineCheckpointStore implements CPipelineCheckpointStore {
  constructor(private readonly rootDirectory: string) {
    if (!rootDirectory.trim()) throw new Error("checkpoint rootDirectory 不能为空")
  }

  async load(inputHash: string): Promise<CPipelineCheckpoint | undefined> {
    const path = this.pathFor(inputHash)
    try {
      const envelope = JSON.parse(await readFile(path, "utf8")) as StoredCheckpointEnvelope
      if (envelope.storage_version !== "1.0"
        || envelope.input_hash !== inputHash
        || envelope.checkpoint.input_hash !== inputHash
        || envelope.checkpoint_hash !== contentHash(envelope.checkpoint)) {
        await rm(path, { force: true }).catch(() => undefined)
        return undefined
      }
      return structuredClone(envelope.checkpoint)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
      return undefined
    }
  }

  async save(checkpoint: CPipelineCheckpoint): Promise<void> {
    assertCheckpointShape(checkpoint)
    await mkdir(this.rootDirectory, { recursive: true, mode: 0o700 })
    await chmod(this.rootDirectory, 0o700)
    await protectSensitivePath(this.rootDirectory, "directory")
    const finalPath = this.pathFor(checkpoint.input_hash)
    const temporaryPath = `${finalPath}.tmp-${process.pid}-${Date.now()}`
    const envelope: StoredCheckpointEnvelope = {
      storage_version: "1.0",
      input_hash: checkpoint.input_hash,
      checkpoint_hash: contentHash(checkpoint),
      checkpoint,
    }
    try {
      await writeFile(temporaryPath, JSON.stringify(envelope), {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      })
      await protectSensitivePath(temporaryPath, "file")
      await rename(temporaryPath, finalPath)
      await chmod(finalPath, 0o600).catch(() => undefined)
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined)
      throw error
    }
  }

  async delete(inputHash: string): Promise<void> {
    await rm(this.pathFor(inputHash), { force: true })
  }

  private pathFor(inputHash: string): string {
    if (!/^sha256:[a-f0-9]{64}$/.test(inputHash)) {
      throw new Error("checkpoint input_hash 格式无效")
    }
    return join(this.rootDirectory, `${inputHash.slice(7)}.json`)
  }
}

function assertCheckpointShape(checkpoint: CPipelineCheckpoint): void {
  if (checkpoint.stage === "code_lab_ready" && !checkpoint.code_lab) {
    throw new Error("code_lab_ready checkpoint 缺少代码实验产物")
  }
  if (checkpoint.stage === "branches_ready"
    && (!checkpoint.code_lab || !checkpoint.assessment)) {
    throw new Error("branches_ready checkpoint 缺少分支产物")
  }
}
