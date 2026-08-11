import { createHash, randomBytes } from "node:crypto"
import { chmod, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { AssessmentSecureArtifact, CodeLabSecureArtifact } from "../contracts/artifacts"
import { contentHash } from "../contracts/common"
import { validateRoleCSchema } from "../validators/runtime-schema-validator"
import { protectSensitivePath } from "../../security/windows-secure-acl"

export type SecureArtifact = CodeLabSecureArtifact | AssessmentSecureArtifact
export type SecureStorePrincipal = "role-c-pipeline" | "role-c-grader" | "role-c-admin"
export type SecureStoreOperation = "write" | "read" | "delete"

export interface SecureStoreContext {
  principal: SecureStorePrincipal
  run_id: string
}

export interface SecureStoreAuthorizationRequest extends SecureStoreContext {
  operation: SecureStoreOperation
  artifact_type?: SecureArtifact["artifact_type"]
}

export type SecureStoreAuthorizer = (request: SecureStoreAuthorizationRequest) => boolean

/** Backend trust boundary. Public/D-facing code receives refs, never values from get(). */
export interface SecureArtifactStore {
  /** Stable only for the lifetime/storage namespace in which opaque refs remain resolvable. */
  readonly namespace_id?: string
  put(artifact: SecureArtifact, context: SecureStoreContext): Promise<string>
  putBatch(artifacts: SecureArtifact[], context: SecureStoreContext): Promise<string[]>
  get(ref: string, context: SecureStoreContext): Promise<SecureArtifact>
  /** Deletes complete storage transactions only; partial-batch deletion is rejected. */
  deleteBatch(refs: string[], context: SecureStoreContext): Promise<void>
}

export class SecureArtifactStoreError extends Error {
  constructor(
    readonly code: "ACCESS_DENIED" | "INVALID_ARTIFACT" | "INVALID_REF" | "NOT_FOUND" | "INTEGRITY_ERROR" | "STORAGE_ERROR",
    message: string,
  ) {
    super(message)
    this.name = "SecureArtifactStoreError"
  }
}

export interface AtomicFileSecureArtifactStoreOptions {
  root_directory: string
  authorize?: SecureStoreAuthorizer
}

interface StoredEnvelope {
  storage_version: "1.0"
  run_id: string
  artifact_id: string
  artifact_type: SecureArtifact["artifact_type"]
  sha256: string
  artifact: SecureArtifact
}

/**
 * Local/backend implementation. A whole batch becomes visible through one atomic
 * directory rename; temporary data is removed on failure. Files are owner-only.
 */
export class AtomicFileSecureArtifactStore implements SecureArtifactStore {
  readonly namespace_id: string
  private readonly authorize: SecureStoreAuthorizer

  constructor(private readonly options: AtomicFileSecureArtifactStoreOptions) {
    if (!options.root_directory.trim()) throw new SecureArtifactStoreError("STORAGE_ERROR", "secure store root_directory 不能为空")
    this.authorize = options.authorize ?? defaultAuthorize
    this.namespace_id = contentHash({ kind: "atomic-file-secure-store-v1", root_directory: options.root_directory })
  }

  async put(artifact: SecureArtifact, context: SecureStoreContext): Promise<string> {
    return (await this.putBatch([artifact], context))[0]
  }

  async putBatch(artifacts: SecureArtifact[], context: SecureStoreContext): Promise<string[]> {
    if (artifacts.length === 0) return []
    assertUniqueArtifactIds(artifacts)
    artifacts.forEach((artifact) => {
      this.assertAuthorized({ ...context, operation: "write", artifact_type: artifact.artifact_type })
      validateSecureArtifact(artifact, context.run_id)
    })
    await mkdir(this.options.root_directory, { recursive: true, mode: 0o700 })
    await chmod(this.options.root_directory, 0o700)
    await protectSensitivePath(this.options.root_directory, "directory")
    const batchToken = randomToken()
    const temporaryDirectory = join(this.options.root_directory, `.tmp-${batchToken}`)
    const finalDirectory = join(this.options.root_directory, `batch-${batchToken}`)
    const itemTokens = artifacts.map(() => randomToken())
    try {
      await mkdir(temporaryDirectory, { mode: 0o700 })
      await protectSensitivePath(temporaryDirectory, "directory")
      for (const [index, artifact] of artifacts.entries()) {
        const artifactJson = JSON.stringify(artifact)
        const envelope: StoredEnvelope = {
          storage_version: "1.0",
          run_id: context.run_id,
          artifact_id: artifact.artifact_id,
          artifact_type: artifact.artifact_type,
          sha256: sha256(artifactJson),
          artifact,
        }
        const artifactPath = join(temporaryDirectory, `${itemTokens[index]}.json`)
        await writeFile(
          artifactPath,
          JSON.stringify(envelope),
          { encoding: "utf8", flag: "wx", mode: 0o600 },
        )
        await protectSensitivePath(artifactPath, "file")
      }
      await rename(temporaryDirectory, finalDirectory)
      await chmod(finalDirectory, 0o700).catch(() => undefined)
      await protectSensitivePath(finalDirectory, "directory")
      return itemTokens.map((itemToken) => secureRef(batchToken, itemToken))
    } catch (error) {
      await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined)
      if (error instanceof SecureArtifactStoreError) throw error
      throw new SecureArtifactStoreError("STORAGE_ERROR", safeErrorMessage(error, "secure artifact 批量写入失败"))
    }
  }

  async get(ref: string, context: SecureStoreContext): Promise<SecureArtifact> {
    this.assertAuthorized({ ...context, operation: "read" })
    const { batchToken, itemToken } = parseSecureRef(ref)
    const path = join(this.options.root_directory, `batch-${batchToken}`, `${itemToken}.json`)
    let envelope: StoredEnvelope
    try {
      envelope = JSON.parse(await readFile(path, "utf8")) as StoredEnvelope
    } catch (error) {
      if (isMissing(error)) throw new SecureArtifactStoreError("NOT_FOUND", "secure artifact 不存在")
      throw new SecureArtifactStoreError("STORAGE_ERROR", safeErrorMessage(error, "secure artifact 读取失败"))
    }
    if (!isStoredEnvelope(envelope)) {
      throw new SecureArtifactStoreError("INTEGRITY_ERROR", "secure artifact 存储信封格式无效")
    }
    if (envelope.run_id !== context.run_id || envelope.artifact.run_id !== context.run_id) {
      throw new SecureArtifactStoreError("ACCESS_DENIED", "run_id 无权读取该 secure artifact")
    }
    this.assertAuthorized({ ...context, operation: "read", artifact_type: envelope.artifact_type })
    const actualHash = sha256(JSON.stringify(envelope.artifact))
    if (actualHash !== envelope.sha256 || envelope.artifact_id !== envelope.artifact.artifact_id) {
      throw new SecureArtifactStoreError("INTEGRITY_ERROR", "secure artifact 完整性校验失败")
    }
    validateSecureArtifact(envelope.artifact, context.run_id)
    return structuredClone(envelope.artifact)
  }

  async deleteBatch(refs: string[], context: SecureStoreContext): Promise<void> {
    this.assertAuthorized({ ...context, operation: "delete" })
    const batches = groupSecureRefs(refs)
    for (const [batchToken, itemTokens] of batches) {
      const directory = join(this.options.root_directory, `batch-${batchToken}`)
      let storedTokens: string[]
      try {
        storedTokens = (await readdir(directory))
          .filter((entry) => entry.endsWith(".json"))
          .map((entry) => entry.slice(0, -5))
      } catch (error) {
        if (isMissing(error)) throw new SecureArtifactStoreError("NOT_FOUND", "secure artifact batch 不存在")
        throw new SecureArtifactStoreError("STORAGE_ERROR", safeErrorMessage(error, "secure artifact batch 读取失败"))
      }
      if (!sameStringSet(storedTokens, itemTokens)) {
        throw new SecureArtifactStoreError("INVALID_REF", "deleteBatch 必须提供同一存储事务的全部引用")
      }
      for (const itemToken of itemTokens) {
        const envelope = await readStoredEnvelope(join(directory, `${itemToken}.json`))
        if (envelope.run_id !== context.run_id || envelope.artifact.run_id !== context.run_id) {
          throw new SecureArtifactStoreError("ACCESS_DENIED", "run_id 无权删除该 secure artifact")
        }
        this.assertAuthorized({ ...context, operation: "delete", artifact_type: envelope.artifact_type })
        assertStoredEnvelopeIntegrity(envelope, context.run_id)
      }
    }
    for (const batchToken of batches.keys()) {
      await rm(join(this.options.root_directory, `batch-${batchToken}`), { recursive: true, force: true })
    }
  }

  private assertAuthorized(request: SecureStoreAuthorizationRequest): void {
    if (!this.authorize(request)) throw new SecureArtifactStoreError("ACCESS_DENIED", `${request.principal} 无权执行 ${request.operation}`)
  }
}

