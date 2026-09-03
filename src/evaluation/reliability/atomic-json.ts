import { writeFile, rename, unlink } from "node:fs/promises"

/** A terminated process leaves either the previous complete JSON or the new one. */
export async function writeEvaluationJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${crypto.randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 })
    await rename(temporary, path)
  } finally {
    await unlink(temporary).catch(() => undefined)
  }
}
