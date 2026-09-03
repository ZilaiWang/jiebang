import type { CodeLabPublicPayload } from "../contracts/artifacts"
import type { CodeRunner, CodeExecutionResult } from "./code-runner"
import { invocationFileFixtures, validateFileFixtures } from "./file-fixtures"

export function publicLabInputCases(payload: CodeLabPublicPayload) {
  const entries = [
    ...payload.public_tests.map(test => ({ case_id: test.test_id, input: test.input })),
    ...(payload.programming_task?.public_examples ?? []).map(test => ({ case_id: test.case_id, input: test.input })),
  ]
  return entries.filter((entry, index) => entries.findIndex(other => other.case_id === entry.case_id) === index)
}

/** Probe the real reference on public inputs as well as hidden tests. No private output is published. */
export async function executePublicLabInputs(runner: CodeRunner, payload: CodeLabPublicPayload, reference: string): Promise<CodeExecutionResult> {
  const inputs = publicLabInputCases(payload)
  const suite = {
    test_suite_id: `${payload.lab_id}-PUBLIC-INPUT-PROBE`, execution_contract: payload.execution_contract,
    tests: inputs.map(entry => ({ test_id: entry.case_id, input: entry.input, expected: null, objective_id: payload.objective_ids[0]!, weight: 1, comparison: { kind: "exact" as const } })),
  }
  return runner.execute({ language: "python", code: reference, test_suite_id: suite.test_suite_id, test_suite: suite,
    ...payload.execution_contract.resource_limits, network_allowed: false, derive_expected: true })
}

export function applyPublicFileFixtures(payload: CodeLabPublicPayload, entries: Array<{ case_id: string; files: Record<string, string> }>): CodeLabPublicPayload {
  const cases = publicLabInputCases(payload)
  if (entries.length !== cases.length || new Set(entries.map(e => e.case_id)).size !== cases.length) throw new Error("public_fixture_case_mismatch")
  const files = new Map(entries.map(entry => {
    const target = cases.find(c => c.case_id === entry.case_id)
    if (!target || !target.input || typeof target.input !== "object" || !Array.isArray((target.input as { args?: unknown }).args)) throw new Error("public_fixture_case_mismatch")
    validateFileFixtures(entry.files)
    const previous = invocationFileFixtures(target.input) ?? {}
    for (const [name, text] of Object.entries(previous)) if (entry.files[name] !== text) throw new Error("public_fixture_existing_content_changed")
    return [entry.case_id, entry.files] as const
  }))
  const result = structuredClone(payload)
  for (const test of result.public_tests) test.input = { ...(test.input as object), files: structuredClone(files.get(test.test_id)!) }
  for (const test of result.programming_task?.public_examples ?? []) test.input = { ...(test.input as object), files: structuredClone(files.get(test.case_id)!) }
  return result
}