/** Fast test/development substitute with the same opaque-ref and authorization semantics. */
export class InMemorySecureArtifactStore implements SecureArtifactStore {
  readonly namespace_id = `memory:${randomToken()}`
  private readonly batches = new Map<string, Map<string, SecureArtifact>>()
  private readonly authorize: SecureStoreAuthorizer

  constructor(authorize: SecureStoreAuthorizer = defaultAuthorize) {
    this.authorize = authorize
  }

  async put(artifact: SecureArtifact, context: SecureStoreContext): Promise<string> {
    return (await this.putBatch([artifact], context))[0]
  }

  async putBatch(artifacts: SecureArtifact[], context: SecureStoreContext): Promise<string[]> {
    if (artifacts.length === 0) return []
    assertUniqueArtifactIds(artifacts)
    artifacts.forEach((artifact) => {
      assertAuthorized(this.authorize, { ...context, operation: "write", artifact_type: artifact.artifact_type })
      validateSecureArtifact(artifact, context.run_id)
    })
    const batchToken = randomToken()
    const batch = new Map<string, SecureArtifact>()
    const refs = artifacts.map((artifact) => {
      const token = randomToken()
      batch.set(token, structuredClone(artifact))
      return secureRef(batchToken, token)
    })
    this.batches.set(batchToken, batch)
    return refs
  }

