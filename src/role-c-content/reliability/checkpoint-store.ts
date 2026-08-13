import type { AssessmentArtifactPair, CodeLabArtifactPair, ConceptLessonArtifact } from "../contracts/artifacts"

export interface CPipelineCheckpoint {
  input_hash: string
  stage: "concept_ready" | "branches_ready"
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
    if (checkpoint.stage === "branches_ready" && (!checkpoint.code_lab || !checkpoint.assessment)) {
      throw new Error("branches_ready checkpoint 缺少分支产物")
    }
    this.values.set(checkpoint.input_hash, structuredClone(checkpoint))
  }
  async delete(inputHash: string): Promise<void> { this.values.delete(inputHash) }
}
