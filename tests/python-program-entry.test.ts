import { describe, expect, test } from "bun:test"
import { validatePythonProgramEntry } from "../src/role-c-content/security/python-program-entry"
import { ensureZeroArgumentFunctionIsInvoked } from "../src/role-c-content/providers/model-backed-provider"

describe("stdin/stdout Python program entry", () => {
  test("rejects a main guard plus a second top-level call", () => {
    expect(validatePythonProgramEntry(`
def main():
    print(input())

if __name__ == "__main__":
    main()

main()
`)).toEqual([expect.objectContaining({ code: "duplicate_program_entry" })])
  })

  test("accepts either one guard or one top-level call", () => {
    expect(validatePythonProgramEntry(`
def main():
    print(input())

if __name__ == "__main__":
    main()
`)).toEqual([])
    expect(validatePythonProgramEntry(`
def solve():
    print(input())

solve()
`)).toEqual([])
  })

  test("does not mistake a helper call inside a function for module entry", () => {
    expect(validatePythonProgramEntry(`
def helper():
    return 1

def main():
    print(helper())

main()
`)).toEqual([])
  })

  test("normalization preserves a conventional main guard without appending a duplicate call", () => {
    const source = `
def main():
    print(input())

if __name__ == "__main__":
    main()
`
    expect(ensureZeroArgumentFunctionIsInvoked(source)).toBe(source)
    expect(validatePythonProgramEntry(ensureZeroArgumentFunctionIsInvoked(source))).toEqual([])
  })

  test("normalization does not append an earlier helper when main already owns module entry", () => {
    const source = `
def parse_input():
    return input().strip()

def main():
    print(parse_input())

if __name__ == "__main__":
    main()
`
    expect(ensureZeroArgumentFunctionIsInvoked(source)).toBe(source)
    expect(ensureZeroArgumentFunctionIsInvoked(source)).not.toContain("\nparse_input()\n")
    expect(validatePythonProgramEntry(ensureZeroArgumentFunctionIsInvoked(source))).toEqual([])
  })

  test("normalization prefers a conventional main function over earlier helpers", () => {
    const normalized = ensureZeroArgumentFunctionIsInvoked(`
def parse_input():
    return input().strip()

def main():
    print(parse_input())
`)
    expect(normalized.match(/^main\(\)$/gmu)).toHaveLength(1)
    expect(normalized).not.toContain("\nparse_input()\n")
  })

  test("normalization appends one entry only when the program has none", () => {
    const normalized = ensureZeroArgumentFunctionIsInvoked(`
def solve():
    print(input())
`)
    expect(normalized.match(/^solve\(\)$/gmu)).toHaveLength(1)
    expect(validatePythonProgramEntry(normalized)).toEqual([])
  })
})
