import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { randomUUID } from "node:crypto"
import { contentHash } from "../contracts/common"

export interface ContentCache<T> {
  get(key: string): Promise<T | undefined>
  put(key: string, value: T): Promise<void>
}

export function pipelineInputHash(input: unknown): string {
  return contentHash({ cache_contract: "role-c-pipeline-v1", input })
}

export class InMemoryContentCache<T> implements ContentCache<T> {
  private readonly entries = new Map<string, T>()
  async get(key: string): Promise<T | undefined> {
    const value = this.entries.get(key)
    return value === undefined ? undefined : structuredClone(value)
  }
  async put(key: string, value: T): Promise<void> { this.entries.set(key, structuredClone(value)) }
}

interface StoredCacheEnvelope<T> { key: string; payload_hash: string; payload: T }

/** Backend-only atomic JSON cache. Files are owner-readable/writable and integrity checked. */
export class AtomicFileContentCache<T> implements ContentCache<T> {
  constructor(private readonly directory: string) {}

  async get(key: string): Promise<T | undefined> {
    try {
      const parsed = JSON.parse(await readFile(this.pathFor(key), "utf8")) as StoredCacheEnvelope<T>
      if (parsed.key !== key || parsed.payload_hash !== contentHash(parsed.payload)) return undefined
      return structuredClone(parsed.payload)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
      throw error
    }
  }

  async put(key: string, value: T): Promise<void> {
    const path = this.pathFor(key)
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    const temp = `${path}.${randomUUID()}.tmp`
    const envelope: StoredCacheEnvelope<T> = { key, payload_hash: contentHash(value), payload: structuredClone(value) }
    try {
      await writeFile(temp, JSON.stringify(envelope), { encoding: "utf8", mode: 0o600, flag: "wx" })
      await rename(temp, path)
      await chmod(path, 0o600)
    } catch (error) {
      await rm(temp, { force: true })
      throw error
    }
  }

  private pathFor(key: string): string {
    const digest = contentHash(key).slice("sha256:".length)
    return join(this.directory, `${digest}.json`)
  }
}