  async get(ref: string, context: SecureStoreContext): Promise<SecureArtifact> {
    assertAuthorized(this.authorize, { ...context, operation: "read" })
    const { batchToken, itemToken } = parseSecureRef(ref)
    const artifact = this.batches.get(batchToken)?.get(itemToken)
    if (!artifact) throw new SecureArtifactStoreError("NOT_FOUND", "secure artifact 不存在")
    if (artifact.run_id !== context.run_id) throw new SecureArtifactStoreError("ACCESS_DENIED", "run_id 无权读取该 secure artifact")
    assertAuthorized(this.authorize, { ...context, operation: "read", artifact_type: artifact.artifact_type })
    return structuredClone(artifact)
  }

  async deleteBatch(refs: string[], context: SecureStoreContext): Promise<void> {
    assertAuthorized(this.authorize, { ...context, operation: "delete" })
    const batches = groupSecureRefs(refs)
    for (const [batchToken, itemTokens] of batches) {
      const batch = this.batches.get(batchToken)
      if (!batch) throw new SecureArtifactStoreError("NOT_FOUND", "secure artifact batch 不存在")
      if (!sameStringSet([...batch.keys()], itemTokens)) {
        throw new SecureArtifactStoreError("INVALID_REF", "deleteBatch 必须提供同一存储事务的全部引用")
      }
      for (const itemToken of itemTokens) {
        const artifact = batch.get(itemToken)
        if (!artifact) throw new SecureArtifactStoreError("NOT_FOUND", "secure artifact 不存在")
        if (artifact.run_id !== context.run_id) {
          throw new SecureArtifactStoreError("ACCESS_DENIED", "run_id 无权删除该 secure artifact")
        }
        assertAuthorized(this.authorize, { ...context, operation: "delete", artifact_type: artifact.artifact_type })
      }
    }
    for (const batchToken of batches.keys()) this.batches.delete(batchToken)
  }
}

function validateSecureArtifact(artifact: SecureArtifact, runId: string): void {
  if (artifact.run_id !== runId || artifact.status !== "ready" || !artifact.payload) {
    throw new SecureArtifactStoreError("INVALID_ARTIFACT", "只能保存同一 run_id 下的 ready secure artifact")
  }
  const schema = artifact.artifact_type === "code_lab_secure"
    ? "code_lab_secure.schema.json"
    : "assessment_secure.schema.json"
  const report = validateRoleCSchema(schema, artifact)
  if (!report.ok) {
    throw new SecureArtifactStoreError("INVALID_ARTIFACT", `secure artifact Schema 无效：${report.issues.map((entry) => entry.path).join("、")}`)
  }
}

