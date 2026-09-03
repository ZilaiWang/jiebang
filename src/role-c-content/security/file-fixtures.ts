/** Optional function invocation envelope field, shared by public debug and private tests. */
export const FILE_FIXTURE_LIMITS = Object.freeze({ max_files: 16, max_total_bytes: 65_536 })

export function validateFileFixtures(files: unknown): asserts files is Record<string, string> {
  if (!files || typeof files !== "object" || Array.isArray(files)) throw new Error("invalid_file_fixtures")
  const entries = Object.entries(files)
  if (entries.length > FILE_FIXTURE_LIMITS.max_files) throw new Error("file_fixture_count_exceeded")
  let bytes = 0
  for (const [name, content] of entries) {
    if (!name || name === "." || name === ".." || /[/\\:\u0000]/u.test(name) || name.length > 120) throw new Error("invalid_fixture_filename")
    if (typeof content !== "string") throw new Error("file_fixture_text_required")
    bytes += Buffer.byteLength(content, "utf8")
  }
  if (bytes > FILE_FIXTURE_LIMITS.max_total_bytes) throw new Error("file_fixture_bytes_exceeded")
}

export function invocationFileFixtures(input: unknown): Record<string, string> | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined
  const invocation = input as Record<string, unknown>
  if (!Array.isArray(invocation.args) || invocation.files === undefined) return undefined
  validateFileFixtures(invocation.files)
  return invocation.files
}
