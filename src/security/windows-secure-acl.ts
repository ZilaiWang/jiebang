import { execFile } from "node:child_process"
import { userInfo } from "node:os"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

export type SensitivePathKind = "directory" | "file"
export type SecurePathAclRunner = (args: string[]) => Promise<string>

export interface ProtectSensitivePathOptions {
  platform?: NodeJS.Platform
  username?: string
  run?: SecurePathAclRunner
}

export class SecurePathProtectionError extends Error {
  readonly code = "SECURE_PATH_ACL_FAILED"

  constructor(path: string, cause?: unknown) {
    super(`Failed to restrict sensitive path ACL: ${path}`, { cause })
    this.name = "SecurePathProtectionError"
  }
}

/**
 * POSIX callers must still set 0700/0600. On Windows those mode bits are not a
 * confidentiality boundary, so replace inherited access with the current user
 * and LocalSystem only. Any ACL error is fatal: callers must not continue with
 * a sensitive artifact whose protection could not be established.
 */
export async function protectSensitivePath(
  path: string,
  _kind: SensitivePathKind,
  options: ProtectSensitivePathOptions = {},
): Promise<void> {
  if ((options.platform ?? process.platform) !== "win32") return

  const username = options.username ?? currentWindowsIdentity()
  const run = options.run ?? runIcacls
  try {
    await run([path, "/reset"])
    await run([path, "/inheritance:r", "/grant:r", `${username}:F`, "SYSTEM:F"])
    const acl = await run([path])
    verifyRestrictedAcl(path, username, acl)
  } catch (error) {
    if (error instanceof SecurePathProtectionError) throw error
    throw new SecurePathProtectionError(path, error)
  }
}

async function runIcacls(args: string[]): Promise<string> {
  const result = await execFileAsync("icacls.exe", args, { windowsHide: true })
  return `${result.stdout}${result.stderr}`
}

function currentWindowsIdentity(): string {
  const info = userInfo()
  const domain = process.env.USERDOMAIN?.trim()
  return domain ? `${domain}\\${info.username}` : info.username
}

function verifyRestrictedAcl(path: string, username: string, acl: string): void {
  const normalized = acl.toLowerCase().replaceAll("/", "\\")
  const expectedUser = username.toLowerCase().replaceAll("/", "\\")
  const hasUser = normalized.includes(`${expectedUser}:`)
    || normalized.includes(`${expectedUser}:(`)
    || normalized.includes(`\\${expectedUser.split("\\").at(-1)}:(`)
  const hasSystem = normalized.includes("system:(") || normalized.includes("nt authority\\system:(")
  const broadPrincipals = [
    "everyone:(",
    "builtin\\users:(",
    "authenticated users:(",
    "用户:(",
  ]
  if (!hasUser || !hasSystem || broadPrincipals.some((principal) => normalized.includes(principal))) {
    throw new SecurePathProtectionError(path, new Error("icacls verification did not prove owner/SYSTEM-only access"))
  }
}
