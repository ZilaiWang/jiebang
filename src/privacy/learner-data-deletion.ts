import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { join, relative, resolve } from "node:path"
import { contentHash } from "../role-c-content/contracts/common"

export interface LearnerDataDeletionResult {
  learner_id: string
  deleted_files: number
  rewritten_files: number
  deleted_paths: string[]
}

const SCANNED_DIRECTORIES = [
  "sessions",
  "learner-memory",
  "paths",
  "mastery",
  "role-c/secure-artifacts",
  "role-c/generation-checkpoints",
  "role-c/learning-cycle",
] as const

/** Remove only one authenticated learner's persisted learning data. */
export async function deleteLearnerData(rootDir: string, learnerId: string): Promise<LearnerDataDeletionResult> {
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(learnerId)) throw new Error("PRIVACY_LEARNER_ID_INVALID")
  const deletedPaths: string[] = []
  let rewrittenFiles = 0

  for (const bucket of SCANNED_DIRECTORIES) {
    const directory = resolve(rootDir, bucket)
    const files = await jsonFiles(directory)
    for (const path of files) {
      if (await fileBelongsToLearner(path, learnerId, bucket)) {
        await rm(path, { force: true })
        deletedPaths.push(path)
      }
    }
  }

  const masteryPath = resolve(rootDir, "mastery/mastery-state.json")
  if (await exists(masteryPath)) {
    const changed = await removeLearnerFromMasterySnapshot(masteryPath, learnerId)
    if (changed) rewrittenFiles += 1
  }

  return { learner_id: learnerId, deleted_files: deletedPaths.length, rewritten_files: rewrittenFiles, deleted_paths: deletedPaths }
}

async function fileBelongsToLearner(path: string, learnerId: string, bucket: string): Promise<boolean> {
  const entry = path.split(/[\\/]/).pop() ?? ""
  if (bucket === "learner-memory" || bucket === "paths") return entry === `${learnerId}.json`
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown
    return containsLearnerIdentity(parsed, learnerId)
  } catch {
    return false
  }
}

function containsLearnerIdentity(value: unknown, learnerId: string): boolean {
  if (typeof value === "string") return false
  if (Array.isArray(value)) return value.some((item) => containsLearnerIdentity(item, learnerId))
  if (!value || typeof value !== "object") return false
  const record = value as Record<string, unknown>
  if (record.learner_id === learnerId || record.owner_id === learnerId || record.learner_id_hash === learnerId) return true
  return Object.values(record).some((item) => containsLearnerIdentity(item, learnerId))
}

async function removeLearnerFromMasterySnapshot(path: string, learnerId: string): Promise<boolean> {
  let envelope: unknown
  try {
    envelope = JSON.parse(await readFile(path, "utf8"))
  } catch {
    return false
  }
  if (!envelope || typeof envelope !== "object") return false
  const root = envelope as { payload?: { entries?: Record<string, { identity?: { learner_id_hash?: string } }> }; payload_hash?: string }
  if (!root.payload?.entries || typeof root.payload_hash !== "string") return false
  const entries = Object.fromEntries(Object.entries(root.payload.entries).filter(([, entry]) => entry.identity?.learner_id_hash !== learnerId))
  if (Object.keys(entries).length === Object.keys(root.payload.entries).length) return false
  const payload = { ...root.payload, entries }
  const next = { ...root, payload, payload_hash: contentHash(payload) }
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(next), { encoding: "utf8", mode: 0o600 })
  await rename(temporary, path)
  await chmod(path, 0o600).catch(() => undefined)
  return true
}

async function jsonFiles(directory: string): Promise<string[]> {
  const result: string[] = []
  async function visit(current: string): Promise<void> {
    let entries
    try { entries = await (await import("node:fs/promises")).readdir(current, { withFileTypes: true }) } catch (error) {
      if (isNotFound(error)) return
      throw error
    }
    for (const entry of entries) {
      const path = resolve(current, entry.name)
      if (relative(directory, path).startsWith("..")) continue
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile() && entry.name.endsWith(".json")) result.push(path)
    }
  }
  await visit(directory)
  return result
}

async function exists(path: string): Promise<boolean> {
  try { await readFile(path); return true } catch (error) { if (isNotFound(error)) return false; throw error }
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT")
}
