import { describe, expect, test } from "bun:test"
import { protectSensitivePath, type SecurePathAclRunner } from "../src/security/windows-secure-acl"

describe("Windows sensitive-path ACL protection", () => {
  test("uses and verifies an owner-and-SYSTEM-only ACL recipe on Windows", async () => {
    const commands: string[][] = []
    const runner: SecurePathAclRunner = async (args) => {
      commands.push(args)
      return args.length === 1
        ? "C:\\secure\\provider-config.json WORKSTATION\\alice:(F)\r\n                                  NT AUTHORITY\\SYSTEM:(F)\r\nSuccessfully processed 1 files; Failed processing 0 files\r\n"
        : ""
    }

    await protectSensitivePath("C:/secure/provider-config.json", "file", {
      platform: "win32",
      username: "WORKSTATION\\alice",
      run: runner,
    })

    expect(commands).toEqual([
      ["C:/secure/provider-config.json", "/reset"],
      ["C:/secure/provider-config.json", "/inheritance:r", "/grant:r", "WORKSTATION\\alice:F", "SYSTEM:F"],
      ["C:/secure/provider-config.json"],
    ])
  })

  test("is a no-op on POSIX platforms", async () => {
    let invoked = false
    await protectSensitivePath("/tmp/provider-config.json", "file", {
      platform: "linux",
      run: async () => { invoked = true; return "" },
    })
    expect(invoked).toBe(false)
  })

  test("fails closed when Windows ACL hardening command fails", async () => {
    await expect(protectSensitivePath("C:/secure", "directory", {
      platform: "win32",
      username: "alice",
      run: async () => { throw new Error("icacls denied") },
    })).rejects.toMatchObject({ code: "SECURE_PATH_ACL_FAILED" })
  })

  test("fails closed when ACL verification finds an additional principal", async () => {
    const runner: SecurePathAclRunner = async (args) => args.length === 1
      ? "C:\\secure WORKSTATION\\alice:(F)\r\n          NT AUTHORITY\\SYSTEM:(F)\r\n          BUILTIN\\Users:(RX)\r\nSuccessfully processed 1 files; Failed processing 0 files\r\n"
      : ""

    await expect(protectSensitivePath("C:/secure", "directory", {
      platform: "win32",
      username: "WORKSTATION\\alice",
      run: runner,
    })).rejects.toMatchObject({ code: "SECURE_PATH_ACL_FAILED" })
  })
})