function assertUniqueArtifactIds(artifacts: SecureArtifact[]): void {
  if (new Set(artifacts.map((artifact) => artifact.artifact_id)).size !== artifacts.length) {
    throw new SecureArtifactStoreError("INVALID_ARTIFACT", "同一 secure batch 中的 artifact_id 必须唯一")
  }
}

function defaultAuthorize(request: SecureStoreAuthorizationRequest): boolean {
  if (request.operation === "write") return ["role-c-pipeline", "role-c-admin"].includes(request.principal)
  if (request.operation === "read") return ["role-c-pipeline", "role-c-grader", "role-c-admin"].includes(request.principal)
  return ["role-c-pipeline", "role-c-admin"].includes(request.principal)
}

function assertAuthorized(authorize: SecureStoreAuthorizer, request: SecureStoreAuthorizationRequest): void {
  if (!authorize(request)) throw new SecureArtifactStoreError("ACCESS_DENIED", `${request.principal} 无权执行 ${request.operation}`)
}

function secureRef(batchToken: string, itemToken: string): string {
  return `secure://role-c/v1/${batchToken}/${itemToken}`
}

function parseSecureRef(ref: string): { batchToken: string; itemToken: string } {
  const match = ref.match(/^secure:\/\/role-c\/v1\/([a-f0-9]{48})\/([a-f0-9]{48})$/)
  if (!match) throw new SecureArtifactStoreError("INVALID_REF", "secure ref 格式无效")
  return { batchToken: match[1], itemToken: match[2] }
}

function groupSecureRefs(refs: string[]): Map<string, string[]> {
  const batches = new Map<string, string[]>()
  for (const ref of refs) {
    const { batchToken, itemToken } = parseSecureRef(ref)
    const tokens = batches.get(batchToken) ?? []
    if (tokens.includes(itemToken)) throw new SecureArtifactStoreError("INVALID_REF", "secure ref 不能重复")
    tokens.push(itemToken)
    batches.set(batchToken, tokens)
  }
  return batches
}

function sameStringSet(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((entry) => right.includes(entry))
}

function randomToken(): string {
  return randomBytes(24).toString("hex")
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT")
}

function safeErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback
  return `${fallback}：${error.name}`
}

function isStoredEnvelope(value: unknown): value is StoredEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const envelope = value as Record<string, unknown>
  const artifact = envelope.artifact
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) return false
  const artifactRecord = artifact as Record<string, unknown>
  return envelope.storage_version === "1.0"
    && typeof envelope.run_id === "string"
    && typeof envelope.artifact_id === "string"
    && (envelope.artifact_type === "code_lab_secure" || envelope.artifact_type === "assessment_secure")
    && typeof envelope.sha256 === "string"
    && artifactRecord.artifact_type === envelope.artifact_type
    && typeof artifactRecord.run_id === "string"
    && typeof artifactRecord.artifact_id === "string"
}

async function readStoredEnvelope(path: string): Promise<StoredEnvelope> {
  let value: unknown
  try {
    value = JSON.parse(await readFile(path, "utf8"))
  } catch (error) {
    if (isMissing(error)) throw new SecureArtifactStoreError("NOT_FOUND", "secure artifact 不存在")
    throw new SecureArtifactStoreError("STORAGE_ERROR", safeErrorMessage(error, "secure artifact 读取失败"))
  }
  if (!isStoredEnvelope(value)) {
    throw new SecureArtifactStoreError("INTEGRITY_ERROR", "secure artifact 存储信封格式无效")
  }
  return value
}

function assertStoredEnvelopeIntegrity(envelope: StoredEnvelope, runId: string): void {
  const actualHash = sha256(JSON.stringify(envelope.artifact))
  if (actualHash !== envelope.sha256 || envelope.artifact_id !== envelope.artifact.artifact_id) {
    throw new SecureArtifactStoreError("INTEGRITY_ERROR", "secure artifact 完整性校验失败")
  }
  validateSecureArtifact(envelope.artifact, runId)
}

/** Used only by tests/operations to verify directory permissions without exposing content. */
export async function secureStoreDirectoryMode(path: string): Promise<number> {
  return (await stat(path)).mode & 0o777
}
